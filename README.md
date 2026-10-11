![Logo](admin/idm-modbus.png)

# ioBroker.idm-modbus

[![NPM version](https://img.shields.io/npm/v/iobroker.idm-modbus.svg)](https://www.npmjs.com/package/iobroker.idm-modbus)
[![Downloads](https://img.shields.io/npm/dm/iobroker.idm-modbus.svg)](https://www.npmjs.com/package/iobroker.idm-modbus)
![Number of Installations](https://iobroker.live/badges/idm-modbus-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/idm-modbus-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.idm-modbus.png?downloads=true)](https://nodei.co/npm/iobroker.idm-modbus/)

**Tests:** ![Test and Release](https://github.com/seaspotter/ioBroker.idm-modbus/workflows/Test%20and%20Release/badge.svg)

## idm-modbus adapter for ioBroker

Connects [IDM](https://www.idm-energie.at) heat pumps (iDM Energiesysteme) with Navigator control to ioBroker locally via Modbus TCP: read, control and feed room, PV and building-automation values. No cloud, one adapter instance per heat pump.

**Manual:** [English](docs/en/manual.md) · [Deutsch](docs/de/handbuch.md)

> **Status: early development.** The Navigator 2.0 (Pro) is verified at a real device for reading and for a few writes. Navigator 1.7 and 10 are built from the IDM documents only and untested. Control, PV, room-temperature and building-automation feeding and the web interface part are off by default.

### Features

- **Reads about 650 documented registers** (temperatures, status, pumps, valves, energy, solar, ISC, cascade, bivalence, PV values, heating circuits A–G, zone modules with up to 8 rooms each) in four polling groups, with one serial connection, a pause between requests and a keepalive: the Navigator stalls under hard polling and closes idle connections after about 10 s.
- **Device scan and detection:** _Test connection_ shows the outdoor temperature and detects the Navigator generation; _Scan device_ reads every register once (read requests only, about 3 minutes, with progress) and _Apply suggestion_ fills in the installation (heating circuits, zone modules, blocks).
- **Clean object tree:** states appear when the Navigator reports a real value, no empty states for hardware you do not have; names in 11 languages; temperatures and counters with one decimal; fault numbers as text.
- **Statistics:** COP and annual performance factor, energy per operating mode, cost and CO₂ (fixed or from a state), operating hours, starts and defrosts, optional external electricity and heat meters; plus runtime, heat and electricity statistics from the Navigator's web pages.
- **Control** (off by default, per group): system mode, hot water, heating circuits, room setpoints and modes (Navigator Pro), solar, bivalence and cascade, and a one-time hot water charge. Every value is checked, limited, read back and counted, with EEPROM protection.
- **Feeding from ioBroker** (off by default): PV values, room temperatures and building-automation values, with scaling, limits, age checks and second-writer detection.
- **Web interface** (optional, PIN): the inputs and outputs of the Navigator (Navigator 2.0 / Pro through its PHP pages, Navigator 10 through its WebSocket) and, on the Navigator 2.0 / Pro, room names, heating circuit names and room data. Modbus values win; the Navigator 1.0/1.7 has no web interface.
- **Heat pump diagram:** a read-only web page (a link next to the instance) with a live picture of your plant: heat pump (air or ground source), storage, fresh water station, heating circuits with their rooms, solar, photovoltaics. It assembles itself from the values the adapter has and shows the IDM measuring points (B33, B48, ...).
- **Support file** with one click, without host, PIN or addresses.

### Requirements

Two things have to be set up on the Navigator once, usually at installer/service level, so ask your installer if you cannot reach them:

1. **Modbus TCP** is switched off by default: main menu _Settings_ → _Building management_ (Gebäudeleittechnik) → set _Modbus TCP_ to _On_, and give the Navigator a fixed IP address. Without it nothing works.
2. **Network PIN** – only for the optional web interface part. The adapter works without it.

The adapter does not try to unlock installer functions or change these settings itself.

### Acknowledgements

Big thanks to [Xerolux](https://github.com/Xerolux) for his extensive work on IDM Modbus, the
[idm-heatpump-api](https://github.com/Xerolux/idm-heatpump-api) and
[idm-heatpump-hass](https://github.com/Xerolux/idm-heatpump-hass) projects (MIT). They are this adapter's secondary
reference for register definitions, batching and EEPROM protection, and the best second opinion where the IDM
documents leave questions open.

### Disclaimer

This is an independent community project. IDM and Navigator are trademarks of their respective owner; the project is not affiliated with or endorsed by IDM Energiesysteme GmbH.

## Changelog

<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->

### **WORK IN PROGRESS**

- (SeaSpotter) read-only adapter for Navigator 2.0: register files, Modbus TCP client, polling, object tree, device scan, 11-language texts
- (SeaSpotter) support file with one click (Diagnostics tab): configuration without host, PIN and addresses, connection state, problem registers, latest readings; English and German manuals, a new logo, German texts aligned with the wording of the IDM manuals (Warmwasserladung, Konstantheizkreis, Trinkwassererwärmer, Datenpunkt)
- (SeaSpotter) Navigator 10: the input/output tables of the web interface are read through its WebSocket (port 61220, protocol as documented by Xerolux; tested against a mock only); the Navigator 1.0/1.7 has no web interface, so its web option is hidden; circuit sensor tags follow the B51-B57 / B61-B67 sequence
- (SeaSpotter) web interface: inputs and outputs of the Navigator (sensors not available by Modbus such as the heating flow rate B2 and the refrigerant circuit, digital inputs such as the hot water flow switch B1, pump and valve states such as M22, M31, M73, fan M13) as states `web.io.*`; the diagram shows them
- (SeaSpotter) heat pump diagram: a read-only web page (link next to the instance, port 8183) that draws heat pump, buffer, hot water, heating circuits, photovoltaics and rooms with live values, only for the parts the plant has
- (SeaSpotter) simpler settings: the web interface options sit in the Connection tab, ports, timeouts and intervals are expert settings, the float word order is no longer a setting
- (SeaSpotter) CO₂ intensity can come from a state (accrued at the value valid when the energy was used), state `stats.co2.intensity` shows the factor in use
- (SeaSpotter) temperatures, temperature differences and counters (energy, hours) show at most one decimal
- (SeaSpotter) states appear when the Navigator reports a real value; hardware the plant does not have gets no empty states (option _Create states only when the Navigator reports a value_, on by default; leftovers are removed two minutes after the start)
- (SeaSpotter) the device scan shows its progress in `diag.scanProgress`, announces its duration and warns when it is interrupted
- (SeaSpotter) fault numbers of the Navigator 2.0 are translated into text (178 faults, 11 languages) in `system.internal_message_text`
- (SeaSpotter) optional one-time hot water boost (`dhw.boost_start` / `dhw.boost_stop`) with target temperature and time limit; it always switches the demand off again
- (SeaSpotter) defrost cycles and defrost hours in the statistics
- (SeaSpotter) web statistics: runtime, heat quantity and electrical energy per operating state (today, month, year, total, history) and the COP from the Navigator's web pages
- (SeaSpotter) optional web interface module: reads room names, heating circuit names and room data (temperature, target, humidity, mode) from the Navigator's local web pages with the display PIN (read only, off by default)
- (SeaSpotter) the test-connection button detects the Navigator generation (2.0, 10 or 1.x) and warns when it differs from the selected one
- (SeaSpotter) register files for Navigator 10 and Navigator 1.0/1.7 from the IDM documents (untested on real devices; 1.7 without coil registers), booster block for Navigator 10
- (SeaSpotter) PV module: writes PV surplus, production, house consumption and battery values from ioBroker states to the Navigator, with scaling, limits and second-writer detection, off by default
- (SeaSpotter) building automation values: outdoor temperature, humidity, demands and storage temperatures from ioBroker states to the Navigator (cyclic, range and age checks), off by default
- (SeaSpotter) room temperature feeding: writes the temperature of an ioBroker state to the external room temperature of a heating circuit (tolerance, heartbeat, range, stale handling), off by default
- (SeaSpotter) optional room control for zone modules: setpoint (0.5 °C steps, 10-30 °C) and operating mode per room, off by default

## License

MIT License

Copyright (c) 2026 SeaSpotter <seatowage@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
