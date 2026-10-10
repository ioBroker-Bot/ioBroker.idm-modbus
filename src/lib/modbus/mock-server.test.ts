import * as net from 'node:net';
import type { ScanResult } from '../scan';

interface MockFrame {
    transactionId: number;
    unitId: number;
    functionCode: number;
    data: Buffer;
}

/** Splits the TCP byte stream of the mock into complete MBAP frames. */
class FrameParser {
    private buffer: Buffer = Buffer.alloc(0);

    public push(chunk: Buffer): MockFrame[] | null {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        const frames: MockFrame[] = [];
        while (this.buffer.length >= 8) {
            const length = this.buffer.readUInt16BE(4);
            if (this.buffer.length < 6 + length) {
                break;
            }
            frames.push({
                transactionId: this.buffer.readUInt16BE(0),
                unitId: this.buffer.readUInt8(6),
                functionCode: this.buffer.readUInt8(7),
                data: Buffer.from(this.buffer.subarray(8, 6 + length)),
            });
            this.buffer = this.buffer.subarray(6 + length);
        }
        return frames;
    }
}

/** Behaviour switches of the in-process mock Navigator used by the tests. No test touches the real device. */
export interface MockOptions {
    /** swallow requests without answering (timeout tests) */
    silent?: boolean;
    /** answer with a wrong transaction id */
    wrongTransactionId?: boolean;
    /** delay every answer by this many ms (late-reply tests) */
    delayMs?: number;
}

/** Minimal Modbus TCP server: FC03/04 read, FC06/16 write to memory; addresses >= 5000 raise exception 02. */
export class MockModbusServer {
    public readonly registers = new Uint16Array(6000);
    /** per function code: values and addresses that raise exception 02, loaded from a scan (overrides `registers`) */
    private readonly replay = new Map<
        number,
        { words: Uint16Array; exceptions: Set<number>; exact: Map<string, number[] | null> }
    >();
    /** requests received, as `fc@address` */
    public readonly requests: string[] = [];
    private readonly server: net.Server;
    private readonly sockets = new Set<net.Socket>();

    /** @param options behaviour switches */
    public constructor(public options: MockOptions = {}) {
        this.server = net.createServer(socket => this.onConnection(socket));
    }

    /**
     * Start listening on a random local port.
     *
     * @returns the port
     */
    public async listen(): Promise<number> {
        await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve));
        return (this.server.address() as net.AddressInfo).port;
    }

    /**
     * Answer like the device that produced a scan: per function code the scanned words, and exception 02 for every address
     * range the device did not answer.
     *
     * @param scan a scan result (fixture)
     */
    public loadScan(scan: ScanResult): void {
        for (const fc of [3, 4] as const) {
            const words = new Uint16Array(6000);
            const exceptions = new Set<number>();
            // The Navigator treats overlapping addresses (1392/1393, 1441/1442, 1483/1484) as separate typed variables: a
            // 2-word read at 1392 and a 1-word read at 1393 do not share their second word. Exact (address, count) matches
            // therefore win over the flat memory.
            const exact = new Map<string, number[] | null>();
            for (const entry of scan.entries) {
                const read = entry.reads[String(fc) as '3' | '4'];
                exact.set(`${entry.address}:${entry.words}`, read?.ok && read.raw ? read.raw : null);
                for (let i = 0; i < entry.words; i++) {
                    if (read?.ok && read.raw) {
                        words[entry.address + i] = read.raw[i];
                    } else {
                        exceptions.add(entry.address + i);
                    }
                }
            }
            this.replay.set(fc, { words, exceptions, exact });
        }
    }

    /** Destroy all open client connections (simulates a dropped link). */
    public dropConnections(): void {
        this.sockets.forEach(socket => socket.destroy());
    }

    /** Stop the server and all connections. */
    public async stop(): Promise<void> {
        this.dropConnections();
        await new Promise<void>(resolve => this.server.close(() => resolve()));
    }

    private onConnection(socket: net.Socket): void {
        this.sockets.add(socket);
        socket.on('close', () => this.sockets.delete(socket));
        socket.on('error', () => undefined);
        const parser = new FrameParser();
        socket.on('data', chunk => {
            for (const frame of parser.push(chunk) ?? []) {
                const { functionCode: fc, data } = frame;
                const address = data.readUInt16BE(0);
                const arg = data.readUInt16BE(2);
                this.requests.push(`${fc}@${address}`);
                if (this.options.silent) {
                    continue;
                }
                let pdu: Buffer;
                if (fc === 3 || fc === 4) {
                    const replay = this.replay.get(fc);
                    const exactKey = `${address}:${arg}`;
                    if (replay?.exact.has(exactKey)) {
                        const exactWords = replay.exact.get(exactKey);
                        if (exactWords) {
                            pdu = Buffer.alloc(2 + arg * 2);
                            pdu[0] = fc;
                            pdu[1] = arg * 2;
                            exactWords.forEach((w, i) => pdu.writeUInt16BE(w, 2 + i * 2));
                        } else {
                            pdu = Buffer.from([fc | 0x80, 2]);
                        }
                        this.reply(socket, frame, pdu);
                        continue;
                    }
                    const unanswered =
                        address + arg > 5000 ||
                        (replay !== undefined &&
                            Array.from({ length: arg }, (_, i) => address + i).some(a => replay.exceptions.has(a)));
                    if (unanswered) {
                        pdu = Buffer.from([fc | 0x80, 2]);
                    } else {
                        pdu = Buffer.alloc(2 + arg * 2);
                        pdu[0] = fc;
                        pdu[1] = arg * 2;
                        for (let i = 0; i < arg; i++) {
                            pdu.writeUInt16BE((replay?.words ?? this.registers)[address + i], 2 + i * 2);
                        }
                    }
                } else if (fc === 6) {
                    this.registers[address] = arg;
                    pdu = Buffer.concat([Buffer.from([6]), data.subarray(0, 4)]);
                } else if (fc === 16) {
                    for (let i = 0; i < arg; i++) {
                        this.registers[address + i] = data.readUInt16BE(5 + i * 2);
                    }
                    pdu = Buffer.concat([Buffer.from([16]), data.subarray(0, 4)]);
                } else {
                    pdu = Buffer.from([fc | 0x80, 1]);
                }
                this.reply(socket, frame, pdu);
            }
        });
    }
    private reply(socket: net.Socket, frame: MockFrame, pdu: Buffer): void {
        const header = Buffer.alloc(7);
        header.writeUInt16BE(this.options.wrongTransactionId ? frame.transactionId + 7 : frame.transactionId, 0);
        header.writeUInt16BE(pdu.length + 1, 4);
        header[6] = frame.unitId;
        const answer = Buffer.concat([header, pdu]);
        if (this.options.delayMs) {
            setTimeout(() => socket.writable && socket.write(answer), this.options.delayMs);
        } else {
            socket.write(answer);
        }
    }
}
