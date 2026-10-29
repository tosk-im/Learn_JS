(function () {
    'use strict';

    var NAME = 'lampa_usm_core';
    var VERSION = '1.2.3';
    var STORAGE = 'lampa_usm_config_v3';

    if (window[NAME]) {
        console.log('[USM] Плагин уже загружен.');
        return;
    }
    window[NAME] = true;

    var DEFAULTS = { timeout: 5000, max_parallel: 4, min_quality: 0, sources: {}, health: {} };

    function copy(o) { return JSON.parse(JSON.stringify(o)); }

    function load() {
        try {
            var value = Lampa.Storage.get(STORAGE);
            if (!value) return copy(DEFAULTS);
            var data = typeof value === 'string' ? JSON.parse(value) : value;
            return {
                timeout: Number(data.timeout) || DEFAULTS.timeout,
                max_parallel: Number(data.max_parallel) || DEFAULTS.max_parallel,
                min_quality: Number(data.min_quality) || 0,
                sources: data.sources || {},
                health: data.health || {}
            };
        } catch (e) {
            console.error('[USM] Ошибка загрузки настроек:', e);
            return copy(DEFAULTS);
        }
    }

    var state = load();
    function save() { Lampa.Storage.set(STORAGE, state); }
    var providers = {};

    function register(provider) {
        if (!provider || !provider.id || typeof provider.search !== 'function') {
            console.error('[USM] Некорректный провайдер:', provider);
            return;
        }
        providers[provider.id] = provider;
        if (typeof state.sources[provider.id] === 'undefined') {
            state.sources[provider.id] = { enabled: true, priority: 100 };
            save();
        }
        console.log('[USM] Зарегистрирован источник:', provider.id);
        return provider.id;
    }

    function unregister(id) { delete providers[id]; delete state.sources[id]; save(); }

    function quality(value) {
        if (!value) return 0;
        var text = String(value).toUpperCase().replace(/\s/g, '');
        var map = { '4K': 2160, '2160P': 2160, 'UHD': 2160, '2K': 1440, '1440P': 1440, 'FHD': 1080, '1080P': 1080, 'HD': 720, '720P': 720, 'SD': 480, '480P': 480 };
        if (map[text]) return map[text];
        var match = text.match(/(\d{3,4})P/);
        return match ? parseInt(match[1], 10) : 0;
    }

    function normalize(item, provider) {
        if (!item || !item.url) return null;
        var q = item.quality || item.resolution || '';
        return {
            id: String(item.id || item.url), title: item.title || '', url: item.url, type: item.type || 'auto',
            quality: q, quality_value: quality(q), voice: item.voice || item.translation || '',
            subtitles: !!item.subtitles, source: item.source || provider.title, source_id: provider.id,
            size: item.size || 0, language: item.language || 'ru', metadata: item.metadata || {}
        };
    }

    function fingerprint(item) {
        return [String(item.title).toLowerCase().trim(), item.quality_value, String(item.voice || '').toLowerCase().trim(), item.type, item.url].join('|');
    }

    function dedupe(items) {
        var seen = {}, output = [];
        items.forEach(function (item) {
            var key = fingerprint(item);
            if (!seen[key]) { seen[key] = true; output.push(item); }
        });
        return output;
    }

    function rank(a, b) {
        var pa = state.sources[a.source_id] || {}, pb = state.sources[b.source_id] || {};
        if ((pb.priority || 0) !== (pa.priority || 0)) return (pb.priority || 0) - (pa.priority || 0);
        if (b.quality_value !== a.quality_value) return b.quality_value - a.quality_value;
        return String(a.source).localeCompare(String(b.source));
    }

    function request(url, success, fail) {
        var RequestClass = Lampa.Request || Lampa.Reguest;
        if (!RequestClass) { if (fail) fail(new Error('Lampa.Request/Reguest не найден')); return; }
        var req = new RequestClass();
        var finished = false;
        var timer = setTimeout(function () { if (finished) return; finished = true; if (fail) fail(new Error('timeout')); }, state.timeout);
        req.silent(url, function (data) {
            if (finished) return; finished = true; clearTimeout(timer); if (success) success(data);
        }, function (error) {
            if (finished) return; finished = true; clearTimeout(timer); if (fail) fail(error);
        });
    }

    function run(tasks, limit, complete) {
        var cursor = 0, active = 0, results = [], errors = [];
        function next() {
            if (cursor >= tasks.length && active === 0) { complete(results, errors); return; }
            while (active < limit && cursor < tasks.length) {
                (function (task) {
                    active++;
                    task(function (err, data) {
                        active--;
                        if (err) errors.push(err);
                        if (data && data.length) results = results.concat(data);
                        next();
                    });
                })(tasks[cursor++]);
            }
        }
        next();
    }

    function search(movie, callback) {
        var list = Object.keys(providers).map(function (id) { return providers[id]; })
            .filter(function (provider) { var cfg = state.sources[provider.id] || {}; return cfg.enabled !== false && provider.enabled !== false; })
            .sort(function (a, b) { var pa = state.sources[a.id] || {}, pb = state.sources[b.id] || {}; return (pb.priority || 0) - (pa.priority || 0); });

        var tasks = list.map(function (provider) {
            return function (done) {
                var started = Date.now(), completed = false;
                function finish(error, items) {
                    if (completed) return; completed = true;
                    var normalized = (items || []).map(function (item) { return normalize(item, provider); })
                        .filter(Boolean).filter(function (item) { return item.quality_value >= state.min_quality; });
                    state.health[provider.id] = { last_check: Date.now(), online: !error, response_ms: Date.now() - started, error: error ? String(error.message || error) : '' };
                    save(); done(error, normalized);
                }
                try { provider.search(movie, finish); } catch (error) { finish(error, []); }
            };
        });
        run(tasks, Math.max(1, state.max_parallel), function (items, errors) {
            callback({ results: dedupe(items).sort(rank), errors: errors, providers: list.length, health: copy(state.health) });
        });
    }

    function health(id, callback) {
        var provider = providers[id];
        if (!provider) { callback(new Error('Unknown provider'), false); return; }
        if (typeof provider.health !== 'function') { callback(null, null); return; }
        var started = Date.now(), done = false;
        var timer = setTimeout(function () {
            if (done) return; done = true;
            state.health[id] = { last_check: Date.now(), online: false, response_ms: Date.now() - started, error: 'timeout' };
            save(); callback(new Error('timeout'), false);
        }, state.timeout);
        provider.health(function (error, online) {
            if (done) return; done = true; clearTimeout(timer);
            state.health[id] = { last_check: Date.now(), online: online !== false, response_ms: Date.now() - started, error: error ? String(error.message || error) : '' };
            save(); callback(error || null, online !== false);
        });
    }

    function setEnabled(id, enabled) {
        if (!state.sources[id]) state.sources[id] = { enabled: !!enabled, priority: 100 };
        else state.sources[id].enabled = !!enabled;
        save();
    }

    function setPriority(id, priority) {
        if (!state.sources[id]) state.sources[id] = { enabled: true, priority: Number(priority) || 0 };
        else state.sources[id].priority = Number(priority) || 0;
        save();
    }

    function clearHealth() { state.health = {}; save(); }

    function adapterJson(definition) {
        if (!definition || !definition.endpoint) {
            return { id: definition?.id || 'unknown', title: definition?.title || 'Unknown', search: function (m, done) { done(new Error('Endpoint не указан'), []); } };
        }
        return {
            id: definition.id, title: definition.title, enabled: definition.enabled !== false,
            search: function (movie, done) {
                var title = movie.title || movie.name || '';
                var date = movie.release_date || movie.first_air_date || '';
                var year = String(date).slice(0, 4);
                var url = definition.endpoint + '?q=' + encodeURIComponent(title) + '&year=' + encodeURIComponent(year) + '&tmdb=' + encodeURIComponent(movie.id || '');
                request(url, function (data) { done(null, data && Array.isArray(data.results) ? data.results : []); }, function (error) { done(error, []); });
            }
        };
    }

    function statusFor(id) {
        var h = state.health[id];
        if (!h) return { icon: '⚪', text: 'не проверен', ms: '' };
        if (h.online === false) return { icon: '🔴', text: 'недоступен', ms: h.response_ms ? h.response_ms + ' ms' : '' };
        if (h.online === true) return { icon: '🟢', text: 'доступен', ms: h.response_ms ? h.response_ms + ' ms' : '' };
        return { icon: '⚪', text: 'не проверен', ms: '' };
    }

    function providerRows() {
        return Object.keys(providers).map(function (id) {
            var p = providers[id];
            var cfg = state.sources[id] || { enabled: true, priority: 100 };
            var status = statusFor(id);
            return { id: id, title: p.title || id, enabled: cfg.enabled !== false, priority: Number(cfg.priority || 0), status: status };
        }).sort(function (a, b) { return (b.priority || 0) - (a.priority || 0) || String(a.title).localeCompare(String(b.title)); });
    }

    function escapeHtml(text) {
        return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function settingsHTML() {
        var rows = providerRows();
        var html = '<div class="usm-panel"><div class="usm-title">Universal Source Manager</div><div class="usm-subtitle">v' + VERSION + ' • Источники и состояние</div>';
        if (!rows.length) html += '<div class="usm-empty">Источники ещё не подключены.<br><small>Добавьте их через LampaUSM.register()</small></div>';
        rows.forEach(function (row) {
            html += '<div class="usm-row" data-usm-id="' + escapeHtml(row.id) + '">';
            html += '<div class="usm-main"><div class="usm-name">' + escapeHtml(row.status.icon + ' ' + row.title) + '</div>';
            html += '<div class="usm-meta">' + escapeHtml(row.status.text) + (row.status.ms ? ' · ' + escapeHtml(row.status.ms) : '') + '</div></div>';
            html += '<label class="usm-toggle"><input type="checkbox" data-usm-toggle="' + escapeHtml(row.id) + '"' + (row.enabled ? ' checked' : '') + '><span></span></label>';
            html += '<input class="usm-priority" type="number" min="0" max="999" data-usm-priority="' + escapeHtml(row.id) + '" value="' + row.priority + '">';
            html += '<button class="usm-test" data-usm-test="' + escapeHtml(row.id) + '">Проверить</button></div>';
        });
        html += '<div class="usm-actions"><button class="usm-test-all">Проверить все</button><button class="usm-clear-health">Сбросить статусы</button></div>';
        html += '<div class="usm-global">';
        html += '<label>Таймаут, мс <input id="usm-timeout" type="number" min="500" max="30000" value="' + state.timeout + '"></label>';
        html += '<label>Параллельных запросов <input id="usm-parallel" type="number" min="1" max="12" value="' + state.max_parallel + '"></label>';
        html += '<label>Мин. качество <input id="usm-quality" type="number" min="0" max="2160" value="' + state.min_quality + '"></label></div></div>';
        return html;
    }

    function injectStyles() {
        if (document.getElementById('lampa-usm-style')) return;
        var style = document.createElement('style');
        style.id = 'lampa-usm-style';
        style.textContent = '.usm-panel{padding:1.5em;color:#fff;font-size:1em}.usm-title{font-size:1.35em;font-weight:600;margin-bottom:.25em}.usm-subtitle{opacity:.6;margin-bottom:1em}.usm-row{display:flex;align-items:center;gap:.7em;padding:.8em 0;border-bottom:1px solid rgba(255,255,255,.08)}.usm-main{flex:1;min-width:0}.usm-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.usm-meta{font-size:.8em;opacity:.55;margin-top:.25em}.usm-toggle input{width:1.2em;height:1.2em}.usm-priority{width:4.5em;background:rgba(255,255,255,.08);color:#fff;border:0;padding:.5em;border-radius:.35em}.usm-test,.usm-actions button{background:rgba(255,255,255,.1);color:#fff;border:0;border-radius:.4em;padding:.55em .8em}.usm-test:active,.usm-actions button:active{transform:scale(.97)}.usm-actions{display:flex;gap:.6em;margin-top:1em}.usm-global{display:flex;flex-direction:column;gap:.7em;margin-top:1.2em;padding-top:1em;border-top:1px solid rgba(255,255,255,.08)}.usm-global label{display:flex;justify-content:space-between;gap:1em}.usm-global input{width:7em;background:rgba(255,255,255,.08);color:#fff;border:0;border-radius:.35em;padding:.5em}.usm-empty{padding:2em 0;opacity:.65}';
        document.head.appendChild(style);
    }

    function bindSettingsEvents() {
        var root = document.querySelector('.usm-panel');
        if (!root) return;
        root.querySelectorAll('[data-usm-toggle]').forEach(function (el) { el.addEventListener('change', function () { setEnabled(el.getAttribute('data-usm-toggle'), el.checked); }); });
        root.querySelectorAll('[data-usm-priority]').forEach(function (el) { el.addEventListener('change', function () { setPriority(el.getAttribute('data-usm-priority'), parseInt(el.value, 10) || 0); }); });
        root.querySelectorAll('[data-usm-test]').forEach(function (el) {
            el.addEventListener('click', function () {
                var id = el.getAttribute('data-usm-test');
                el.disabled = true; el.textContent = '...';
                health(id, function () { el.disabled = false; el.textContent = 'Проверить'; refreshSettings(); });
            });
        });
        var all = root.querySelector('.usm-test-all');
        if (all) {
            all.addEventListener('click', function () {
                var ids = Object.keys(providers), index = 0;
                all.disabled = true; all.textContent = 'Проверка...';
                function next() { if (index >= ids.length) { all.disabled = false; all.textContent = 'Проверить все'; refreshSettings(); return; } health(ids[index++], next); }
                next();
            });
        }
        var clear = root.querySelector('.usm-clear-health');
        if (clear) clear.addEventListener('click', function () { clearHealth(); refreshSettings(); });
        var timeout = root.querySelector('#usm-timeout');
        if (timeout) timeout.addEventListener('change', function () { state.timeout = Math.max(500, Math.min(30000, parseInt(timeout.value, 10) || 5000)); save(); });
        var parallel = root.querySelector('#usm-parallel');
        if (parallel) parallel.addEventListener('change', function () { state.max_parallel = Math.max(1, Math.min(12, parseInt(parallel.value, 10) || 4)); save(); });
        var quality = root.querySelector('#usm-quality');
        if (quality) quality.addEventListener('change', function () { state.min_quality = Math.max(0, Math.min(2160, parseInt(quality.value, 10) || 0)); save(); });
    }

    function openSettings() {
        injectStyles();
        try {
            if (Lampa.Modal && Lampa.Modal.open) {
                var htmlContent = (typeof $ === 'function') ? $(settingsHTML()) : settingsHTML();
                Lampa.Modal.open({
                    title: 'Менеджер источников',
                    html: htmlContent,
                    onBack: function () { return true; }
                });
                setTimeout(bindSettingsEvents, 150);
                return;
            }
        } catch (e) {
            console.error('[USM] Ошибка открытия Modal:', e);
        }
        if (Lampa.Noty) {
            Lampa.Noty.show('Менеджер источников: ' + Object.keys(providers).length + ' шт.');
        } else {
            alert('Менеджер источников: ' + Object.keys(providers).length + ' шт.');
        }
    }

    function refreshSettings() {
        if (Lampa.Modal && Lampa.Modal.close) Lampa.Modal.close();
        setTimeout(openSettings, 100);
    }

    function addSettings() {
        if (!window.Lampa || !Lampa.SettingsApi) {
            console.warn('[USM] Lampa или SettingsApi ещё не загружены. Ждём...');
            return false;
        }
        if (window[NAME + '_settings_registered']) return true;
        try {
            console.log('[USM] Попытка регистрации в настройках...');
            Lampa.SettingsApi.addComponent({
                component: NAME,
                name: 'Менеджер источников',
                icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 0h6v6h-6v-6z" fill="currentColor"/></svg>'
            });
            Lampa.SettingsApi.addParam({
                component: NAME,
                param: { name: NAME + '_open_manager', type: 'button' },
                field: { name: 'Открыть менеджер источников', description: 'Управление подключёнными источниками и приоритетами' },
                onRender: function (item) {
                    if (item && typeof item.on === 'function') {
                        item.on('hover:enter click', function () { console.log('[USM] Кнопка нажата'); openSettings(); });
                    } else if (item && item.addEventListener) {
                        item.addEventListener('click', function () { console.log('[USM] Кнопка нажата (addEventListener)'); openSettings(); });
                    }
                },
                onChange: function () { openSettings(); }
            });
            window[NAME + '_settings_registered'] = true;
            console.log('[USM] ✅ Настройки успешно зарегистрированы!');
            return true;
        } catch (e) {
            console.error('[USM] ❌ Ошибка регистрации настроек:', e);
            return false;
        }
    }

    var started = false;
    function start() {
        if (started) return;
        started = true;
        console.log('[USM] Запуск инициализации v' + VERSION + '...');
        if (!addSettings()) {
            var attempts = 0;
            var retry = setInterval(function () {
                attempts++;
                if (addSettings() || attempts >= 20) {
                    clearInterval(retry);
                    if (attempts >= 20) console.error('[USM] Не удалось зарегистрировать настройки после 20 попыток.');
                }
            }, 500);
        }
    }

    if (window.appready) {
        start();
    } else if (Lampa.Listener) {
        Lampa.Listener.follow('app', function (event) { if (event.type === 'ready') start(); });
    } else {
        setTimeout(start, 2000);
    }

    window.LampaUSM = {
        version: VERSION, state: state, providers: providers,
        register: register, unregister: unregister, search: search, health: health,
        setEnabled: setEnabled, setPriority: setPriority, clearHealth: clearHealth,
        adapterJson: adapterJson, save: save, openSettings: openSettings,
        list: function () { return providerRows(); },
        exportConfig: function () { return JSON.stringify(state, null, 2); },
        reset: function () { state = copy(DEFAULTS); save(); return state; }
    };
    console.log('[USM] API доступен через объект window.LampaUSM');
})();
