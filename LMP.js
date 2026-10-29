(function () {
    'use strict';
    console.log('[USM] Начало загрузки файла v1.8.0...');

    var NAME = 'lampa_usm_core';
    var VERSION = '1.8.0';
    var STORAGE = 'lampa_usm_config_v5';
    var MENU_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 0h6v6h-6v-6z"/></svg>';

    if (window[NAME]) { console.log('[USM] Плагин уже загружен.'); return; }
    window[NAME] = true;

    var DEFAULTS = { timeout: 5000, max_parallel: 4, min_quality: 0, sources: {}, health: {}, iptv_urls: [], vod_urls: [], api_sources: [], intercept: true };
    var PRIO_LIST = [10, 50, 100, 150, 200, 300];
    var TIMEOUT_LIST = [2000, 5000, 8000, 10000, 15000, 30000];
    var PARALLEL_LIST = [1, 2, 4, 6, 8, 12];
    var QUALITY_LIST = [0, 480, 720, 1080, 2160];

    function copy(o) { return JSON.parse(JSON.stringify(o)); }
    function cycle(list, current) { var i = list.indexOf(Number(current)); return list[(i + 1) % list.length]; }

    function load() {
        try {
            var value = Lampa.Storage.get(STORAGE);
            if (!value) return copy(DEFAULTS);
            var data = typeof value === 'string' ? JSON.parse(value) : value;
            return {
                timeout: Number(data.timeout) || DEFAULTS.timeout,
                max_parallel: Number(data.max_parallel) || DEFAULTS.max_parallel,
                min_quality: Number(data.min_quality) || 0,
                sources: data.sources || {}, health: data.health || {},
                iptv_urls: Array.isArray(data.iptv_urls) ? data.iptv_urls : [],
                vod_urls: Array.isArray(data.vod_urls) ? data.vod_urls : [],
                api_sources: Array.isArray(data.api_sources) ? data.api_sources : [],
                intercept: data.intercept !== false
            };
        } catch (e) { return copy(DEFAULTS); }
    }

    var state = load();
    function save() { Lampa.Storage.set(STORAGE, state); }
    var providers = {};

    function register(provider) {
        if (!provider || !provider.id || typeof provider.search !== 'function') return;
        providers[provider.id] = provider;
        if (typeof state.sources[provider.id] === 'undefined') { state.sources[provider.id] = { enabled: true, priority: 100 }; save(); }
        return provider.id;
    }
    function unregister(id) { delete providers[id]; delete state.sources[id]; save(); }
    function setEnabled(id, enabled) {
        if (!state.sources[id]) state.sources[id] = { enabled: !!enabled, priority: 100 };
        else state.sources[id].enabled = !!enabled;
        save();
    }
    function clearHealth() { state.health = {}; save(); }

    function jsonGet(url, ok, fail) {
        var R = Lampa.Request || Lampa.Reguest;
        var r = new R();
        r.silent(url, function (d) {
            if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) {} }
            ok(d);
        }, function (e) { fail(e); });
    }

    function health(id, callback) {
        var provider = providers[id];
        if (!provider) { callback(new Error('Unknown'), false); return; }
        if (typeof provider.health !== 'function') { callback(null, null); return; }
        var started = Date.now(), done = false;
        var timer = setTimeout(function () {
            if (done) return; done = true;
            state.health[id] = { last_check: Date.now(), online: false, response_ms: Date.now() - started, error: 'timeout' };
            save(); callback(new Error('timeout'), false);
        }, state.timeout);
        try {
            provider.health(function (error, online) {
                if (done) return; done = true; clearTimeout(timer);
                state.health[id] = { last_check: Date.now(), online: online !== false, response_ms: Date.now() - started, error: error ? String(error.message || error) : '' };
                save(); callback(error || null, online !== false);
            });
        } catch (e) { if (!done) { done = true; clearTimeout(timer); callback(e, false); } }
    }

    function checkAll(callback) {
        var ids = Object.keys(providers), index = 0;
        function next() { if (index >= ids.length) { callback(); return; } health(ids[index++], next); }
        next();
    }

    function statusFor(id) {
        var h = state.health[id];
        if (!h) return { icon: '⚪', text: 'не проверен', ms: '' };
        if (h.online === false) return { icon: '🔴', text: 'недоступен', ms: h.response_ms ? h.response_ms + ' ms' : '' };
        return { icon: '🟢', text: 'доступен', ms: h.response_ms ? h.response_ms + ' ms' : '' };
    }

    function providerRows() {
        return Object.keys(providers).map(function (id) {
            var p = providers[id];
            var cfg = state.sources[id] || { enabled: true, priority: 100 };
            return { id: id, title: p.title || id, enabled: cfg.enabled !== false, priority: Number(cfg.priority || 0), status: statusFor(id) };
        }).sort(function (a, b) { return (b.priority || 0) - (a.priority || 0) || String(a.title).localeCompare(String(b.title)); });
    }

    function escapeHtml(text) {
        return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function rowTpl(act, id, name, meta) {
        return '<div class="selector usm-row" data-act="' + act + '" data-id="' + escapeHtml(id || '') + '">' +
            '<div class="usm-main"><div class="usm-name">' + escapeHtml(name) + '</div>' +
            '<div class="usm-meta">' + escapeHtml(meta || '') + '</div></div>' +
            '<div class="usm-hint">Enter ▸</div></div>';
    }

    function settingsHTML() {
        var rows = providerRows();
        var html = '<div class="usm-panel"><div class="usm-title">Universal Source Manager</div><div class="usm-subtitle">v' + VERSION + '</div>';

        html += '<div class="usm-section-title">📺 IPTV (' + state.iptv_urls.length + ')</div>';
        html += rowTpl('add-iptv', '', '➕ Добавить IPTV плейлист', 'M3U URL для ТВ каналов');
        html += rowTpl('catalog-iptv', '', '📺 Каталог каналов', 'Сетка с логотипами и группами');
        html += rowTpl('refresh-iptv', '', '🔄 Обновить кэш IPTV', 'Скачать заново');
        state.iptv_urls.forEach(function (url, index) {
            var s = url.length > 50 ? url.substring(0, 50) + '...' : url;
            html += rowTpl('remove-iptv', String(index), '📺 ' + s, 'Нажмите для удаления');
        });

        html += '<div class="usm-sep"></div>';
        html += '<div class="usm-section-title">🎬 Фильмы и Сериалы (' + state.vod_urls.length + ')</div>';
        html += rowTpl('add-vod', '', '➕ Добавить источник фильмов', 'M3U с VOD или прямой URL');
        html += rowTpl('catalog-vod', '', '🎬 Каталог фильмов', 'Сетка с обложками');
        html += rowTpl('refresh-vod', '', '🔄 Обновить кэш фильмов', 'Скачать заново');
        state.vod_urls.forEach(function (item, index) {
            var s = (item.name || item.url); if (s.length > 45) s = s.substring(0, 45) + '...';
            html += rowTpl('remove-vod', String(index), '🎬 ' + s, item.type + ' • нажмите для удаления');
        });

        html += '<div class="usm-sep"></div>';
        html += '<div class="usm-section-title">🔌 API источники (' + state.api_sources.length + ')</div>';
        html += rowTpl('add-api', '', '➕ Добавить JSON API', 'Свой сервер или готовый API');
        state.api_sources.forEach(function (src, index) {
            var s = src.endpoint; if (s.length > 45) s = s.substring(0, 45) + '...';
            html += rowTpl('remove-api', String(index), '🔌 ' + src.name, s + ' • нажмите для удаления');
        });

        html += '<div class="usm-sep"></div>';
        html += '<div class="usm-section-title">🎯 Активные источники</div>';
        if (!rows.length) html += '<div class="usm-empty">Источники не подключены.</div>';
        rows.forEach(function (row) {
            html += rowTpl('toggle', row.id, (row.enabled ? '✅ ' : '⛔ ') + row.status.icon + ' ' + row.title, row.status.text + (row.status.ms ? ' · ' + row.status.ms : ''));
            html += rowTpl('prio', row.id, '⚙ Приоритет: ' + row.priority, 'Enter — сменить');
            html += rowTpl('check', row.id, '🔍 Проверить', 'Замерить отклик');
        });

        html += '<div class="usm-sep"></div>';
        html += '<div class="usm-section-title">⚙️ Настройки</div>';
        html += rowTpl('intercept', '', (state.intercept ? '⚡ Перехват «Смотреть»: ВКЛ' : '⚡ Перехват «Смотреть»: ВЫКЛ'), 'USM встраивается в родное окно выбора');
        html += rowTpl('check-all', '', '▶ Проверить все', 'Последовательно');
        html += rowTpl('clear', '', '♻ Сбросить статусы', 'Очистить историю');
        html += rowTpl('timeout', '', '⏱ Таймаут: ' + state.timeout + ' мс', 'Enter — сменить');
        html += rowTpl('parallel', '', '🔀 Параллельных: ' + state.max_parallel, 'Enter — сменить');
        html += rowTpl('quality', '', '🎯 Мин. качество: ' + (state.min_quality || 0), 'Enter — сменить');
        html += '<div class="usm-sep"></div>';
        html += rowTpl('close', '', '✖ Закрыть', 'Esc / назад / клик вне окна');
        html += '</div>';
        return html;
    }

    function injectStyles() {
        if (document.getElementById('lampa-usm-style')) return;
        var style = document.createElement('style');
        style.id = 'lampa-usm-style';
        style.textContent = '.usm-panel{padding:1.5em;color:#fff;font-size:1em;max-height:80vh;overflow-y:auto}.usm-title{font-size:1.35em;font-weight:600;margin-bottom:.25em}.usm-subtitle{opacity:.6;margin-bottom:1em}.usm-section-title{font-size:1.05em;font-weight:600;opacity:.85;margin:1em 0 .6em 0;text-transform:uppercase;letter-spacing:.04em}.usm-row{display:flex;align-items:center;gap:.7em;padding:.9em .8em;margin-bottom:.4em;border-radius:.6em;background:rgba(255,255,255,.05);cursor:pointer;transition:background 0.15s}.usm-row.focus,.usm-row:hover{background:rgba(255,255,255,.16)}.usm-main{flex:1;min-width:0}.usm-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}.usm-meta{font-size:.8em;opacity:.55;margin-top:.25em}.usm-hint{opacity:.35;font-size:.8em}.usm-sep{height:1px;background:rgba(255,255,255,.1);margin:1em 0}.usm-empty{padding:2em 0;opacity:.65}.usm-native-head{padding:.6em .8em;margin-top:.8em;font-size:.85em;font-weight:700;letter-spacing:.05em;color:#e50914;text-transform:uppercase}.usm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;padding-bottom:1em}.usm-chan{background:rgba(255,255,255,.06);border-radius:10px;padding:10px;cursor:pointer;transition:background .15s}.usm-chan.focus,.usm-chan:hover{background:rgba(255,255,255,.18)}';
        document.head.appendChild(style);
    }

    var usmModalOpen = false;
    function closeUsmModal() {
        usmModalOpen = false;
        $(document).off('keydown.usm click.usm');
        if (Lampa.Modal && Lampa.Modal.close) Lampa.Modal.close();
    }
    function openUsmModal(title, htmlOrJq, bindFn) {
        injectStyles();
        var $html = typeof htmlOrJq === 'string' ? $(htmlOrJq) : htmlOrJq;
        if (bindFn) bindFn($html);
        usmModalOpen = true;
        $(document).off('keydown.usm').on('keydown.usm', function (e) { if (e.key === 'Escape' && usmModalOpen) closeUsmModal(); });
        $(document).off('click.usm').on('click.usm', function (e) {
            if (!usmModalOpen) return;
            var t = $(e.target);
            if (t.closest('.usm-panel').length || t.closest('.modal__content').length || t.closest('.selector').length) return;
            closeUsmModal();
        });
        Lampa.Modal.open({ title: title, html: $html, onBack: function () { closeUsmModal(); return true; } });
    }

    // ============ УПРАВЛЕНИЕ ИСТОЧНИКАМИ ============
    function addIPTVPlaylist() {
        var url = prompt('Введите URL M3U плейлиста для IPTV:', 'https://');
        if (!url) return; url = url.trim();
        if (!url || url.indexOf('http') !== 0) { if (Lampa.Noty) Lampa.Noty.show('USM: Некорректный URL'); return; }
        if (state.iptv_urls.indexOf(url) !== -1) { if (Lampa.Noty) Lampa.Noty.show('USM: уже добавлен'); return; }
        state.iptv_urls.push(url); save(); iptvCache = null;
        refreshSettings();
    }
    function removeIPTVPlaylist(index) {
        if (confirm('Удалить этот IPTV плейлист?')) { state.iptv_urls.splice(index, 1); save(); iptvCache = null; refreshSettings(); }
    }
    function refreshIPTVCache() { iptvCache = null; delete state.health['iptv-com-provider']; save(); refreshSettings(); }

    function addVODSource() {
        var name = prompt('Название источника:', '');
        if (!name) return;
        var url = prompt('URL M3U с фильмами или прямой URL видео:', 'https://');
        if (!url) return; url = url.trim();
        if (!url || url.indexOf('http') !== 0) { if (Lampa.Noty) Lampa.Noty.show('USM: Некорректный URL'); return; }
        var type = 'm3u', low = url.toLowerCase();
        if (low.indexOf('.mp4') !== -1 || low.indexOf('.mkv') !== -1 || low.indexOf('.webm') !== -1) type = 'direct';
        state.vod_urls.push({ name: name, url: url, type: type }); save(); vodCache = null;
        refreshSettings();
    }
    function removeVODSource(index) {
        if (confirm('Удалить этот источник фильмов?')) { state.vod_urls.splice(index, 1); save(); vodCache = null; refreshSettings(); }
    }
    function refreshVODCache() { vodCache = null; delete state.health['vod-provider']; save(); refreshSettings(); }

    function mapApiResults(data, srcName) {
        var arr = Array.isArray(data) ? data : (data && (data.results || data.items || data.files) || []);
        return arr.map(function (f, i) {
            return {
                id: srcName + '-' + i,
                title: f.title || f.name || ('Файл ' + (i + 1)),
                url: f.url || f.file || f.link || f.stream || '',
                quality: f.quality || f.resolution || '',
                voice: f.voice || f.translation || f.audio || '',
                logo: f.logo || f.icon || '',
                source: srcName,
                type: f.type || 'movie'
            };
        }).filter(function (f) { return f.url; });
    }

    function registerApiProvider(src) {
        register({
            id: src.id, title: '🔌 ' + src.name,
            search: function (movie, done) {
                var sep = src.endpoint.indexOf('?') === -1 ? '?' : '&';
                var q = encodeURIComponent(movie.title || movie.name || '');
                var year = String(movie.release_date || movie.first_air_date || '').slice(0, 4);
                jsonGet(src.endpoint + sep + 'q=' + q + '&year=' + encodeURIComponent(year) + '&tmdb=' + encodeURIComponent(movie.id || ''),
                    function (d) { done(null, mapApiResults(d, src.name)); },
                    function (e) { done(e, []); });
            },
            health: function (done) {
                var sep = src.endpoint.indexOf('?') === -1 ? '?' : '&';
                jsonGet(src.endpoint + sep + 'health=1', function () { done(null, true); }, function () { done(null, false); });
            }
        });
    }

    function addApiSource() {
        var name = prompt('Название API источника:', '');
        if (!name) return;
        var endpoint = prompt('URL endpoint (JSON {results:[{title,url,quality,voice}]}):', 'https://');
        if (!endpoint || endpoint.indexOf('http') !== 0) { if (Lampa.Noty) Lampa.Noty.show('USM: Некорректный URL'); return; }
        var src = { id: 'api-' + Date.now(), name: name, endpoint: endpoint };
        state.api_sources.push(src); save();
        registerApiProvider(src);
        refreshSettings();
    }
    function removeApiSource(index) {
        var src = state.api_sources[index];
        if (!src) return;
        if (confirm('Удалить API источник "' + src.name + '"?')) {
            unregister(src.id);
            state.api_sources.splice(index, 1); save();
            refreshSettings();
        }
    }

    // ============ КАТАЛОГ: ГРУППЫ + СЕТКА С ЛОГОТИПАМИ ============
    function openCatalog(kind) {
        var loader = kind === 'iptv' ? loadIPTV : loadVOD;
        if (Lampa.Noty) Lampa.Noty.show('USM: загрузка каталога...');
        loader(function (items) {
            if (!items || !items.length) { if (Lampa.Noty) Lampa.Noty.show('USM: каталог пуст — добавьте плейлисты'); return; }
            var groups = {};
            items.forEach(function (i) { var g = i.voice || 'Общие'; groups[g] = (groups[g] || 0) + 1; });
            var gnames = Object.keys(groups).sort(function (a, b) { return groups[b] - groups[a]; });

            var html = '<div class="usm-panel"><div class="usm-title">' + (kind === 'iptv' ? '📺 Каналы' : '🎬 Фильмы') + ': ' + items.length + '</div>';
            html += rowTpl('grid-all', '', '📺 Все каналы', items.length + ' шт.');
            html += rowTpl('grid-search', '', '🔎 Поиск по названию', 'Введите часть имени');
            gnames.slice(0, 40).forEach(function (g) {
                html += rowTpl('grid-group', g, '🗂 ' + g, groups[g] + ' шт.');
            });
            html += '</div>';

            openUsmModal('Каталог USM', html, function ($h) {
                $h.find('.selector').on('hover:enter', function () {
                    var act = this.getAttribute('data-act');
                    var id = this.getAttribute('data-id');
                    if (act === 'grid-all') openGrid(items, kind);
                    else if (act === 'grid-search') {
                        var q = (prompt('Введите название:', '') || '').toLowerCase().trim();
                        if (!q) return;
                        var f = items.filter(function (i) { return i.title.toLowerCase().indexOf(q) !== -1; });
                        if (!f.length) { if (Lampa.Noty) Lampa.Noty.show('USM: не найдено'); return; }
                        openGrid(f, kind);
                    } else if (act === 'grid-group') {
                        openGrid(items.filter(function (i) { return (i.voice || 'Общие') === id; }), kind);
                    }
                });
            });
        });
    }

    function openGrid(items, kind) {
        items = items.slice(0, 300);
        var html = '<div class="usm-panel"><div class="usm-title">' + (kind === 'iptv' ? '📺' : '🎬') + ' ' + items.length + '</div><div class="usm-grid">';
        items.forEach(function (item, idx) {
            var logo = item.logo
                ? '<img src="' + escapeHtml(item.logo) + '" style="width:100%;height:64px;object-fit:contain;background:#fff;border-radius:8px;padding:6px" onerror="this.style.visibility=\'hidden\'">'
                : '<div style="height:64px;display:flex;align-items:center;justify-content:center;font-size:26px;opacity:.45">' + (kind === 'iptv' ? '📺' : '🎬') + '</div>';
            html += '<div class="selector usm-chan" data-idx="' + idx + '">' + logo +
                '<div style="margin-top:8px;font-size:.85em;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(item.title) + '</div></div>';
        });
        html += '</div></div>';
        openUsmModal('Каталог USM', html, function ($h) {
            $h.find('.usm-chan').on('hover:enter', function () {
                var it = items[parseInt(this.getAttribute('data-idx'), 10)];
                playSource(it, it);
            });
        });
    }

    function bindManagerEvents($html) {
        $html.find('.selector').on('hover:enter', function () {
            var act = this.getAttribute('data-act');
            var id = this.getAttribute('data-id');
            if (act === 'close') { closeUsmModal(); return; }
            if (act === 'add-iptv') addIPTVPlaylist();
            else if (act === 'refresh-iptv') refreshIPTVCache();
            else if (act === 'remove-iptv') removeIPTVPlaylist(parseInt(id, 10));
            else if (act === 'catalog-iptv') openCatalog('iptv');
            else if (act === 'add-vod') addVODSource();
            else if (act === 'refresh-vod') refreshVODCache();
            else if (act === 'remove-vod') removeVODSource(parseInt(id, 10));
            else if (act === 'catalog-vod') openCatalog('vod');
            else if (act === 'add-api') addApiSource();
            else if (act === 'remove-api') removeApiSource(parseInt(id, 10));
            else if (act === 'intercept') { state.intercept = !state.intercept; save(); refreshSettings(); }
            else if (act === 'toggle') {
                var cfg = state.sources[id] || { enabled: true, priority: 100 };
                setEnabled(id, cfg.enabled === false); refreshSettings();
            } else if (act === 'prio') {
                var c = state.sources[id] || { enabled: true, priority: 100 };
                c.priority = cycle(PRIO_LIST, c.priority); state.sources[id] = c; save(); refreshSettings();
            } else if (act === 'check') { health(id, function () { refreshSettings(); }); }
            else if (act === 'check-all') { checkAll(function () { refreshSettings(); }); }
            else if (act === 'clear') { clearHealth(); refreshSettings(); }
            else if (act === 'timeout') { state.timeout = cycle(TIMEOUT_LIST, state.timeout); save(); refreshSettings(); }
            else if (act === 'parallel') { state.max_parallel = cycle(PARALLEL_LIST, state.max_parallel); save(); refreshSettings(); }
            else if (act === 'quality') { state.min_quality = cycle(QUALITY_LIST, state.min_quality); save(); refreshSettings(); }
        });
    }

    function openSettings() {
        try { openUsmModal('Менеджер источников', settingsHTML(), bindManagerEvents); return; } catch (e) { console.error('[USM] Ошибка Modal:', e); }
    }
    function refreshSettings() {
        if (Lampa.Modal && Lampa.Modal.close) Lampa.Modal.close();
        setTimeout(openSettings, 100);
    }

    // ============ ПЕРЕХВАТ «СМОТРЕТЬ» ============
    function usmIntercept(movie) {
        if (!movie || !state.intercept) return;
        var seen = {};
        $('.selector').each(function () { seen[this.__usm_id || (this.__usm_id = Math.random())] = true; });
        var started = Date.now(), injected = false;
        LampaUSM.search(movie, function (resp) {
            var results = (resp.results || []).slice(0, 10);
            if (!results.length) return;
            var poll = setInterval(function () {
                var found = null;
                $('.selector').each(function () { if (!found && !seen[this.__usm_id]) found = $(this); });
                if (found) {
                    clearInterval(poll); injected = true;
                    injectIntoNativeList(found.parent(), results, movie);
                } else if (Date.now() - started > 4000) {
                    clearInterval(poll);
                    if (!injected) showResults(movie, results);
                }
            }, 150);
        });
    }

    function injectIntoNativeList($container, results, movie) {
        if (!$container || !$container.length || $container.data('usm-injected')) return;
        $container.data('usm-injected', true);
        injectStyles();
        var sibling = $container.children('.selector').first();
        $container.append('<div class="usm-native-head">⚡ USM источники</div>');
        results.forEach(function (item) {
            var cls = sibling && sibling.length ? sibling.attr('class') : 'selector';
            var $row = $('<div class="' + cls + ' usm-native-row"></div>');
            $row.html('<div style="flex:1;min-width:0;padding:.4em 0"><div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">⚡ ' + escapeHtml(item.title) + '</div><div style="font-size:.8em;opacity:.6">' + escapeHtml(item.source) + ' • ' + escapeHtml(item.quality) + (item.voice ? ' • ' + escapeHtml(item.voice) : '') + '</div></div>');
            $row.on('hover:enter click', function (ev) { ev.stopPropagation(); playSource(item, movie); });
            $container.append($row);
        });
    }

    function setupCard(e) {
        try {
            var container = e.object.template.find('.full-start__buttons');
            if (!container.length) return;
            if (!container.find('.usm-custom-btn').length) {
                var $btn = $('<div class="selector full-start__button usm-custom-btn"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg><span>USM</span></div>');
                $btn.css({ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '12px 20px', background: '#e50914', borderRadius: '8px', color: '#fff', fontWeight: 'bold', cursor: 'pointer', marginRight: '10px' });
                var movie0 = e.object.movie;
                $btn.on('hover:enter click', function () { openUSMSearch(movie0); });
                container.prepend($btn);
            }
            if (!container.data('usm-intercept-bound')) {
                container.data('usm-intercept-bound', true);
                container.children('.selector').each(function () {
                    var txt = $(this).text();
                    if (/Смотреть|Watch|Просмотр/i.test(txt) && !$(this).data('usm-hook')) {
                        $(this).data('usm-hook', true);
                        var movie = e.object.movie;
                        $(this).on('hover:enter click', function () { usmIntercept(movie); });
                    }
                });
            }
        } catch (err) {}
    }

    var searchBusy = false;
    function openUSMSearch(movie) {
        if (!movie || searchBusy) return;
        searchBusy = true;
        setTimeout(function () { searchBusy = false; }, 1000);
        if (Lampa.Noty) Lampa.Noty.show('USM: Поиск...');
        LampaUSM.search(movie, function (response) {
            var results = response.results || [];
            if (!results.length) { if (Lampa.Noty) Lampa.Noty.show('USM: ничего не найдено'); return; }
            showResults(movie, results);
        });
    }

    function showResults(movie, results) {
        var html = '<div class="usm-panel"><div class="usm-title">Найдено: ' + results.length + '</div><div class="usm-subtitle">' + escapeHtml(movie.title || movie.name || '') + '</div>';
        results.forEach(function (item, index) {
            html += rowTpl('play', String(index), item.title, item.source + ' • ' + item.quality + (item.voice ? ' • ' + item.voice : ''));
        });
        html += '</div>';
        openUsmModal('USM Источники', html, function ($h) {
            $h.find('.selector').on('hover:enter', function () {
                playSource(results[parseInt(this.getAttribute('data-id'), 10)], movie);
            });
        });
    }

    function playSource(item, movie) {
        if (!item || !item.url) return;
        closeUsmModal();
        console.log('[USM] play:', item.url);
        var file = {
            title: item.title || (movie && movie.title) || 'USM',
            url: item.url,
            quality: item.quality || ''
        };
        try {
            if (Lampa.Noty) Lampa.Noty.show('USM: запуск ' + file.title);
            Lampa.Player.play(file);
            if (typeof Lampa.Player.playlist === 'function') Lampa.Player.playlist([file]);
        } catch (e) {
            console.error('[USM] Ошибка плеера:', e);
            if (Lampa.Noty) Lampa.Noty.show('USM: ошибка плеера — смотри консоль');
        }
    }

    // ============ ЗАГРУЗЧИКИ M3U (с логотипами) ============
    var iptvCache = null, iptvLoading = false, vodCache = null, vodLoading = false;

    function parseM3U(content, sourceName) {
        var lines = String(content).split('\n'), out = [], current = {};
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (line.indexOf('#EXTINF:') === 0) {
                var logo = line.match(/tvg-logo="([^"]*)"/);
                var group = line.match(/group-title="([^"]*)"/);
                var name = line.match(/,(.*)$/);
                current = { logo: logo ? logo[1] : '', group: group ? group[1] : 'Общие', title: name ? name[1].trim() : 'Неизвестный канал' };
            } else if (line.indexOf('http') === 0) {
                current.url = line;
                out.push({ id: 'm3u-' + out.length, title: current.title, url: current.url, quality: 'Live', voice: current.group, logo: current.logo, source: sourceName });
                current = {};
            }
        }
        return out;
    }

    var PROXY_LIST = [
        function (url) { return url; },
        function (url) { return 'https://corsproxy.io/?' + encodeURIComponent(url); },
        function (url) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url); }
    ];

    function fetchWithProxies(url, onSuccess, onFail) {
        var R = Lampa.Request || Lampa.Reguest, proxyIndex = 0;
        function tryNext() {
            if (proxyIndex >= PROXY_LIST.length) { onFail(); return; }
            var req = new R();
            req.silent(PROXY_LIST[proxyIndex++](url), function (data) {
                if (data && data.length > 100 && String(data).indexOf('#EXTINF') !== -1) onSuccess(data);
                else tryNext();
            }, function () { tryNext(); });
        }
        tryNext();
    }

    function loadIPTV(callback) {
        if (iptvCache) { callback(iptvCache); return; }
        if (iptvLoading) { var w = setInterval(function () { if (!iptvLoading) { clearInterval(w); callback(iptvCache || []); } }, 500); return; }
        if (!state.iptv_urls.length) { callback([]); return; }
        iptvLoading = true;
        var all = [], idx = 0;
        function nextUrl() {
            if (idx >= state.iptv_urls.length) {
                var seen = {}, uniq = [];
                all.forEach(function (ch) { if (!seen[ch.url]) { seen[ch.url] = true; uniq.push(ch); } });
                iptvCache = uniq; iptvLoading = false; callback(uniq); return;
            }
            var url = state.iptv_urls[idx++];
            fetchWithProxies(url, function (data) { all = all.concat(parseM3U(data, 'IPTV')); nextUrl(); }, nextUrl);
        }
        nextUrl();
    }

    function loadVOD(callback) {
        if (vodCache) { callback(vodCache); return; }
        if (vodLoading) { var w = setInterval(function () { if (!vodLoading) { clearInterval(w); callback(vodCache || []); } }, 500); return; }
        if (!state.vod_urls.length) { callback([]); return; }
        vodLoading = true;
        var all = [], idx = 0;
        function nextItem() {
            if (idx >= state.vod_urls.length) { vodCache = all; vodLoading = false; callback(all); return; }
            var item = state.vod_urls[idx++];
            if (item.type === 'direct') {
                all.push({ id: 'vod-' + all.length, title: item.name, url: item.url, quality: '1080p', type: 'movie', source: item.name, logo: '' });
                nextItem();
            } else {
                fetchWithProxies(item.url, function (data) {
                    var movies = parseM3U(data, item.name);
                    movies.forEach(function (m) { m.type = 'movie'; });
                    all = all.concat(movies); nextItem();
                }, nextItem);
            }
        }
        nextItem();
    }

    // ============ МЕНЮ / СТАРТ ============
    var menuEl = null;
    function ensureMenu() {
        try {
            if (!window.Lampa || !Lampa.Menu || typeof Lampa.Menu.addButton !== 'function') return;
            if (menuEl && menuEl.parents('.menu__list').length) return;
            menuEl = $(Lampa.Menu.addButton(MENU_ICON, 'USM Источники', function () { openSettings(); }));
        } catch (e) {}
    }

    function addSettings() {
        if (!window.Lampa || !Lampa.SettingsApi) return false;
        if (window[NAME + '_ok']) return true;
        try {
            Lampa.SettingsApi.addComponent({ component: NAME, name: 'USM Источники', icon: MENU_ICON });
            Lampa.SettingsApi.addParam({
                component: NAME, param: { name: NAME + '_btn', type: 'button' },
                field: { name: 'Открыть менеджер', description: 'Управление IPTV, фильмами и API' },
                onRender: function (item) { if (item && typeof item.on === 'function') item.on('hover:enter click', openSettings); },
                onChange: openSettings
            });
            window[NAME + '_ok'] = true;
            return true;
        } catch (e) { return false; }
    }

    function start() {
        console.log('[USM] 🚀 Запуск v' + VERSION + '...');
        setTimeout(function () {
            ensureMenu();
            addSettings();
            state.api_sources.forEach(registerApiProvider);
            Lampa.Listener.follow('video', function (e) { if (e.type === 'complite') setupCard(e); });
            setInterval(ensureMenu, 2000);
        }, 500);
    }

    if (window.appready) start();
    else if (Lampa.Listener) Lampa.Listener.follow('app', function (event) { if (event.type === 'ready') start(); });
    else setTimeout(start, 2000);

    // ============ ИСТОЧНИКИ ============
    register({
        id: 'iptv-com-provider', title: '📺 IPTV Плейлисты',
        search: function (movie, done) {
            loadIPTV(function (channels) {
                if (!channels.length) { done(null, []); return; }
                var query = (movie.title || movie.name || '').toLowerCase();
                done(null, channels.filter(function (ch) {
                    return ch.title.toLowerCase().indexOf(query) !== -1 || query.indexOf(ch.title.toLowerCase()) !== -1;
                }).slice(0, 20));
            });
        },
        health: function (done) { loadIPTV(function (ch) { done(null, !!ch.length); }); }
    });

    register({
        id: 'vod-provider', title: '🎬 Фильмы и Сериалы',
        search: function (movie, done) {
            loadVOD(function (movies) {
                if (!movies.length) { done(null, []); return; }
                var query = (movie.title || movie.name || '').toLowerCase();
                done(null, movies.filter(function (m) {
                    return m.title.toLowerCase().indexOf(query) !== -1 || query.indexOf(m.title.toLowerCase()) !== -1;
                }).slice(0, 20));
            });
        },
        health: function (done) { loadVOD(function (m) { done(null, !!m.length); }); }
    });

    register({
        id: 'demo-movies', title: '🎬 Демо Фильмы',
        search: function (movie, done) {
            setTimeout(function () {
                done(null, [{ id: 'mov-1', title: (movie.title || 'Фильм') + ' [1080p] (Демо)', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', quality: '1080p', voice: 'Дублированный', type: 'movie', source: 'Демо' }]);
            }, 200);
        },
        health: function (done) { done(null, true); }
    });

    console.log('[USM] ✅ Файл v' + VERSION + ' загружен!');

    window.LampaUSM = {
        version: VERSION, register: register, unregister: unregister, openSettings: openSettings,
        search: function (movie, callback) {
            var list = Object.keys(providers).map(function (id) { return providers[id]; })
                .filter(function (p) { var cfg = state.sources[p.id] || {}; return cfg.enabled !== false; })
                .sort(function (a, b) { var pa = state.sources[a.id] || {}, pb = state.sources[b.id] || {}; return (pb.priority || 0) - (pa.priority || 0); });
            var cursor = 0, active = 0, results = [];
            function next() {
                if (cursor >= list.length && active === 0) {
                    var seen = {}, uniq = [];
                    results.forEach(function (r) {
                        var key = [String(r.title).toLowerCase(), r.quality, String(r.voice).toLowerCase(), r.url].join('|');
                        if (!seen[key]) { seen[key] = true; uniq.push(r); }
                    });
                    var qmap = { '4K': 2160, '2160p': 2160, '1440p': 1440, '1080p': 1080, '720p': 720, '480p': 480, 'Live': 1000 };
                    uniq.sort(function (a, b) {
                        var pa = state.sources[a.source_id] || {}, pb = state.sources[b.source_id] || {};
                        return (pb.priority || 0) - (pa.priority || 0) || (qmap[b.quality] || 0) - (qmap[a.quality] || 0);
                    });
                    callback({ results: uniq });
                    return;
                }
                while (active < state.max_parallel && cursor < list.length) {
                    (function (provider) {
                        active++;
                        var completed = false;
                        function finish(error, items) {
                            if (completed) return; completed = true; active--;
                            (items || []).forEach(function (it) { it.source_id = provider.id; results.push(it); });
                            next();
                        }
                        try { provider.search(movie, finish); } catch (e) { finish(e, []); }
                    })(list[cursor++]);
                }
            }
            next();
        }
    };
})();
