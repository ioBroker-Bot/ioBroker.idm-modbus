/* Heat pump diagram: draws the plant the adapter reports and keeps the values live. Read only. */
(function () {
    'use strict';
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.getElementById('diagram');
    var model = null;
    var modelJson = '';
    var state = {};
    var bindings = {};
    var gradientCount = 0;

    function el(tag, attrs, parent) {
        var node = document.createElementNS(NS, tag);
        Object.keys(attrs || {}).forEach(function (k) {
            node.setAttribute(k, attrs[k]);
        });
        if (parent) {
            parent.appendChild(node);
        }
        return node;
    }
    function text(parent, x, y, str, cls, anchor) {
        var t = el('text', { x: x, y: y, class: cls || 'label' }, parent);
        if (anchor) {
            t.setAttribute('text-anchor', anchor);
        }
        t.textContent = str;
        return t;
    }
    function bind(id, fn) {
        if (!id) {
            return;
        }
        (bindings[id] = bindings[id] || []).push(fn);
        if (Object.prototype.hasOwnProperty.call(state, id)) {
            fn(state[id]);
        }
    }
    function num(v) {
        return typeof v === 'number' && isFinite(v) ? v : null;
    }
    function fmt(v, decimals, unit) {
        var n = num(v);
        if (n === null) {
            return '–';
        }
        var s = n.toFixed(decimals);
        if (model && model.language === 'de') {
            s = s.replace('.', ',');
        }
        return s + (unit ? `\u202f${unit}` : '');
    }
    function value(parent, x, y, id, decimals, unit, cls, anchor) {
        var t = text(parent, x, y, '–', cls || 'value', anchor);
        bind(id, function (v) {
            t.textContent = fmt(v, decimals, unit);
        });
        return t;
    }
    /* temperature to colour: blue (cold) over green and yellow to orange and red (hot) */
    function tempColor(t) {
        var n = num(t);
        if (n === null) {
            return '#9aa5b1';
        }
        var k = Math.max(0, Math.min(1, (n - 5) / 55));
        return `hsl(${Math.round(215 - k * 205)}, 80%, 55%)`;
    }
    function isOn(v) {
        return v === true || (num(v) !== null && v !== 0);
    }
    /* a pipe; its colour follows a temperature, it flows while the compressor runs */
    function pipe(parent, d, tempId, activeId) {
        var p = el('path', { d: d, class: 'pipe', stroke: '#9aa5b1' }, parent);
        bind(tempId, function (v) {
            p.setAttribute('stroke', tempColor(v));
        });
        bind(activeId, function (v) {
            p.classList.toggle('flowing', isOn(v));
        });
        return p;
    }
    function card(parent, x, y, w, h, title) {
        el('rect', { x: x, y: y, width: w, height: h, rx: 14, class: 'box' }, parent);
        if (title) {
            text(parent, x + 16, y + 28, title, 'title');
        }
    }
    function dot(parent, cx, cy, id) {
        var c = el('circle', { cx: cx, cy: cy, r: 6, fill: '#9aa5b1' }, parent);
        bind(id, function (v) {
            c.setAttribute('fill', isOn(v) ? 'var(--good)' : '#9aa5b1');
        });
    }
    function fan(parent, cx, cy, size, compressorId) {
        el('rect', { x: cx - size / 2, y: cy - size / 2, width: size, height: size, rx: 12, class: 'fanbg' }, parent);
        var g = el('g', { transform: `translate(${cx} ${cy})` }, parent);
        var inner = el('g', { class: 'fan' }, g);
        for (var i = 0; i < 3; i++) {
            el(
                'path',
                {
                    d: 'M0 0 C 8 -10 22 -34 6 -44 C -9 -34 -10 -12 0 0 Z',
                    fill: 'var(--accent)',
                    transform: `rotate(${i * 120}) scale(${size / 110})`,
                },
                inner,
            );
        }
        el('circle', { r: 4, fill: 'var(--muted)' }, g);
        bind(compressorId, function (v) {
            inner.classList.toggle('spin', isOn(v));
        });
    }
    /* the tank: a vertical gradient from the top to the bottom temperature, a chip per level */
    function tank(parent, x, y, w, h, levels, title) {
        var id = `grad${++gradientCount}`;
        var defs = el('defs', {}, parent);
        var grad = el('linearGradient', { id: id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
        el('stop', { offset: '0%', 'stop-color': '#f28a3a' }, grad);
        el('stop', { offset: '50%', 'stop-color': '#f3b266' }, grad);
        el('stop', { offset: '78%', 'stop-color': '#9cc3e8' }, grad);
        el('stop', { offset: '100%', 'stop-color': '#3f8fdc' }, grad);
        el('rect', { x: x, y: y, width: w, height: h, rx: 58, fill: `url(#${id})`, class: 'tank' }, parent);
        text(parent, x + w / 2, y - 28, title, 'title', 'middle');
        levels.forEach(function (level, i) {
            var cy = levels.length === 1 ? y + h / 2 : y + 56 + (i * (h - 112)) / (levels.length - 1);
            el('rect', { x: x + 14, y: cy - 15, width: w - 28, height: 30, rx: 15, class: 'level' }, parent);
            var t = text(parent, x + w / 2, cy + 5, '–', 'leveltext', 'middle');
            bind(level.id, function (v) {
                t.textContent = (level.tag ? `${level.tag}  ` : '') + fmt(v, 1, '°C');
            });
        });
    }

    /* a pipe made of straight pieces; `points` are [x, y] pairs */
    function line(parent, points, tempId, activeId) {
        var d = points
            .map(function (pt, k) {
                return `${(k ? 'L' : 'M') + pt[0]} ${pt[1]}`;
            })
            .join(' ');
        return pipe(parent, d, tempId, activeId);
    }
    /* a value chip with the IDM sensor tag in front, sitting on a pipe */
    function tagChip(parent, cx, cy, id, tag) {
        var g = el('g', {}, parent);
        var r = el('rect', { x: cx - 52, y: cy - 13, width: 104, height: 26, rx: 13, fill: '#9aa5b1' }, g);
        var t = text(g, cx, cy + 5, tag, 'chiptext', 'middle');
        bind(id, function (v) {
            r.setAttribute('fill', tempColor(v));
            t.textContent = `${tag}  ${fmt(v, 1, '°C')}`;
        });
    }
    /* the heat exchanger of the fresh water station: a hot and a cold zigzag side by side */
    function exchanger(parent, x, y, w, hotId, coldId) {
        var step = (w - 20) / 6;
        var path = function (yy) {
            var d = `M${x} ${yy} H${x + 10}`;
            for (var k = 0; k < 6; k++) {
                d += ` l${step / 2} ${k % 2 ? 12 : -12} l${step / 2} ${k % 2 ? -12 : 12}`;
            }
            return `${d} H${x + w}`;
        };
        var hot = el('path', { d: path(y), class: 'pipe thin', stroke: '#9aa5b1' }, parent);
        var cold = el('path', { d: path(y + 30), class: 'pipe thin', stroke: '#9aa5b1' }, parent);
        bind(hotId, function (v) {
            hot.setAttribute('stroke', tempColor(v));
        });
        bind(coldId, function (v) {
            cold.setAttribute('stroke', tempColor(v));
        });
    }

    function render() {
        var m = model;
        var p = m.parts;
        var ids = m.ids;
        while (svg.firstChild) {
            svg.removeChild(svg.firstChild);
        }
        document.getElementById('title').textContent = m.labels.title;
        document.title = m.labels.title;
        document.documentElement.lang = m.language;
        bindings = {};
        gradientCount = 0;
        var root = el('g', { transform: 'translate(130 0)' }, svg);
        var gPipes = el('g', {}, root);
        var gParts = el('g', {}, root);
        var circuits = m.circuits;

        /* fixed grid: the three pipes between heat pump and storage run at 110 (hot gas line), 190 (flow), 270 (return) */
        var Y_HGL = 110,
            Y_FLOW = 190,
            Y_RET = 270;
        var hpX = 20,
            hpY = 60,
            hpW = 280,
            hpH = 270;
        var tankX = 450,
            tankY = 80,
            tankW = 150,
            tankH = 360;

        /* heat pump card: fan, power, COP, the sensors of heat pump and heat source (B36, B37, ...), operating mode */
        var stripName = function (name) {
            return name
                .replace(/\s*(temperature|temperatur|température|temperatura|temperatuur|temperatura|温度)\s*/i, ' ')
                .trim();
        };
        var rows = [
            { label: m.labels.power, id: ids.power, decimals: 2, unit: 'kW' },
            { label: m.labels.cop, id: ids.cop, decimals: 1, unit: '' },
        ]
            .concat(
                m.sensors
                    .filter(function (sensor) {
                        return sensor.group === 'heatpump' || sensor.group === 'source';
                    })
                    .map(function (sensor) {
                        return {
                            label: `${sensor.tag} ${stripName(sensor.name)}`,
                            id: sensor.id,
                            decimals: 1,
                            unit: '°C',
                        };
                    }),
            )
            .filter(function (row) {
                return row.id;
            });
        hpH = Math.max(270, 70 + rows.length * 50 + 70);
        card(gParts, hpX, hpY, hpW, hpH, m.labels.heatPump);
        dot(gParts, hpX + hpW - 20, hpY + 22, ids.compressor);
        fan(gParts, hpX + 72, hpY + 118, 96, ids.compressor);
        rows.forEach(function (row, i) {
            text(gParts, hpX + 142, hpY + 70 + i * 50, row.label, 'label');
            value(gParts, hpX + 142, hpY + 92 + i * 50, row.id, row.decimals, row.unit, 'big');
        });
        if (ids.hpMode) {
            el('rect', { x: hpX + 16, y: hpY + hpH - 48, width: hpW - 32, height: 34, rx: 17, class: 'pill' }, gParts);
            var mode = text(gParts, hpX + hpW / 2, hpY + hpH - 26, '', 'pilltext', 'middle');
            bind(ids.hpMode, function (v) {
                mode.textContent = m.enums.hpMode[String(v)] || '';
            });
        }

        /* the outdoor temperature (B32) stands left of the heat pump, outside of it */
        if (ids.outdoor) {
            text(gParts, -110, hpY + 100, `B32 ${m.labels.outdoor}`, 'label');
            value(gParts, -110, hpY + 130, ids.outdoor, 1, '°C', 'big');
        }

        /* the storage: B48 (hot water top), B41 (hot water bottom) and B38 (heat storage), like the IDM plant diagram */
        var levels = [];
        if (p.dhw) {
            levels.push({ id: ids.dhwTop, tag: 'B48' });
        }
        if (p.dhw && ids.dhwBottom) {
            levels.push({ id: ids.dhwBottom, tag: 'B41' });
        }
        if (p.buffer) {
            levels.push({ id: ids.buffer, tag: 'B38' });
        }
        var hasTank = levels.length > 0;
        if (hasTank) {
            var title =
                p.dhw && p.buffer ? `${m.labels.buffer} / ${m.labels.dhw}` : p.dhw ? m.labels.dhw : m.labels.buffer;
            tank(gParts, tankX, tankY, tankW, tankH, levels, title);
            var chipX = (hpX + hpW + tankX) / 2;
            if (ids.hgl) {
                line(
                    gPipes,
                    [
                        [hpX + hpW, Y_HGL],
                        [tankX + 12, Y_HGL],
                    ],
                    ids.hgl,
                    ids.compressor,
                );
                tagChip(gParts, chipX, Y_HGL, ids.hgl, 'B35');
            }
            line(
                gPipes,
                [
                    [hpX + hpW, Y_FLOW],
                    [tankX + 12, Y_FLOW],
                ],
                ids.hpFlow,
                ids.compressor,
            );
            line(
                gPipes,
                [
                    [hpX + hpW, Y_RET],
                    [tankX + 12, Y_RET],
                ],
                ids.hpReturn,
                ids.compressor,
            );
            tagChip(gParts, chipX, Y_FLOW, ids.hpFlow, 'B33');
            tagChip(gParts, chipX, Y_RET, ids.hpReturn, 'B34');
        } else {
            tagChip(gParts, hpX + hpW + 80, Y_FLOW, ids.hpFlow, 'B33');
            tagChip(gParts, hpX + hpW + 80, Y_RET, ids.hpReturn, 'B34');
        }

        /* heating circuits on the right: flow at the height of the heat pump flow, return at the height of its return */
        var cX = 800,
            cW = 180,
            cH = 140,
            cGap = 16,
            cY = Y_FLOW - 40;
        var flowManifold = 776,
            retManifold = 762;
        var fromX = hasTank ? tankX + tankW - 12 : hpX + hpW;
        circuits.forEach(function (c, i) {
            var y = cY + i * (cH + cGap);
            card(gParts, cX, y, cW, cH, c.name);
            dot(gParts, cX + cW - 18, y + 22, c.active);
            var cols = [{ label: m.labels.flow, id: c.flow, tag: 'B51' }];
            if (c.setpoint) {
                cols.push({ label: m.labels.setpoint, id: c.setpoint });
            }
            if (c.room) {
                cols.push({ label: m.labels.room, id: c.room });
            }
            cols.forEach(function (col, k) {
                var x = cX + 12 + k * 56;
                text(gParts, x, y + 72, col.label, 'label');
                value(gParts, x, y + 96, col.id, 1, '°', 'value');
            });
            line(
                gPipes,
                [
                    [flowManifold, y + 40],
                    [cX, y + 40],
                ],
                c.flow,
                c.active,
            );
            line(
                gPipes,
                [
                    [cX, y + 120],
                    [retManifold, y + 120],
                ],
                null,
                null,
            );
        });
        if (circuits.length) {
            var last = cY + (circuits.length - 1) * (cH + cGap);
            line(
                gPipes,
                [
                    [fromX, Y_FLOW],
                    [flowManifold, Y_FLOW],
                    [flowManifold, last + 40],
                ],
                ids.hpFlow,
                ids.compressor,
            );
            line(
                gPipes,
                [
                    [retManifold, Y_RET],
                    [retManifold, last + 120],
                ],
                null,
                null,
            );
            line(
                gPipes,
                [
                    [retManifold, Y_RET],
                    [fromX, Y_RET],
                ],
                ids.hpReturn,
                ids.compressor,
            );
        }

        /* fresh water station beside the storage: heat exchanger, pump M22, tapping temperature B42, tap and cold water */
        var bottom = Math.max(
            hpY + hpH,
            hasTank ? tankY + tankH + 60 : 0,
            circuits.length ? cY + circuits.length * (cH + cGap) : 0,
        );
        if (p.freshwater && hasTank) {
            var sX = 626,
                sY = 330,
                sW = 124,
                sH = 150;
            card(gParts, sX, sY, sW, sH, null);
            text(gParts, sX + sW / 2, sY + 22, m.labels.freshwater, 'small', 'middle');
            line(
                gPipes,
                [
                    [tankX + tankW - 12, sY + 44],
                    [sX + 6, sY + 44],
                ],
                ids.dhwTop,
                ids.compressor,
            );
            line(
                gPipes,
                [
                    [sX + 6, sY + 74],
                    [tankX + tankW - 12, sY + 74],
                ],
                ids.dhwBottom || ids.buffer,
                ids.compressor,
            );
            exchanger(gParts, sX + 10, sY + 44, sW - 20, ids.dhwTop, ids.dhwTap);
            text(gParts, sX + 34, sY + 108, 'B42', 'small', 'middle');
            value(gParts, sX + 34, sY + 130, ids.dhwTap, 1, '°C', 'value', 'middle');
            if (ids.dhwSetpoint) {
                text(gParts, sX + 92, sY + 108, m.labels.setpoint, 'small', 'middle');
                value(gParts, sX + 92, sY + 130, ids.dhwSetpoint, 0, '°C', 'value', 'middle');
            }
            /* tap (WW) leaves to the right and below, cold water (KW) comes in from the left */
            text(gParts, sX + sW / 2, sY + sH + 24, `${m.labels.coldWater} → ${m.labels.dhw}`, 'small', 'middle');
            bottom = Math.max(bottom, sY + sH + 40);
        }

        /* the other temperature sensors, grouped like in the IDM plant diagrams */
        bottom += 24;
        var groups = ['storage', 'solar', 'isc', 'other'];
        var groupTitle = { heatpump: m.labels.heatPump, solar: m.labels.solar };
        var gx = 20,
            gRowHeight = 0;
        groups.forEach(function (group) {
            var list = m.sensors.filter(function (sensor) {
                return sensor.group === group;
            });
            if (!list.length) {
                return;
            }
            var height = 40 + list.length * 44;
            if (gx + 310 > 1000) {
                gx = 20;
                bottom += gRowHeight + 16;
                gRowHeight = 0;
            }
            card(gParts, gx, bottom, 310, height, groupTitle[group] || m.labels[group]);
            list.forEach(function (sensor, i) {
                var sy = bottom + 50 + i * 44;
                text(gParts, gx + 14, sy, `${sensor.tag} ${sensor.name}`, 'label');
                value(gParts, gx + 14, sy + 20, sensor.id, 1, '°C', 'value');
            });
            gRowHeight = Math.max(gRowHeight, height);
            gx += 330;
        });
        bottom += gRowHeight + (gRowHeight ? 16 : 0);

        /* solar thermal and bivalence */
        var ex = 20;
        if (p.solar || p.bivalence) {
            if (p.solar) {
                card(gParts, ex, bottom, 220, 100, m.labels.solar);
                text(gParts, ex + 16, bottom + 62, m.labels.collector, 'label');
                value(gParts, ex + 16, bottom + 88, ids.solarCollector, 1, '°C', 'big');
                ex += 240;
            }
            if (p.bivalence) {
                card(gParts, ex, bottom, 220, 100, m.labels.bivalence);
                var biv = text(gParts, ex + 16, bottom + 80, '–', 'big');
                bind(ids.bivalence, function (v) {
                    biv.textContent = v === null || v === undefined ? '–' : String(v);
                });
            }
            bottom += 120;
        }

        /* rooms */
        if (m.rooms.length) {
            text(gParts, 20, bottom + 20, m.labels.rooms, 'title');
            m.rooms.forEach(function (room, i) {
                var rx = 20 + (i % 5) * 192,
                    ry = bottom + 36 + Math.floor(i / 5) * 64;
                el('rect', { x: rx, y: ry, width: 180, height: 52, rx: 10, class: 'box' }, gParts);
                text(gParts, rx + 12, ry + 21, room.name, 'label');
                value(gParts, rx + 12, ry + 43, room.temperature, 1, '°C', 'value');
                if (room.target) {
                    value(gParts, rx + 168, ry + 43, room.target, 1, '°C', 'small', 'end');
                }
            });
            bottom += 36 + Math.ceil(m.rooms.length / 5) * 64 + 16;
        }

        /* energy tiles: photovoltaics, battery, surplus, house, heat pump; separate from the heat pump, no lines */
        if (p.pv) {
            var tiles = [
                { label: m.labels.pv, id: ids.pvProduction, d: 2, u: 'kW' },
                { label: m.labels.battery, id: ids.pvBattery, d: 0, u: '%', sub: ids.pvBatteryPower },
                { label: m.labels.surplus, id: ids.pvSurplus, d: 2, u: 'kW' },
                { label: m.labels.house, id: ids.pvHouse, d: 2, u: 'kW' },
                { label: m.labels.heatPump, id: ids.power, d: 2, u: 'kW' },
            ].filter(function (tile) {
                return tile.id;
            });
            var tileW = 176,
                gap = 12;
            var startX = (1000 - (tiles.length * tileW + (tiles.length - 1) * gap)) / 2;
            tiles.forEach(function (tile, i) {
                var tx = startX + i * (tileW + gap),
                    ty = bottom;
                el('rect', { x: tx, y: ty, width: tileW, height: 62, rx: 12, class: 'box solartile' }, gParts);
                text(gParts, tx + 12, ty + 22, tile.label, 'label');
                value(gParts, tx + 12, ty + 48, tile.id, tile.d, tile.u, 'value');
                if (tile.sub) {
                    value(gParts, tx + tileW - 12, ty + 48, tile.sub, 2, 'kW', 'small', 'end');
                }
            });
            bottom += 62 + 10;
        }
        svg.setAttribute('viewBox', `0 0 1130 ${bottom + 20}`);
        applyAll();
    }

    function applyAll() {
        Object.keys(bindings).forEach(function (id) {
            if (Object.prototype.hasOwnProperty.call(state, id)) {
                bindings[id].forEach(function (fn) {
                    fn(state[id]);
                });
            }
        });
        updateStatus();
    }
    function updateStatus() {
        if (!model) {
            return;
        }
        var connected = state[model.ids.connection] === true;
        document.getElementById('dot').classList.toggle('on', connected);
        document.getElementById('statusText').textContent = `${
            connected ? model.labels.connected : model.labels.disconnected
        } · ${model.labels.updated} ${new Date().toLocaleTimeString(model.language)}`;
    }

    function loadModel() {
        return fetch('api/model', { cache: 'no-store' })
            .then(function (r) {
                return r.json();
            })
            .then(function (m) {
                var json = JSON.stringify(m);
                if (json !== modelJson) {
                    modelJson = json;
                    model = m;
                    render();
                }
            })
            .catch(function () {
                /* the next try follows */
            });
    }

    function listen() {
        var source = new EventSource('events');
        source.addEventListener('snapshot', function (e) {
            state = JSON.parse(e.data);
            applyAll();
        });
        source.addEventListener('update', function (e) {
            var changed = JSON.parse(e.data);
            Object.keys(changed).forEach(function (id) {
                state[id] = changed[id];
                (bindings[id] || []).forEach(function (fn) {
                    fn(changed[id]);
                });
            });
            updateStatus();
        });
    }

    loadModel().then(function () {
        listen();
    });
    /* the plant may report more parts after the first polls, so look again every 10 seconds */
    setInterval(loadModel, 10000);
})();
