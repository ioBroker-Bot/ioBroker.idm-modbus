/**
 * Recomputes status and value of a scan fixture from its raw words after a register rule changed (range, sentinel).
 * No device access. Usage: `npm run scan:reclassify [family]`
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadRegisters } from '../src/lib/registers/plant';
import { reclassifyScan, summarizeScan, suggestPlant, type ScanResult } from '../src/lib/scan';
import type { NavigatorFamily } from '../src/lib/constants';

const family = (process.argv[2] ?? 'nav20') as NavigatorFamily;
const registers = loadRegisters(family);
const file = path.join(__dirname, '..', 'test', 'fixtures', `scan-${family}.json`);
if (!registers || !fs.existsSync(file)) {
    console.error(`No register file or fixture for ${family}`);
    process.exit(1);
}
const scan = reclassifyScan(JSON.parse(fs.readFileSync(file, 'utf8')) as ScanResult, registers);
fs.writeFileSync(file, `${JSON.stringify(scan, null, 1)}\n`);
console.log(`reclassified test/fixtures/scan-${family}.json`, summarizeScan(scan));
console.log('suggested plant:', JSON.stringify(suggestPlant(scan)));
