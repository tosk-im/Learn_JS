(function () {
    'use strict';
    console.log('[USM] Начало загрузки файла v1.5.0...');

    var NAME = 'lampa_usm_core';
    var VERSION = '1.5.0';
    var STORAGE = 'lampa_usm_config_v5';

    if (window[NAME]) { console.log('[USM] Плагин уже загружен.'); return; }
    window[NAME] = true;

    var DEFAULTS = { 
        timeout: 5000, 
        max_parallel: 4, 
        min_quality: 0, 
        sources: {}, 
        health: {},
        iptv_urls: [],
        vod_urls: []  // M3U плейлисты с фильмами
    };

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
                sources: data.sources || {},
                health: data.health || {},
                iptv_urls: Array.isArray(data.iptv_urls) ? data.iptv_urls : [],
                vod_urls: Array.isArray(data.vod_urls) ? data.vod_urls : []
            };
        } catch (e) { return copy(DEFAULTS); }
    }

    var state = load();
    function save() { Lampa.Storage.set(STORAGE, state); }
    var providers = {};

    function register(provider) {
        if (!provider || !provider.id || typeof provider.search !== 'function') { console.error('[USM] Некорректный провайдер', provider); return; }
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
        function next() {
            if (index >= ids.length) { callback(); return; }
            health(ids[index++], next);
        }
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
        
        // === IPTV ПЛЕЙЛИСТЫ ===
        html += '<div class="usm-section-title">📺 IPTV Плейлисты (' + state.iptv_urls.length + ')</div>';
        html += rowTpl('add-iptv', '', '➕ Добавить IPTV плейлист', 'M3U URL для ТВ каналов');
        html += rowTpl('refresh-iptv', '', '🔄 Обновить кэш IPTV', 'Скачать заново');
        state.iptv_urls.forEach(function (url, index) {
            var shortUrl = url.length > 50 ? url.substring(0, 50) + '...' : url;
            html += rowTpl('remove-iptv', String(index), '📺 ' + shortUrl, 'Нажмите для удаления');
        });
        
        html += '<div class="usm-sep"></div>';
        
        // === ФИЛЬМЫ И СЕРИАЛЫ (VOD) ===
        html += '<div class="usm-section-title">🎬 Фильмы и Сериалы (' + state.vod_urls.length + ')</div>';
        html += rowTpl('add-vod', '', '➕ Добавить источник фильмов', 'M3U с VOD или прямой URL');
        html += rowTpl('refresh-vod', '', '🔄 Обновить кэш фильмов', 'Скачать заново');
        state.vod_urls.forEach(function (item, index) {
            var shortName = item.name || (item.url.length > 40 ? item.url.substring(0, 40) + '...' : item.url);
            html += rowTpl('remove-vod', String(index), '🎬 ' + shortName, item.type + ' • ' + (item.url.length > 50 ? item.url.substring(0, 50) + '...' : item.url));
        });
        
        html += '<div class="usm-sep"></div>';
        
        // === ИСТОЧНИКИ ===
        html += '<div class="usm-section-title">🎯 Активные источники</div>';
        if (!rows.length) {
            html += '<div class="usm-empty">Источники не подключены.</div>';
        } else {
            rows.forEach(function (row) {
                html += rowTpl('toggle', row.id, (row.enabled ? '✅ ' : '⛔ ') + row.status.icon + ' ' + row.title, row.status.text + (row.status.ms ? ' · ' + row.status.ms : ''));
                html += rowTpl('prio', row.id, '⚙ Приоритет: ' + row.priority, 'Enter — сменить');
                html += rowTpl('check', row.id, '🔍 Проверить', 'Замерить отклик');
            });
        }
        html += '<div class="usm-sep"></div>';
        
        // === ОБЩИЕ НАСТРОЙКИ ===
        html += '<div class="usm-section-title">⚙️ Настройки</div>';
        html += rowTpl('check-all', '', '▶ Проверить все', 'Последовательно');
        html += rowTpl('clear', '', '♻ Сбросить статусы', 'Очистить историю');
        html += rowTpl('timeout', '', '⏱ Таймаут: ' + state.timeout + ' мс', 'Enter — сменить');
        html += rowTpl('parallel', '', '🔀 Параллельных: ' + state.max_parallel, 'Enter — сменить');
        html += rowTpl('quality', '', '🎯 Мин. качество: ' + (state.min_quality || 0), 'Enter — сменить');
        html += '</div>';
        return html;
    }

    function injectStyles() {
        if (document.getElementById('lampa-usm-style')) return;
        var style = document.createElement('style');
        style.id = 'lampa-usm-style';
        style.textContent = '.usm-panel{padding:1.5em;color:#fff;font-size:1em;max-height:80vh;overflow-y:auto}.usm-title{font-size:1.35em;font-weight:600;margin-bottom:.25em}.usm-subtitle{opacity:.6;margin-bottom:1em}.usm-section-title{font-size:1.05em;font-weight:600;opacity:.85;margin:1em 0 .6em 0;text-transform:uppercase;letter-spacing:.04em}.usm-row{display:flex;align-items:center;gap:.7em;padding:.9em .8em;margin-bottom:.4em;border-radius:.6em;background:rgba(255,255,255,.05);cursor:pointer;transition:background 0.15s}.usm-row.focus,.usm-row:hover{background:rgba(255,255,255,.16)}.usm-main{flex:1;min-width:0}.usm-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}.usm-meta{font-size:.8em;opacity:.55;margin-top:.25em}.usm-hint{opacity:.35;font-size:.8em}.usm-sep{height:1px;background:rgba(255,255,255,.1);margin:1em 0}.usm-empty{padding:2em 0;opacity:.65}.usm-empty-small{padding:.8em 1em;opacity:.5;font-size:.9em;font-style:italic}.usm-modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.7);z-index:9998}';
        document.head.appendChild(style);
    }

    // === УПРАВЛЕНИЕ IPTV ===
    function addIPTVPlaylist() {
        var url = prompt('Введите URL M3U плейлиста для IPTV:', 'https://');
        if (!url) return;
        url = url.trim();
        if (!url || !url.startsWith('http')) {
            if (Lampa.Noty) Lampa.Noty.show('USM: Некорректный URL');
            return;
        }
        if (state.iptv_urls.indexOf(url) !== -1) {
            if (Lampa.Noty) Lampa.Noty.show('USM: Этот плейлист уже добавлен');
            return;
        }
        state.iptv_urls.push(url);
        save();
        iptvCache = null;
        if (Lampa.Noty) Lampa.Noty.show('USM: IPTV плейлист добавлен!');
        refreshSettings();
    }

    function removeIPTVPlaylist(index) {
        if (confirm('Удалить этот IPTV плейлист?')) {
            state.iptv_urls.splice(index, 1);
            save();
            iptvCache = null;
            if (Lampa.Noty) Lampa.Noty.show('USM: Плейлист удалён');
            refreshSettings();
        }
    }

    function refreshIPTVCache() {
        iptvCache = null;
        if (state.health['iptv-com-provider']) {
            delete state.health['iptv-com-provider'];
            save();
        }
        if (Lampa.Noty) Lampa.Noty.show('USM: Кэш IPTV сброшен');
        refreshSettings();
    }

    // === УПРАВЛЕНИЕ ФИЛЬМАМИ (VOD) ===
    function addVODSource() {
        var name = prompt('Название источника (например: "Мои Фильмы"):', '');
        if (!name) return;
        
        var url = prompt('URL M3U плейлиста с фильмами или прямой URL на видео:', 'https://');
        if (!url) return;
        url = url.trim();
        if (!url || !url.startsWith('http')) {
            if (Lampa.Noty) Lampa.Noty.show('USM: Некорректный URL');
            return;
        }
        
        var type = 'm3u';
        if (url.toLowerCase().endsWith('.mp4') || url.toLowerCase().endsWith('.mkv') || url.toLowerCase().endsWith('.webm')) {
            type = 'direct';
        }
        
        state.vod_urls.push({ name: name, url: url, type: type });
        save();
        vodCache = null;
        if (Lampa.Noty) Lampa.Noty.show('USM: Источник фильмов добавлен!');
        refreshSettings();
    }

    function removeVODSource(index) {
        if (confirm('Удалить этот источник фильмов?')) {
            state.vod_urls.splice(index, 1);
            save();
            vodCache = null;
            if (Lampa.Noty) Lampa.Noty.show('USM: Источник удалён');
            refreshSettings();
        }
    }

    function refreshVODCache() {
        vodCache = null;
        if (state.health['vod-provider']) {
            delete state.health['vod-provider'];
            save();
        }
        if (Lampa.Noty) Lampa.Noty.show('USM: Кэш фильмов сброшен');
        refreshSettings();
    }

    function bindManagerEvents($html) {
        $html.find('.selector').on('hover:enter', function () {
            var act = this.getAttribute('data-act');
            var id = this.getAttribute('data-id');
            
            if (act === 'add-iptv') addIPTVPlaylist();
            else if (act === 'refresh-iptv') refreshIPTVCache();
            else if (act === 'remove-iptv') removeIPTVPlaylist(parseInt(id, 10));
            else if (act === 'add-vod') addVODSource();
            else if (act === 'refresh-vod') refreshVODCache();
            else if (act === 'remove-vod') removeVODSource(parseInt(id, 10));
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

    var currentModal = null;

    function openSettings() {
        injectStyles();
        try {
            var $html = $(settingsHTML());
            bindManagerEvents($html);
            
            // Создаём overlay для закрытия кликом вне окна
            var $overlay = $('<div class="usm-modal-overlay"></div>');
            $overlay.on('click', function() {
                if (currentModal && Lampa.Modal.close) {
                    Lampa.Modal.close();
                    currentModal = null;
                }
            });
            $('body').append($overlay);
            
            currentModal = Lampa.Modal.open({ 
                title: 'Менеджер источников', 
                html: $html, 
                onBack: function () { 
                    $overlay.remove();
                    currentModal = null;
                    return true; 
                },
                onClose: function() {
                    $overlay.remove();
                    currentModal = null;
                }
            });
            
            // Обработчик Escape для ПК
            $(document).off('keydown.usm').on('keydown.usm', function(e) {
                if (e.key === 'Escape' && currentModal) {
                    if (Lampa.Modal.close) Lampa.Modal.close();
                    $overlay.remove();
                    currentModal = null;
                    $(document).off('keydown.usm');
                }
            });
            
            return;
        } catch (e) { console.error('[USM] Ошибка Modal:', e); }
        if (Lampa.Noty) Lampa.Noty.show('Менеджер: ' + Object.keys(providers).length + ' источников');
    }

    function refreshSettings() {
        if (Lampa.Modal && Lampa.Modal.close) Lampa.Modal.close();
        setTimeout(openSettings, 100);
    }

    // ==========================================
    // ДОБАВЛЕНИЕ В БОКОВУЮ ПАНЕЛЬ (SIDEBAR)
    // ==========================================
    function addToSidebar() {
        try {
            if (Lampa.Sidebar && Lampa.Sidebar.add) {
                Lampa.Sidebar.add('usm-manager', {
                    name: 'USM Источники',
                    icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 0h6v6h-6v-6z"/></svg>',
                    action: openSettings
                });
                console.log('[USM] ✅ Добавлено в боковую панель');
            } else {
                // Fallback: добавляем через SettingsApi в настройки
                addSettings();
            }
        } catch (e) {
            console.warn('[USM] Sidebar недоступен, используем SettingsApi:', e);
            addSettings();
        }
    }

    // ==========================================
    // ИНТЕГРАЦИЯ С ПЛЕЕРОМ
    // ==========================================
    var searchBusy = false;

    function openUSMSearch(movie) {
        if (!movie || searchBusy) return;
        searchBusy = true;
        setTimeout(function () { searchBusy = false; }, 1000);
        console.log('[USM] Поиск источников для:', movie.title || movie.name);
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
        var $h = $(html);
        $h.find('.selector').on('hover:enter', function () {
            var idx = parseInt(this.getAttribute('data-id'), 10);
            playSource(results[idx], movie);
        });
        try {
            Lampa.Modal.open({ title: 'USM Источники', html: $h, onBack: function () { return true; } });
        } catch (e) { console.error('[USM] Ошибка Modal:', e); }
    }

    function playSource(item, movie) {
        if (!item || !item.url) return;
        if (Lampa.Modal && Lampa.Modal.close) Lampa.Modal.close();
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
    // ПАРСЕР IPTV
    // ==========================================
    var iptvCache = null;
    var iptvLoading = false;

    function parseM3U(content, sourceName) {
        var lines = String(content).split('\n');
        var channels = [];
        var current = {};
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (line.indexOf('#EXTINF:') === 0) {
                var logo = line.match(/tvg-logo="([^"]*)"/);
                var group = line.match(/group-title="([^"]*)"/);
                var name = line.match(/,(.*)$/);
                current = { logo: logo ? logo[1] : '', group: group ? group[1] : 'Общие', title: name ? name[1].trim() : 'Неизвестный канал' };
            } else if (line.indexOf('http') === 0) {
                current.url = line;
                channels.push({ id: 'iptv-' + channels.length, title: current.title, url: current.url, quality: 'Live', voice: current.group, type: 'iptv', source: sourceName });
                current = {};
            }
        }
        return channels;
    }

    var PROXY_LIST = [
        function(url) { return url; },
        function(url) { return 'https://corsproxy.io/?' + encodeURIComponent(url); },
        function(url) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url); }
    ];

    function loadIPTV(callback) {
        if (iptvCache) { callback(iptvCache); return; }
        if (iptvLoading) {
            var check = setInterval(function () { if (!iptvLoading) { clearInterval(check); callback(iptvCache || []); } }, 500);
            return;
        }
        if (!state.iptv_urls || state.iptv_urls.length === 0) { callback([]); return; }
        
        iptvLoading = true;
        var RequestClass = Lampa.Request || Lampa.Reguest;
        var allChannels = [];
        var urlIndex = 0;
        
        function processNextUrl() {
            if (urlIndex >= state.iptv_urls.length) {
                var seen = {};
                var unique = [];
                allChannels.forEach(function(ch) { if (!seen[ch.url]) { seen[ch.url] = true; unique.push(ch); } });
                iptvCache = unique;
                iptvLoading = false;
                console.log('[USM] ✅ IPTV загружено, каналов:', unique.length);
                callback(iptvCache);
                return;
            }
            var currentUrl = state.iptv_urls[urlIndex++];
            var proxyIndex = 0;
            var sourceName = 'IPTV: ' + currentUrl.substring(0, 40);
            
            function tryNextProxy() {
                if (proxyIndex >= PROXY_LIST.length) { processNextUrl(); return; }
                var proxyFn = PROXY_LIST[proxyIndex++];
                var url = proxyFn(currentUrl);
                var req = new RequestClass();
                req.silent(url, function (data) {
                    if (data && data.length > 100 && data.indexOf('#EXTINF') !== -1) {
                        allChannels = allChannels.concat(parseM3U(data, sourceName));
                        processNextUrl();
                    } else { tryNextProxy(); }
                }, function () { tryNextProxy(); });
            }
            tryNextProxy();
        }
        processNextUrl();
    }

    // ==========================================
    // ПАРСЕР ФИЛЬМОВ (VOD)
    // ==========================================
    var vodCache = null;
    var vodLoading = false;

    function loadVOD(callback) {
        if (vodCache) { callback(vodCache); return; }
        if (vodLoading) {
            var check = setInterval(function () { if (!vodLoading) { clearInterval(check); callback(vodCache || []); } }, 500);
            return;
        }
        if (!state.vod_urls || state.vod_urls.length === 0) { callback([]); return; }
        
        vodLoading = true;
        var RequestClass = Lampa.Request || Lampa.Reguest;
        var allMovies = [];
        var urlIndex = 0;
        
        function processNext() {
            if (urlIndex >= state.vod_urls.length) {
                vodCache = allMovies;
                vodLoading = false;
                console.log('[USM] ✅ VOD загружено, фильмов:', allMovies.length);
                callback(vodCache);
                return;
            }
            var item = state.vod_urls[urlIndex++];
            
            if (item.type === 'direct') {
                // Прямая ссылка на видео
                allMovies.push({
                    id: 'vod-' + allMovies.length,
                    title: item.name,
                    url: item.url,
                    quality: '1080p',
                    type: 'movie',
                    source: item.name
                });
                processNext();
            } else {
                // M3U плейлист с фильмами
                var proxyIndex = 0;
                function tryNextProxy() {
                    if (proxyIndex >= PROXY_LIST.length) { processNext(); return; }
                    var proxyFn = PROXY_LIST[proxyIndex++];
                    var url = proxyFn(item.url);
                    var req = new RequestClass();
                    req.silent(url, function (data) {
                        if (data && data.length > 100 && data.indexOf('#EXTINF') !== -1) {
                            var movies = parseM3U(data, item.name).map(function(m) { m.type = 'movie'; return m; });
                            allMovies = allMovies.concat(movies);
                            processNext();
                        } else { tryNextProxy(); }
                    }, function () { tryNextProxy(); });
                }
                tryNextProxy();
            }
        }
        processNext();
    }

    // ==========================================
    // НАСТРОЙКИ (FALLBACK)
    // ==========================================
    function addSettings() {
        if (!window.Lampa || !Lampa.SettingsApi) return false;
        if (window[NAME + '_ok']) return true;
        try {
            Lampa.SettingsApi.addComponent({ component: NAME, name: 'USM Источники', icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 0h6v6h-6v-6z"/></svg>' });
            Lampa.SettingsApi.addParam({
                component: NAME, param: { name: NAME + '_btn', type: 'button' },
                field: { name: 'Открыть менеджер', description: 'Управление IPTV и фильмами' },
                onRender: function (item) { if (item && typeof item.on === 'function') item.on('hover:enter click', openSettings); },
                onChange: openSettings
            });
            window[NAME + '_ok'] = true;
            console.log('[USM] ✅ SettingsApi зарегистрирован');
            return true;
        } catch (e) { console.error('[USM] ❌ SettingsApi ошибка:', e); return false; }
    }

    function start() {
        console.log('[USM] 🚀 Запуск v' + VERSION + '...');
        setTimeout(function () {
            addToSidebar();
            addWatchButton();
        }, 500);
    }

    if (window.appready) start();
    else if (Lampa.Listener) Lampa.Listener.follow('app', function (event) { if (event.type === 'ready') start(); });
    else setTimeout(start, 2000);

    // ==========================================
    // РЕГИСТРАЦИЯ ИСТОЧНИКОВ
    // ==========================================
    register({
        id: 'iptv-com-provider',
        title: '📺 IPTV Плейлисты',
        search: function (movie, done) {
            loadIPTV(function (channels) {
                if (!channels || !channels.length) { done(null, []); return; }
                var query = (movie.title || movie.name || '').toLowerCase();
                var results = channels.filter(function (ch) {
                    return ch.title.toLowerCase().indexOf(query) !== -1 || query.indexOf(ch.title.toLowerCase()) !== -1;
                });
                done(null, results.slice(0, 20));
            });
        },
        health: function (done) { loadIPTV(function (channels) { done(null, !!(channels && channels.length)); }); }
    });

    register({
        id: 'vod-provider',
        title: '🎬 Фильмы и Сериалы',
        search: function (movie, done) {
            loadVOD(function (movies) {
                if (!movies || !movies.length) { done(null, []); return; }
                var query = (movie.title || movie.name || '').toLowerCase();
                var results = movies.filter(function (m) {
                    return m.title.toLowerCase().indexOf(query) !== -1 || query.indexOf(m.title.toLowerCase()) !== -1;
                });
                done(null, results.slice(0, 20));
            });
        },
        health: function (done) { loadVOD(function (movies) { done(null, !!(movies && movies.length)); }); }
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
                .filter(function (p) { var cfg = state.sources[p.id] || {}; return cfg.enabled !== false && p.enabled !== false; })
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
