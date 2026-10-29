(function () {
    'use strict';
    console.log('[USM] Начало загрузки файла v1.6.0...');

    var NAME = 'lampa_usm_core';
    var VERSION = '1.6.0';
    var STORAGE = 'lampa_usm_config_v5';
    var MENU_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 0h6v6h-6v-6z"/></svg>';

    if (window[NAME]) { console.log('[USM] Плагин уже загружен.'); return; }
    window[NAME] = true;

    var DEFAULTS = { timeout: 5000, max_parallel: 4, min_quality: 0, sources: {}, health: {}, iptv_urls: [], vod_urls: [] };
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
                vod_urls: Array.isArray(data.vod_urls) ? data.vod_urls : []
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
        console.log('[USM] Источник зарегистрирован:', provider.id);
        return provider.id;
    }

    function setEnabled(id, enabled) {
        if (!state.sources[id]) state.sources[id] = { enabled: !!enabled, priority: 100 };
        else state.sources[id].enabled = !!enabled;
        save();
    }

    function clearHealth() { state.health = {}; save(); }

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
        html += rowTpl('catalog-iptv', '', '📺 Каталог каналов', 'Просмотр всех каналов');
        html += rowTpl('refresh-iptv', '', '🔄 Обновить кэш IPTV', 'Скачать заново');
        state.iptv_urls.forEach(function (url, index) {
            var shortUrl = url.length > 50 ? url.substring(0, 50) + '...' : url;
            html += rowTpl('remove-iptv', String(index), '📺 ' + shortUrl, 'Нажмите для удаления');
        });

        html += '<div class="usm-sep"></div>';
        html += '<div class="usm-section-title">🎬 Фильмы и Сериалы (' + state.vod_urls.length + ')</div>';
        html += rowTpl('add-vod', '', '➕ Добавить источник фильмов', 'M3U с VOD или прямой URL');
        html += rowTpl('catalog-vod', '', '🎬 Каталог фильмов', 'Просмотр и поиск по VOD');
        html += rowTpl('refresh-vod', '', '🔄 Обновить кэш фильмов', 'Скачать заново');
        state.vod_urls.forEach(function (item, index) {
            var shortName = item.name || item.url;
            if (shortName.length > 45) shortName = shortName.substring(0, 45) + '...';
            html += rowTpl('remove-vod', String(index), '🎬 ' + shortName, item.type + ' • нажмите для удаления');
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
        style.textContent = '.usm-panel{padding:1.5em;color:#fff;font-size:1em;max-height:80vh;overflow-y:auto}.usm-title{font-size:1.35em;font-weight:600;margin-bottom:.25em}.usm-subtitle{opacity:.6;margin-bottom:1em}.usm-section-title{font-size:1.05em;font-weight:600;opacity:.85;margin:1em 0 .6em 0;text-transform:uppercase;letter-spacing:.04em}.usm-row{display:flex;align-items:center;gap:.7em;padding:.9em .8em;margin-bottom:.4em;border-radius:.6em;background:rgba(255,255,255,.05);cursor:pointer;transition:background 0.15s}.usm-row.focus,.usm-row:hover{background:rgba(255,255,255,.16)}.usm-main{flex:1;min-width:0}.usm-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}.usm-meta{font-size:.8em;opacity:.55;margin-top:.25em}.usm-hint{opacity:.35;font-size:.8em}.usm-sep{height:1px;background:rgba(255,255,255,.1);margin:1em 0}.usm-empty{padding:2em 0;opacity:.65}';
        document.head.appendChild(style);
    }

    // ==========================================
    // УНИВЕРСАЛЬНОЕ МОДАЛЬНОЕ ОКНО + ЗАКРЫТИЕ
    // ==========================================
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

        // Esc на ПК
        $(document).off('keydown.usm').on('keydown.usm', function (e) {
            if (e.key === 'Escape' && usmModalOpen) closeUsmModal();
        });
        // Клик в пустую область (телефон/ПК): всё, что вне контента и не selector
        $(document).off('click.usm').on('click.usm', function (e) {
            if (!usmModalOpen) return;
            var t = $(e.target);
            if (t.closest('.usm-panel').length) return;
            if (t.closest('.modal__content').length) return;
            if (t.closest('.selector').length) return;
            closeUsmModal();
        });

        Lampa.Modal.open({
            title: title,
            html: $html,
            onBack: function () { closeUsmModal(); return true; } // назад на ТВ/телефоне
        });
    }

    // ==========================================
    // УПРАВЛЕНИЕ IPTV / VOD
    // ==========================================
    function addIPTVPlaylist() {
        var url = prompt('Введите URL M3U плейлиста для IPTV:', 'https://');
        if (!url) return;
        url = url.trim();
        if (!url || url.indexOf('http') !== 0) { if (Lampa.Noty) Lampa.Noty.show('USM: Некорректный URL'); return; }
        if (state.iptv_urls.indexOf(url) !== -1) { if (Lampa.Noty) Lampa.Noty.show('USM: уже добавлен'); return; }
        state.iptv_urls.push(url); save(); iptvCache = null;
        if (Lampa.Noty) Lampa.Noty.show('USM: IPTV плейлист добавлен!');
        refreshSettings();
    }

    function removeIPTVPlaylist(index) {
        if (confirm('Удалить этот IPTV плейлист?')) {
            state.iptv_urls.splice(index, 1); save(); iptvCache = null;
            if (Lampa.Noty) Lampa.Noty.show('USM: удалено');
            refreshSettings();
        }
    }

    function refreshIPTVCache() {
        iptvCache = null;
        delete state.health['iptv-com-provider']; save();
        if (Lampa.Noty) Lampa.Noty.show('USM: кэш IPTV сброшен');
        refreshSettings();
    }

    function addVODSource() {
        var name = prompt('Название источника (например: "Мои Фильмы"):', '');
        if (!name) return;
        var url = prompt('URL M3U плейлиста с фильмами или прямой URL на видео:', 'https://');
        if (!url) return;
        url = url.trim();
        if (!url || url.indexOf('http') !== 0) { if (Lampa.Noty) Lampa.Noty.show('USM: Некорректный URL'); return; }
        var type = 'm3u';
        var low = url.toLowerCase();
        if (low.indexOf('.mp4') !== -1 || low.indexOf('.mkv') !== -1 || low.indexOf('.webm') !== -1) type = 'direct';
        state.vod_urls.push({ name: name, url: url, type: type }); save(); vodCache = null;
        if (Lampa.Noty) Lampa.Noty.show('USM: источник фильмов добавлен!');
        refreshSettings();
    }

    function removeVODSource(index) {
        if (confirm('Удалить этот источник фильмов?')) {
            state.vod_urls.splice(index, 1); save(); vodCache = null;
            if (Lampa.Noty) Lampa.Noty.show('USM: удалено');
            refreshSettings();
        }
    }

    function refreshVODCache() {
        vodCache = null;
        delete state.health['vod-provider']; save();
        if (Lampa.Noty) Lampa.Noty.show('USM: кэш фильмов сброшен');
        refreshSettings();
    }

    function openCatalog(kind) {
        var loader = kind === 'iptv' ? loadIPTV : loadVOD;
        if (Lampa.Noty) Lampa.Noty.show('USM: загрузка каталога...');
        loader(function (items) {
            if (!items || !items.length) { if (Lampa.Noty) Lampa.Noty.show('USM: каталог пуст — добавьте плейлисты'); return; }
            var filter = prompt('Фильтр по названию (пусто = показать все):', '') || '';
            var q = filter.toLowerCase().trim();
            var list = q ? items.filter(function (i) { return i.title.toLowerCase().indexOf(q) !== -1; }) : items;
            if (!list.length) { if (Lampa.Noty) Lampa.Noty.show('USM: ничего не найдено'); return; }
            list = list.slice(0, 100);
            var html = '<div class="usm-panel"><div class="usm-title">' + (kind === 'iptv' ? '📺 Каналы' : '🎬 Фильмы') + ': ' + list.length + '</div>';
            list.forEach(function (item, idx) {
                html += rowTpl('play-catalog', String(idx), item.title, (item.voice || '') + (item.source ? ' • ' + item.source : ''));
            });
            html += '</div>';
            openUsmModal('Каталог USM', html, function ($h) {
                $h.find('.selector').on('hover:enter', function () {
                    var it = list[parseInt(this.getAttribute('data-id'), 10)];
                    playSource(it, { title: it.title });
                });
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
            else if (act === 'toggle') {
                var cfg = state.sources[id] || { enabled: true, priority: 100 };
                setEnabled(id, cfg.enabled === false);
                refreshSettings();
            } else if (act === 'prio') {
                var c = state.sources[id] || { enabled: true, priority: 100 };
                c.priority = cycle(PRIO_LIST, c.priority);
                state.sources[id] = c; save(); refreshSettings();
            } else if (act === 'check') {
                if (Lampa.Noty) Lampa.Noty.show('USM: проверка...');
                health(id, function () { refreshSettings(); });
            } else if (act === 'check-all') {
                if (Lampa.Noty) Lampa.Noty.show('USM: проверка всех...');
                checkAll(function () { refreshSettings(); });
            } else if (act === 'clear') { clearHealth(); refreshSettings(); }
            else if (act === 'timeout') { state.timeout = cycle(TIMEOUT_LIST, state.timeout); save(); refreshSettings(); }
            else if (act === 'parallel') { state.max_parallel = cycle(PARALLEL_LIST, state.max_parallel); save(); refreshSettings(); }
            else if (act === 'quality') { state.min_quality = cycle(QUALITY_LIST, state.min_quality); save(); refreshSettings(); }
        });
    }

    function openSettings() {
        try {
            openUsmModal('Менеджер источников', settingsHTML(), bindManagerEvents);
            return;
        } catch (e) { console.error('[USM] Ошибка Modal:', e); }
        if (Lampa.Noty) Lampa.Noty.show('Менеджер: ' + Object.keys(providers).length + ' источников');
    }

    function refreshSettings() {
        if (Lampa.Modal && Lampa.Modal.close) Lampa.Modal.close();
        setTimeout(openSettings, 100);
    }

    // ==========================================
    // ПУНКТ В БОКОВОМ МЕНЮ + WATCHDOG
    // ==========================================
    var menuEl = null;

    function ensureMenu() {
        try {
            if (!window.Lampa || !Lampa.Menu || typeof Lampa.Menu.addButton !== 'function') return;
            if (menuEl && menuEl.parents('.menu__list').length) return; // уже на месте
            menuEl = $(Lampa.Menu.addButton(MENU_ICON, 'USM Источники', function () { openSettings(); }));
            console.log('[USM] ✅ Пункт добавлен в боковое меню');
        } catch (e) { console.error('[USM] Ошибка меню:', e); }
    }

    // ==========================================
    // ПОИСК И ПЛЕЕР
    // ==========================================
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
                var idx = parseInt(this.getAttribute('data-id'), 10);
                playSource(results[idx], movie);
            });
        });
    }

    function playSource(item, movie) {
        if (!item || !item.url) return;
        closeUsmModal();
        if (Lampa.Noty) Lampa.Noty.show('USM: запуск ' + item.title);
        Lampa.Player.play({
            url: item.url,
            title: item.title || (movie.title || movie.name || 'USM'),
            timeline: movie
        });
    }

    function addWatchButton() {
        Lampa.Listener.follow('video', function (e) {
            if (e.type !== 'complite') return;
            try {
                var container = e.object.template.find('.full-start__buttons');
                if (!container.length || container.find('.usm-custom-btn').length) return;
                var $btn = $('<div class="selector full-start__button usm-custom-btn"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg><span>USM</span></div>');
                $btn.css({ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '12px 20px', background: '#e50914', borderRadius: '8px', color: '#fff', fontWeight: 'bold', cursor: 'pointer', marginRight: '10px' });
                var movie = e.object.movie;
                function triggerSearch() { openUSMSearch(movie); }
                $btn.on('hover:enter', triggerSearch);
                $btn.on('click', triggerSearch);
                container.prepend($btn);
            } catch (err) { console.error('[USM] Ошибка кнопки:', err); }
        });
    }

    // ==========================================
    // ЗАГРУЗЧИКИ M3U (IPTV + VOD)
    // ==========================================
    var iptvCache = null, iptvLoading = false;
    var vodCache = null, vodLoading = false;

    function parseM3U(content, sourceName) {
        var lines = String(content).split('\n');
        var out = [];
        var current = {};
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (line.indexOf('#EXTINF:') === 0) {
                var group = line.match(/group-title="([^"]*)"/);
                var name = line.match(/,(.*)$/);
                current = { group: group ? group[1] : 'Общие', title: name ? name[1].trim() : 'Неизвестный канал' };
            } else if (line.indexOf('http') === 0) {
                current.url = line;
                out.push({ id: 'm3u-' + out.length, title: current.title, url: current.url, quality: 'Live', voice: current.group, source: sourceName });
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
        var RequestClass = Lampa.Request || Lampa.Reguest;
        var proxyIndex = 0;
        function tryNext() {
            if (proxyIndex >= PROXY_LIST.length) { onFail(); return; }
            var proxyFn = PROXY_LIST[proxyIndex++];
            var req = new RequestClass();
            req.silent(proxyFn(url), function (data) {
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
                iptvCache = uniq; iptvLoading = false;
                console.log('[USM] ✅ IPTV каналов:', uniq.length);
                callback(uniq); return;
            }
            var url = state.iptv_urls[idx++];
            fetchWithProxies(url, function (data) {
                all = all.concat(parseM3U(data, 'IPTV'));
                nextUrl();
            }, nextUrl);
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
            if (idx >= state.vod_urls.length) {
                vodCache = all; vodLoading = false;
                console.log('[USM] ✅ VOD позиций:', all.length);
                callback(all); return;
            }
            var item = state.vod_urls[idx++];
            if (item.type === 'direct') {
                all.push({ id: 'vod-' + all.length, title: item.name, url: item.url, quality: '1080p', type: 'movie', source: item.name });
                nextItem();
            } else {
                fetchWithProxies(item.url, function (data) {
                    var movies = parseM3U(data, item.name);
                    movies.forEach(function (m) { m.type = 'movie'; m.id = 'vod-' + all.length; });
                    all = all.concat(movies);
                    nextItem();
                }, nextItem);
            }
        }
        nextItem();
    }

    // ==========================================
    // FALLBACK: НАСТРОЙКИ
    // ==========================================
    function addSettings() {
        if (!window.Lampa || !Lampa.SettingsApi) return false;
        if (window[NAME + '_ok']) return true;
        try {
            Lampa.SettingsApi.addComponent({ component: NAME, name: 'USM Источники', icon: MENU_ICON });
            Lampa.SettingsApi.addParam({
                component: NAME, param: { name: NAME + '_btn', type: 'button' },
                field: { name: 'Открыть менеджер', description: 'Управление IPTV и фильмами' },
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
            addWatchButton();
            setInterval(ensureMenu, 2000); // watchdog: вернёт пункт, если меню пересоздалось
        }, 500);
    }

    if (window.appready) start();
    else if (Lampa.Listener) Lampa.Listener.follow('app', function (event) { if (event.type === 'ready') start(); });
    else setTimeout(start, 2000);

    // ==========================================
    // ИСТОЧНИКИ
    // ==========================================
    register({
        id: 'iptv-com-provider',
        title: '📺 IPTV Плейлисты',
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
        id: 'vod-provider',
        title: '🎬 Фильмы и Сериалы',
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
        id: 'demo-movies',
        title: '🎬 Демо Фильмы',
        search: function (movie, done) {
            setTimeout(function () {
                done(null, [{ id: 'mov-1', title: (movie.title || 'Фильм') + ' [1080p] (Демо)', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', quality: '1080p', voice: 'Дублированный', type: 'movie', source: 'Демо' }]);
            }, 200);
        },
        health: function (done) { done(null, true); }
    });

    console.log('[USM] ✅ Файл v' + VERSION + ' загружен!');

    window.LampaUSM = {
        version: VERSION,
        register: register,
        openSettings: openSettings,
        search: function (movie, callback) {
            var list = Object.keys(providers).map(function (id) { return providers[id]; })
                .filter(function (p) { var cfg = state.sources[p.id] || {}; return cfg.enabled !== false; })
                .sort(function (a, b) { var pa = state.sources[a.id] || {}, pb = state.sources[b.id] || {}; return (pb.priority || 0) - (pa.priority || 0); });
            var cursor = 0, active = 0, results = [];
            function next() {
                if (cursor >= list.length && active === 0) { callback({ results: results }); return; }
                while (active < state.max_parallel && cursor < list.length) {
                    (function (provider) {
                        active++;
                        var completed = false;
                        function finish(error, items) {
                            if (completed) return; completed = true; active--;
                            if (items && items.length) results = results.concat(items);
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
