/* Data of the heat pump diagram: reads the objects and states of one adapter instance through the socket of the web adapter and
   reports every change. Read only: it only subscribes and never writes. */
(function (root) {
    'use strict';

    var ADAPTER = 'idm-modbus';
    /* an id that sorts after every id with the prefix (the way ioBroker lists the ids of a range) */
    var RANGE_END = '香';
    var OBJECT_REFRESH_MS = 5000;

    function loadScript(url) {
        return new Promise(function (resolve, reject) {
            var script = document.createElement('script');
            script.src = url;
            script.onload = resolve;
            script.onerror = function () {
                reject(new Error(`Cannot load ${url}`));
            };
            document.head.appendChild(script);
        });
    }

    /* The web adapter serves one of two client libraries under /socket.io/socket.io.js: the socket.io client (a function) or the
       shim of its pure WebSocket mode (an object with connect). */
    function openSocket(origin) {
        var options = { path: '/socket.io', transports: ['websocket', 'polling'], reconnection: true };
        var io = root.io;
        return typeof io === 'function' ? io(origin || undefined, options) : io.connect(origin || '/', options);
    }

    function parseSettings(text) {
        try {
            return typeof text === 'string' ? JSON.parse(text) : {};
        } catch {
            return {};
        }
    }

    function ask(socket, command) {
        var args = Array.prototype.slice.call(arguments, 2);
        return new Promise(function (resolve, reject) {
            args.push(function (error, result) {
                if (error) {
                    reject(new Error(String(error)));
                } else {
                    resolve(result);
                }
            });
            socket.emit.apply(socket, [command].concat(args));
        });
    }

    /**
     * Connect and keep the data current.
     *
     * @param options `instance` (instance number) and `origin` (address of the web adapter when the page is not served by it)
     * @param handlers `onSnapshot({ states, objects, settings, language })` after every (re)connect and when the objects changed,
     *   `onState(id, value, before)` for every change (`before` is the value it replaces), `onConnection(connected, message)`
     */
    function connect(options, handlers) {
        var origin = options.origin || '';
        var prefix = `${ADAPTER}.${options.instance}.`;
        var relative = function (id) {
            return id.indexOf(prefix) === 0 ? id.slice(prefix.length) : null;
        };
        var socket = null;
        var states = {};
        var objects = {};
        var settings = {};
        var language = (navigator.language || 'en').slice(0, 2);
        var refreshAt = 0;

        function loadObjects() {
            var range = { startkey: prefix, endkey: prefix + RANGE_END };
            return Promise.all(
                ['state', 'channel'].map(function (type) {
                    return ask(socket, 'getObjectView', 'system', type, range);
                }),
            ).then(function (views) {
                objects = {};
                views.forEach(function (view) {
                    ((view && view.rows) || []).forEach(function (row) {
                        var id = relative(row.id);
                        if (id) {
                            objects[id] = row.value;
                        }
                    });
                });
            });
        }
        function loadAll() {
            return Promise.all([
                loadObjects(),
                ask(socket, 'getStates', `${prefix}*`).then(function (all) {
                    states = {};
                    Object.keys(all || {}).forEach(function (id) {
                        var rel = relative(id);
                        if (rel) {
                            states[rel] = all[id] ? all[id].val : null;
                        }
                    });
                }),
                ask(socket, 'getObject', 'system.config')
                    .then(function (config) {
                        language = (config && config.common && config.common.language) || language;
                    })
                    .catch(function () {
                        /* the browser language stays */
                    }),
                ask(socket, 'getState', `${prefix}diagram.settings`)
                    .then(function (state) {
                        settings = parseSettings(state && state.val);
                    })
                    .catch(function () {
                        settings = {};
                    }),
            ]).then(function () {
                handlers.onSnapshot({ states: states, objects: objects, settings: settings, language: language });
            });
        }
        /* a state that is not in the object tree yet: the adapter created it, so look at the objects again (not too often) */
        function refreshObjects() {
            var now = Date.now();
            if (now < refreshAt) {
                return;
            }
            refreshAt = now + OBJECT_REFRESH_MS;
            loadObjects()
                .then(function () {
                    handlers.onSnapshot({ states: states, objects: objects, settings: settings, language: language });
                })
                .catch(function () {
                    /* the next change tries again */
                });
        }

        var start = loadScript(`${origin}/socket.io/socket.io.js`).then(function () {
            socket = openSocket(origin);
            socket.on('connect', function () {
                loadAll()
                    .then(function () {
                        socket.emit('subscribe', `${prefix}*`);
                        handlers.onConnection(true);
                    })
                    .catch(function (error) {
                        handlers.onConnection(false, error.message);
                    });
            });
            socket.on('disconnect', function () {
                handlers.onConnection(false);
            });
            socket.on('connect_error', function (error) {
                handlers.onConnection(false, error && error.message);
            });
            socket.on('stateChange', function (id, state) {
                var rel = relative(id);
                if (rel === null) {
                    return;
                }
                if (!objects[rel] && rel !== 'info.connection') {
                    refreshObjects();
                }
                var before = states[rel];
                states[rel] = state ? state.val : null;
                if (rel === 'diagram.settings') {
                    settings = parseSettings(states[rel]);
                    handlers.onSnapshot({ states: states, objects: objects, settings: settings, language: language });
                    return;
                }
                handlers.onState(rel, states[rel], before);
            });
        });
        start.catch(function (error) {
            handlers.onConnection(false, error.message);
        });
        return {
            close: function () {
                if (socket) {
                    socket.close();
                }
            },
        };
    }

    root.DiagramData = { connect: connect };
})(this);
