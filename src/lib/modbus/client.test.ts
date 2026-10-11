import { expect } from 'chai';
import { ModbusTcpClient, type ClientTimers } from './client';
import { MockModbusServer } from './mock-server.test';
import { decodeWords } from './codec';

const timers: ClientTimers = {
    setTimeout: (cb, ms) => setTimeout(cb, ms),
    delay: ms => new Promise<void>(resolve => setTimeout(resolve, ms)),
    clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout),
};

describe('ModbusTcpClient (against the mock server)', () => {
    let server: MockModbusServer;
    let port: number;
    let clients: ModbusTcpClient[];

    const makeClient = (
        overrides: { timeoutMs?: number; pauseMs?: number; onDisconnect?: () => void } = {},
    ): ModbusTcpClient => {
        const client = new ModbusTcpClient({
            host: '127.0.0.1',
            port,
            unitId: 1,
            timeoutMs: 300,
            pauseMs: 0,
            timers,
            ...overrides,
        });
        clients.push(client);
        return client;
    };

    beforeEach(async () => {
        server = new MockModbusServer();
        server.registers[1000] = 0x0000; // 21.5, low word first
        server.registers[1001] = 0x41ac;
        server.registers[1005] = 1;
        port = await server.listen();
        clients = [];
    });

    afterEach(async () => {
        clients.forEach(c => c.close());
        await server.stop();
    });

    it('reads input and holding registers and decodes a FLOAT', async () => {
        const client = makeClient();
        expect((await client.connect()).ok).to.equal(true);
        const float = await client.readRegisters(4, 1000, 2);
        expect(float.ok && decodeWords('FLOAT', float.value, 'lowFirst')).to.equal(21.5);
        const mode = await client.readRegisters(3, 1005, 1);
        expect(mode).to.deep.equal({ ok: true, value: [1] });
    });

    it('turns a Modbus exception into an error result and keeps the connection', async () => {
        const client = makeClient();
        await client.connect();
        const result = await client.readRegisters(4, 5100, 2);
        expect(result).to.deep.equal({
            ok: false,
            error: { kind: 'exception', message: 'Modbus exception 2', exceptionCode: 2 },
        });
        expect(client.connected).to.equal(true);
        expect((await client.readRegisters(4, 1000, 2)).ok).to.equal(true);
    });

    it('writes FC06 and FC16 to the MOCK (never a real device)', async () => {
        const client = makeClient();
        await client.connect();
        expect((await client.writeSingleRegister(1005, 2)).ok).to.equal(true);
        expect((await client.writeMultipleRegisters(1100, [7, 9])).ok).to.equal(true);
        expect([server.registers[1005], server.registers[1100], server.registers[1101]]).to.deep.equal([2, 7, 9]);
    });

    it('rejects invalid requests locally without sending anything', async () => {
        const client = makeClient();
        await client.connect();
        for (const result of [
            await client.readRegisters(4, 1000, 0),
            await client.readRegisters(4, 1000, 126),
            await client.readRegisters(4, 65535, 2),
            await client.writeSingleRegister(1005, 70000),
            await client.writeMultipleRegisters(1100, []),
        ]) {
            expect(result.ok).to.equal(false);
            expect(!result.ok && result.error.kind).to.equal('invalid');
        }
        expect(server.requests).to.deep.equal([]);
    });

    it('times out, closes the connection and reconnects afterwards', async () => {
        let disconnects = 0;
        const client = makeClient({ timeoutMs: 150, onDisconnect: () => disconnects++ });
        await client.connect();
        server.options.silent = true;
        const timedOut = await client.readRegisters(4, 1000, 2);
        expect(!timedOut.ok && timedOut.error.kind).to.equal('timeout');
        expect(client.connected).to.equal(false);
        expect(disconnects).to.equal(1);
        const offline = await client.readRegisters(4, 1000, 2);
        expect(!offline.ok && offline.error.kind).to.equal('offline');

        server.options.silent = false;
        expect((await client.connect()).ok).to.equal(true);
        expect((await client.readRegisters(4, 1000, 2)).ok).to.equal(true);
    });

    it('detects a dropped link and recovers by reconnecting', async () => {
        let disconnects = 0;
        const client = makeClient({ onDisconnect: () => disconnects++ });
        await client.connect();
        server.dropConnections();
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(client.connected).to.equal(false);
        expect(disconnects).to.equal(1);
        const result = await client.readRegisters(4, 1000, 2);
        expect(!result.ok && result.error.kind).to.equal('offline');
        expect((await client.connect()).ok).to.equal(true);
        expect((await client.readRegisters(4, 1000, 2)).ok).to.equal(true);
    });

    it('never takes a late reply for the answer to a later request', async () => {
        // modbus-connect does not check the MBAP transaction id, so the guarantee comes from this client:
        // a timeout closes the connection, a reply that arrives afterwards goes nowhere.
        server.registers[1010] = 111;
        server.registers[1020] = 222;
        server.options.delayMs = 250;
        const client = makeClient({ timeoutMs: 120 });
        await client.connect();
        const late = await client.readRegisters(4, 1010, 1);
        expect(!late.ok && late.error.kind).to.equal('timeout');
        expect(client.connected).to.equal(false);

        server.options.delayMs = 0;
        expect((await client.connect()).ok).to.equal(true);
        const next = await client.readRegisters(4, 1020, 1);
        expect(next).to.deep.equal({ ok: true, value: [222] });
        await new Promise(resolve => setTimeout(resolve, 300)); // the stale 111 reply would have arrived by now
        expect(await client.readRegisters(4, 1020, 1)).to.deep.equal({ ok: true, value: [222] });
    });

    it('reports a failed connect without host or port', async () => {
        const closed = new MockModbusServer();
        const freePort = await closed.listen();
        await closed.stop();
        const client = new ModbusTcpClient({
            host: '127.0.0.1',
            port: freePort,
            unitId: 1,
            timeoutMs: 300,
            pauseMs: 0,
            timers,
        });
        const result = await client.connect();
        expect(result.ok).to.equal(false);
        const message = !result.ok ? result.error.message : '';
        expect(message).to.equal('Connection failed');
        expect(message).to.not.contain('127.0.0.1');
        expect(message).to.not.contain(String(freePort));
    });

    it('writes nothing to stdout or stderr, so host and port never reach a log', async () => {
        const written: string[] = [];
        const origOut = process.stdout.write.bind(process.stdout);
        const origErr = process.stderr.write.bind(process.stderr);
        const capture = (chunk: unknown): boolean => {
            written.push(String(chunk));
            return true;
        };
        process.stdout.write = capture;
        process.stderr.write = capture;
        try {
            const client = makeClient({ timeoutMs: 120 });
            await client.connect();
            await client.readRegisters(4, 1000, 2);
            await client.readRegisters(4, 5100, 2); // exception
            server.options.silent = true;
            await client.readRegisters(4, 1000, 2); // timeout
            server.options.silent = false;
            await client.connect();
            server.dropConnections();
            await new Promise(resolve => setTimeout(resolve, 80));
            const refused = new MockModbusServer();
            const freePort = await refused.listen();
            await refused.stop();
            await new ModbusTcpClient({
                host: '127.0.0.1',
                port: freePort,
                unitId: 1,
                timeoutMs: 120,
                pauseMs: 0,
                timers,
            }).connect();
        } finally {
            process.stdout.write = origOut;
            process.stderr.write = origErr;
        }
        expect(written.join('')).to.equal('');
    });

    it('serialises concurrent requests with a pause in between', async () => {
        const client = makeClient({ pauseMs: 80 });
        await client.connect();
        const started = Date.now();
        const results = await Promise.all([
            client.readRegisters(4, 1000, 2),
            client.readRegisters(4, 1000, 2),
            client.readRegisters(3, 1005, 1),
        ]);
        expect(results.every(r => r.ok)).to.equal(true);
        expect(Date.now() - started).to.be.at.least(150);
        expect(server.requests).to.deep.equal(['4@1000', '4@1000', '3@1005']);
    });

    it('fails pending and later requests with offline after close()', async () => {
        const client = makeClient();
        await client.connect();
        client.close();
        const result = await client.readRegisters(4, 1000, 2);
        expect(!result.ok && result.error.kind).to.equal('offline');
    });
});
