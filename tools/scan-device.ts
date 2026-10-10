/**
 * Scans a Navigator (read requests only) and writes the result as a fixture without host or network data.
 *
 * Usage: `IDM_HOST=<host> [IDM_DEVICE="IDM SLM 3-11 HGL, Navigator 2.0"] npm run scan:device [family]`
 *
 * The host comes from the environment and is never printed or stored (CLAUDE.md rule 3). The scan honours the Navigator's
 * limits: one connection, serial requests, 150 ms pause. It takes a few minutes. The same scan runs inside the adapter
 * (`sendTo` command `scan`); this tool exists so that users of other Navigator generations can send in a scan.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ModbusTcpClient } from '../src/lib/modbus/client';
import { loadRegisters } from '../src/lib/registers/plant';
import { runScan, summarizeScan, suggestPlant } from '../src/lib/scan';
import { NAVIGATOR_FAMILIES, type NavigatorFamily } from '../src/lib/constants';

/** CLI entry. */
async function main(): Promise<void> {
    const family = (process.argv[2] ?? 'nav20') as NavigatorFamily;
    const host = process.env.IDM_HOST;
    if (!host) {
        throw new Error('Set IDM_HOST to the Navigator host');
    }
    if (!NAVIGATOR_FAMILIES.includes(family)) {
        throw new Error(`Unknown family ${family}`);
    }
    const registers = loadRegisters(family);
    if (!registers) {
        throw new Error(`No register file for ${family} yet`);
    }

    const client = new ModbusTcpClient({
        host,
        port: Number(process.env.IDM_PORT) || 502,
        unitId: 1,
        timeoutMs: 3000,
        pauseMs: 150,
        timers: {
            setTimeout: (cb, ms) => setTimeout(cb, ms),
            clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout),
        },
    });
    const connected = await client.connect();
    if (!connected.ok) {
        throw new Error(connected.error.message);
    }
    const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as {
        version: string;
    };
    let lastPercent = -1;
    const scan = await runScan({
        registers,
        client,
        floatWordOrder: 'lowFirst',
        now: () => Date.now(),
        family,
        device: process.env.IDM_DEVICE ?? 'unknown',
        adapterVersion: packageJson.version,
        progress: (done, total) => {
            const percent = Math.floor((done * 100) / total / 10) * 10;
            if (percent !== lastPercent) {
                lastPercent = percent;
                console.log(`${percent}% (${done}/${total})`);
            }
        },
    });
    client.close();

    const target = path.join(__dirname, '..', 'test', 'fixtures', `scan-${family}.json`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(scan, null, 1)}\n`);
    console.log(
        `written test/fixtures/scan-${family}.json`,
        summarizeScan(scan),
        scan.aborted ? `ABORTED: ${scan.aborted}` : '',
    );
    console.log('suggested plant:', JSON.stringify(suggestPlant(scan)));
}

main().catch((error: Error) => {
    console.error(error.message);
    process.exit(1);
});
