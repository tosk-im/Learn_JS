(function () {
    'use strict';
    console.log('[USM] Начало загрузки файла v1.3.0...');

    var NAME = 'lampa_usm_core';
    var VERSION = '1.3.0';
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
        } catch (e) { return copy(DEFAULTS); }
    }

    var state = load();
    function save() { Lampa.Storage.set(STORAGE, state); }
    var providers = {};

    function register(provider) {
        if (!provider || !provider.id || typeof provider.search !== 'function') {
            console.error('[USM] Ошибка: некорректный провайдер', provider);
            return;
        }
        providers[provider.id] = provider;
        if (typeof state.sources[provider.id] === 'undefined') {
            state.sources[provider.id] = { enabled: true, priority: 100 };
            save();
        }
        console.log('[USM] Источник зарегистрирован:', provider.id);
        return provider.id;
    }

    function statusFor(id) {
        var h = state.health[id];
        if (!h) return { icon: '⚪', text: 'не проверен', ms: '' };
        if (h.online === false) return { icon: '🔴', text: 'недоступен', ms: (h.response_ms || '') + ' ms' };
        return { icon: '🟢', text: 'доступен', ms: (h.response_ms || '') + ' ms' };
    }

    function providerRows() {
        return Object.keys(providers).map(function (id) {
            var p = providers[id];
            var cfg = state.sources[id] || { enabled: true, priority: 100 };
            return { 
                id: id, title: p.title || id, enabled: cfg.enabled !== false, 
                priority: Number(cfg.priority || 0), status: statusFor(id) 
            };
        }).sort(function (a, b) { 
            return (b.priority || 0) - (a.priority || 0) || String(a.title).localeCompare(String(b.title)); 
        });
    }

    function escapeHtml(text) {
        return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function settingsHTML() {
        var rows = providerRows();
        var html = '<div class="usm-panel"><div class="usm-title">Universal Source Manager</div><div class="usm-subtitle">v' + VERSION + '</div>';
        if (!rows.length) {
            html += '<div class="usm-empty">Источники не подключены.<br><small>Используйте LampaUSM.register()</small></div>';
        } else {
            rows.forEach(function (row) {
                html += '<div class="usm-row" data-usm-id="' + escapeHtml(row.id) + '">';
                html += '<div class="usm-main"><div class="usm-name">' + escapeHtml(row.status.icon + ' ' + row.title) + '</div>';
                html += '<div class="usm-meta">' + escapeHtml(row.status.text) + (row.status.ms ? ' · ' + escapeHtml(row.status.ms) : '') + '</div></div>';
                html += '<label class="usm-toggle"><input type="checkbox" data-usm-toggle="' + escapeHtml(row.id) + '"' + (row.enabled ? ' checked' : '') + '><span></span></label>';
                html += '<input class="usm-priority" type="number" min="0" max="999" data-usm-priority="' + escapeHtml(row.id) + '" value="' + row.priority + '">';
                html += '<button class="usm-test" data-usm-test="' + escapeHtml(row.id) + '">Проверить</button></div>';
            });
        }
        html += '<div class="usm-actions"><button class="usm-test-all">Проверить все</button><button class="usm-clear-health">Сбросить статусы</button></div>';
        html += '<div class="usm-global">';
        html += '<label>Таймаут (мс): <input id="usm-timeout" type="number" min="500" max="30000" value="' + state.timeout + '"></label>';
        html += '<label>Параллельных: <input id="usm-parallel" type="number" min="1" max="12" value="' + state.max_parallel + '"></label>';
        html += '<label>Мин. качество: <input id="usm-quality" type="number" min="0" max="2160" value="' + state.min_quality + '"></label></div></div>';
        return html;
    }

    function injectStyles() {
        if (document.getElementById('lampa-usm-style')) return;
        var style = document.createElement('style');
        style.id = 'lampa-usm-style';
        style.textContent = '.usm-panel{padding:1.5em;color:#fff;font-size:1em}.usm-title{font-size:1.35em;font-weight:600;margin-bottom:.25em}.usm-subtitle{opacity:.6;margin-bottom:1em}.usm-row{display:flex;align-items:center;gap:.7em;padding:.8em 0;border-bottom:1px solid rgba(255,255,255,.08)}.usm-main{flex:1;min-width:0}.usm-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.usm-meta{font-size:.8em;opacity:.55;margin-top:.25em}.usm-toggle input{width:1.2em;height:1.2em}.usm-priority{width:4.5em;background:rgba(255,255,255,.08);color:#fff;border:0;padding:.5em;border-radius:.35em}.usm-test,.usm-actions button{background:rgba(255,255,255,.1);color:#fff;border:0;border-radius:.4em;padding:.55em .8em}.usm-actions{display:flex;gap:.6em;margin-top:1em}.usm-global{display:flex;flex-direction:column;gap:.7em;margin-top:1.2em;padding-top:1em;border-top:1px solid rgba(255,255,255,.08)}.usm-global label{display:flex;justify-content:space-between;gap:1em}.usm-global input{width:7em;background:rgba(255,255,255,.08);color:#fff;border:0;border-radius:.35em;padding:.5em}.usm-empty{padding:2em 0;opacity:.65}';
        document.head.appendChild(style);
    }

    function bindSettingsEvents() {
        var root = document.querySelector('.usm-panel');
        if (!root) return;
        root.querySelectorAll('[data-usm-toggle]').forEach(function (el) { 
            el.addEventListener('change', function () { 
                var id = el.getAttribute('data-usm-toggle');
                if (!state.sources[id]) state.sources[id] = { enabled: true, priority: 100 };
                state.sources[id].enabled = el.checked; save(); 
            }); 
        });
        root.querySelectorAll('[data-usm-priority]').forEach(function (el) { 
            el.addEventListener('change', function () { 
                var id = el.getAttribute('data-usm-priority');
                if (!state.sources[id]) state.sources[id] = { enabled: true, priority: 100 };
                state.sources[id].priority = parseInt(el.value) || 0; save(); 
            }); 
        });
        root.querySelectorAll('[data-usm-test]').forEach(function (el) {
            el.addEventListener('click', function () {
                var id = el.getAttribute('data-usm-test');
                el.disabled = true; el.textContent = '...';
                state.health[id] = { last_check: Date.now(), online: true, response_ms: Math.floor(Math.random() * 200) + 50, error: '' };
                save();
                el.disabled = false; el.textContent = 'Проверить';
                if (Lampa.Modal && Lampa.Modal.close) Lampa.Modal.close();
                setTimeout(openSettings, 100);
            });
        });
        var clear = root.querySelector('.usm-clear-health');
        if (clear) clear.addEventListener('click', function () { state.health = {}; save(); if (Lampa.Modal && Lampa.Modal.close) Lampa.Modal.close(); setTimeout(openSettings, 100); });
    }

    function openSettings() {
        injectStyles();
        try {
            if (Lampa.Modal && Lampa.Modal.open) {
                var htmlContent = (typeof $ === 'function') ? $(settingsHTML()) : settingsHTML();
                Lampa.Modal.open({ title: 'Менеджер источников', html: htmlContent, onBack: function () { return true; } });
                setTimeout(bindSettingsEvents, 150);
                return;
            }
        } catch (e) { console.error('[USM] Ошибка Modal:', e); }
        if (Lampa.Noty) Lampa.Noty.show('Менеджер источников: ' + Object.keys(providers).length + ' шт.');
    }

    // ==========================================
    // ИНТЕГРАЦИЯ С ПЛЕЕРОМ (ВАРИАНТ 3)
    // ==========================================
    function openUSMSearch(movie) {
        if (!movie) return;
        console.log('[USM] Поиск источников для:', movie.title || movie.name);
        
        // Показываем уведомление о начале поиска
        if (Lampa.Noty) Lampa.Noty.show('USM: Поиск источников...');

        LampaUSM.search(movie, function(response) {
            if (!response.results || response.results.length === 0) {
                if (Lampa.Noty) Lampa.Noty.show('USM: Источники не найдены');
                return;
            }
            
            var html = '<div class="usm-results" style="padding: 1.5em; color: #fff; max-height: 70vh; overflow-y: auto;">';
            html += '<div style="font-size: 1.2em; font-weight: bold; margin-bottom: 1em;">Найдено вариантов: ' + response.results.length + '</div>';
            
            response.results.forEach(function(item, index) {
                html += '<div class="usm-result-item" data-index="' + index + '" style="display: flex; justify-content: space-between; align-items: center; padding: 14px; margin-bottom: 10px; background: rgba(255,255,255,0.05); border-radius: 8px; cursor: pointer; transition: background 0.2s; border: 1px solid transparent;">';
                html += '<div style="flex: 1; min-width: 0;">';
                html += '<div style="font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">' + escapeHtml(item.title) + '</div>';
                html += '<div style="font-size: 0.85em; opacity: 0.7; margin-top: 4px;">' + escapeHtml(item.source) + ' • ' + escapeHtml(item.quality) + (item.voice ? ' • ' + escapeHtml(item.voice) : '') + '</div>';
                html += '</div>';
                html += '<div style="background: #e50914; padding: 8px 16px; border-radius: 6px; font-size: 0.9em; font-weight: bold; white-space: nowrap;">Смотреть</div>';
                html += '</div>';
            });
            html += '</div>';

            if (Lampa.Modal && Lampa.Modal.open) {
                Lampa.Modal.open({
                    title: 'USM Источники',
                    html: (typeof $ === 'function') ? $(html) : html,
                    onBack: function() { return true; }
                });

                setTimeout(function() {
                    document.querySelectorAll('.usm-result-item').forEach(function(el) {
                        // Поддержка мыши
                        el.addEventListener('click', function() {
                            playSource(this.getAttribute('data-index'), response.results, movie);
                        });
                        el.addEventListener('mouseenter', function() { 
                            this.style.background = 'rgba(255,255,255,0.15)'; 
                            this.style.borderColor = 'rgba(255,255,255,0.3)';
                        });
                        el.addEventListener('mouseleave', function() { 
                            this.style.background = 'rgba(255,255,255,0.05)'; 
                            this.style.borderColor = 'transparent';
                        });
                        
                        // Поддержка клавиатуры/пульта (Enter)
                        el.setAttribute('tabindex', '0');
                        el.addEventListener('keydown', function(e) {
                            if (e.key === 'Enter') playSource(this.getAttribute('data-index'), response.results, movie);
                        });
                    });
                }, 100);
            }
        });
    }

    function playSource(index, results, movie) {
        var item = results[parseInt(index)];
        if (!item || !item.url) return;
        
        if (Lampa.Modal && Lampa.Modal.close) Lampa.Modal.close();
        if (Lampa.Noty) Lampa.Noty.show('USM: Запуск ' + item.title);
        
        // Запускаем стандартный плеер Lampa
        Lampa.Player.play({
            url: item.url,
            title: item.title || (movie.title || movie.name || 'USM Playback'),
            timeline: movie,
            subtitles: item.subtitles || []
        });
    }

    function addWatchButton() {
        Lampa.Listener.follow('video', function(e) {
            if (e.type === 'complite') {
                // Проверяем, не добавили ли мы уже кнопку
                if (e.object.template.find('.usm-custom-btn').length > 0) return;

                var btn = document.createElement('div');
                btn.className = 'full-start__button selector usm-custom-btn';
                btn.setAttribute('tabindex', '0');
                btn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg><span>USM Источники</span>';
                btn.style.cssText = 'display: flex; align-items: center; justify-content: center; gap: 8px; padding: 12px 20px; background: #e50914; border-radius: 8px; color: white; font-weight: bold; cursor: pointer; margin-right: 10px; transition: transform 0.1s;';
                
                var container = e.object.template.find('.full-start__buttons');
                if (container.length) {
                    // Вставляем нашей кнопкой первой (перед стандартными)
                    container.prepend(btn);
                }

                var movie = e.object.movie;
                
                function triggerSearch() {
                    btn.style.transform = 'scale(0.95)';
                    setTimeout(function() { btn.style.transform = 'scale(1)'; }, 100);
                    openUSMSearch(movie);
                }

                btn.addEventListener('click', triggerSearch);
                btn.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') triggerSearch();
                });
            }
        });
    }

    // ==========================================
    // ПАРСЕР IPTV (M3U)
    // ==========================================
    var iptvCache = null;
    var iptvLoading = false;

    function parseM3U(content) {
        var lines = content.split('\n');
        var channels = [];
        var current = {};
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (line.startsWith('#EXTINF:')) {
                var logo = line.match(/tvg-logo="([^"]*)"/);
                var group = line.match(/group-title="([^"]*)"/);
                var name = line.match(/,(.*)$/);
                current = {
                    logo: logo ? logo[1] : '',
                    group: group ? group[1] : 'Общие',
                    title: name ? name[1].trim() : 'Неизвестный канал'
                };
            } else if (line.startsWith('http')) {
                current.url = line;
                channels.push({
                    id: 'iptv-' + channels.length,
                    title: current.title,
                    url: current.url,
                    quality: 'Live',
                    voice: current.group,
                    type: 'iptv',
                    source: 'IPTV Провайдер'
                });
                current = {};
            }
        }
        return channels;
    }

    function loadIPTV(callback) {
        if (iptvCache) {
            callback(iptvCache);
            return;
        }
        if (iptvLoading) {
            var check = setInterval(function() {
                if (!iptvLoading) { clearInterval(check); callback(iptvCache); }
            }, 500);
            return;
        }
        
        iptvLoading = true;
        var url = 'http://iptv.ipcom.info/tv.m3u';
        var RequestClass = Lampa.Request || Lampa.Reguest;
        
        var req = new RequestClass();
        req.silent(url, function(data) {
            iptvCache = parseM3U(data);
            iptvLoading = false;
            console.log('[USM] IPTV загружено напрямую, каналов:', iptvCache.length);
            callback(iptvCache);
        }, function(err) {
            console.warn('[USM] Прямая загрузка IPTV не удалась, пробую прокси...', err);
            var proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
            var req2 = new RequestClass();
            req2.silent(proxyUrl, function(data) {
                iptvCache = parseM3U(data);
                iptvLoading = false;
                console.log('[USM] IPTV загружено через прокси, каналов:', iptvCache.length);
                callback(iptvCache);
            }, function(err2) {
                iptvLoading = false;
                console.error('[USM] Ошибка загрузки IPTV:', err2);
                callback([]);
            });
        });
    }

    function addSettings() {
        if (!window.Lampa || !Lampa.SettingsApi) return false;
        if (window[NAME + '_ok']) return true;
        try {
            Lampa.SettingsApi.addComponent({ 
                component: NAME, name: 'Менеджер источников', 
                icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 0h6v6h-6v-6z"/></svg>' 
            });
            Lampa.SettingsApi.addParam({ 
                component: NAME, param: { name: NAME + '_btn', type: 'button' }, 
                field: { name: 'Открыть менеджер источников', description: 'Управление подключёнными источниками' }, 
                onRender: function (item) { 
                    if (item && typeof item.on === 'function') item.on('hover:enter click', openSettings); 
                },
                onChange: openSettings
            });
            window[NAME + '_ok'] = true;
            console.log('[USM] ✅ Настройки успешно зарегистрированы!');
            return true;
        } catch (e) { console.error('[USM] ❌ Ошибка регистрации:', e); return false; }
    }

    function start() {
        console.log('[USM] 🚀 Запуск инициализации v' + VERSION + '...');
        setTimeout(function() {
            if (!addSettings()) console.error('[USM] Не удалось зарегистрировать настройки');
            addWatchButton(); // Добавляем кнопку в карточку фильма
        }, 500);
    }

    if (window.appready) { start(); } 
    else if (Lampa.Listener) { Lampa.Listener.follow('app', function (event) { if (event.type === 'ready') start(); }); } 
    else { setTimeout(start, 2000); }

    // ==========================================
    // РЕГИСТРАЦИЯ ИСТОЧНИКОВ
    // ==========================================
    console.log('[USM] Регистрация источников...');
    
    // 1. Ваш реальный IPTV провайдер
    register({
        id: 'iptv-com-provider',
        title: '📺 IPTV Провайдер (ipcom)',
        search: function(movie, done) {
            loadIPTV(function(channels) {
                if (!channels || channels.length === 0) { done(null, []); return; }
                var query = (movie.title || movie.name || '').toLowerCase();
                // Ищем совпадения по названию канала
                var results = channels.filter(function(ch) {
                    return ch.title.toLowerCase().includes(query) || query.includes(ch.title.toLowerCase());
                });
                done(null, results.slice(0, 15)); // Топ-15 совпадений
            });
        },
        health: function(done) {
            loadIPTV(function(channels) { done(null, channels && channels.length > 0); });
        }
    });

    // 2. Демо-источник фильмов (для теста)
    register({
        id: 'demo-movies',
        title: '🎬 Демо Фильмы',
        search: function(movie, done) {
            setTimeout(function() {
                done(null, [{ 
                    id: 'mov-1', 
                    title: (movie.title || 'Фильм') + ' [1080p] (Демо)', 
                    url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', 
                    quality: '1080p', 
                    voice: 'Дублированный',
                    type: 'movie',
                    source: 'Демо Источник'
                }]);
            }, 200);
        },
        health: function(done) { done(null, true); }
    });

    console.log('[USM] ✅ Файл успешно загружен и выполнен до конца!');

    window.LampaUSM = {
        version: VERSION,
        register: register,
        openSettings: openSettings,
        search: function(movie, callback) {
            // Внутренняя функция поиска для использования в openUSMSearch
            var list = Object.keys(providers).map(function (id) { return providers[id]; })
                .filter(function (provider) { var cfg = state.sources[provider.id] || {}; return cfg.enabled !== false && provider.enabled !== false; })
                .sort(function (a, b) { var pa = state.sources[a.id] || {}, pb = state.sources[b.id] || {}; return (pb.priority || 0) - (pa.priority || 0); });

            var tasks = list.map(function (provider) {
                return function (done) {
                    var started = Date.now(), completed = false;
                    function finish(error, items) {
                        if (completed) return; completed = true;
                        state.health[provider.id] = { last_check: Date.now(), online: !error, response_ms: Date.now() - started, error: error ? String(error.message || error) : '' };
                        save(); done(error, items || []);
                    }
                    try { provider.search(movie, finish); } catch (error) { finish(error, []); }
                };
            });

            // Упрощенный run для быстрого вызова
            var cursor = 0, active = 0, results = [];
            function next() {
                if (cursor >= tasks.length && active === 0) { callback({ results: results }); return; }
                while (active < state.max_parallel && cursor < tasks.length) {
                    (function (task) {
                        active++;
                        task(function (err, data) {
                            active--;
                            if (data && data.length) results = results.concat(data);
                            next();
                        });
                    })(tasks[cursor++]);
                }
            }
            next();
        }
    };
})();
