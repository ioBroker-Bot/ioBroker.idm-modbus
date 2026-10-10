# ioBroker.idm-modbus – Manual

Local ioBroker adapter for IDM heat pumps with Navigator control (Navigator 2.0 / Pro verified, Navigator 10 and 1.0/1.7 from the IDM documents). It talks to the Navigator over **Modbus TCP** on your own network, with no cloud. [Deutsche Version](../de/handbuch.md)

## 1. Before you start

Two things have to be set up **once on the Navigator**, usually at installer/service level (ask your installer if you cannot reach the menus):

1. **Modbus TCP** is switched off by default. In the main menu "Settings" choose "Building management" (Gebäudeleittechnik) and set "Modbus TCP" to "On"; give the Navigator a fixed IP address. Without it the adapter cannot read anything; _Test connection_ then reports a failed connection.
2. **Network PIN** – only for the optional _web interface_ part (room names, room data, statistics from the Navigator's web pages). The adapter works without it.

The adapter never unlocks installer functions and never changes these settings itself.

**Safety in short:** reading is always harmless. Writing is off by default, per group, and every write is checked, limited and counted. Many Navigator settings live in an EEPROM that survives about 300,000 write cycles per setting, so never let an automation write them continuously.

## 2. First setup (5 minutes)

1. Install the adapter and create an instance.
2. **Connection** tab: enter the Navigator's IP address and choose the Navigator generation. Press **Test connection**: it shows the outdoor temperature and the generation it detected (a hint appears if it differs from your choice).
3. **Installation** tab: press **Scan device** (about 3 minutes, read requests only; do not restart the adapter meanwhile; the page shows the progress). When the status line says _Scan finished_, press **Apply suggestion**. It ticks the heating circuits, zone modules and blocks the Navigator really has. Check them, then **Save**.
4. States appear as soon as the Navigator reports a value. Hardware your plant does not have gets no empty states.

Everything else is optional and off until you switch it on.

## 3. Settings reference

### Connection

| Setting                  | Meaning                                                                                                                                                                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigator host / IP      | Address of the Navigator. Use a fixed address.                                                                                                                                                                                                                       |
| Navigator generation     | 2.0 (also Pro), 1.7 or 10. The test button detects it for you.                                                                                                                                                                                                       |
| Web interface (optional) | Also read room names, room data and statistics from the web interface. Needs the display's network PIN (stored encrypted, sent unencrypted over your local network like in a browser).                                                                               |
| Expert settings          | Visible with the admin's expert mode: port (502), unit ID (1), request timeout, pause between requests (at least 100 ms: the Navigator stalls under hard polling), polling intervals fast/medium/slow/settings (30 s / 60 s / 300 s / 3600 s) and the web intervals. |

### Installation

Heating circuits A–G (with optional names), number of zone modules and rooms per module, optional register blocks (solar, ISC, cascade, bivalence, PV and power values, booster pumps of the Navigator 10), the device scan with _Apply suggestion_, and two options for which states exist:

- **Hide states of hardware that reports no value** (default on): states of sensors, pumps and the like that your plant does not have are not created, leftovers are removed two minutes after the start. A state appears by itself when a real value arrives. Custom settings (for example history) of a removed state are lost.
- **Delete states of circuits, zones and blocks switched off here**: cleans up what you disabled.

### Statistics

Derived values and statistics (see section 6): optional external electricity meter (counter and/or power) and heat meter, which heat source feeds the efficiency figures, price per kWh (fixed or from a state), currency, CO₂ per kWh (fixed or from a state), maximum age of external values, _Reset statistics_.

### Control

Allows writing to the heat pump. **Everything is off by default**, per group: system mode and fault acknowledgement, hot water settings, each heating circuit, room setpoints and operating modes of the zone modules (Navigator Pro), solar mode, and bivalence/cascade (expert). Plus the one-time hot water charge, the minimum time between two writes of one setting (default 60 s) and a warning threshold for writes per setting and day.

### Photovoltaics, Room sensors, Building automation

Feeding of values from ioBroker states to the Navigator, see section 7.

### Diagnostics

_Create support file_ (section 9).

## 4. The object tree

All states are below the instance (`idm-modbus.0.`). Names are translated into your ioBroker language.

| Channel                                             | Content                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `info`                                              | `connection`, `family`, `errors`, `lastSuccess`                                                                     |
| `system`                                            | outdoor temperature, system mode, fault number `internal_message` and its text `internal_message_text`              |
| `dhw`                                               | hot water: storage and heater temperatures, setpoints, one-time charge (`boost_*`)                                  |
| `hp`                                                | heat pump: flow/return, operating mode, compressors, pumps, valves, demands, summary fault                          |
| `hc.A` … `hc.G`                                     | per heating circuit: flow, room temperature, mode, setpoints, heating curve, limits                                 |
| `zones.1.rooms.1` …                                 | zone modules: room temperature, setpoint, humidity, operating mode, relay (names from the web interface if enabled) |
| `energy`                                            | heat quantity counters, momentary power                                                                             |
| `solar`, `isc`, `cascade`, `bivalence`, `pv`, `glt` | optional blocks                                                                                                     |
| `calc`                                              | calculated values: temperature differences, flow deviation, momentary COP                                           |
| `stats`                                             | energy per operating mode, COP and annual performance factor, cost, CO₂, operating hours, starts, defrosts          |
| `web`                                               | room data and statistics from the web interface                                                                     |
| `diag`                                              | request statistics, last error, write counters, scan state                                                          |

Rules for the values:

- Temperatures, temperature differences and counters (kWh, hours) show **one decimal**.
- A value the Navigator marks as _not available_ (sensor missing) is empty with a bad quality flag, never a made-up number.
- Writable states are written with `ack=false`; the adapter confirms with `ack=true` after the Navigator accepted and read back the value.

## 5. Writing and its protections

Every write passes these checks: allowed group, valid value (documented range and allowed values only), only if it differs from the current value (for EEPROM settings), debounced (1 s), at least 60 s between two writes of one EEPROM setting (the newest value wins), written, **read back** after 1 s and counted (`diag.writes.<id>`). A burst or more than the daily threshold gives a warning; three failures in a row lock a setting for ten minutes. Nothing is queued while the Navigator is offline, and a refused value is shown back as the real value.

**One-time hot water charge** (Control tab, off by default): `dhw.boost_start` / `dhw.boost_stop`. It switches the hot water demand (register 1712) on, refreshes it every 30 s and **always switches it off again**: at the target temperature (default 55 °C), after the time limit (default 60 minutes), on request, after three failed writes, when the adapter stops and after a restart.

## 6. Statistics

- **Calculated values** (`calc`): heat pump flow minus return, heat source inlet minus outlet, hot water minus setpoint, flow deviation per heating circuit, momentary COP (internal from the Navigator's power registers, external if you have your own meter).
- **Energy and efficiency** (`stats`): electrical and thermal energy per operating mode (heating, hot water, cooling, defrost) for today, this month, this year and since the start, COP and annual performance factor (also the last 365 days), cost at the price valid when the energy was used, CO₂ at the intensity valid then (`stats.co2.intensity` shows the factor in use), operating hours, starts and short runs per compressor, defrost cycles and hours. The statistics survive restarts. COP guards: at least 50 W, at least 0.1 kWh per period.
- **External meters:** a counter state is preferred (it keeps counting while the adapter is stopped); a power-only state is integrated. The unit is read from the state; if it has none, choose it, otherwise the source stays off with a warning (the adapter never guesses a unit).
- **Web statistics** (`web.statistics`, needs the PIN): runtime, heat quantity and electrical energy per operating state for today, month, year and total, a JSON history of days, months and years (back to the first operation), and the COP calculated from them. Compare it with the Modbus-based figures before relying on it; the hot water COP in particular depends on how the Navigator assigns energy.

## 7. Feeding values to the Navigator

All three modules are **off by default**, write only when something is configured, and read back what they wrote to detect a second writer (`*.writer_conflict`).

- **Photovoltaics** (registers 74–86): PV surplus, production, house consumption, battery discharge and level from ioBroker states. A factor converts to kW (1 for kW, 0.001 for W; there is deliberately no default), plus invert and limits. Surplus is taken directly from a state or calculated as production minus house consumption. Every value is written every cycle (30 s by default). If the surplus source is missing or too old, **0** is written so the heat pump does not keep running on an old surplus. The Navigator's PV menu must be set up. Switch off any other program that writes these registers.
- **Room sensors** (registers 1650+): the temperature of a state as external room temperature of a heating circuit; written on a change of 0.2 °C or at the heartbeat (300 s), only within 15–30 °C, and not from sources older than 15 minutes (or a fixed fallback value). In the Navigator the room must use the Modbus/GLT sensor as its temperature source.
- **Building automation** (registers 1690–1722): outdoor temperature, humidity, temperature and heating/cooling/hot water demands, storage temperatures. Switch on the matching GLT option in the Navigator first (for example "GLT outdoor temperature"). Not tested on a real device.

## 8. Web interface (optional)

With the display PIN the adapter reads the Navigator's local web pages (read only): room names and heating circuit names (used as names in the object tree), room temperature, target, humidity and mode per room, and the statistics. The web interface is not documented by IDM and may change with firmware updates. Polling every 60 s (rooms) and 15 minutes (statistics); never faster than 30 s / 5 minutes.

## 8a. Heat pump diagram

The adapter serves a read-only web page with a diagram of your plant and live values (port 8183 by default, Connection tab). It is the link next to the instance in the instances list. The diagram assembles itself: heat pump (outdoor, flow, return, power, COP, operating mode, a fan that turns while the compressor runs), buffer tank, hot water, every heating circuit, photovoltaics (production, house, surplus, battery) and all rooms appear only when the adapter has real values for them; pipes are coloured by temperature. Anyone in your network who knows the address can open the page, but it cannot change anything. Listen on 127.0.0.1 (expert setting) to keep it on the ioBroker computer, or switch the page off in the Connection tab.

## 9. Support

_Diagnostics_ tab → **Create support file**: a report for bug reports with the configuration (without host, PIN and state ids), connection state, registers that report no value, the latest reading of every register and the last scan result. IP and e-mail addresses are removed. The file opens in a new tab and is kept in the file area `support` (last five files). Attach it together with the adapter log (set the log level to _debug_ for connection problems).

## 10. Troubleshooting

| Symptom                                               | Cause / remedy                                                                                                                                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _Test connection_ fails                               | Modbus TCP not enabled on the Navigator, wrong IP, or another client blocks the port.                                                                                               |
| Connected but no outdoor temperature                  | Unit ID other than 1 (expert settings).                                                                                                                                             |
| Many empty states                                     | Hardware your plant does not have: keep _Hide states of hardware that reports no value_ on, or run the scan and apply the suggestion.                                               |
| Wrong or missing values after changing the generation | Select the generation the test button reports.                                                                                                                                      |
| The Navigator becomes slow                            | Polling intervals or the pause between requests too short; keep the defaults.                                                                                                       |
| Scan stops at about 25 %                              | The adapter was restarted during the scan (also by a configuration save); start it again and leave the adapter alone.                                                               |
| `web.connected` is false                              | Wrong PIN, web interface not reachable, or the PIN is not set on the Navigator.                                                                                                     |
| A write has no effect                                 | Check the group is enabled in the Control tab; the log names the reason (range, equal value, interval, lock). Room setpoints only act while the room is in operating mode _Normal_. |

## 11. Known limits

- Navigator 10 and 1.0/1.7 register files come from the IDM documents and are untested on real devices; scans from other owners will confirm them. The 1.7 coil registers (3000–3003) are not supported.
- The Navigator may deliver wrong data when overlapping registers are read in one block; the adapter reads the affected registers (for example room humidity and mode) one by one.
- A Modbus room created in the Navigator app cannot be fed by this adapter yet; how the Navigator expects its temperature is open.

## 12. Credits and disclaimer

Register definitions follow the IDM Modbus TCP documents (Navigator 2.0: 812170 Rev.10, Navigator 10: 812663 Rev.0, Navigator 1.0/1.7: 812049 Rev.1). Thanks to **Xerolux** ([idm-heatpump-api](https://github.com/Xerolux/idm-heatpump-api), [idm-heatpump-hass](https://github.com/Xerolux/idm-heatpump-hass), MIT) for the comparison data and for finding many device quirks first. This is an independent community project, not affiliated with or endorsed by IDM Energiesysteme GmbH. Use at your own risk, especially when writing.
