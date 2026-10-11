import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ModbusTcpClient } from './modbus/client';
import { MockModbusServer } from './modbus/mock-server.test';
import { buildReadBlocks } from './modbus/batching';
import { activeRegisters, loadRegisters } from './registers/plant';
import type { RegisterEntry } from './registers/types';
import { runScan, type ScanResult, suggestPlant, summarizeScan } from './scan';
import { interpretWords } from './value';

const fixturePath = path.join(__dirname, '..', '..', 'test', 'fixtures', 'scan-nav20.json');
const fixture = fs.existsSync(fixturePath)
    ? (JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as ScanResult)
    : undefined;
const nav20 = loadRegisters('nav20') as RegisterEntry[];

describe('scan fixture of the test device (IDM Navigator 2.0)', function () {
    before(function () {
        if (!fixture) {
            this.skip();
        }
    });

    it('contains no host, address or credentials', () => {
        const text = fs.readFileSync(fixturePath, 'utf8');
        expect(text).to.not.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
        expect(text).to.not.match(/password|token|host/i);
    });

    it('is complete: every readable nav20 register was scanned and the scan did not abort', () => {
        const scanned = fixture as ScanResult;
        expect(scanned.aborted).to.equal(undefined);
        expect(scanned.entries.map(e => e.id).sort()).to.deep.equal(
            nav20
                .filter(r => r.access !== 'W')
                .map(r => r.id)
                .sort(),
        );
    });

    it('decodes to the stored values with the shipped decoder', () => {
        for (const entry of (fixture as ScanResult).entries) {
            const reg = nav20.find(r => r.id === entry.id) as RegisterEntry;
            const answered = entry.reads['4']?.ok
                ? entry.reads['4']
                : entry.reads['3']?.ok
                  ? entry.reads['3']
                  : undefined;
            if (!answered?.raw) {
                expect(entry.status).to.equal('absent');
                continue;
            }
            const decoded = interpretWords(reg, answered.raw, 'lowFirst');
            expect(decoded.value, entry.id).to.equal(entry.value);
            expect(entry.status, entry.id).to.equal(decoded.valid ? 'present' : 'unavailable');
        }
    });

    it('has plausible temperatures only where registers are present (low word first is right)', () => {
        for (const entry of (fixture as ScanResult).entries) {
            const reg = nav20.find(r => r.id === entry.id) as RegisterEntry;
            if (entry.status === 'present' && reg.unit === '°C' && reg.type === 'FLOAT') {
                expect(entry.value, `${entry.id} = ${entry.value}`).to.be.within(-60, 130);
            }
        }
    });

    it('replays through the real client: scanning the mock gives the same result as the device', async function () {
        this.timeout(120000);
        const scanned = fixture as ScanResult;
        const server = new MockModbusServer();
        server.loadScan(scanned);
        const port = await server.listen();
        const client = new ModbusTcpClient({
            host: '127.0.0.1',
            port,
            unitId: 1,
            timeoutMs: 2000,
            pauseMs: 0,
            timers: {
                setTimeout: (cb, ms) => setTimeout(cb, ms),
                delay: ms => new Promise<void>(resolve => setTimeout(resolve, ms)),
                clearTimeout: h => clearTimeout(h as NodeJS.Timeout),
            },
        });
        try {
            expect((await client.connect()).ok).to.equal(true);
            const again = await runScan({
                registers: nav20,
                client,
                floatWordOrder: 'lowFirst',
                now: () => Date.now(),
                family: 'nav20',
                device: 'mock',
                adapterVersion: '0.0.0',
            });
            expect(again.aborted).to.equal(undefined);
            expect(again.entries.map(e => [e.id, e.status, e.value])).to.deep.equal(
                scanned.entries.map(e => [e.id, e.status, e.value]),
            );
            expect(summarizeScan(again)).to.deep.equal(summarizeScan(scanned));
            expect(suggestPlant(again)).to.deep.equal(suggestPlant(scanned));
        } finally {
            client.close();
            await server.stop();
        }
    });

    it('bundled reads (neighbours and one function code per block) decode to the same values as the single reads', async function () {
        this.timeout(60000);
        const scanned = fixture as ScanResult;
        const byId = new Map(scanned.entries.map(e => [e.id, e]));
        const active = activeRegisters(nav20, suggestPlant(scanned));
        const blocks = buildReadBlocks(active);
        expect(blocks.length).to.be.lessThan(active.length / 2); // far fewer requests than registers

        const server = new MockModbusServer();
        server.loadScan(scanned);
        const port = await server.listen();
        const client = new ModbusTcpClient({
            host: '127.0.0.1',
            port,
            unitId: 1,
            timeoutMs: 2000,
            pauseMs: 0,
            timers: {
                setTimeout: (cb, ms) => setTimeout(cb, ms),
                delay: ms => new Promise<void>(resolve => setTimeout(resolve, ms)),
                clearTimeout: h => clearTimeout(h as NodeJS.Timeout),
            },
        });
        try {
            await client.connect();
            for (const block of blocks) {
                const result = await client.readRegisters(block.fc, block.start, block.count);
                expect(result.ok, `block ${block.fc}:${block.start}x${block.count}`).to.equal(true);
                if (!result.ok) {
                    continue;
                }
                for (const { reg, offset } of block.items) {
                    const decoded = interpretWords(reg, result.value.slice(offset, offset + reg.words), 'lowFirst');
                    const expected = byId.get(reg.id) as ScanResult['entries'][number];
                    expect(decoded.value, `${reg.id} in ${block.fc}:${block.start}x${block.count}`).to.equal(
                        expected.value,
                    );
                }
            }
        } finally {
            client.close();
            await server.stop();
        }
    });
});
