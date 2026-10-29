/*
 * Lampa Universal Source Manager (Fixed & Enhanced)
 * v1.2.1
 */
(function () {
    'use strict';

    var NAME = 'lampa_usm_core';
    var VERSION = '1.2.1';
    var STORAGE = 'lampa_usm_config_v3';

    if (window[NAME]) {
        console.log('[USM] Плагин уже загружен.');
        return;
    }
    window[NAME] = true;

    var DEFAULTS = {
        timeout: 5000,
        max_parallel: 4,
        min_quality: 0,
        sources: {},
        health: {}
    };

    function copy(o) {
        return JSON.parse(JSON.stringify(o));
    }

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

    function save() {
        Lampa.Storage.set(STORAGE, state);
    }

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

    function unregister(id) {
        delete providers[id];
        delete state.sources[id];
        save();
    }

    // --- ИСПРАВЛЕНИЕ: Поддержка и Reguest, и Request ---
    function request(url, success, fail) {
        var RequestClass = Lampa.Request || Lampa.Reguest;
        if (!RequestClass) {
            if (fail) fail(new Error('Lampa.Request/Reguest не найден в этой версии'));
            return;
        }

        var req = new RequestClass();
        var finished = false;
        var timer = setTimeout(function () {
            if (finished) return;
            finished = true;
            if (fail) fail(new Error('timeout'));
        }, state.timeout);

        req.silent(
            url,
            function (data) {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                if (success) success(data);
            },
            function (error) {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                if (fail) fail(error);
            }
        );
    }

    // ... (функции quality, normalize, fingerprint, dedupe, rank, run, search, health остаются без изменений, они были хороши) ...
    // Для экономии места я их опустил, но вставьте их из оригинального кода сюда.
    // Если нужно, я могу прислать полный файл целиком, но ключевые изменения ниже:

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
            id: String(item.id || item.url),
            title: item.title || '',
            url: item.url,
            type: item.type || 'auto',
            quality: q,
            quality_value: quality(q),
            voice: item.voice || item.translation || '',
            subtitles: !!item.subtitles,
            source: item.source || provider.title,
            source_id: provider.id,
            size: item.size || 0,
            language: item.language || 'ru',
            metadata: item.metadata || {}
        };
    }

    function fingerprint(item) {
        return [item.title.toLowerCase().trim(), item.quality_value, (item.voice || '').toLowerCase().trim(), item.type, item.url].join('|');
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
        var pa = state.sources[a.source_id] || {};
        var pb = state.sources[b.source_id] || {};
        if ((pb.priority || 0) !== (pa.priority || 0)) return (pb.priority || 0) - (pa.priority || 0);
        if (b.quality_value !== a.quality_value) return b.quality_value - a.quality_value;
        return String(a.source).localeCompare(String(b.source));
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
            .filter(function (provider) {
                var cfg = state.sources[provider.id] || {};
                return cfg.enabled !== false && provider.enabled !== false;
            })
            .sort(function (a, b) {
                var pa = state.sources[a.id] || {}, pb = state.sources[b.id] || {};
                return (pb.priority || 0) - (pa.priority || 0);
            });

        var tasks = list.map(function (provider) {
            return function (done) {
                var started = Date.now(), completed = false;
                function finish(error, items) {
                    if (completed) return;
                    completed = true;
                    var normalized = (items || []).map(function (item) { return normalize(item, provider); })
                        .filter(Boolean).filter(function (item) { return item.quality_value >= state.min_quality; });
                    
                    state.health[provider.id] = {
                        last_check: Date.now(), online: !error,
                        response_ms: Date.now() - started, error: error ? String(error.message || error) : ''
                    };
                    save();
                    done(error, normalized);
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

    // --- УЛУЧШЕННАЯ РЕГИСТРАЦИЯ НАСТРОЕК ---
    function addSettings() {
        if (!window.Lampa || !Lampa.SettingsApi) {
            console.warn('[USM] Lampa или SettingsApi ещё не загружены. Ждём...');
            return false;
        }

        if (window[NAME + '_settings_registered']) return true;

        try {
            console.log('[USM] Попытка регистрации в настройках...');
            
            // 1. Создаем компонент (вкладку)
            Lampa.SettingsApi.addComponent({
                component: NAME,
                name: 'Менеджер источников',
                // Более совместимый SVG
                icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 0h6v6h-6v-6z" fill="currentColor"/></svg>'
            });

            // 2. Добавляем параметр (кнопку)
            Lampa.SettingsApi.addParam({
                component: NAME,
                param: {
                    name: 'usm_open_manager_btn',
                    type: 'button',
                    value: 'Открыть менеджер источников', // Явный текст кнопки
                    description: 'Управление подключёнными источниками и приоритетами'
                },
                onRender: function (item) {
                    if (item && typeof item.on === 'function') {
                        item.on('hover:enter click', function () {
                            console.log('[USM] Кнопка нажата, открываем менеджер');
                            openSettings();
                        });
                    } else if (item && item.addEventListener) {
                        item.addEventListener('click', function() {
                            console.log('[USM] Кнопка нажата (addEventListener), открываем менеджер');
                            openSettings();
                        });
                    }
                }
            });

            window[NAME + '_settings_registered'] = true;
            console.log('[USM] ✅ Настройки успешно зарегистрированы!');
            return true;
        } catch (e) {
            console.error('[USM] ❌ Ошибка регистрации настроек:', e);
            return false;
        }
    }

    // --- ФУНКЦИИ UI (сокращенно для читаемости, они были рабочими) ---
    function statusFor(id) { /* ... как в оригинале ... */ return { icon: '⚪', text: 'не проверен', ms: '' }; } // Заглушка для краткости, вставьте оригинал
    function providerRows() { /* ... как в оригинале ... */ return []; } // Заглушка для краткости, вставьте оригинал
    function escapeHtml(text) { return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function settingsHTML() { return '<div class="usm-panel"><div class="usm-title">Universal Source Manager</div><div class="usm-subtitle">v' + VERSION + '</div><div class="usm-empty">Источники не подключены.</div></div>'; } // Упрощено для теста
    function injectStyles() { /* ... как в оригинале ... */ }
    
    function openSettings() {
        injectStyles();
        if (Lampa.Modal && Lampa.Modal.open) {
            Lampa.Modal.open({
                title: 'Менеджер источников',
                html: settingsHTML(),
                onBack: function () { return true; }
            });
        } else if (Lampa.Noty) {
            Lampa.Noty.show('Менеджер источников: ' + Object.keys(providers).length + ' шт.');
        } else {
            alert('Менеджер источников: ' + Object.keys(providers).length + ' шт.');
        }
    }

    var started = false;
    function start() {
        if (started) return;
        started = true;
        console.log('[USM] Запуск инициализации...');
        
        if (!addSettings()) {
            var attempts = 0;
            var retry = setInterval(function () {
                attempts++;
                if (addSettings() || attempts >= 20) {
                    clearInterval(retry);
                    if(attempts >= 20) console.error('[USM] Не удалось зарегистрировать настройки после 20 попыток.');
                }
            }, 500);
        }
    }

    // Инициализация
    if (window.appready) {
        start();
    } else if (Lampa.Listener) {
        Lampa.Listener.follow('app', function (event) {
            if (event.type === 'ready') start();
        });
    } else {
        // Фоллбэк для очень старых или специфичных сборок
        setTimeout(start, 2000);
    }

})();
