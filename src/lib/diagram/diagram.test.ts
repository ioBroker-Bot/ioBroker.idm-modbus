import { expect } from 'chai';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { LANGUAGES, missingLanguages } from '../translations';
import dictionary from '../dictionary.json';
import { ValueHub } from './hub';
import { loadRegisters } from '../registers/plant';
import type { RegisterEntry } from '../registers/types';
import { stateIdFor } from '../state-model';
import { ioKey } from '../web/io';
import { circuitTags, modbusTagRegisters } from './sensors';
import { buildDiagramModel, DIAGRAM_STATE_IDS, DIAGRAM_TEXTS, type DiagramInput } from './model';
import { DiagramServer } from './server';

const input = (
    ids: Record<string, string | number | boolean | null>,
    extra: Partial<DiagramInput> = {},
): DiagramInput => ({
    language: 'en',
    has: id => ids[id] !== undefined && ids[id] !== null,
    value: id => ids[id],
    circuits: [
        { letter: 'A', name: null },
        { letter: 'B', name: 'Upstairs' },
    ],
    stateIds: Object.keys(ids),
    hpModes: { 1: 'Heating' },
    hidden: [],
    ...extra,
});

describe('diagram model', () => {
    it('shows only the parts whose states have values, and only circuits with a flow temperature', () => {
        const model = buildDiagramModel(
            input({
                'system.outdoor_temp': 8.7,
                'hp.hp_flow_temp': 31,
                'dhw.storage_temp': 36,
                'dhw.dhw_temp_top': 45,
                'hc.A.flow_temp': 27,
                'hc.B.flow_temp': null,
                'pv.pv_production': 3.04,
                'solar.solar_collector_temp': null,
                'zones.1.rooms.1.temp': 23.2,
                'zones.1.rooms.1.setpoint': 22.5,
                'zones.1.rooms.2.temp': null,
                'zones.1.rooms.1.name': 'Kid',
            }),
        );
        expect(model.parts).to.deep.equal({
            buffer: true,
            dhw: true,
            freshwater: false,
            pv: true,
            solar: false,
            bivalence: false,
        });
        expect(model.circuits.map(c => c.letter)).to.deep.equal(['A']); // B has no flow temperature
        expect(model.circuits[0].name).to.equal('Heating circuit A');
        expect(model.rooms).to.deep.equal([
            { zone: 1, name: 'Kid', temperature: 'zones.1.rooms.1.temp', target: 'zones.1.rooms.1.setpoint' },
        ]);
        expect(model.ids.pvProduction).to.equal('pv.pv_production');
        expect(model.ids.solarCollector).to.equal(null);
        expect(model.watch).to.include.members(['hc.A.flow_temp', 'zones.1.rooms.1.temp', 'info.connection']);
    });

    it("has no buffer or hot water part for a direct system, honours hidden parts and uses the user's language and names", () => {
        const model = buildDiagramModel(
            input(
                { 'hp.hp_flow_temp': 31, 'pv.pv_surplus': 0, 'hc.B.flow_temp': 30 },
                { hidden: ['pv'], language: 'de' },
            ),
        );
        expect(model.parts).to.include({ buffer: false, dhw: false, pv: false });
        expect(model.circuits).to.deep.equal([
            {
                letter: 'B',
                name: 'Upstairs',
                flow: 'hc.B.flow_temp',
                setpoint: null,
                active: null,
                room: null,
                flowTag: 'B52',
                roomTag: 'B62',
            },
        ]);
        expect(model.labels.outdoor).to.equal('Außen');
        expect(model.labels.heatPump).to.equal('Wärmepumpe');
    });

    it('takes flow and return from the heat sink registers where the heat exchanger hides 1050/1052 (Navigator 10)', () => {
        const model = buildDiagramModel(input({ 'hp.heat_sink_flow_temp': 34, 'hp.heat_sink_return_temp': 29 }));
        expect(model.ids.hpFlow).to.equal('hp.heat_sink_flow_temp');
        expect(model.ids.hpReturn).to.equal('hp.heat_sink_return_temp');
    });

    it('names the circuit sensors B51-B57 and B61-B67 and knows their registers', () => {
        expect(circuitTags('A')).to.deep.equal({ flow: 'B51', room: 'B61' });
        expect(circuitTags('D')).to.deep.equal({ flow: 'B54', room: 'B64' }); // verified live at a Navigator 10 by Xerolux
        expect(circuitTags('G')).to.deep.equal({ flow: 'B57', room: 'B67' });
        expect(circuitTags('H')).to.equal(null);
        const registers = modbusTagRegisters(loadRegisters('nav20') as RegisterEntry[]);
        expect(registers.get('B52')).to.equal('hc_b_flow_temp');
        expect(registers.get('B33')).to.equal('hp_flow_temp');
    });

    it('finds the storage temperature where Navigator 1.x keeps it', () => {
        expect(buildDiagramModel(input({ 'hp.storage_temp': 35 })).ids.buffer).to.equal('hp.storage_temp');
    });

    it('only asks for states that the register files and the web module create', () => {
        const known = new Set(
            (['nav20', 'nav10', 'nav17'] as const).flatMap(family =>
                (loadRegisters(family) as RegisterEntry[]).map(stateIdFor),
            ),
        );
        for (const id of Object.values(DIAGRAM_STATE_IDS).flat()) {
            if (id.startsWith('web.io.')) {
                const key = id.split('.')[3];
                expect(ioKey({ tag: key.toUpperCase(), name: '', value: 0, unit: '' }), id).to.equal(key);
            } else if (!id.startsWith('calc.')) {
                expect(known.has(id), `${id} is not a register state`).to.equal(true);
            }
        }
    });

    it('has every text in all 11 languages', () => {
        const missing = DIAGRAM_TEXTS.filter(text => missingLanguages(text, dictionary as never).length);
        expect(missing).to.deep.equal([]);
        expect(LANGUAGES).to.have.length(11);
    });
});

describe('ValueHub', () => {
    it('tells listeners only about changes and answers has() for real values', () => {
        const hub = new ValueHub();
        const heard: string[] = [];
        const off = hub.subscribe((id, value) => heard.push(`${id}=${String(value)}`));
        hub.set('a', 1);
        hub.set('a', 1);
        hub.set('a', null);
        expect(heard).to.deep.equal(['a=1', 'a=null']);
        expect(hub.has('a')).to.equal(false);
        off();
        hub.set('b', 2);
        expect(heard).to.have.length(2);
        expect(hub.snapshot()).to.deep.equal({ a: null, b: 2 });
    });
});

describe('DiagramServer', () => {
    const get = (
        port: number,
        url: string,
        method = 'GET',
    ): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> =>
        new Promise((resolve, reject) => {
            http.request({ port, host: '127.0.0.1', path: url, method }, res => {
                let body = '';
                res.on('data', c => (body += String(c)));
                res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
            })
                .on('error', reject)
                .end();
        });

    const start = async (): Promise<{ server: DiagramServer; port: number; hub: ValueHub; dir: string }> => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diagram-'));
        fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Diagram</title>');
        fs.writeFileSync(path.join(dir, 'diagram.js'), '// js');
        fs.writeFileSync(path.join(dir, 'secret.txt'), 'not served');
        const hub = new ValueHub();
        hub.set('hp.hp_flow_temp', 31);
        const model = buildDiagramModel(input({ 'hp.hp_flow_temp': 31 }));
        const server = new DiagramServer({
            port: 0,
            bind: '127.0.0.1',
            wwwDir: dir,
            hub,
            model: () => model,
            timers: { setInterval: () => 1, clearInterval: () => undefined },
            log: { debug: () => undefined, warn: () => undefined },
        });
        const result = await server.start();
        if (!result.ok) {
            throw new Error(result.error.message);
        }
        return { server, port: result.value, hub, dir };
    };

    it('serves its own files and the model, answers only GET and HEAD, and nothing else', async () => {
        const { server, port } = await start();
        try {
            const page = await get(port, '/');
            expect(page.status).to.equal(200);
            expect(page.body).to.contain('<title>Diagram</title>');
            expect(page.headers['content-security-policy']).to.contain("default-src 'self'");
            expect(page.headers['cache-control']).to.equal('no-store');
            expect((await get(port, '/diagram.js')).status).to.equal(200);
            expect(JSON.parse((await get(port, '/api/model')).body).parts.buffer).to.equal(false);
            expect((await get(port, '/secret.txt')).status).to.equal(404);
            expect((await get(port, '/../secret.txt')).status).to.equal(404);
            expect((await get(port, '/', 'POST')).status).to.equal(405);
            expect((await get(port, '/', 'HEAD')).body).to.equal('');
        } finally {
            await server.stop();
        }
    });

    it('streams a snapshot of the watched values and then the changes', async () => {
        const { server, port, hub } = await start();
        try {
            const chunks: string[] = [];
            await new Promise<void>(resolve => {
                const req = http.request({ port, host: '127.0.0.1', path: '/events' }, res => {
                    res.on('data', c => {
                        chunks.push(String(c));
                        if (chunks.join('').includes('event: snapshot') && !chunks.join('').includes('event: update')) {
                            hub.set('hp.hp_flow_temp', 32);
                        }
                        if (chunks.join('').includes('event: update')) {
                            req.destroy();
                            resolve();
                        }
                    });
                });
                req.end();
            });
            const text = chunks.join('');
            expect(text).to.contain('event: snapshot\ndata: {"hp.hp_flow_temp":31');
            expect(text).to.contain('event: update\ndata: {"hp.hp_flow_temp":32}');
        } finally {
            await server.stop();
        }
    });

    it('sends only the changes of states the model listens to', async () => {
        const { server, port, hub } = await start();
        try {
            const chunks: string[] = [];
            await new Promise<void>(resolve => {
                const req = http.request({ port, host: '127.0.0.1', path: '/events' }, res => {
                    res.on('data', c => {
                        chunks.push(String(c));
                        if (chunks.join('').includes('event: snapshot') && !chunks.join('').includes('event: update')) {
                            hub.set('stats.something_else', 1); // not part of the model: not sent
                            hub.set('hp.hp_flow_temp', 33);
                        }
                        if (chunks.join('').includes('event: update')) {
                            req.destroy();
                            resolve();
                        }
                    });
                });
                req.end();
            });
            const text = chunks.join('');
            expect(text).to.not.contain('stats.something_else');
            expect(text).to.contain('event: update\ndata: {"hp.hp_flow_temp":33}');
        } finally {
            await server.stop();
        }
    });

    it('reports a port in use or missing files instead of throwing', async () => {
        const { server, port } = await start();
        try {
            const other = new DiagramServer({
                port,
                bind: '127.0.0.1',
                wwwDir: os.tmpdir(),
                hub: new ValueHub(),
                model: () => buildDiagramModel(input({})),
                timers: { setInterval: () => 1, clearInterval: () => undefined },
                log: { debug: () => undefined, warn: () => undefined },
            });
            expect((await other.start()).ok).to.equal(false); // no index.html in the temp folder
        } finally {
            await server.stop();
        }
    });
});
