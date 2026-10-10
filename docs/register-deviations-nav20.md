# Abweichungsbericht nav20: IDM-PDF gegen Xerolux/idm-heatpump-api

Stand 10.10.2026. Verglichen wurde `src/lib/registers/nav20.json` (663 Register, Quelle IDM 812170 Rev.10) mit dem
Registerkatalog von [Xerolux/idm-heatpump-api](https://github.com/Xerolux/idm-heatpump-api) (MIT, Copyright (c) 2026 Basti,
Commit 868a576), aufgebaut für Navigator 2.0 mit sieben Heizkreisen, zehn Zonenmodulen à acht Räumen, Solar, ISC, PV und Kaskade
(654 Einträge). Bei Widerspruch gilt das IDM-Dokument, Gerätescan geht vor beidem. Die Registernamen (`id`) stimmen bei allen
gemeinsamen Adressen überein; Adressen, Zugriff (lesen/schreiben) und EEPROM-Markierung ebenfalls.

## Nur im IDM-PDF

| Adresse | id | Anmerkung |
| --- | --- | --- |
| 1714, 1715 | `ext_pump_demand_1`, `ext_pump_demand_2` | Externe Pumpenanforderung; der Navigator regelt selbst, GLT-Ansteuerung laut PDF nicht sinnvoll |
| 2064 + 65·(z−1) | `zm{z}_room9_relay` | Status Relais Raum 9 (A9) je Zonenmodul, zehn Register |

## Nur bei Xerolux (nicht in der Nav-2.0-Liste)

| Adresse | id | Anmerkung |
| --- | --- | --- |
| 88 | `pv_target_value` | Navigator 10 (PDF 812663) |
| 90 | `smart_grid_status` | Navigator 10 (PDF 812663); in nav20 liegt der Smart-Grid-Status laut PDF auf 1006, siehe Spec O4 |
| 4120 | `firmware_version` | weder im nav20-PDF noch hier übernommen; für nav10 in Step 10 gegen das PDF prüfen |

## Wertebereiche, die abweichen

| Adresse | id | IDM nav20 | Xerolux | Entscheidung |
| --- | --- | --- | --- | --- |
| 1034 | `dhw_charge_off_temp` | 46 bis 53 | 46 bis 67 | PDF |
| 1120 bis 1123, 1226 bis 1231 | Bivalenzpunkte | -90 bis 40 | -40 bis 40 | PDF; -40 entspricht dem Navigator-10-PDF (siehe Spec, Abschnitt Quellen) |

## Typ und Einheit

- **1004** `internal_message`: PDF UCHAR, Meldungsnummern gehen bis 999. Übernommen als `UINT16` (`typeSource: community`), wie bei Xerolux.
- **WORD** (Pumpenstatus, Ventile, Bivalenz, Batterie): PDF ohne Vorzeichen. Wir führen `INT16` (Werte -1 und negative Temperaturen),
  Xerolux nutzt für die Ventile `UINT16` (nur 0/1, kein praktischer Unterschied). Alle `typeSource: community`, der Scan klärt es.
- **Prozent Feuchte**: wir führen `%rF` wie im PDF, Xerolux `%`. Nur Anzeige.
- **1048** `current_electricity_price`: PDF ohne Einheit, Xerolux `€/MWh`. Ohne Einheit übernommen, bis ein Scan es bestätigt.
- **86** `battery_soc`: PDF nennt nur den Standardwert -1, Xerolux 0 bis 100. Wir tragen -1 als Sentinel ein, aber keine Grenzen.
- **Min/Max** bei Enum-Registern führt das PDF, Xerolux oft nicht (155 Einträge); wir übernehmen die PDF-Werte.

## Offen für den Gerätescan

- Float-Wortreihenfolge (Standard `lowFirst`, nur `community`).
- Die drei überlappenden Adressen 1392/1393, 1441/1442, 1483/1484.
- Ob jedes RW-Register sich per FC04 und FC03 lesen lässt.
