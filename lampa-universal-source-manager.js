/*
 * Lampa Universal Source Manager
 * v1.0.0
 *
 * Provider-manager core for Lampa 3.x.
 *
 * This build contains NO third-party movie/video providers.
 * Add only adapters for APIs/sources you own or are authorized to use.
 *
 * Adapter example:
 *
 * LampaUSM.register({
 *   id: 'my-api',
 *   title: 'Мой API',
 *   search: function(movie, done) {
 *     // Fetch your authorized API and return:
 *     // [{id, title, url, quality, voice, subtitles, type}]
 *     done(null, results);
 *   },
 *   health: function(done) {
 *     done(null, true);
 *   }
 * });
 */

(function () {
    'use strict';

    var NAME = 'lampa_universal_source_manager';
    var VERSION = '1.0.0';
    var STORAGE = 'lampa_usm_config_v3';

    if (window[NAME]) return;
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
            throw new Error('Invalid provider');
        }

        providers[provider.id] = provider;

        if (typeof state.sources[provider.id] === 'undefined') {
            state.sources[provider.id] = {
                enabled: true,
                priority: 100
            };
            save();
        }

        return provider.id;
    }

    function unregister(id) {
        delete providers[id];
        delete state.sources[id];
        save();
    }

    function quality(value) {
        if (!value) return 0;

        var text = String(value).toUpperCase().replace(/\s/g, '');

        var map = {
            '4K': 2160,
            '2160P': 2160,
            'UHD': 2160,
            '2K': 1440,
            '1440P': 1440,
            'FHD': 1080,
            '1080P': 1080,
            'HD': 720,
            '720P': 720,
            'SD': 480,
            '480P': 480
        };

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
        return [
            item.title.toLowerCase().trim(),
            item.quality_value,
            item.voice.toLowerCase().trim(),
            item.type,
            item.url
        ].join('|');
    }

    function dedupe(items) {
        var seen = {};
        var output = [];

        items.forEach(function (item) {
            var key = fingerprint(item);

            if (!seen[key]) {
                seen[key] = true;
                output.push(item);
            }
        });

        return output;
    }

    function rank(a, b) {
        var pa = state.sources[a.source_id] || {};
        var pb = state.sources[b.source_id] || {};

        /* Higher priority first. */
        if ((pb.priority || 0) !== (pa.priority || 0)) {
            return (pb.priority || 0) - (pa.priority || 0);
        }

        /* Then quality. */
        if (b.quality_value !== a.quality_value) {
            return b.quality_value - a.quality_value;
        }

        /* Then source name. */
        return String(a.source).localeCompare(String(b.source));
    }

    function request(url, success, fail) {
        var request = new Lampa.Reguest();
        var finished = false;

        var timer = setTimeout(function () {
            if (finished) return;
            finished = true;

            if (fail) fail(new Error('timeout'));
        }, state.timeout);

        request.silent(
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

    function run(tasks, limit, complete) {
        var cursor = 0;
        var active = 0;
        var results = [];
        var errors = [];

        function next() {
            if (cursor >= tasks.length && active === 0) {
                complete(results, errors);
                return;
            }

            while (active < limit && cursor < tasks.length) {
                (function (task) {
                    active++;

                    task(function (err, data) {
                        active--;

                        if (err) errors.push(err);
                        if (data && data.length) {
                            results = results.concat(data);
                        }

                        next();
                    });
                })(tasks[cursor++]);
            }
        }

        next();
    }

    function search(movie, callback) {
        var list = Object.keys(providers)
            .map(function (id) {
                return providers[id];
            })
            .filter(function (provider) {
                var cfg = state.sources[provider.id] || {};

                return cfg.enabled !== false &&
                    provider.enabled !== false;
            })
            .sort(function (a, b) {
                var pa = state.sources[a.id] || {};
                var pb = state.sources[b.id] || {};

                return (pb.priority || 0) - (pa.priority || 0);
            });

        var tasks = list.map(function (provider) {
            return function (done) {
                var started = Date.now();
                var completed = false;

                function finish(error, items) {
                    if (completed) return;
                    completed = true;

                    var normalized = (items || [])
                        .map(function (item) {
                            return normalize(item, provider);
                        })
                        .filter(Boolean)
                        .filter(function (item) {
                            return item.quality_value >= state.min_quality;
                        });

                    state.health[provider.id] = {
                        last_check: Date.now(),
                        online: !error,
                        response_ms: Date.now() - started,
                        error: error ? String(error.message || error) : ''
                    };

                    save();
                    done(error, normalized);
                }

                try {
                    provider.search(movie, finish);
                } catch (error) {
                    finish(error, []);
                }
            };
        });

        run(tasks, Math.max(1, state.max_parallel), function (items, errors) {
            items = dedupe(items).sort(rank);

            callback({
                results: items,
                errors: errors,
                providers: list.length,
                health: copy(state.health)
            });
        });
    }

    function health(id, callback) {
        var provider = providers[id];

        if (!provider) {
            callback(new Error('Unknown provider'), false);
            return;
        }

        if (typeof provider.health !== 'function') {
            callback(null, null);
            return;
        }

        var started = Date.now();
        var done = false;

        var timer = setTimeout(function () {
            if (done) return;
            done = true;

            state.health[id] = {
                last_check: Date.now(),
                online: false,
                response_ms: Date.now() - started,
                error: 'timeout'
            };

            save();
            callback(new Error('timeout'), false);
        }, state.timeout);

        provider.health(function (error, online) {
            if (done) return;
            done = true;
            clearTimeout(timer);

            state.health[id] = {
                last_check: Date.now(),
                online: online !== false,
                response_ms: Date.now() - started,
                error: error ? String(error.message || error) : ''
            };

            save();
            callback(error || null, online !== false);
        });
    }

    function setEnabled(id, enabled) {
        if (!state.sources[id]) {
            state.sources[id] = {
                enabled: !!enabled,
                priority: 100
            };
        } else {
            state.sources[id].enabled = !!enabled;
        }

        save();
    }

    function setPriority(id, priority) {
        if (!state.sources[id]) {
            state.sources[id] = {
                enabled: true,
                priority: Number(priority) || 0
            };
        } else {
            state.sources[id].priority = Number(priority) || 0;
        }

        save();
    }

    function clearHealth() {
        state.health = {};
        save();
    }

    function adapterJson(definition) {
        return {
            id: definition.id,
            title: definition.title,
            enabled: definition.enabled !== false,

            search: function (movie, done) {
                var title = movie.title || movie.name || '';
                var date = movie.release_date ||
                    movie.first_air_date ||
                    '';

                var year = String(date).slice(0, 4);

                var url = definition.endpoint +
                    '?q=' + encodeURIComponent(title) +
                    '&year=' + encodeURIComponent(year) +
                    '&tmdb=' + encodeURIComponent(movie.id || '');

                request(url, function (data) {
                    done(
                        null,
                        data && Array.isArray(data.results)
                            ? data.results
                            : []
                    );
                }, function (error) {
                    done(error, []);
                });
            }
        };
    }


    /*
     * Lightweight source-management UI.
     * It intentionally uses Lampa's existing DOM helpers where available,
     * and falls back to a simple HTML panel.
     */
    function statusFor(id) {
        var h = state.health[id];

        if (!h) return {
            icon: '⚪',
            text: 'не проверен',
            ms: ''
        };

        if (h.online === false) return {
            icon: '🔴',
            text: 'недоступен',
            ms: h.response_ms ? h.response_ms + ' ms' : ''
        };

        if (h.online === true) return {
            icon: '🟢',
            text: 'доступен',
            ms: h.response_ms ? h.response_ms + ' ms' : ''
        };

        return {
            icon: '⚪',
            text: 'не проверен',
            ms: ''
        };
    }

    function providerRows() {
        return Object.keys(providers)
            .map(function (id) {
                var p = providers[id];
                var cfg = state.sources[id] || {
                    enabled: true,
                    priority: 100
                };
                var status = statusFor(id);

                return {
                    id: id,
                    title: p.title || id,
                    enabled: cfg.enabled !== false,
                    priority: Number(cfg.priority || 0),
                    status: status
                };
            })
            .sort(function (a, b) {
                return b.priority - a.priority ||
                    a.title.localeCompare(b.title);
            });
    }

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function settingsHTML() {
        var rows = providerRows();

        var html = '';
        html += '<div class="usm-panel">';
        html += '<div class="usm-title">Universal Source Manager</div>';
        html += '<div class="usm-subtitle">Источники и состояние подключения</div>';

        if (!rows.length) {
            html += '<div class="usm-empty">';
            html += 'Источники ещё не подключены.<br>';
            html += '<small>Подключите адаптер через LampaUSM.register().</small>';
            html += '</div>';
        }

        rows.forEach(function (row) {
            html += '<div class="usm-row" data-usm-id="' +
                escapeHtml(row.id) + '">';

            html += '<div class="usm-main">';
            html += '<div class="usm-name">' +
                escapeHtml(row.status.icon + ' ' + row.title) +
                '</div>';

            html += '<div class="usm-meta">' +
                escapeHtml(row.status.text) +
                (row.status.ms ? ' · ' + escapeHtml(row.status.ms) : '') +
                '</div>';
            html += '</div>';

            html += '<label class="usm-toggle">';
            html += '<input type="checkbox" data-usm-toggle="' +
                escapeHtml(row.id) + '"' +
                (row.enabled ? ' checked' : '') + '>';
            html += '<span></span>';
            html += '</label>';

            html += '<input class="usm-priority" type="number" min="0" max="999" ' +
                'data-usm-priority="' + escapeHtml(row.id) + '" ' +
                'value="' + row.priority + '">';

            html += '<button class="usm-test" data-usm-test="' +
                escapeHtml(row.id) + '">Проверить</button>';

            html += '</div>';
        });

        html += '<div class="usm-actions">';
        html += '<button class="usm-test-all">Проверить все</button>';
        html += '<button class="usm-clear-health">Сбросить статусы</button>';
        html += '</div>';

        html += '<div class="usm-global">';
        html += '<label>Таймаут, мс <input id="usm-timeout" type="number" min="500" max="30000" value="' +
            state.timeout + '"></label>';
        html += '<label>Параллельных запросов <input id="usm-parallel" type="number" min="1" max="12" value="' +
            state.max_parallel + '"></label>';
        html += '<label>Минимальное качество <input id="usm-quality" type="number" min="0" max="2160" value="' +
            state.min_quality + '"></label>';
        html += '</div>';

        html += '</div>';

        return html;
    }

    function injectStyles() {
        if (document.getElementById('lampa-usm-style')) return;

        var style = document.createElement('style');
        style.id = 'lampa-usm-style';

        style.textContent = [
            '.usm-panel{padding:1.5em;color:#fff;font-size:1em}',
            '.usm-title{font-size:1.35em;font-weight:600;margin-bottom:.25em}',
            '.usm-subtitle{opacity:.6;margin-bottom:1em}',
            '.usm-row{display:flex;align-items:center;gap:.7em;padding:.8em 0;border-bottom:1px solid rgba(255,255,255,.08)}',
            '.usm-main{flex:1;min-width:0}',
            '.usm-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
            '.usm-meta{font-size:.8em;opacity:.55;margin-top:.25em}',
            '.usm-toggle input{width:1.2em;height:1.2em}',
            '.usm-priority{width:4.5em;background:rgba(255,255,255,.08);color:#fff;border:0;padding:.5em;border-radius:.35em}',
            '.usm-test,.usm-actions button{background:rgba(255,255,255,.1);color:#fff;border:0;border-radius:.4em;padding:.55em .8em}',
            '.usm-test:active,.usm-actions button:active{transform:scale(.97)}',
            '.usm-actions{display:flex;gap:.6em;margin-top:1em}',
            '.usm-global{display:flex;flex-direction:column;gap:.7em;margin-top:1.2em;padding-top:1em;border-top:1px solid rgba(255,255,255,.08)}',
            '.usm-global label{display:flex;justify-content:space-between;gap:1em}',
            '.usm-global input{width:7em;background:rgba(255,255,255,.08);color:#fff;border:0;border-radius:.35em;padding:.5em}',
            '.usm-empty{padding:2em 0;opacity:.65}'
        ].join('');

        document.head.appendChild(style);
    }

    function openSettings() {
        injectStyles();

        /*
         * Use Lampa.Select where available. This keeps navigation TV-friendly.
         * The panel itself is deliberately framework-light.
         */
        if (Lampa.Modal && Lampa.Modal.open) {
            Lampa.Modal.open({
                title: 'Universal Source Manager',
                html: settingsHTML(),
                onBack: function () {
                    return true;
                }
            });

            setTimeout(bindSettingsEvents, 0);
            return;
        }

        if (Lampa.Noty) {
            Lampa.Noty.show('Universal Source Manager: ' +
                Object.keys(providers).length + ' источников');
        }
    }

    function refreshSettings() {
        if (Lampa.Modal && Lampa.Modal.close) {
            Lampa.Modal.close();
        }

        setTimeout(openSettings, 100);
    }

    function bindSettingsEvents() {
        var root = document.querySelector('.usm-panel');
        if (!root) return;

        root.querySelectorAll('[data-usm-toggle]').forEach(function (el) {
            el.addEventListener('change', function () {
                setEnabled(el.getAttribute('data-usm-toggle'), el.checked);
            });
        });

        root.querySelectorAll('[data-usm-priority]').forEach(function (el) {
            el.addEventListener('change', function () {
                setPriority(
                    el.getAttribute('data-usm-priority'),
                    parseInt(el.value, 10) || 0
                );
            });
        });

        root.querySelectorAll('[data-usm-test]').forEach(function (el) {
            el.addEventListener('click', function () {
                var id = el.getAttribute('data-usm-test');

                el.disabled = true;
                el.textContent = '...';

                health(id, function () {
                    el.disabled = false;
                    el.textContent = 'Проверить';
                    refreshSettings();
                });
            });
        });

        var all = root.querySelector('.usm-test-all');

        if (all) {
            all.addEventListener('click', function () {
                var ids = Object.keys(providers);
                var index = 0;

                all.disabled = true;
                all.textContent = 'Проверка...';

                function next() {
                    if (index >= ids.length) {
                        all.disabled = false;
                        all.textContent = 'Проверить все';
                        refreshSettings();
                        return;
                    }

                    health(ids[index++], next);
                }

                next();
            });
        }

        var clear = root.querySelector('.usm-clear-health');

        if (clear) {
            clear.addEventListener('click', function () {
                clearHealth();
                refreshSettings();
            });
        }

        var timeout = root.querySelector('#usm-timeout');
        var parallel = root.querySelector('#usm-parallel');
        var quality = root.querySelector('#usm-quality');

        if (timeout) {
            timeout.addEventListener('change', function () {
                state.timeout = Math.max(500, Math.min(
                    30000,
                    parseInt(timeout.value, 10) || 5000
                ));
                save();
            });
        }

        if (parallel) {
            parallel.addEventListener('change', function () {
                state.max_parallel = Math.max(1, Math.min(
                    12,
                    parseInt(parallel.value, 10) || 4
                ));
                save();
            });
        }

        if (quality) {
            quality.addEventListener('change', function () {
                state.min_quality = Math.max(0, Math.min(
                    2160,
                    parseInt(quality.value, 10) || 0
                ));
                save();
            });
        }
    }

    /*
     * Public API for adapters and debugging.
     */
    window.LampaUSM = {
        version: VERSION,
        state: state,
        providers: providers,

        register: register,
        unregister: unregister,

        search: search,
        health: health,

        setEnabled: setEnabled,
        setPriority: setPriority,
        clearHealth: clearHealth,

        adapterJson: adapterJson,

        save: save,

        openSettings: openSettings,

        list: function () {
            return providerRows();
        },

        exportConfig: function () {
            return JSON.stringify(state, null, 2);
        },

        reset: function () {
            state = copy(DEFAULTS);
            save();
            return state;
        }
    };

    /*
     * Lampa 3.x settings integration.
     *
     * We use SettingsApi rather than the old Lampa.Settings API.
     * See Lampa 3.x migration documentation.
     */
    function addSettings() {
        if (!Lampa.SettingsApi) return;
        if (window[NAME + '_settings']) return;

        window[NAME + '_settings'] = true;

        Lampa.SettingsApi.addComponent({
            component: NAME,
            name: 'Universal Sources',
            icon: ''
        });

        if (Lampa.SettingsApi.addParam) {
            Lampa.SettingsApi.addParam({
                component: NAME,
                param: {
                    name: 'timeout',
                    type: 'input',
                    default: state.timeout
                },
                field: {
                    name: 'Таймаут источника, мс'
                }
            });

            Lampa.SettingsApi.addParam({
                component: NAME,
                param: {
                    name: 'max_parallel',
                    type: 'input',
                    default: state.max_parallel
                },
                field: {
                    name: 'Одновременных запросов'
                }
            });

            Lampa.SettingsApi.addParam({
                component: NAME,
                param: {
                    name: 'min_quality',
                    type: 'input',
                    default: state.min_quality
                },
                field: {
                    name: 'Минимальное качество, p'
                }
            });
        }
    }

    function start() {
        addSettings();

        if (window.console) {
            console.log(
                '[USM] Universal Source Manager ' +
                VERSION +
                ' loaded'
            );
        }
    }

    /*
     * Lampa 3.x plugin bootstrap:
     * wait for app:ready when required.
     */
    if (window.appready) {
        start();
    } else if (Lampa.Listener) {
        Lampa.Listener.follow('app', function (event) {
            if (event.type === 'ready') start();
        });
    }

})();
