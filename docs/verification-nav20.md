# Verification protocol: Navigator 2.0 test device

Device: IDM SLM 3-11 HGL with Navigator 2.0. Date: 2026-10-10. Method: read requests only (FC03/FC04), one connection,
150 ms pause between requests. Scan fixture: [test/fixtures/scan-nav20.json](../test/fixtures/scan-nav20.json) (raw words of
every readable register, no host or network data). Plan: V1–V11 in [SPEC.md](SPEC.md), chapter "Tests und Hardware-Verifikation".

Where the device and a document disagree, the device wins and the register file is corrected (CLAUDE.md rule 5).

| # | Check | Result | Status |
| --- | --- | --- | --- |
| V1 | Outdoor temperature 1000: decode both word orders | Words `0x6ff0 0x4148` decode to **12.53 °C** with the low word first and to 1.5e29 with the high word first. The scan read 12.61 °C a few minutes later; the average (1002) is 12.12 °C. Low word first is right for every FLOAT sensor of the scan (all temperatures lie between −60 and 130 °C). | Done, **display value still to be compared by the owner** |
| V2 | Address offset: read 999, 1001 and 998 | Only the documented addresses answer: 999, 1001 and 998 raise exception 02, 1000 and 1002 answer. PDF addresses are protocol addresses, no offset; a FLOAT can only be read from its own start address. | Done |
| V3 | Overlapping addresses 1392/1393, 1441/1442, 1483/1484 | Read individually, all six answer plausibly (1393 = heating circuit A mode 1). A 2-word read at 1392 returns `[0x0000, 0xBF80]` (humidity −1.0 = no sensor) while a 1-word read at 1393 returns `1`: the Navigator treats overlapping addresses as separate typed variables, not as one flat register array. Reading them individually is therefore required, not just cautious. | Done |
| V4 | FC03 against FC04 per register | Every register that answers does so on **both** function codes, read-only (R) and read/write (RW) alike: 116 R and 144 RW registers answer on FC03 and FC04, 99 R and 288 RW (zone modules 2–10) answer on neither. RO via FC04 and RW via FC03 (spec) is safe; the poller keeps it. | Done |
| V5 | "Not available" markers | 69 registers answer but report "not available": integer status registers of hardware that is not installed return `0xFFFF` (compressors 2–4, charging/brine/source/ISC pumps, five valves, cascade stages, smart grid input, circuits B–G active mode, ISC mode); float sensors that are not connected return `-1.0` (unused circuits B–G flow, solar and ISC temperatures, cold storage, heat source in/out, cascade temperatures, passive cooling energy, solar power, electricity price). Nothing raises an exception inside an existing zone module or heating circuit block. Zone modules 2–10 (387 registers) raise exception 02. | Done; the sentinels are in the register file |
| V6 | Meaning of 1006 / smart grid | 1006 reads `0xFFFF`: no smart grid input is wired. The Navigator 10 registers 88 (PV target), 90 (smart grid status) and 4120 (firmware) raise exception 02 on FC03 and FC04, so on Navigator 2.0 the smart grid status is 1006 as the PDF says, and Xerolux's register 90 is Navigator 10 only. | Done; the meaning of values 0–4 cannot be tested without wiring |
| V7 | Vortex values 1748 ff., 1790 | Heat quantities answer: heating 59,566 kWh, cooling 4,205 kWh, hot water 24,278 kWh, defrost 2,622 kWh, electric heater 18.7 kWh, total 90,670 kWh (also at 4128, identical). 1790 and 4122 read 0 kW with the heat pump off. Passive cooling, solar energy and solar power are "not available" (not installed). | Done for presence and plausibility; rising counters and power against the display to be watched while the heat pump runs |
| V8 | Write test without EEPROM (1690 or 74) | Not performed. Writing to the device is excluded by the standing order of 2026-10-10. | Open |
| V9 | Behaviour when a heartbeat stops | Not performed (needs writes). | Open |
| V10 | Polling load | Sustained 1,300 scan requests (4 min) and a 75 s poll run at the default throttle: no errors, no stalls, median response 158 ms (150 ms pause plus about 8 ms device time), maximum 209 ms. Load was **not** increased above the throttle (CLAUDE.md rule 2). The Navigator also closes a connection that was idle for about 10 s (10.1–12.1 s in five runs started at different times), hence the keepalive after 5 s. | Done at the default throttle; **owner to confirm the Navigator display stayed operable** |
| V11 | EEPROM write test | Performed 2026-10-10 with the owner's explicit approval on `dhw_setpoint` (1032) only: 42 → 43 → 42, through the adapter's write scheduler. The Navigator accepts a write of one UCHAR register with **function code 16** (no need for function code 6), the value read back as 43 one second later, and after the restore as 42. The scheduler held the second write back for the 60 s EEPROM interval as designed. That wait exposed a flaw in the test script, not in the adapter: the Navigator closed the idle connection (about 10 s), so the scripted second write was refused as offline and the value stayed at 43 for a few minutes until a second run restored 42 (two EEPROM writes were used in total: 43, then 42). The adapter itself keeps the connection alive. Still to be confirmed by the owner: the Navigator display showed 43 during that time. | Done for the write path (FC16, read-back, restore); display check open |
| V12 | Navigator heat counters against the integral of its thermal power register (4126) | A 12-minute read-only window (2026-10-10, afternoon) fell into an idle period: operating mode "Off" in all 72 samples, no counter moved. The identity of the counters also holds for increments: between the scan (about 13:00) and that window heating rose 1.30 kWh and hot water 11.50 kWh, the total 12.80 kWh, with cooling and defrost unchanged. The comparison itself needs hours with the pump running; the adapter now keeps it up to date in `stats.energy.thermal.integrated.*` next to the counter-based `stats.energy.thermal.*`. | Open: read the ratio after a few days of operation |
| V13 | Internal against external electrical energy | Needs the external meter of the owner (power `modbus.2.inputRegisters.30041_Gesamtleistung`, counter `modbus.2.inputRegisters.30275_Gesamtbezug`) in the adapter configuration; compare `stats.energy.electrical.internal.*` with `.external.*` after a few days. Units and whether the meter measures only the heat pump are still to be confirmed. | Open |
| V14 | Efficiency figures against the Navigator display | Only if the Navigator shows its own COP or performance factor; not found in the Modbus register list. | Open |

## Result for the register file

`verified: device` is set for every register that answered with a plausible value (191 of 663, listed with `deviceStatus` and
`deviceFc` in [nav20.json](../src/lib/registers/nav20.json)); address, width and function code of these registers are confirmed.
Registers of hardware this installation does not have keep `verified: doc` and carry `deviceStatus: unavailable` or `absent`.
The remaining value semantics (what 0–4 of the smart grid status mean, counters while running) stay `doc` until observed.

## Installation of the test device (suggested by the scan)

One heating circuit (A), zone module 1 with 8 rooms, no solar, ISC or cascade. The bivalence and PV register blocks answer
on every Navigator 2.0 (PV values 74–86 and 4122 exist even without a PV system), so the scan suggests them; switching them on
is the user's choice.

## V15 – Room setpoint write (zone module 1, room 1, register 2004)

Approved by the user in the chat (±0.5 °C and put back). One FC16 write of FLOAT (low word first) 22.5 → 23.0, read back 23.0 after 1 s,
written back to 22.5, read back 22.5. Both writes accepted; room mode was 1 (not Normal), so the room itself did not follow the setpoint
(documented behaviour, the adapter warns about it). Two writes to register 2004 in total. Whether the display showed the change: not checked.

V15b – room mode (zone module 1, room 1, register 2007), approved by the user in the chat: FC16 1 (Automatic) → 3 (Normal), held 30 s
(read back 3 six times), restored to 1, read back 1. Two writes to register 2007. Display effect not checked by us (the user may watch).

V15c – rooms 2..8 of zone module 1, approved by the user in the chat: setpoint 22.5 → 23.0 → 22.5 and mode 1 → 3 → 1, each step read back
as written and restored (2 writes to each setpoint and mode register). Address formula 2004/2007 + 7·(r−1) confirmed for all rooms on write.
Display effect: the user saw nothing online yet and assumes the display needs time to catch up.

## V16 – PV module takeover (registers 74, 78, 82, 84, 86)

Approved by the user in the chat after they stopped their own push. The production `PvRunner` wrote five values every 30 s for 5 minutes
(45 writes, FC16, no write error): surplus 74 (direct, not below 0), production 78, house 82, battery 84, battery level 86 (integer). The sources were
the user's calculated states (kW, factor 1). The read-back every 4th cycle never differed, no second writer was reported, and the last
read of the Navigator matched the source states (production 2.69 vs 2.67 kW, house 0.47, battery −2.20, level 61 vs 61.6 → 61). The user's push was then switched on again.
Open: whether the Navigator display / PV menu showed the values and the heat pump reacted to a surplus (needs a day with surplus); register 76 not written.

V15/V16 display check (user, via the IDM cloud app): the minimal changes of the written values were visible, so room setpoint/mode writes and the PV values do arrive in the Navigator.

## V17 – Room temperature feeding (heating circuit A external room temperature, register 1650)

Approved by the user in the chat ("ok test it", register 1650, fixed 21.5 °C, ~2 minutes, then restore). The production `RoomRunner` wrote 21.5 (FLOAT, low word first) at
13 s and again at 73 s (heartbeat 60 s); the register read back 21.50 each time, no second writer. Then −1.0 was written back and read back as −1.00. Three writes to 1650 in total.
The user's Modbus room 9 (assigned to heating circuit A) belongs to zone module 1 slot 9: only its status 2064 answers (0 throughout), registers 2058–2063 give exception 2.
Open: whether the Navigator showed the temperature for room 9 (user to check in the app / GLT monitor); the status 2064 stayed 0 (no heat demand in that time).

V17 note: the IDM manual says a room with a Modbus TCP sensor gets its current temperature at the room's own zone register (room 3: 2016), not via the heating circuit's 1650.
For the user's room 9 that would be 2058, which answers exception 2 on read. So 1650 may not be the right path for such a room; open question for IDM support. No zone register of room 9 is to be written without the user's explicit OK. How to delete a Modbus room: not documented (web search and IDM manual found nothing).

V17 display check (user, GLT monitor in the IDM app): while the adapter wrote 21.5 the monitor showed 22 (rounded display), after the restore −1. So the Navigator receives register 1650 and the GLT monitor shows it.
Not shown by this: that room 9 uses the value.

V18 – GLT values (Modul E): implemented and tested against the mock only. The user declined real-device tests of them (2026-10-10); they stay "untested on the device". Never write 1690 before the user switched "GLT outdoor temperature" off on the Navigator.

V19 – Navigator generation detection (read only): FC03 1005 answered (system mode), FC04 90, FC03 88 and FC04 1068 refused (exception 2) → `nav20`, high confidence. FC04 4001 also answers on the Navigator 2.0 (with 0xFFFF), so it is no evidence for Navigator 10. The Navigator 10 and 1.x branches follow the IDM documents and are untested on devices.

V20 – Web interface (Navigator Pro, read only, display PIN, user-approved): login via POST `index.php` with the form field `pin` works (status 302 with the page in the body, cookie `MYIDM`, CSRF token in the page). GET `data/rooms.php`, `data/heatpump.php` and `data/info.php` return JSON. Rooms 101-109 = zone module 1, rooms 1-9 (names, mode, actual/target temperature, humidity); the user's Modbus room 9 shows no temperature (`--.-`) and no humidity, so the earlier write to 1650 did not feed it. Heating circuit name from `heatpump.php`. The production `WebClient`/`WebRunner` read all of it in one pass.

V21 – Web statistics (read only): `statistics.php?type=heatpump|amountofheat|baenergyhp` return lifetime totals and daily/monthly/yearly values per heating/cooling/hot water/defrost (days: 32, months: up to 104, years: 9). Totals use `unitTotal` (h, MWh, kWh), periods are in h or kWh. Compare with the Modbus counters and our own statistics (V12/V13) before trusting the web COP, especially for hot water.

V22 – Fault texts, hot water boost, defrost statistics: implemented and tested against the mock only (unit and integration tests). The boost writes register 1712 (1, refreshed every 30 s, 0 at the end): needs the user's explicit OK before a real-device test, and the Navigator display should be watched. Defrost uses operating mode 8 of the fast poll (V12/V13 style comparison with the Navigator's own defrost counters is still open).

V23 – Dev-server check (mock Navigator from the scan fixture, 1 heating circuit, 1 zone module with 8 rooms, control/PV/solar on): 290 objects (235 states, 54 channels), no orphan channels, all names in 11 languages, all roles in the role catalogue, `zones.1.rooms.9.relay` and the fault text/boost states exist, jsonConfig valid against the admin schema, all i18n keys present in 11 languages. Not checked: how the tabs look in a browser.

V24 – Found in the user's dev-server instance with live values: `common.states` held translated objects, which the admin shows as "[object Object]". Fixed: enum texts are plain strings in the ioBroker system language (`textIn`), the boost status too. The remaining null states on the Navigator Pro are expected: sensors and pumps the plant does not have (answer 0xFFFF or −1), no room device at heating circuit A, no solar, statistics values that need data first (COP needs ≥ 50 W and ≥ 0.1 kWh).

V25 – The scan was started three times in the user's dev-server instance and never finished: each time the adapter was restarted while it ran (the sandbox restarts it whenever the build changes), and the only feedback was a log line every 25 %. Now: `diag.scanProgress` (1 % steps), a log line every 10 %, the start message names the minutes (about 0.22 s per register: 647 registers, 3 minutes), and an interruption is logged. States without a real value (hardware the plant does not have) are not created and leftovers are removed after 2 minutes; on the live Navigator Pro 18 states were removed, only compressor 1 of the 4 remains.

V26 – Scan feedback in the admin page: the Installation tab shows the scan progress (state `diag.scanProgress`, updates live), whether a scan is running (`diag.scanRunning`) and a button "Show last scan result" (command `scanResult`, from `diag.scan`). The jsonConfig is valid against the admin schema; the rendering in a browser has not been seen by Claude.

V27 – After a scan the Installation tab shows a status line (running %, finished with the numbers and what to do next), a button "Show last scan result" and a button "Apply suggestion" (`scanApply`, `useNative`): it puts the suggested heating circuits, zone modules, rooms per module and blocks into the form; the user checks and saves. The mapping is `plantToNative` (unit tested). Not seen in a browser by Claude.

V28 – Room mode wrong in block reads (found in the user's dev-server instance: mode null/0 for room 1-3, no mode state for rooms 4-8). At the device the room humidity is a FLOAT over 2006-2007 and clobbers the mode at 2007 whenever a block read contains both (e.g. 2002x7 gives 0x422d for the mode, 2006x3 gives the temperature word); single reads are right (mode = 1 in all rooms, as the web interface's `auto_normal`). A comparison of every batched block with single reads over the whole plant (152 items) showed no other mismatch (two hot water temperatures differ only by live changes). Fixed with `overlapWith` in the register source: humidity and mode of every room are read one by one; the Navigator 2.0 test device gives mode 1 for all eight rooms now. The same overlap is assumed for Navigator 10 (inherits nav20) but untested there.

V29 – Display precision (user request): FLOAT states with unit °C, K, kWh, MWh or h show one decimal, other FLOAT values three; statistics energies, hours, CO₂ and the web statistics one decimal (cost two, COP two). The saved statistics data stays exact. Live check on the Navigator Pro: outdoor 8.7, flow 30.9, heating energy 59567.3.

V30 – Settings simplified after the user's review of the admin page (screenshot): labels showing raw keys were the browser's cached translation file (hard reload), not missing keys. The web interface settings moved into the Connection tab (PIN only when switched on), ports/timeouts/pause/intervals and the web intervals are `expertMode` items, the float word order setting is gone (it is `lowFirst`, confirmed at the device), the Cleanup options got clear labels ("Hide states of hardware that reports no value", "Delete states of circuits, zones and blocks switched off here"), the scan buttons share one row, and the CO₂ intensity can come from a state (`co2StateId`, accrual like the cost). jsonConfig valid against the admin schema; not seen in a browser by Claude.

V31 – The raw i18n keys the user saw in the admin page (scanProgressLabel, hideUnavailable, hdrWebConnection, co2StateId, ...) were a dev-server artefact: `dev-server watch` does not sync `admin/`, so the sandbox served the translation files uploaded at the first setup (all keys that were added later were missing). Fix for the sandbox: copy the admin files and `iobroker upload idm-modbus`. A real install uploads all admin files. Statistics layout: price and CO₂ rows with number and state under each other, currency and maximum age on their own rows.

V32 – Support export (Diagnostics tab, `supportExport`): report with whitelisted configuration values, connection and request state, absent and invalid registers, latest readings and the last scan; IP and e-mail addresses and credential-like keys are removed (unit and integration tested, the integration test reads the file back and checks that the host is not in it). German wording review against the IDM manuals: terms aligned (Einmalige Warmwasserladung, Konstantheizkreis, Trinkwassererwärmer, Raumsolltemperatur, Datenpunkt); register and enum texts in German come from the IDM documents. The IDM Modbus manual (3.3) says a Modbus room gets its temperature at the room's own address (room 3 = 2016); for a ninth room it names none, which matches the user's room 9 that refuses reads at 2058.

V33 – Heat pump diagram (Modul I): server and model unit tested, the integration test fetches page and model from the running adapter (read only, POST = 405, other paths = 404). In the sandbox against the Navigator Pro the page showed outdoor 12.6 °C, flow/return, buffer 25.3 °C, hot water top/bottom/setpoint, circuit A, PV values and eight rooms with live values (headless Chrome screenshot). Not yet seen: solar, bivalence, cascade, several circuits, light/dark theme on a phone.
