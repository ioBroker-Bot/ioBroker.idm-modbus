# Spezifikation ioBroker.idm-modbus (IDM Navigator via Modbus TCP)

Oct 4, 2026 · @Florian

> **Änderungen gegenüber der Ursprungsfassung (10.10.2026, Kick-off):**
>
> - Sprache ist **TypeScript** (strict, Ausgabe CommonJS nach `build/`), nicht JavaScript. Pfade `main.js`, `lib/...` in dieser Spec lesen sich als `src/main.ts`, `src/lib/...`. Konstanten stehen in `src/lib/constants.ts` (statt eines `CONFIG`-Objekts in einer Datei).
> - O13 ist geklärt: Adaptername `idm-modbus`, npm-Paket `iobroker.idm-modbus`, Repo `seaspotter/ioBroker.idm-modbus`.
> - Die Registerdateien liegen unter `src/lib/registers/*.json` und werden per `resolveJsonModule` importiert, damit sie im Build landen.
> - Hinweis aus dem openwb2-Adapter: `jsonConfig` kann ein asynchrones `sendTo`-Ergebnis (Scan-Vorschläge) nicht in eine bearbeitbare Tabelle einmischen, ohne Nutzereingaben zu überschreiben. Falls die Scan-Vorschläge (Tab 2 Anlage) das brauchen, wechselt die Admin-Oberfläche auf React (`@iobroker/adapter-react-v5`/`gui-components`, `adminUI.config: "materialize"`). Entscheidung in Step 5.
> - **Quellenhierarchie (verbindlich, siehe CLAUDE.md):** 1. Gerätescan, 2. die IDM-Dokumente in `docs/sources/` (je Familie das passende), 3. sekundär die Arbeit von Xerolux (idm-heatpump-api / idm-heatpump-hass, MIT), 4. sonstige Community. Die IDM-PDFs für `nav20` (812170 Rev.10) und `nav10` (812663 Rev.0, Stand 18.06.2025, NAV10_20.23-903) liegen jetzt im Repo; das PDF für `nav17` (812049 Rev.1) ebenfalls. Dadurch entfällt die Aussage „PDF nicht ins Repo legen“ und `nav10`-Register können `doc` statt nur `community` sein.
> - Der Spike zur Modbus-Bibliothek (O11) ist weiterhin offen und gehört zu Step 3; die Entscheidung steht: `modbus-connect` hinter einem eigenen Wrapper.

## Überblick und Ziele

Der Adapter `ioBroker.idm-modbus` (Arbeitstitel) bindet IDM-Wärmepumpen mit Navigator-Regelung lokal per Modbus TCP an ioBroker an: lesend, steuernd und als Empfänger für Raum-, PV- und Gebäudeleittechnik-Werte (GLT). Er ersetzt den Cloud-Adapter [lonestar2001/ioBroker.idm](https://github.com/lonestar2001/ioBroker.idm), dessen letzter Release von Oktober 2022 stammt und der über myIDM nur die erste Wärmepumpe mit einem Heizkreis abruft.

**Ziele**

- Alle Daten lokal ohne Cloud, mit konfigurierbarem Intervall statt 30 bis 60 Minuten Cloud-Verzögerung.
- Primär Navigator 2.0 (Testgerät: IDM SLM 3-11 HGL). Navigator 1.7 und Navigator 10 laufen über dieselbe Architektur mit je einer Register-Datei pro Familie.
- Nur anlegen und abfragen, was an der Anlage vorhanden ist: Heizkreise, Zonenmodule, Räume, Solar, ISC, Kaskade.
- Schreibfunktionen einzeln aktivierbar: Steuern, Raumsensoren, PV-/Energiedaten, weitere GLT-Werte.
- Schutz des Navigator-EEPROMs vor zu häufigem Schreiben.
- Phase 2: KNX-Anbindung über ioBroker.openknx.

**Nicht-Ziele in v1:** myIDM-Cloud, Firmware-Update, Modbus RTU, Navigator-Web-Interface (HTTP/WebSocket), Navigator 1.0, mehrere Wärmepumpen in einer Instanz (stattdessen eine Instanz je Wärmepumpe).

| Familie       | Kennung | Status                                                               | Quelle                                                      |
| ------------- | ------- | -------------------------------------------------------------------- | ----------------------------------------------------------- |
| Navigator 2.0 | `nav20` | primär, am Testgerät prüfbar                                         | IDM-PDF Rev. 10 (04/2022)                                   |
| Navigator 1.7 | `nav17` | abwärtskompatibel, anderes Registerlayout, nur lesend plus PV-Zusatz | IDM-PDF 812049 (2016), HASS-Katalog                         |
| Navigator 10  | `nav10` | aufwärtskompatibel, nicht am Testgerät prüfbar                       | IDM-PDF 812663 Rev.0 (Stand 18.06.2025), Gegenprobe Xerolux |

Navigator Pro (Einzelraumregelung mit Zonenmodulen) steht in der Registerliste von Navigator 2.0 und ist deshalb ein optionaler Teil von `nav20`.

Arbeitsprinzip: Jede Registerangabe trägt einen Verifikationsstatus (`doc` = IDM-Dokument, `community` = HASS/Dritte, `device` = am Testgerät bestätigt). Erst ein Gerätescan setzt `device`.

## Quellen und Lizenzen

Registerwerte stammen aus dem IDM-PDF und werden gegen den HASS-Katalog geprüft. Bei Widerspruch gilt diese Rangfolge: 1. Gerätescan am Testgerät, 2. IDM-PDF, 3. HASS-Katalog, 4. weitere Community-Quellen. Stand der Recherche: 04.10.2026.

| Quelle                                                                                                                                                                                                                   | Inhalt                                                                                                                      | Verwendung                                                                                 | Lizenz / Status                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| [IDM Modbus TCP Navigator 2.0](https://api.library.loxone.com/downloader/file/647/Modbus%20TCP_Navigator%202.0_DE.pdf) (812170 Rev. 10, 20.04.2022, SW 20.21-101)                                                        | Parameterliste, GLT-Konfiguration, Anwendungsbeispiele                                                                      | Primärquelle `nav20`                                                                       | IDM-Dokument; liegt in `docs/sources/`, nur als Referenz (nicht im npm-Paket), Register als Fakten übernehmen    |
| [IDM myIDM energy Navigator 2.0](https://www.idm-energie.at/wp-content/uploads/2023/10/tu_de_812184_myiDMenergy-Navigator-2.0.pdf)                                                                                       | PV-Schnittstelle: Register 74 als Holding Register (RW), 4122 als Input Register (RO)                                       | Function Codes PV                                                                          | IDM-Dokument                                                                                                     |
| [IDM Smartfox/GLT 2021](https://www.idm-energie.at/wp-content/uploads/2021/04/iDM-Schnittstelle-Smartfox.pdf) und [Fassung 2026](https://www.idm-energie.at/wp-content/uploads/2026/01/Gebaeudeleittechnik-Smartfox.pdf) | PV-Werte über Modbus, KNX, BACnet                                                                                           | Modul D; die Fassung 2026 war automatisiert nicht abrufbar und muss manuell gelesen werden | IDM-Dokument                                                                                                     |
| IDM Modbus TCP Navigator 1.0/1.7 (812049 Rev. 1, 13.06.2016)                                                                                                                                                             | Registerliste mit anderem Layout                                                                                            | `nav17`                                                                                    | IDM-Dokument                                                                                                     |
| IDM Modbus TCP Navigator 10 (812663 Rev.0, Stand 18.06.2025)                                                                                                                                                             | Parameterliste Navigator 10 inkl. Smart Grid 90, Booster, Wärmesenke                                                        | Primärquelle `nav10`, liegt in `docs/sources/`                                             | IDM-Dokument                                                                                                     |
| [Xerolux/idm-heatpump-hass](https://github.com/Xerolux/idm-heatpump-hass) und [Doku](https://xerolux.github.io/idm-heatpump-hass/docs/modbus-register/)                                                                  | Katalog mit 687 Registerdefinitionen (Stand idm-heatpump-api 2.2.0), Batching, EEPROM-Schutz, RoomTempForwarder, KNX-Bridge | Gegenprobe `nav20`, Quelle für `nav10` und `nav17`                                         | MIT                                                                                                              |
| Xerolux/idm-heatpump-api (PyPI `idm-heatpump-api`)                                                                                                                                                                       | Maschinenlesbares Register-Schema                                                                                           | möglicher Import in Step 1; Repo noch nicht geöffnet                                       | MIT (LICENSE im Repo geprüft 10.10.2026, Copyright (c) 2026 Basti); Registerdaten in `idm_heatpump/registers.py` |
| [dschrempf/idm-modbus](https://github.com/dschrempf/idm-modbus)                                                                                                                                                          | Navigator-2.0-Registerliste als TSV, Scan-Daten einer realen Anlage, Messungen zur Float-Reihenfolge                        | Abgleich mit dem eigenen Scan                                                              | BSD-3-Clause (GitHub-API, 10.10.2026); trotzdem nur zum Abgleich, keine Daten kopieren (Entscheidung O10)        |
| [lonestar2001/ioBroker.idm](https://github.com/lonestar2001/ioBroker.idm)                                                                                                                                                | Cloud-Adapter                                                                                                               | nur Abgrenzung                                                                             | MIT                                                                                                              |

Für `nav10` liegt das IDM-Dokument 812663 Rev.0 (Stand 18.06.2025, Software NAV10_20.23-903 bzw. T_NAV10_20.23-1336) im Repo; `nav10`-Register sind damit `doc`, aber erst ein Gerätescan setzt `device`. Beobachtete Unterschiede zu `nav20` (für Step 2 und 10 zu prüfen, nicht aus dem Gedächtnis zu übernehmen): Register 88 (PV-Zielwert) und 90 (Smart Grid Status, 0 Red … 4 Supergreen) neu, 1006 ist dort „Variabler Eingang“ (deckt sich mit HASS, siehe O4), zusätzliche Register 1068–1088 (Wärmesenke, Grundwasser), 1680–1683 (Störungen), 4001–4052 (Booster), 4108/4112 (Leistungsbegrenzung), 4124; Bivalenzbereiche -40 bis 40 statt -90 bis 40; Zonenmodule dort mit 6 statt 8 Räumen (O7); Loxone-Beispiele nutzen FC4 beziehungsweise FC16.

## Architektur

Alle Module sprechen nur über eine gemeinsame Modbus-Schicht mit dem Navigator; Adressen stehen ausschließlich in den Register-Dateien.

```text
 Quell-States (ioBroker)      Objektbaum            Register-Dateien
        |                        ^  |                  (nav17/nav20/nav10.json)
        v                        |  v                       |
   C Raumsensoren          A Lesen   B Steuern              |  Adressen, Objektbaum,
   D PV / Energie            (Messwerte)  (Sollwerte)        |  Polling-Plan
   E weitere GLT-Werte           |  |                       |
        |                        v  v                       v
        +----------------> Modbus-Schicht  <----------------+
                          (Verbindung, Queue, Kodierung, Batching, Scan)
                                     |
                                     v
                          Navigator (Modbus TCP, Port 502)
```

Lesen von links: Quell-States speisen die Module C, D und E. Modul A schreibt Messwerte in den Objektbaum, Modul B übernimmt Sollwerte aus dem Objektbaum. Alle Module geben ihre Aufträge an die Modbus-Schicht weiter. Die Register-Dateien liefern der Modbus-Schicht die Adressen und den Modulen den Aufbau des Objektbaums und den Polling-Plan. Modul F (KNX, Phase 2) kommt als sechstes Modul dazu.

**Ordnerstruktur:**

- `src/main.ts`: Adapterstart, Konfiguration, Lebenszyklus.
- `src/lib/modbus/`: Verbindung, Warteschlange, Kodierung, Batching, Scan.
- `src/lib/registers/`: JSON-Dateien je Familie und Ladefunktion mit `extends`.
- `src/lib/modules/`: `read.ts`, `control.ts`, `rooms.ts`, `pv.ts`, `glt.ts`, `knx.ts`.
- `src/lib/guards/`: EEPROM-Schutz, Entprellung, Mindestintervall.
- `admin/jsonConfig.json` und `admin/i18n/`: Oberfläche in Deutsch und Englisch.
- `tools/build-registers.ts` und `test/`: Generator, Mock-Server, Fixtures. Tests liegen als `*.test.ts` neben dem Code.

## Modbus-Grundlagen

Der Navigator spricht Modbus TCP auf Port 502 mit Unit-ID 1. Die Funktion muss am Gerät unter Einstellungen → Gebäudeleittechnik → Modbus TCP auf Ein stehen (Service- bzw. Heizungsbauerebene).

| Thema                   | Festlegung                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Status                                                                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verbindung              | TCP 502, Unit-ID 1, statische IP (bei DHCP kann sich die Adresse ändern). Modbus TCP und myIDM laufen parallel, solange dieselbe IP genutzt wird.                                                                                                                                                                                                                                                                                                                                            | `doc`                                                                                                                                                       |
| Function Codes          | Nur lesbare Werte (RO) per FC04, lesbar/schreibbar (RW) per FC03 lesen und FC16 schreiben; einzelne 16-Bit-Register optional per FC06. Laut myIDM-Doku ist 74 ein Holding Register, 4122 ein Input Register. Ob jedes Register über beide Function Codes lesbar ist, ist nicht dokumentiert: der Scan prüft FC04 zuerst, dann FC03. Probe 10.10.2026: Register 1005 (RW) antwortet auf FC03 und FC04 gleich.                                                                                 | `doc`, Rest offen                                                                                                                                           |
| FLOAT                   | IEEE 754 über 2 Register. HASS und dschrempf nennen die Reihenfolge Low-Word zuerst (anders als üblich bei Modbus). Konfigurierbar (`floatWordOrder`), Standard `lowFirst`.                                                                                                                                                                                                                                                                                                                  | `community`; **am Gerät bestätigt 10.10.2026** (Probe 1000, 1008, 1050: nur `lowFirst` ergibt plausible Werte), `verified: device` setzt der Scan in Step 5 |
| UCHAR                   | 1 Register, Wert 0–255.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `doc`                                                                                                                                                       |
| BOOL                    | 1 Register, 0 oder 1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `doc`                                                                                                                                                       |
| WORD                    | Im PDF ohne Vorzeichenangabe; HASS behandelt es als INT16 (Bivalenzpunkte negativ, Pumpenstatus -1 bis 100). Standard INT16.                                                                                                                                                                                                                                                                                                                                                                 | `community`                                                                                                                                                 |
| Adressen                | Adresse im PDF = Protokolladresse (Loxone-Beispiel im PDF nutzt 1000 für Register 1000). Ein Off-by-one wird im Scan geprüft. Probe 10.10.2026: die PDF-Adressen treffen am Gerät ohne Versatz (1000 Außentemperatur, 1008 Speicher, 1050 Vorlauf, 1005 Betriebsart 1, 1090 Aus).                                                                                                                                                                                                            | `doc`, Gerätetest                                                                                                                                           |
| Nicht verfügbar         | -1 bei Pumpen (INT16), Batteriefüllstand, GLT-Speichertemperaturen; -1.0 bei Räumen ohne Sensor (laut HASS). Werte außerhalb min/max der Register-Datei gelten als ungültig.                                                                                                                                                                                                                                                                                                                 | `doc`/`community`                                                                                                                                           |
| Zeitverhalten           | PDF-Beispiel Loxone: Abfrage alle 60 s. PV-Werte wirken nach etwa 15 s. dschrempf: der Navigator stockt bei hartem Polling; HASS: manche Firmwares vertragen nur wenige parallele Clients. Daher eine Verbindung, serielle Requests, Pause zwischen Requests.                                                                                                                                                                                                                                | `doc`/`community`                                                                                                                                           |
| Leerlauf der Verbindung | Der Navigator schließt eine TCP-Verbindung nach etwa 10 s ohne Anfrage (am Testgerät gemessen, 10.10.2026: 10,1 bis 12,1 s in fünf Läufen, unabhängig vom Startzeitpunkt, also kein zweiter Client). Der Poller sendet deshalb nach 5 s Leerlauf ein kleines Lese-Request (Register 1000, FC04) als Keepalive; sonst würde `info.connection` zwischen den Zyklen wechseln.                                                                                                                   | `device`                                                                                                                                                    |
| Mehrere Clients         | Am Testgerät läuft parallel ein weiterer ioBroker-Modbus-Adapter des Nutzers, der die PV-Werte 74 bis 86 schreibt. Der Navigator verträgt zwei gleichzeitige TCP-Verbindungen: ein Lesetest mit einer Anfrage alle 5 s über 120 s lief ohne Verbindungsabbruch. Die Verbindung bricht nur nach etwa 10 s Leerlauf ab (Messreihe: 10,1 bis 12,1 s, unabhängig von der Startphase). Die Last beider Clients addiert sich, deshalb gilt die Mindestpause von 100 ms für unseren Adapter weiter. | `device`                                                                                                                                                    |
| Nicht vorhanden (Gerät) | Am Testgerät antwortet der Navigator mit 0xFFFF (-1) bei Statusregistern nicht vorhandener Hardware (Verdichter 2 bis 4, Smart-Grid-Eingang, Pumpen, Ventile) und mit -1,0 bei FLOAT-Fühlern, die es nicht gibt (Raumtemperatur ohne Raumfühler, Feuchtesensor). Beides wird als ungültig behandelt (State `null`, Qualität 0x44).                                                                                                                                                           | `device`                                                                                                                                                    |
| Zyklisches Schreiben    | Laut PDF müssen GLT-Werte zyklisch übermittelt werden. Pflicht-Intervalle: 1696 und 1698 alle 10 Minuten; 1710 und 1711 zyklisch, damit die Anforderung nach einem Neustart wieder anliegt.                                                                                                                                                                                                                                                                                                  | `doc`                                                                                                                                                       |

Das Servicepasswort für die Aktivierung nennt dschrempf als Tag und Monat des aktuellen Datums; das ist unbestätigt und gehört nicht in die Adapter-Doku.

## Register-Modell

Alle Register stehen in JSON-Dateien pro Familie unter `src/lib/registers/` (`nav17.json`, `nav20.json`, `nav10.json`). Der Code kennt keine Adressen; er liest nur diese Dateien. `nav10.json` erweitert `nav20.json` über `extends` mit `add`, `override` und `remove`. `nav17.json` ist eigenständig, weil das Layout abweicht (zum Beispiel liegt die Außentemperatur dort ebenfalls bei 1000, die WP-Vorlauftemperatur aber bei 1002 statt 1050).

Ein Registereintrag:

```json
{
    "id": "hc_a_flow_temp",
    "address": 1350,
    "type": "FLOAT",
    "access": "R",
    "unit": "°C",
    "group": "hc",
    "instance": "A",
    "poll": "fast",
    "min": -50,
    "max": 100,
    "eeprom": false,
    "cyclicSec": null,
    "sentinel": [],
    "enum": null,
    "requires": ["hc:A"],
    "verified": "doc",
    "label": { "de": "Vorlauftemperatur HK A", "en": "Flow temperature HC A" }
}
```

- `type`: `FLOAT`, `UCHAR`, `BOOL`, `INT16`, `UINT16`.
- `access`: `R` (lesen), `RW`, `W` (nur schreiben, zum Beispiel 1650–1662, 1999).
- `poll`: `fast`, `medium`, `slow`, `config` (Abschnitt Modul A).
- `eeprom`: true bei den mit Stern markierten Registern des PDFs.
- `cyclicSec`: Pflicht-Schreibintervall, zum Beispiel 600 für 1696 und 1698.
- `requires`: Bedingungen wie `hc:A`, `zone:2`, `block:solar`, `block:isc`, `block:cascade`; ohne erfüllte Bedingung wird das Register weder gelesen noch als State angelegt.
- `verified`: `doc`, `community`, `device`.

**Adressformeln** (der Generator `tools/build-registers.ts` erzeugt daraus die wiederholten Blöcke; `i` = Heizkreis A=0 bis G=6):

| Wert                                        | Formel                           |
| ------------------------------------------- | -------------------------------- |
| Vorlauftemperatur HK                        | `1350 + 2i`                      |
| Raumtemperatur HK                           | `1364 + 2i`                      |
| Soll-Vorlauf HK                             | `1378 + 2i`                      |
| Betriebsart HK (RW)                         | `1393 + i`                       |
| Raumsoll Heizen Normal / Eco                | `1401 + 2i` / `1415 + 2i`        |
| Heizkurve                                   | `1429 + 2i`                      |
| Heizgrenze, Festwert-Vorlauf                | `1442 + i`, `1449 + i`           |
| Raumsoll Kühlen Normal / Eco                | `1457 + 2i` / `1471 + 2i`        |
| Kühlgrenze, Kühl-Vorlauf                    | `1484 + i`, `1491 + i`           |
| Aktive Betriebsart HK                       | `1498 + i`                       |
| Parallelverschiebung                        | `1505 + i`                       |
| Externe Raumtemperatur HK (W)               | `1650 + 2i`                      |
| Zonenmodul `z` (1–10), Basis                | `2000 + 65·(z−1)`                |
| Zone: Modus Heizen/Kühlen, Entfeuchtung     | Basis, Basis + 1                 |
| Raum `r` (1–8): Temperatur                  | Basis + 2 + 7·(r−1)              |
| Raum: Soll / Feuchte / Betriebsart / Relais | Temperatur + 2 / + 4 / + 5 / + 6 |
| Zone: Status Raum 9 (A9)                    | Basis + 64                       |

Prüfwerte für die Tests: Zone 1 Raum 3 Temperatur = 2016, Zone 2 Raum 1 Temperatur = 2067, Zone 1 Raum 8 Relais = 2057, HK G externe Raumtemperatur = 1662, HK G Betriebsart = 1399.

**Fähigkeitserkennung:** Die Familie wählt der Nutzer in der Konfiguration; automatische Erkennung ist kein Ziel von v1. Aktive Blöcke (Heizkreise, Zonen, Räume, Solar, ISC, Kaskade) kommen aus der Konfiguration, der Scan liefert nur Vorschläge. Grund: laut HASS-Doku beweist eine antwortende Adresse allein nicht, dass das Feature existiert.

## Registerübersicht Navigator 2.0

Stand IDM-PDF vom 20.04.2022 (alle Werte `doc`). FLOAT belegt zwei Register. `*` = EEPROM-Register.

| Bereich               | Adressen                     | Typ / Zugriff | Inhalt                                                                                                                                              |
| --------------------- | ---------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| PV / Batterie         | 74, 76, 78, 82, 84           | FLOAT RW      | PV-Überschuss, E-Heizstab-Leistung, PV-Produktion, Hausverbrauch, Batterieentladung (kW)                                                            |
|                       | 86                           | WORD RW       | Batteriefüllstand in %, -1 = nicht verfügbar                                                                                                        |
| Außen / Meldung       | 1000, 1002                   | FLOAT R       | Außentemperatur B32, gemittelte Außentemperatur                                                                                                     |
|                       | 1004                         | UCHAR R       | Interne Meldung (Nr. 020–999)                                                                                                                       |
| Betriebsart           | 1005\*                       | UCHAR RW      | 0 Standby, 1 Automatik, 2 Abwesend, 4 Nur Warmwasser, 5 Nur Heizung/Kühlung                                                                         |
| Smart Grid            | 1006                         | UCHAR R       | 0 EVU-Sperre und kein günstiger Strom, 1 EVU-Bezug und kein günstiger Strom, 2 kein EVU-Bezug und günstiger Strom, 4 EVU-Sperre und günstiger Strom |
| Speicher / Warmwasser | 1008, 1010, 1012, 1014, 1030 | FLOAT R       | Wärmespeicher B38, Kältespeicher B40, TWE unten B41, TWE oben B48, Zapftemperatur B42                                                               |
|                       | 1032\*, 1033\*, 1034\*       | UCHAR RW      | WW-Soll (35–95, Standard 46), Einschalttemperatur (30–50, 46), Ausschalttemperatur (46–53, 50)                                                      |
|                       | 1048                         | FLOAT R       | Aktueller Strompreis                                                                                                                                |
| WP-Temperaturen       | 1050–1066 (gerade)           | FLOAT R       | Vorlauf B33, Rücklauf B34, HGL-Vorlauf B35, Quelle ein B43 und aus B36, Luftansaugung B37, Luft-WT B72, Luftansaugung 2 B46, Ladefühler B45         |
| WP-Status             | 1090                         | UCHAR R       | 0 Aus, 1 Heizen, 2 Kühlen, 4 Warmwasser, 8 Abtauung                                                                                                 |
|                       | 1091–1093, 1098, 1099        | UCHAR R       | Anforderung Heizen, Kühlen, Warmwasser; EVU-Sperrkontakt (0 gesperrt, 1 nicht gesperrt); Summenstörung                                              |
|                       | 1100–1103                    | UCHAR R       | Verdichter 1–4                                                                                                                                      |
|                       | 1104–1106, 1108, 1109        | WORD R        | Ladepumpe M73, Sole-/Zwischenkreispumpe M16, Wärmequellenpumpe M15, ISC-Pumpen M84 und M17 (-1 bis 100 %)                                           |
|                       | 1110–1118                    | WORD R        | Umschaltventile M61–M99 und Zirkulationspumpe M64 (0/1)                                                                                             |
| Bivalenz              | 1120\*–1123\*                | WORD RW       | Bivalenzpunkte 2. und 3. Wärmeerzeuger (-90 bis 40 °C)                                                                                              |
|                       | 1124                         | UCHAR R       | 0 Aus, 1 Bivalenz 1, 2 Bivalenz 2, 3 beide                                                                                                          |
| Kaskade               | 1147–1152                    | UCHAR R       | Verfügbare und laufende Stufen Heizen/Kühlen/Warmwasser                                                                                             |
|                       | 1200–1210                    | FLOAT R       | Angeforderte und gemittelte Temperaturen                                                                                                            |
|                       | 1220–1225                    | UCHAR RW      | Minimale und maximale Leistung je Betriebsart (%)                                                                                                   |
|                       | 1226–1231                    | WORD RW       | Bivalenzpunkte Kaskade (-90 bis 40 °C)                                                                                                              |
| Heizkreise A–G        | 1350–1391, 1393–1511         | siehe Formeln | Temperaturen, Betriebsart, Sollwerte, Heizkurve, Grenzen (Formeltabelle im Abschnitt Register-Modell)                                               |
|                       | 1392                         | FLOAT R       | Feuchtesensor B31 (0–100 %)                                                                                                                         |
| GLT-Eingänge          | 1650–1662                    | FLOAT W       | Externe Raumtemperatur HK A–G (15–30 °C)                                                                                                            |
|                       | 1690, 1692                   | FLOAT W       | Externe Außentemperatur, externe Feuchte (0–100 %)                                                                                                  |
|                       | 1694\*, 1695\*               | UCHAR RW      | Externe Anforderungstemperatur Heizen (20–65, Standard 40) und Kühlen (10–25, 18)                                                                   |
|                       | 1696, 1698                   | FLOAT W       | GLT-Temperaturanforderung Heizen und Kühlen, alle 10 Minuten schreiben                                                                              |
|                       | 1710–1712                    | BOOL RW       | Anforderung Heizen, Kühlen, Warmwasserladung                                                                                                        |
|                       | 1713                         | BOOL RW       | Einmalige Warmwasserladung; muss mit 0 beendet werden                                                                                               |
|                       | 1714, 1715                   | UCHAR RW      | Pumpenanforderung; Navigator regelt selbst, GLT-Ansteuerung nicht sinnvoll                                                                          |
|                       | 1716–1722                    | FLOAT W       | GLT-Wärmespeicher, -Kältespeicher, -TWE unten, -TWE oben (-1 = ungenutzt)                                                                           |
|                       | 1999                         | UCHAR W       | Störmeldungen quittieren; nicht dauerhaft schreiben                                                                                                 |
| Energie               | 1748–1762 (gerade)           | FLOAT R       | Wärmemenge Heizen, gesamt, Kühlen, Warmwasser, Abtauung, passive Kühlung, Solar, E-Heizeinsatz (kWh)                                                |
|                       | 1790, 1792                   | FLOAT R       | Momentanleistung, Solarleistung (kW)                                                                                                                |
| Solar                 | 1850, 1852, 1854, 1857       | FLOAT R       | Kollektor, Kollektorrücklauf, Ladetemperatur, Referenz/Pool                                                                                         |
|                       | 1856\*                       | UCHAR RW      | 0 Automatik, 1 Warmwasser, 2 Heizung, 3 Warmwasser + Heizung, 4 Wärmequelle/Pool                                                                    |
| ISC                   | 1870, 1872                   | FLOAT R       | Ladetemperatur Kühlen, Rückkühltemperatur                                                                                                           |
|                       | 1874                         | UCHAR R       | 0 keine Abwärme, 1 Heizung, 4 Warmwasser, 8 Wärmequelle                                                                                             |
| Zonenmodule 1–10      | 2000–2649                    | siehe Formeln | je Modul bis zu 8 Räume mit Temperatur, Soll, Feuchte, Betriebsart (0 Aus, 1 Automatik, 2 Eco, 3 Normal, 4 Komfort) und Relais                      |
| Leistung              | 4122                         | FLOAT R       | Elektrische Leistungsaufnahme Wärmepumpe (kW)                                                                                                       |
|                       | 4126, 4128                   | FLOAT R       | Thermische Leistung (Durchflusssensor), Wärmemenge gesamt                                                                                           |

**Fußnoten aus dem PDF:** Wärmemengen Heizen, Kühlen, Warmwasser, Abtauung und E-Heizeinsatz gibt es nur bei Anlagen mit Vortex-Sensor (unter anderem AERO SLM/ALM, TERRA SWM). Ohne Vortex-Sensor ist 1750 eine berechnete Summe, 1790 eine berechnete Leistung. Solarwerte nur mit Durchflusszähler. Passive Kühlung nur bei iPump T.

**EEPROM-Register (Stern):** 1005, 1032–1034, 1120–1123, 1393–1399, 1401–1428, 1429–1441, 1442–1448, 1449–1455, 1457–1483, 1484–1497, 1505–1511, 1694, 1695, 1856.

**Überlappende Adressen im PDF:** 1392 (FLOAT, belegt 1392–1393) und 1393 (UCHAR, Betriebsart HK A); 1441 (FLOAT, 1441–1442) und 1442 (Heizgrenze HK A); 1483 (FLOAT, 1483–1484) und 1484 (Kühlgrenze HK A). Diese Register werden einzeln gelesen, nie in einem Block mit ihrem Nachbarn dekodiert; der Scan klärt, was am Gerät tatsächlich liegt.

**Abweichung zu HASS:** HASS führt 1006 als „Variabler Eingang“ und legt den Smart-Grid-Status auf Register 90. Das PDF nennt 1006 Smart Grid Status. Maßgeblich ist der Scan am Gerät. **Geklärt am Testgerät (10.10.2026):** Register 88, 90 und 4120 gibt es beim Navigator 2.0 nicht (Exception 02); der Smart-Grid-Eingang liegt bei 1006 und liefert dort ohne Beschaltung 0xFFFF. Das Prüfprotokoll steht in [verification-nav20.md](verification-nav20.md).

## Objektbaum und State-Konventionen

Eine Adapter-Instanz entspricht einer Wärmepumpe (`idm-modbus.0`, `idm-modbus.1`, …). States entstehen nur für aktivierte Blöcke und vorhandene Register.

```text
idm-modbus.0
  info.connection, info.lastSuccess, info.family, info.errors
  system.*        Außentemperatur, Meldungsnummer, Betriebsart (RW), Smart Grid
  dhw.*           Speicher, TWE, Zapftemperatur, WW-Sollwerte (RW)
  hp.*            Vorlauf, Rücklauf, Quelle, Verdichter, Pumpen, Ventile, Betriebsart
  hc.A … hc.G     je Heizkreis: Temperaturen, Betriebsart, Sollwerte, Kurve
  zones.1.rooms.1 Temperatur, Soll, Feuchte, Betriebsart, Relais
  energy.*        Wärmemengen, Momentanleistung
  pv.*            Überschuss, Produktion, Hausverbrauch, Batterie, WP-Leistung
  glt.*           Außentemperatur, Feuchte, Anforderungen, externe Fühler
  solar.*, isc.*, cascade.*, bivalence.*
  diag.*          Scan, Schreibzähler, letzter Fehler, Export
```

- **IDs:** snake\_case aus dem Register-`id` der JSON-Datei (Namen wie bei HASS, zum Beispiel `outdoor_temp`, `hc_a_room_temp`), damit Quellen vergleichbar bleiben.
- **Namen:** Heizkreise und Räume tragen den Namen aus der Konfiguration in `common.name`; die ID bleibt technisch (`hc.A`, `zones.1.rooms.3`).
- **Typen und Rollen:** FLOAT → `number` mit Rolle `value.temperature`, `value.humidity`, `value.power`, `value.energy`; schreibbare Sollwerte `level.temperature`; BOOL → `boolean` mit `switch` oder `indicator`; Enums → `number` mit `common.states` in Deutsch und Englisch.
- **Einheiten, min, max:** aus der Register-Datei.
- **Schreiben:** `common.write` ist nur gesetzt, wenn das zugehörige Schreibmodul aktiv ist. Ein Schreibzugriff mit `ack=false` löst den Modbus-Schreibvorgang aus; nach erfolgreichem Rücklesen setzt der Adapter `ack=true`. Scheitert der Vorgang, bleibt der alte Wert stehen und `diag.lastError` wird gesetzt.
- **Nicht verfügbar:** Sentinel- und Plausibilitätsfehler ergeben `val=null` mit einer Qualitätsangabe für ungültig; das Register wird nicht gelöscht.
- **Aufräumen:** Beim Start werden States entfernt, die nach Konfiguration nicht mehr zulässig sind (Option in der Konfiguration, Standard aus).
- **Aufbau im Code:** Konstanten (Intervalle, Grenzwerte, Standardwerte) zentral in `src/lib/constants.ts`, wiederkehrende Muster (State anlegen, Wert dekodieren, Schreibschutz prüfen) in Helper-Funktionen.

## Konfiguration (jsonConfig)

Die Admin-Oberfläche nutzt `jsonConfig` mit Tabs. Alle Texte liegen in Deutsch und Englisch (Englisch ist für ioBroker-Adapter Pflicht). Schreibfunktionen sind standardmäßig aus.

| Tab                      | Felder                                                                                                                                                                                                                                     | Standard                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 1 Verbindung             | Host, Port, Unit-ID, Familie (`nav17`, `nav20`, `nav10`), Float-Wortreihenfolge, Request-Timeout, Pause zwischen Requests, Intervalle `fast`, `medium`, `slow` und Einstellungen (`config`, Standard 3600 s, mindestens 60 s), Test-Button | Port 502, Unit-ID 1, `nav20`, `lowFirst`, Timeout 3000 ms, Pause 100 ms, 30 s / 60 s / 300 s |
| 2 Anlage                 | Heizkreise A–G (Checkbox, Name), Zonenmodule (Anzahl, Räume je Modul, Raumnamen), Blöcke Solar, ISC, Kaskade, Bivalenz, PV, Scan-Button                                                                                                    | alles aus                                                                                    |
| 3 Lesen                  | Registergruppen ein/aus, Aufräumen nicht mehr erlaubter States                                                                                                                                                                             | alle Gruppen der aktiven Blöcke an                                                           |
| 4 Steuern                | Schreibfreigabe je Gruppe (System, Warmwasser, je Heizkreis, Kaskade/Bivalenz als Expertenmodus), EEPROM-Mindestintervall, Tageswarnschwelle                                                                                               | alles aus, Mindestintervall 60 s                                                             |
| 5 Raumsensoren           | Tabelle: Ziel (HK-Raumtemperatur oder Zone/Raum), Quell-State Temperatur, Quell-State Feuchte, Faktor, Offset, Max-Alter, Heartbeat, Toleranz, Bereich, Verhalten bei veralteter Quelle                                                    | Heartbeat 300 s, Toleranz 0,2 °C, Bereich 15–30 °C                                           |
| 6 PV / Energie           | Umfang (nur Überschuss oder alle PV-Werte), Tabelle je Register 74/76/78/82/84/86: Modus, Quell-State, Faktor, Vorzeichen, Min/Max, Intervall, Max-Alter                                                                                   | aus, Intervall 30 s                                                                          |
| 7 GLT-Werte              | Außentemperatur, Feuchte, Anforderungen Heizen/Kühlen/Warmwasser, externe Speicherfühler: je Quell-State und Intervall                                                                                                                     | aus                                                                                          |
| 7a Statistik (Modul G)   | Modul an/aus, externer Stromzähler (State Zählerstand kWh, optional State Leistung), externer Wärmemengenzähler (ebenso), maßgebliche Wärmequelle, Strompreis (fest oder State), CO₂-Faktor, maximales Alter fremder States, Zurücksetzen  | an, ohne externe Zähler, 120 s                                                               |
| 8 KNX / Export (Phase 2) | Basis-Gruppenadresse, Objektgruppen, Export                                                                                                                                                                                                | aus                                                                                          |
| 9 Diagnose               | Log-Stufe, Schreib-Log, Support-Export                                                                                                                                                                                                     | Info                                                                                         |

Die Standardwerte sind Startwerte und werden nach dem Gerätescan angepasst. Validierung: Intervall `fast` mindestens 10 s; Raumtemperatur-Bereich nie außerhalb 15–30 °C (Registergrenze); Blöcke, die der Scan nicht gefunden hat, erscheinen mit Hinweis, nicht gesperrt.

## Modul A: Lesen, Polling und Scan

Das Lesemodul ist immer aktiv und die Grundlage aller anderen Module.

**Polling-Gruppen.** Jedes Register hat ein `poll`-Feld. Zuordnung als Startwert:

| Gruppe   | Intervall                                    | Inhalt                                                                                                                                                          |
| -------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fast`   | 30 s                                         | Außentemperatur, Leistungen (1790, 4122, 4126), WP-Status und Anforderungen (1090–1099), Verdichter, Pumpen, Vorlauftemperaturen, Rücklesen der GLT-Werte 74–86 |
| `medium` | 60 s                                         | Speicher- und Warmwassertemperaturen, Raumtemperaturen HK und Zonen, Soll-Vorlauf, Meldungsnummer 1004, Ventile                                                 |
| `slow`   | 300 s                                        | Energiezähler (1748 ff., 4128), Kaskade, Solar, ISC                                                                                                             |
| `config` | beim Start, nach Schreibzugriff, dann 3600 s | RW-Parameter: Betriebsarten, Sollwerte, Heizkurven, Grenzen, Bivalenz                                                                                           |

**Ablauf eines Zyklus:**

1. Fällige Register je Gruppe sammeln und nach Function Code sortieren.
2. Exakt benachbarte, nicht überlappende Register zu Blöcken bündeln, höchstens 40 Wörter je Request (Vorgehen wie HASS). Auch direkte Nachbarn aus anderen Pollgruppen kommen in denselben Block (kostet keinen eigenen Request, der State bekommt nur einen frischeren Wert); ein Request entsteht nur, wenn mindestens ein fälliges Register darin liegt. Lücken aus unbekannten Adressen werden nie überbrückt (Exception 02 würde den ganzen Block scheitern lassen). Pro Block gilt ein Function Code: der, den das Testgerät für alle Register des Blocks beantwortet hat (`deviceFc`, beim Navigator 2.0 FC03 und FC04), sonst der dokumentierte (RO via FC04, RW via FC03). Schlägt ein Block mit Exception fehl, werden seine Register einzeln mit dem dokumentierten Function Code gelesen. Messung am Testgerät (ein Heizkreis, Zonenmodul 1 mit 8 Räumen): Gruppe `medium` 37 auf 13 Requests je Zyklus, `config` 32 auf 18. Die überlappenden Register 1392, 1441, 1483 werden einzeln gelesen.
3. Requests nacheinander über **eine** TCP-Verbindung senden, mit konfigurierbarer Pause dazwischen.
4. Jeden Block anhand von Offsets in die Registerwerte zerlegen, FLOAT mit der konfigurierten Wortreihenfolge dekodieren.
5. Plausibilität prüfen: Sentinel oder Wert außerhalb von min/max → State `null` mit Qualitätsangabe, Zähler `diag.invalid.<id>` erhöhen.
6. State nur bei Änderung setzen (FLOAT mit Totband 0,01), mindestens alle 10 Zyklen zur Auffrischung des Zeitstempels.

**Fehlerverhalten:** Modbus-Exception 02 (ungültige Adresse) bei einem Register: nach 3 Wiederholungen als `absent` markieren und bis zum nächsten Scan nicht mehr abfragen. Timeout: Verbindung schließen, neu aufbauen, Wartezeit 5 s, dann verdoppelnd bis 60 s. `info.connection` spiegelt den Zustand.

**Scan (`sendTo` Befehl `scan`).** Der Scan liest alle Register der gewählten Familie einzeln (ohne Bündelung) und protokolliert pro Register: Adresse, Function Code, Rohwörter, dekodierten Wert, Exception-Code, Antwortzeit. Ergebnis:

- `diag.scan` als JSON und Datei `scan-<datum>.json` im Datenverzeichnis des Adapters, außerdem CSV.
- Ein Register gilt als vorhanden, wenn es ohne Exception und nicht mit Sentinel antwortet.
- Die Admin-Oberfläche schlägt daraus Heizkreise, Zonen und Blöcke vor; der Nutzer bestätigt.
- Dieselbe Datei dient als Test-Fixture (Abschnitt Tests).

Der Scan sendet nur Leseanfragen und ist deshalb gefahrlos. Er läuft gedrosselt (Pause aus der Konfiguration, mindestens 100 ms), weil der Navigator bei hartem Polling stockt.

## Modul B: Steuern und EEPROM-Schutz

Schreibbare Parameter (Zugriff RW) werden nur angelegt und beschreibbar, wenn die Schreibfreigabe der Gruppe aktiv ist. Das Modul schreibt nur auf Nutzeraktion, nie zyklisch.

| Gruppe                             | Register                                                                                                           | Hinweise                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| System                             | 1005\*                                                                                                             | Enum 0, 1, 2, 4, 5 (siehe Registerübersicht)                                                                                      |
| Warmwasser                         | 1032\*, 1033\*, 1034\*                                                                                             | Bereiche aus dem PDF; Ausschalttemperatur muss über der Einschalttemperatur liegen (Prüfung im Adapter, nicht aus dem PDF belegt) |
| Heizkreis A–G                      | Betriebsart 1393\*–1399\*, Raumsollwerte, Heizkurve, Heizgrenze, Festwert-Vorlauf, Kühlwerte, Parallelverschiebung | Betriebsart: 0 Aus, 1 Zeitprogramm, 2 Normal, 3 Eco, 4 Manuell Heizen, 5 Manuell Kühlen                                           |
| Kaskade / Bivalenz (Expertenmodus) | 1120\*–1123\*, 1220–1231                                                                                           | Fehleingaben beeinflussen die Anlagenauslegung                                                                                    |
| Solar                              | 1856\*                                                                                                             | Enum 0–4                                                                                                                          |
| Quittieren                         | 1999                                                                                                               | Button-State, schreibt einmalig 1; nie zyklisch (sonst werden Störmeldungen nicht mehr angezeigt)                                 |

**Schreibpfad:**

1. State-Änderung mit `ack=false` → Wert gegen min/max und Typ der Register-Datei prüfen, ungültig ablehnen.
2. Bei EEPROM-Registern aktuellen Wert frisch lesen; bei Gleichheit nicht schreiben.
3. Entprellen: Es zählt nur der letzte Wert innerhalb von 1 s (Vorgehen wie die HASS-KNX-Bridge).
4. Mindestintervall je EEPROM-Register, Standard 60 s (HASS-Standard). Liegt ein neuer Wert früher an, bleibt der neueste Wert in der Warteschlange und wird nach Ablauf geschrieben.
5. Schreiben per FC16 (ein Register für UCHAR, BOOL, INT16; zwei für FLOAT in der konfigurierten Wortreihenfolge).
6. Nach 1 s zurücklesen; bei Übereinstimmung `ack=true`, sonst Fehler im Log.

**Schutzmaßnahmen:**

- Laut PDF vertragen die mit Stern markierten Register höchstens 300.000 Schreibzyklen. Der Adapter führt je EEPROM-Register einen dauerhaften Zähler (`diag.writes.<id>`).
- Warnung im Log, wenn dasselbe Register innerhalb von 5 s mehrfach geschrieben wird (wie HASS) und bei Überschreiten einer Tageswarnschwelle (eigene Ergänzung, Vorschlag 24 Schreibvorgänge je Register und Tag).
- Schreibfehler setzen `diag.lastError`; nach 3 Fehlern in Folge wird das Register 10 Minuten gesperrt.
- Nur ein Schreiber je Register: Automatisierungen, die dasselbe Register parallel beschreiben, sind Sache des Nutzers; der Adapter warnt nur bei auffälligem Rücklesen.
- Die einmalige Warmwasserladung (1713) und die Warmwasseranforderung (1712) werden im Modul E behandelt.

## Modul C: Raumsensoren

Das Modul schreibt Raumtemperatur und Raumfeuchte aus beliebigen ioBroker-States (zum Beispiel KNX-Sensoren) zyklisch an den Navigator. Es gibt zwei Ziele.

**Ziel 1: Heizkreis-Raumtemperatur (ohne Navigator Pro).**

- Register 1650 + 2i (HK A–G), FLOAT, 15 bis 30 °C.
- Voraussetzung am Navigator: Einstellungen → Heizkreis → Raumtemperaturerfassung = „GLT Raumsensor“.
- Die Feuchte ist global (Register 1692, ein Wert für die Anlage) und wird in Modul E konfiguriert, nicht je Heizkreis.

**Ziel 2: Navigator Pro, Einzelraumregelung (Zonenmodule).**

- Temperatur (RW), Raumsoll (RW), Feuchte (UCHAR, RW) und Betriebsart (RW) je Raum nach den Formeln im Register-Modell.
- Voraussetzung am Navigator: Raum als „Raum mit Modbus TCP hinzufügen“ anlegen; die Reihenfolge der Anlage bestimmt die Raumnummer, die Relaiszuordnung gehört zum Raum, nicht zum Relais.
- Die Raumfeuchte ist für den Kühlbetrieb zwingend.
- Räume mit IDM-Sensoren sind für Temperatur und Feuchte nur lesbar (RO); der Adapter schreibt dort nie. In der Konfiguration wählt der Nutzer je Raum „IDM-Sensor (nur lesen)“ oder „extern (schreiben)“.

**Konfigurationstabelle** (eine Zeile je Ziel):

| Feld                  | Bedeutung                                             | Standard             |
| --------------------- | ----------------------------------------------------- | -------------------- |
| Ziel                  | HK A–G oder Zone/Raum                                 |                      |
| Quelle Temperatur     | State-ID                                              |                      |
| Quelle Feuchte        | State-ID, optional (nur Zonen)                        |                      |
| Faktor, Offset        | Umrechnung auf °C und %                               | 1, 0                 |
| Heartbeat             | Schreibintervall auch ohne Änderung                   | 300 s (HASS-Wert)    |
| Toleranz              | Änderung, ab der sofort geschrieben wird              | 0,2 °C (HASS-Wert)   |
| Bereich               | Werte außerhalb werden nicht geschrieben              | 15–30 °C, 0–100 %    |
| Max-Alter             | Ab welchem Alter eine Quelle als veraltet gilt        | 15 min (Vorschlag)   |
| Bei veralteter Quelle | Schreiben einstellen oder festen Ersatzwert schreiben | Schreiben einstellen |

**Regeln:**

- Temperatur auf 0,1 °C runden, Feuchte auf ganze Prozent.
- Raumsollwerte (RW) werden nur bei Änderung geschrieben, nie zyklisch; laut PDF-FAQ führt dauerndes Schreiben der Solltemperatur zum Neustart des Zonenmoduls. Sollwerte nur in 0,5-Schritten, und die Raumbetriebsart muss dafür auf Normal stehen.
- Temperatur und Feuchte müssen dagegen zyklisch ankommen (Heartbeat).
- Der Adapter legt Rücklese-States (`rooms.*.temp_readback`) an und vergleicht sie mit dem zuletzt geschriebenen Wert; Abweichungen deuten auf einen zweiten Schreiber hin.
- Das Verhalten des Navigators bei ausbleibenden Werten ist nicht dokumentiert und wird am Testgerät geprüft (Abschnitt Tests). Der „GLT Monitor“ im Navigator zeigt den letzten geschriebenen Wert oder einen Fehler an und wird nach einer Stunde zurückgesetzt.

## Modul D: PV- und Energiedaten

Das Modul ersetzt einen externen Energiemanager (zum Beispiel Smartfox oder E3DC) und schreibt PV-Werte aus ioBroker-States zyklisch an die Wärmepumpe. Laut IDM startet die Wärmepumpe, sobald der PV-Überschuss (74) höher ist als ihre Leistungsaufnahme (4122), und bewirtschaftet dann das System nach den Einstellungen im PV-Menü des Navigators. Dieses Menü muss am Gerät eingerichtet sein.

| Register | Wert                     | Typ                         | Hinweis                                         |
| -------- | ------------------------ | --------------------------- | ----------------------------------------------- |
| 74       | PV-Überschuss (kW)       | FLOAT, Holding Register     | Pflichtwert                                     |
| 76       | Leistung E-Heizstab (kW) | FLOAT                       | optional                                        |
| 78       | PV-Produktion (kW)       | FLOAT                       | optional                                        |
| 82       | Hausverbrauch (kW)       | FLOAT                       | optional                                        |
| 84       | Batterieentladung (kW)   | FLOAT                       | optional; Vorzeichen beim Laden ungeklärt       |
| 86       | Batteriefüllstand (%)    | INT16, -1 = nicht verfügbar | optional; ohne Batterie nicht schreiben         |
| 88       | PV-Zielwert (kW)         | FLOAT                       | nur `nav10`, modell-/firmwareabhängig laut HASS |

Lesend: 4122 (elektrische Leistungsaufnahme der Wärmepumpe, kW), 4126 (thermische Leistung), 4128 (Wärmemenge gesamt). Der Navigator zeigt an, ob nur der Überschuss oder alle PV-Werte kommuniziert werden; die Konfiguration kennt dieselben zwei Umfänge.

**Quellmodi für den Überschuss (74):**

1. **Direkt:** ein State, der den Überschuss bereits liefert.
2. **Berechnet:** PV-Produktion minus Hausverbrauch, optional minus Batterieladeleistung.
3. **Aus Netzleistung:** Einspeisung (negativer Netzbezug) als Überschuss, mit Vorzeichen-Umkehr.

Die anderen Register nutzen je einen Quell-State.

**Je Zeile konfigurierbar:** Quell-State, Faktor (zum Beispiel 0,001 von W nach kW), Vorzeichen umkehren, Min/Max-Begrenzung (Vorschlag für 74: nicht unter 0), Intervall (Standard 30 s, minimal 10 s), Max-Alter der Quelle.

**Regeln:**

- Jeder Wert wird in jedem Intervall geschrieben, auch ohne Änderung, damit der Navigator ihn aktuell hält. Die Parameteraktualisierung im Navigator läuft zyklisch und wirkt nach etwa 15 s.
- Ist eine Quelle älter als das Max-Alter (Vorschlag 120 s), schreibt der Adapter für 74 den Wert 0 statt des letzten Werts, damit die Wärmepumpe nicht mit altem Überschuss weiterläuft. Das ist eine Empfehlung der Spec, nicht im IDM-Dokument belegt.
- Rücklesen von 74–86 und Vergleich mit dem zuletzt geschriebenen Wert: weicht er wiederholt ab, setzt der Adapter `pv.writerConflict` und warnt, weil ein weiterer Energiemanager dasselbe Register beschreibt (Warnung wie in der HASS-Doku).
- Skalierung und Vorzeichen sind Nutzerkonfiguration, nicht Teil des Adapters; Standardwerte gibt es bewusst nicht.

## Modul E: weitere GLT-Werte

Jede Funktion ist einzeln aktivierbar und hat Quell-State, Faktor und Intervall.

| Funktion                                  | Register                                 | Schreibart                                             | Voraussetzung am Navigator                                                                      |
| ----------------------------------------- | ---------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Externe Außentemperatur                   | 1690 (FLOAT)                             | zyklisch, Heartbeat 60 s (Vorschlag)                   | „GLT Außentemperatur“ = Ja                                                                      |
| Externe Feuchte                           | 1692 (FLOAT, 0–100 %)                    | zyklisch, Heartbeat 60 s (Vorschlag)                   | „GLT Feuchtewert“ = Ja                                                                          |
| Anforderungstemperatur Heizen / Kühlen    | 1694\*, 1695\* (UCHAR, 20–65 / 10–25 °C) | nur bei Änderung (EEPROM)                              | Pufferbewirtschaftung ohne Heiz-/Kühlregelung                                                   |
| GLT-Temperaturanforderung Heizen / Kühlen | 1696, 1698 (FLOAT)                       | zyklisch alle 10 Minuten (Pflicht)                     |                                                                                                 |
| Anforderung Heizen / Kühlen               | 1710, 1711 (BOOL)                        | zyklisch, damit sie nach einem Neustart wieder anliegt | Passive Kühlung wie aktive über 1711; läuft gleichzeitig Heizen, Heizanforderung über 1710      |
| Warmwasseranforderung                     | 1712 (BOOL)                              | zyklisch; Ende nur durch Schreiben von 0               | startet die Warmwasserladung unabhängig von der Speichertemperatur                              |
| Einmalige Warmwasserladung                | 1713 (BOOL)                              | Button; muss mit 0 beendet werden                      | Verhalten am Gerät prüfen                                                                       |
| Externe Speicherfühler                    | 1716, 1718, 1720, 1722 (FLOAT)           | zyklisch                                               | GLT-Messwerte für Wärmespeicher, Kältespeicher, Trinkwarmwasser unten und oben; Standardwert -1 |
| Pumpenanforderung                         | 1714, 1715 (UCHAR)                       | nur `nav10`, Expertenmodus                             | PDF: Ansteuerung durch die GLT nicht sinnvoll, der Navigator regelt selbst                      |

Besonderheiten:

- 1696 und 1698 ändern den Parameter PM003 nicht und müssen laut PDF-Fußnote zyklisch alle 10 Minuten geändert werden; was bei ausbleibendem Schreiben passiert, steht dort nicht und ist am Gerät zu prüfen.
- Beim Deaktivieren der Funktion oder beim Adapter-Stopp schreibt der Adapter einmalig 0 in 1710, 1711 und 1712, damit keine Anforderung hängen bleibt (Vorschlag der Spec, konfigurierbar, Standard an).
- -1 ist im PDF der Standardwert der Register 1716–1722. Bei veralteter Quelle schreibt der Adapter -1 (Vorschlag der Spec, am Gerät zu prüfen).
- Die Anforderungen 1710 und 1711 gehören zum Anwendungsfall Pufferbewirtschaftung. Mit Heiz-/Kühlregelung durch den Navigator werden sie nicht gebraucht.

## Modul G: Abgeleitete Werte und Statistik

Rein lesend und lokal: das Modul rechnet aus gelesenen Werten (und optional aus fremden States) weitere Größen aus und schreibt nichts an die Wärmepumpe. Ideen und Schutzregeln (kein COP im Stillstand, keine Überbrückung langer Lücken) orientieren sich an der Arbeit von Xerolux (idm-heatpump-hass, MIT); Umsetzung und Formeln sind eigenständig. Alle Zustände liegen unter `calc.*` (Momentanwerte) und `stats.*` (Statistik).

**Quellen.** Wärme (thermisch) und Strom (elektrisch) können aus mehreren Quellen kommen; berechnet wird jede sinnvolle Kombination.

| Größe         | Quelle                                | Register / State                                                                          | Bemerkung                                                                                                                                               |
| ------------- | ------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wärmemenge    | Navigator-Zähler (Standard)           | 1748 Heizen, 1754 Warmwasser, 1752 Kühlen, 1756 Abtauung, 1762 E-Heizeinsatz, 1750 Gesamt | kumulierte kWh, nur mit Vortex-Sensor. Am Testgerät gilt 1750 = 1748 + 1752 + 1754 + 1756 (90 670,29 kWh). Zähler überstehen Pausen des Adapters.       |
| Wärmemenge    | Externer Wärmemengenzähler (optional) | State mit kWh-Zähler, optional State mit Leistung                                         | seltener, aber genauer als der Navigator-Zähler, wenn vorhanden                                                                                         |
| Wärmeleistung | Navigator                             | 4126 (und 1790)                                                                           | aus Durchfluss und Spreizung berechnet; bei Abtauung und Betriebswechsel gibt es Ausreißer (Xerolux: bis -48 kW), deshalb nur positive, plausible Werte |
| Strom         | Navigator intern                      | 4122, Momentanleistung in kW                                                              | Energie nur durch Integration; kein Zähler im Navigator                                                                                                 |
| Strom         | Externer Stromzähler (optional)       | State mit kWh-Zähler, optional State mit Leistung (W oder kW, Einheit aus dem State)      | misst real, enthält je nach Einbau auch Pumpen und Heizstab; deshalb zweiter COP, nicht Ersatz                                                          |

**Momentanwerte (`calc.*`).** Temperaturdifferenzen: Vorlauf minus Rücklauf der Wärmepumpe (B33 minus B34), Wärmequelle Ein minus Aus (B43 minus B36), Warmwasser oben minus Sollwert, je Heizkreis Vorlauf minus Soll-Vorlauf (nicht, solange der Heizkreis nichts anfordert, Soll = 0) und Raum minus Vorlauf. Momentan-COP je Stromquelle: Wärmeleistung durch elektrische Leistung; kein Wert, wenn eine der Größen fehlt, ungültig oder nicht positiv ist, bei elektrischer Leistung unter 50 W (Stillstand) oder bei einem Verhältnis über 15 (Messartefakt). Geschätzte Werte werden nie als Messwert ausgegeben.

**Energie und Arbeitszahlen (`stats.*`).**

- **Thermisch:** aus den Zählern (Differenz zwischen zwei Abfragen), je Betriebsart Heizen, Warmwasser, Kühlen, Abtauung. Hat der Nutzer einen externen Wärmemengenzähler, wählt er in der Konfiguration, welche Quelle maßgeblich ist; die andere wird zum Vergleich weitergeführt.
- **Elektrisch intern:** trapezförmige Integration von 4122 zwischen zwei gültigen Abfragen. Ein Abstand über max(180 s, 3 × Pollintervall) wird nicht überbrückt (Verbindung weg, Adapter gestoppt).
- **Elektrisch extern:** Differenz des Zählerstands zwischen zwei Abfragen; unempfindlich gegen Pausen des Adapters. Zählerrücksprung (Austausch, Überlauf) oder ein Sprung über der physikalisch möglichen Größe wird als Unstetigkeit verworfen und einmal geloggt.
- **Zuordnung nach Betriebsart:** der Stromverbrauch eines Intervalls wird der Betriebsart (Register 1090: Heizen, Warmwasser, Kühlen, Abtauung, Aus) zugeordnet, die am Ende des Intervalls galt. Daraus ergeben sich getrennte Arbeitszahlen für Heizen und Warmwasser.
- **Perioden:** Tag, Monat, Jahr (Kalender) und gesamt, in der Zeitzone des Systems; dazu eine gleitende Jahresarbeitszahl (JAZ) über 365 Tage aus gespeicherten Tagessummen.
- **Arbeitszahl** = Wärme für Heizen und Warmwasser (1748 + 1754) durch Strom derselben Periode, einmal je Stromquelle (`stats.cop.internal.*`, `stats.cop.external.*`; Abtauung und Kühlen laufen nicht in die JAZ ein und werden getrennt ausgewiesen). Ohne ausreichende Energie in der Periode (unter 0,1 kWh Strom) kein Wert.
- **Kosten und CO₂:** aus dem Strom (extern, wenn vorhanden, sonst intern) mit festem Preis oder einem Preis-State und einem CO₂-Faktor in g/kWh. Der Anteil PV-Eigenverbrauch folgt, sobald die PV-Quellen (Modul D) vorliegen.
- **Laufzeit und Takten:** je Verdichter (1100 bis 1103) Betriebsstunden und Starts (heute, gesamt), mittlere Laufzeit und Zahl der Läufe unter 10 Minuten als Takt-Hinweis.

**Persistenz.** Zähler, Tagessummen (400 Tage), letzte Stände und Perioden stehen als JSON im State `stats.data` und werden jede Minute sowie beim Beenden gespeichert und beim Start wiederhergestellt. Ein Neustart verliert höchstens die letzte Minute der Integration.

**Konfiguration (Tab 7a Statistik).** Modul an oder aus (Standard an); externer Stromzähler: State für den Zählerstand (kWh), optional State für die Leistung; externer Wärmemengenzähler: ebenso; maßgebliche Wärmequelle (Navigator oder extern); Strompreis (fest, in €/kWh, oder Preis-State); CO₂-Faktor (g/kWh); maximales Alter eines fremden States (Standard 120 s, älter gilt als nicht verfügbar); Statistik zurücksetzen (mit Bestätigung). Fehlerhafte Quellen deaktivieren nur die betroffene Auswertung, der Adapter läuft weiter.

**Tests.** Integrator mit und ohne Lücken; Zählerdifferenz mit Rücksprung und Sprung; Perioden- und Jahreswechsel; JAZ über Tagessummen; Zuordnung zur Betriebsart; alle Schutzregeln (Stillstand, Ausreißer, Division durch null); Persistenz-Rundlauf; jeweils mit den Werten des Scan-Fixtures. **Verifikation am Testgerät (nur lesen):** V12 Navigator-Wärmemenge gegen integrierte Wärmeleistung 4126 über mehrere Stunden; V13 interner gegen externen Stromverbrauch über mehrere Stunden (Verhältnis und Ursache der Abweichung); V14 Plausibilität der Arbeitszahlen gegen die Anzeige des Navigators, falls dieser eine liefert.

## Modul F: KNX-Anbindung und ETS-Export (Phase 2)

Der Adapter bekommt keinen eigenen KNX-Stack. Er liefert saubere States und eine Zuordnungstabelle; die Verbindung zum Bus übernimmt `ioBroker.openknx`. Ob openknx sich per Import oder programmatisch befüllen lässt, ist in Phase 2 zuerst zu prüfen.

**Vorbild: KNX-Bridge der HASS-Integration** ([Doku](https://xerolux.github.io/idm-heatpump-hass/docs/knx-bridge/), von den Autoren als experimentell bezeichnet, auf dem Bus nicht mit echten Telegrammen verifiziert). Übernommen werden die Konzepte, nicht der Code:

- IDM verkauft die KNX-Anbindung als Weinzierl KNX IP BAOS 774 mit einem ETS-Beispielprojekt. Dessen 654 Kommunikationsobjekte haben feste Objektnummern, Datapoint-Typen und Richtungen; HASS bildet sie auf die Modbus-Register ab.
- Gruppenadresse = Basisadresse + IDM-Objektnummer, damit der gesamte Katalog in eine Hauptgruppe passt.
- Nur lesbare Objekte werden gesendet; schreibbare Objekte nehmen auch Befehle vom Bus an.
- Entprellung von 1 s beim Schreiben, Echo-Schutz gegen Schleifen, Antwort auf Lese-Anfragen (GroupValueRead).
- Objektgruppen (system, dhw, heating\_circuits, zones, glt, energy, solar, isc, cascade, pv) und Overrides für abweichende Adressen.

| Wert                                | Datapoint-Typ (nach HASS)       |
| ----------------------------------- | ------------------------------- |
| Temperaturen                        | 9.001                           |
| Feuchte                             | 9.007                           |
| Leistung (kW)                       | 9.024                           |
| Wärmemengen (kWh)                   | 14.031                          |
| Prozent                             | 5.001                           |
| Modi, Zustände, Zähler              | 7.001 (Systembetriebsart 5.010) |
| Bivalenzpunkte (vorzeichenbehaftet) | 8.001                           |
| Anforderungen                       | 1 Bit                           |

**Umfang Phase 2:**

1. Zuordnungstabelle `knx-map.json`: Register-ID, IDM-Objektnummer, DPT, Richtung, Objektgruppe. Quelle: die CSV-Dateien im HASS-Repo (`docs/examples/knx/`, MIT); Zuordnung gegen das IDM-ETS-Beispielprojekt prüfen.
2. Export als ETS-Import (XML, Dreiebenen-Adressen) für eine einstellbare Basisadresse und Objektgruppen, plus CSV als Lesehilfe.
3. Optional: Generieren der openknx-Konfiguration, falls dort ein Import oder eine Schnittstelle existiert.
4. Bus-Last: erste Übertragung gedrosselt (HASS: etwa 20 Telegramme pro Sekunde), erneutes Senden erst bei Änderung über einer Toleranz.

Die Objekte 384 und 385 (Sole-/Zwischenkreispumpe, Grundwasserpumpe) lässt HASS bewusst aus, weil die IDM-Bezeichnungen nicht eindeutig auf die Register passen; die Spec übernimmt diese Entscheidung.

## Fehlerbehandlung, Logging und Diagnose

| Situation                                             | Verhalten                                                                                                                                                                        |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verbindung verloren oder Timeout                      | Verbindung schließen, neu aufbauen, Wartezeit 5 s verdoppelnd bis 60 s; `info.connection=false`; keine Schreibzugriffe in der Warteschlange abarbeiten, bis die Verbindung steht |
| Modbus-Exception 02 (Adresse ungültig)                | Register nach 3 Versuchen als `absent` markieren, einmal im Log melden                                                                                                           |
| Wert ungültig (Sentinel, außerhalb min/max)           | State `null` mit Qualitätsangabe, Zähler `diag.invalid.<id>`, höchstens eine Logzeile pro Register und Stunde                                                                    |
| Schreibfehler                                         | `diag.lastError`, ack nicht setzen, nach 3 Fehlern in Folge Register 10 Minuten sperren                                                                                          |
| Konfigurationsfehler (Quelle fehlt, Bereich ungültig) | Eintrag deaktivieren, Fehler im Admin-Log, Adapter läuft weiter                                                                                                                  |
| Navigator-Meldung                                     | Nummer (1004) als State; Klartext in Step 9, Textliste aus der Navigator-Bedienungsanleitung (HASS liefert bereits Texte, Quelle und Lizenz prüfen)                              |
| Summenstörung (1099)                                  | eigener boolescher State, in `info` sichtbar                                                                                                                                     |

**Logging:** Stufe Info zeigt Start, Verbindung, Scan-Ergebnis und Schreibzugriffe auf EEPROM-Register; Debug zeigt jede Anfrage mit Adresse, Function Code und Antwortzeit. IP-Adressen und Zugangsdaten gehören nie in Logs oder Exporte.

**Diagnose-States:** `diag.requestsPerMinute`, `diag.avgResponseMs`, `diag.writes.<id>` (EEPROM-Zähler), `diag.invalid.<id>`, `diag.lastError`, `diag.scan`.

**Support-Export (`sendTo` `exportDiagnostics`):** JSON mit Adapter-Version, Familie, aktiven Blöcken, Scan-Ergebnis und Fehlerzählern, ohne Host. Gedacht für Rückmeldungen von Nutzern anderer Navigator-Generationen; das schließt die Lücke bei `nav10` und `nav17`.

**Hilfe am Gerät:** Der „GLT Monitor“ im Navigator (Menü Gebäudeleittechnik) zeigt Kommunikation und zuletzt geschriebene Werte an und wird nach einer Stunde zurückgesetzt. Die README verweist darauf für die Fehlersuche. Typische Ursachen laut PDF-FAQ: Modbus TCP am Gerät nicht aktiviert, anderes Netz, IP-Konflikt, DHCP-Adresse geändert, Switch blockiert.

## Tests und Hardware-Verifikation

**Automatisierte Tests (ohne Gerät):**

- Dekodierer und Kodierer: FLOAT in beiden Wortreihenfolgen, UCHAR, BOOL, INT16 mit negativen Werten, Sentinel -1.
- Adressformeln gegen die Prüfwerte aus dem Register-Modell (2016, 2067, 2057, 1662, 1399).
- Generator: jede Adresse des PDFs kommt in `nav20.json` vor; die drei überlappenden Adressen sind markiert; keine unbeabsichtigten Überlappungen sonst.
- Batching: nur benachbarte, nicht überlappende Register, höchstens 40 Wörter.
- Schreibpfad: Entprellung, Mindestintervall, Gleichheitsprüfung, Warteschlange mit neuestem Wert.
- Quellmodi und Skalierung der Module C, D, E mit simulierten States.
- Mock-Modbus-Server, der die Scan-Datei des Testgeräts als Fixture abspielt (Antworten, Exceptions, Verzögerungen).

**Verifikation am Testgerät (IDM SLM 3-11 HGL, Navigator 2.0):** Erst lesen, dann gezielt schreiben. Jede bestätigte Zeile setzt `verified: device` in `nav20.json`.

| Nr. | Prüfung                                                                                                | Erwartung                                                  | Risiko        |
| --- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ------------- |
| V1  | Außentemperatur (1000) mit Display vergleichen, beide Wortreihenfolgen dekodieren                      | Eine Reihenfolge ergibt den Displaywert                    | keins (lesen) |
| V2  | Adressversatz: Register 1000 gegen 999 und 1001 lesen                                                  | 1000 liefert Außentemperatur                               | keins         |
| V3  | Überlappende Adressen 1392/1393, 1441/1442, 1483/1484 einzeln lesen                                    | Werte plausibel, Betriebsart HK A als 0–5                  | keins         |
| V4  | FC03 gegen FC04 je Register                                                                            | Matrix, welcher Function Code antwortet                    | keins         |
| V5  | Sentinels: Pumpenstatus ohne Pumpe, Räume ohne Sensor, nicht vorhandene Blöcke                         | -1 oder Exception 02, dokumentiert                         | keins         |
| V6  | 1006 gegen Smart-Grid-Status und variablen Eingang vergleichen (HASS meint Register 90 für Smart Grid) | Bedeutung von 1006 am Gerät klar                           | keins         |
| V7  | Vortex-Werte (1748 ff., 1790) vorhanden und plausibel                                                  | Wärmemengen steigen, Leistung passt zur Anzeige            | keins         |
| V8  | Schreibtest ohne EEPROM: 1690 oder 74 mit Testwert, im GLT Monitor des Navigators prüfen               | Wert erscheint, Antwortzeit gemessen                       | gering        |
| V9  | Verhalten bei ausbleibendem Heartbeat (Raumtemperatur, PV) beobachten                                  | Verfallszeit und Rückfallverhalten notiert                 | gering        |
| V10 | Pollingtest: Last steigern, Antwortzeiten messen                                                       | Pause und Intervall festgelegt, Navigator bleibt bedienbar | gering        |
| V11 | EEPROM-Schreibtest mit einem Wert, den man zurücksetzen kann (zum Beispiel WW-Solltemperatur ±1 °C)    | Wert wirkt, Rücklesen ok, Zähler zählt                     | EEPROM-Zyklus |

Bei Abweichungen entscheidet der Scan; die Spec und die Registerdatei werden danach angepasst, nicht umgekehrt. Claude Code führt Schreibtests am echten Gerät nur nach ausdrücklicher Freigabe aus.

## Phasenplan für Claude Code

Die Umsetzung läuft in Steps, die jeweils für sich lauffähig und testbar sind. Jeder Step endet mit einem Commit und erfüllt seine Akzeptanzkriterien, bevor der nächste beginnt.

**Arbeitsregeln für Claude Code:** siehe [CLAUDE.md](../CLAUDE.md) im Repo-Root (dort um die Erfahrungen aus den Adaptern openwb2 und victoriametrics ergänzt).

**Steps:**

1. **Projekt-Setup.** Repo mit `@iobroker/create-adapter` (TypeScript, jsonConfig, Tests, Release-Workflow), Name `iobroker.idm-modbus`, `CLAUDE.md`, diese Spec als `docs/SPEC.md`. _Akzeptanz:_ Adapter startet leer in ioBroker, `npm test` läuft, Lint grün.
2. **Registerdateien.** _(nav20 erledigt 10.10.2026: `tools/build-registers.ts`, `tools/sources/nav20.*.json`, `src/lib/registers/nav20.json`, Bericht `docs/register-deviations-nav20.md`.)_ Generator `tools/build-registers.ts` erzeugt `src/lib/registers/nav20.json` aus einer transkribierten Quelldatei des PDFs und den Adressformeln; Abgleich mit dem HASS-Katalog als Bericht (Unterschiede, fehlende Einträge). _Akzeptanz:_ jede PDF-Adresse vorhanden, Prüfwerte der Adressformeln stimmen, überlappende Adressen markiert, Abweichungsbericht liegt vor.
3. **Modbus-Schicht.** _(erledigt 10.10.2026, siehe O11: Wrapper um `modbus-connect` in `src/lib/modbus/`.)_ Kurzer Spike zur Wahl der Bibliothek (Kriterien: FC03/04/06/16, Timeout, Reconnect, Zugriff auf Rohregister), danach Verbindung, serielle Warteschlange mit Pause, Dekodierer/Kodierer, Batching. Mock-Server für Tests. _Akzeptanz:_ Tests für Dekodierung, Batching, Fehlerpfade; Reconnect gegen den Mock bewiesen.
4. **Lese-Adapter (v0.1).** _(umgesetzt 10.10.2026; am Testgerät nur lesend geprüft: 87 Register eines Heizkreises mit Bivalenz und PV, keines fehlend, stabile Verbindung über 75 s. Offen für den Nutzer: prüfen, dass der Navigator während des Pollings bedienbar bleibt.)_ Tabs Verbindung und Anlage, Polling-Gruppen, Objektbaum für `nav20`, `info.connection`, Fehlerbehandlung. _Akzeptanz:_ läuft gegen das Testgerät, alle aktivierten Register erscheinen, Antwortzeiten stabil, Navigator bleibt bedienbar.
5. **Scan und Verifikation.** _(umgesetzt 10.10.2026, nur lesend: `sendTo scan`, `npm run scan:device`, Fixture `test/fixtures/scan-nav20.json`, `verified: device` für 191 Register, Prüfprotokoll V1–V7 und V10 in [verification-nav20.md](verification-nav20.md). Offen: Display-Vergleich V1/V10 durch den Nutzer, V8/V9/V11 brauchen Schreibzugriffe.)_ `sendTo scan`, Datei und CSV, Admin-Vorschläge; Prüfungen V1–V7 am Testgerät; Scan als Fixture ins Repo (ohne IP); `verified: device` setzen, Register-Datei nachziehen. _Akzeptanz:_ Prüfprotokoll V1–V7 ausgefüllt, offene Punkte der Spec aktualisiert.
   5b. **Abgeleitete Werte und Statistik (Modul G, nur lesend).** _(umgesetzt 10.10.2026: `src/lib/stats/`, Tab Statistik, Tests und Integrationstest mit externem Zähler; V12 und V13 siehe docs/verification-nav20.md.)_ Momentanwerte, Energie je Betriebsart aus Navigator-Zählern, interne und externe Stromquelle, Arbeitszahlen für Tag, Monat, Jahr, gleitende JAZ, Kosten, CO₂, Laufzeit und Takten, Persistenz. _Akzeptanz:_ Tests nach Abschnitt Modul G, V12 bis V13 am Testgerät lesend, Konfiguration in 11 Sprachen, Texte nur über das Wörterbuch. Steht vor Step 6, weil er keine Schreibfreigabe braucht.
6. **Steuern (v0.2).** _(Software umgesetzt 10.10.2026, getestet nur gegen den Mock-Server: `src/lib/control/`, Tab Steuern, Integrationstest. Schreibtests am echten Gerät (V8, V11) stehen aus und brauchen die ausdrückliche Freigabe des Nutzers je Register.)_ Modul B mit allen Schutzmechanismen und Zählern. _Akzeptanz:_ Tests des Schreibpfads; nach Freigabe V8 und V11 am Gerät.
   7a. **Zonenraum-Steuerung (Navigator Pro, v0.3).** Raumsollwert und Raumbetriebsart je Raum (Register 2004 und 2007 + 7·(r−1) + 65·(z−1)) als schreibbare States, mit den Regeln aus Modul C: nur bei Änderung schreiben, Sollwert in 0,5-Schritten, Raumbetriebsart muss auf Normal stehen, nie zyklisch (dauerndes Schreiben startet laut PDF-FAQ das Zonenmodul neu), Mindestintervall, Rücklesen. Gilt auch für Räume mit IDM-Sensoren (deren Temperatur und Feuchte bleiben nur lesbar). Nach dem Testgerät (alle 8 Räume mit IDM-Sensoren) das wichtigste Raum-Feature; Schreibtests am echten Gerät nur mit ausdrücklicher Freigabe je Register. **Stand:** Software fertig (Option `writeZones`, Bereich 10–30 °C, Schritt 0,5, Mindestintervall 60 s wie EEPROM, Warnung wenn Raumbetriebsart ≠ Normal; nur gegen den Mock getestet, kein Schreibtest am Gerät).
7. **Raumsensoren (v0.3).** Modul C für HK-Raumtemperatur und Zonenräume mit Konfigurationstabelle. _Akzeptanz:_ Mock-Test, danach V9 am Gerät. _(Das Testgerät hat keine externen Raumsensoren, dieser Teil lässt sich dort nicht prüfen: nur Mock-Tests, als „community, ungetestet“ kennzeichnen.)_
8. **PV und GLT (v0.4).** Module D und E mit Quellmodi, Skalierung, Rücklesen, Rückfallverhalten. _Akzeptanz:_ Mock-Tests; am Gerät Schreibtest 74 und GLT-Monitor-Prüfung. **Stand:** Modul D fertig (Quellmodi direkt/berechnet, Rücklesen mit Konflikt-Erkennung, Alter-Regel), am Gerät mit 5 Minuten Übernahme getestet (V16); Modul E: zyklische Werte fertig (nur Mock), 1694/1695 (EEPROM), 1713 und 1714/1715 nicht umgesetzt.
9. **Diagnose und Dokumentation.** Diagnose-Tab, Support-Export, README in Deutsch und Englisch, Meldungstexte, Release-Checks von ioBroker. _Akzeptanz:_ Repository-Checker ohne Fehler, Beta-Release möglich.
10. **`nav17` und `nav10`.** Register-Dateien mit `extends` bzw. eigenständig, Auswahl in der Konfiguration, Tests mit Fixtures aus Nutzerrückmeldungen. _Akzeptanz:_ beide Familien als „community, ungetestet“ gekennzeichnet; erst Gerätescans anderer Nutzer setzen `device`. **Stand:** Register-Dateien fertig (nav10 per `extends`, nav17 eigenständig mit `lowByte`), siehe `docs/register-deviations-nav10-nav17.md`; Spulen (nav17) und Gerätetests offen.
11. **KNX (Phase 2).** Modul F nach der Prüfung von openknx. _Akzeptanz:_ ETS-Import der erzeugten Datei funktioniert in einem Testprojekt, Zuordnung stimmt mit dem IDM-Beispielprojekt überein.

## Offene Punkte und Risiken

| Nr. | Punkt                                                                                                                                                        | Wie klären                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Step  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| O1  | Float-Wortreihenfolge bei Navigator 2.0 (HASS und dschrempf: Low-Word zuerst)                                                                                | V1 am Testgerät                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 5     |
| O2  | Überlappende Adressen 1392/1393, 1441/1442, 1483/1484                                                                                                        | V3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 5     |
| O3  | Welche Register per FC03, welche per FC04 lesbar sind                                                                                                        | V4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 5     |
| O4  | Register 1006: Smart Grid (PDF) oder variabler Eingang (HASS)?                                                                                               | V6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 5     |
| O5  | Verhalten des Navigators, wenn GLT-Werte ausbleiben (Raumtemperatur, PV, 1696/1698, Anforderungen)                                                           | V9                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 7, 8  |
| O6  | Vorzeichen bei Batterieladung in Register 84; ob 74 negativ sein darf                                                                                        | Smartfox-PDF 2026 manuell lesen, V8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 8     |
| O7  | Räume je Zonenmodul: PDF 2022 nennt 8, HASS nennt 6 als Standard (8 konfigurierbar)                                                                          | Navigator Pro am Gerät oder per Rückmeldung                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 5, 10 |
| O8  | Beenden der einmaligen Warmwasserladung (1713)                                                                                                               | Test nach Freigabe                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 6     |
| O9  | ~~IDM-Spezifikation für Navigator 10~~ liegt vor (812663 Rev.0); `nav17`-Dokument (812049 Rev.1) liegt ebenfalls vor                                         | erledigt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 10    |
| O10 | Lizenzen: Datenübernahme aus dschrempf/idm-modbus, Weitergabe von Registerdaten aus IDM-Dokumenten, Lizenz von idm-heatpump-api                              | **Geklärt 10.10.2026:** Xerolux api/hass MIT, Übernahme mit Namensnennung und Copyright-Hinweis im Registerfile-Header und in den Danksagungen; dschrempf BSD-3-Clause, bleibt reine Vergleichsquelle; IDM-Registerlisten werden nur als Fakten (Adresse, Typ, Bereich, Enum) übernommen, PDFs nicht weitergegeben                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 2     |
| O11 | Bibliothekswahl für Modbus (zum Beispiel modbus-serial oder jsmodbus)                                                                                        | **Entschieden 10.10.2026 (Nutzer): `modbus-connect` 5.x** (MIT, TypeScript, aktiv gepflegt). Spikes mit modbus-serial, jsmodbus, node-modbus-lib und modbus-connect gegen einen Mock-Server und das Testgerät (nur lesen). Eigener Wrapper `src/lib/modbus/client.ts` erzwingt, was der Navigator braucht: strikt serielle Requests mit Pause, keine Auto-Retries und kein Auto-Reconnect der Bibliothek, Verbindung schließen bei Timeout, nur bereinigte Fehler. Bekannte Eigenheiten der Bibliothek: sie schreibt `Connecting to <host>:<port>` und ähnliches ins Log (Transport-, Manager-, Queue- und Client-Logger werden einzeln abgeschaltet, ein Test prüft, dass nichts auf stdout/stderr landet), sie prüft die MBAP-Transaktions-ID nicht (deshalb Verbindung schließen nach Timeout), sie bringt `serialport` mit (nativ, bei uns ungenutzt). Der Wrapper ist die einzige Stelle, die die Bibliothek kennt; ein Wechsel bleibt klein | 3     |
| O12 | Raumnamen automatisch aus dem Navigator lesen (HASS-Web-Supplement per HTTP/WebSocket mit dem Netzwerkcode); ob dort Namen enthalten sind, ist nicht bekannt | nach v1 prüfen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | –     |
| O13 | ~~Adaptername und Repository~~ geklärt: `idm-modbus` / `seaspotter/ioBroker.idm-modbus`                                                                      | erledigt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 1     |

**Risiken:**

- **EEPROM-Verschleiß:** begrenzt durch Gleichheitsprüfung, Mindestintervall, Zähler und Tageswarnschwelle; Restrisiko bei Nutzerautomatisierungen, die dasselbe Register häufig schreiben.
- **Navigator stockt bei zu hartem Polling:** gedrosselt, eine Verbindung, Intervalle konfigurierbar; V10 legt die Grenzen fest.
- **Zweiter Schreiber auf denselben Registern** (Smartfox, E3DC, HASS, Loxone): Rücklese-Warnung, Dokumentation, keine technische Sperre.
- **Unterschiedliche Firmwarestände:** Familienauswahl statt Autoerkennung, Support-Export für Rückmeldungen, `verified`-Status je Register.
- **Fehlerhafte Annahmen aus Community-Quellen:** Rangfolge der Quellen, Gerätescan als letzte Instanz.

## Modul H: Weboberfläche (read-only, Navigator Pro / 2.0 mit PHP-Seiten)

Optionales Zusatzmodul, standardmäßig aus. Es liest über die lokale Weboberfläche des Navigators (HTTP, Port 80) Daten, die Modbus nicht liefert: Raum- und Heizkreisnamen sowie je Raum Betriebsart, Ist- und Solltemperatur und Feuchte.
Die Schnittstelle ist von IDM nicht dokumentiert und wurde an einem Navigator Pro beobachtet; Xerolux (idm-heatpump-api, MIT) beschreibt den Zugang für Navigator 2.0 ähnlich (PIN, CSRF-Token, `data/*.php`).

- **Anmeldung:** Formularfeld `pin` per POST an `index.php`, Session-Cookie `MYIDM`, CSRF-Token aus der Seite (`csrf_token`), danach nur GET auf `data/<name>.php` mit Header `CSRF-Token`. Abgelaufene Sitzung: einmal neu anmelden.
- **Seiten:** `rooms` (Raum-ID `100·Zone+Raum`, Name, Modus, Temperatur Ist/Soll, Feuchte), `heatpump` (Heizkreisnamen), `info` (nicht genutzt: System, PV-Kurzinfo, Wetter).
- **Zuordnung:** Raum-ID 101–109 gehört zu Zonenmodul 1, Raum 1–9 (am Testgerät belegt); für andere Zonenmodule ist `100·Zone+Raum` eine Annahme. Heizkreisnamen aus dem Navigator gelten nur, wenn der Nutzer keinen eigenen Namen eingetragen hat.
- **Schutz:** nur GET, nie Schreiben; Intervall mindestens 30 s (Standard 60 s); PIN nur als `encryptedNative`/`protectedNative` (`webPin`), nie in Logs oder Fehlermeldungen; ein Fehler schaltet nur das Modul aus (`web.connected = false`), nie den Adapter.
- **Statistik:** `statistics.php?type=heatpump|amountofheat|baenergyhp` (Laufzeit in h, Wärmemenge und Stromverbrauch in kWh, je Heizen/Kühlen/Warmwasser/Abtauung): Summe seit Beginn (`unitTotal`, auch MWh), heute, Monat, Jahr, Verlauf (32 Tage, bis ca. 100 Monate, 8 Jahre) als JSON, daraus COP (Monat/Jahr/gesamt). Intervall Standard 900 s (mindestens 300 s, 0 = aus). Die Wärmemenge-Werte je Zeitraum liegen in kWh, auch wenn die Summe als MWh dargestellt wird. Am Testgerät wirkt der COP Warmwasser unplausibel hoch (12,6; Wärmemenge und Strom werden vom Navigator unterschiedlich zugeordnet) und ist nicht geprüft.
- **Nicht umgesetzt:** Zeitprogramme, Wetter, PV-Kurzinfo, Warmwasserparameter (`heatpump` liefert FW0xx-Parameter mit Bereichen), alles Schreibende (`settings`, `actions`, `relaytest`).

### Modul H für Navigator 10 und 1.7 (Stand 2026-10-11)

- **Navigator 10:** lokaler WebSocket, Port 61220, `ws://<host>:61220/?auth_code=<PIN>`; erster Frame `{"authorized": true|false}`; Anfrage `{"controller":"setting","command":"detail","data":{"settingId":"<id>"}}`, Antwort `settingDetail.value` als HTML-Tabelle wie die PHP-Seiten des Navigator 2.0. Setting-IDs (Xerolux, idm-heatpump-api): 4768 Fühler, 4775 Digitaleingänge, 4782 Analogausgänge, 4789 Digitalausgänge. Dieselbe Tabellenauswertung und derselbe `web.io`-Publisher wie beim Navigator 2.0 (`src/lib/web/nav10-client.ts`, `nav10-runner.ts`, `io-publisher.ts`); Antworten nacheinander, 50 ms Pause. Nicht umgesetzt: Räume, Heizkreisnamen, Statistik, Benachrichtigungen und der Anforderungsgrund (`home/detail`). Nur gegen einen simulierten Socket getestet.
- **Navigator 1.0/1.7:** keine Weboberfläche (Xerolux unterstützt dort nur ein altes UDP-Protokoll); die Web-Option ist ausgeblendet, das Modul bleibt aus.
- **Heizkreis-Fühler:** Vorlauf B51–B57, Raum B61–B67 für die Heizkreise A–G (Xerolux hat B54/B64 für Kreis D live am Navigator 10 geprüft); daraus entfällt das Erkennen der Namen im Fühlertext.

## Modul I: Wärmepumpen-Diagramm (read-only)

Eine vom Adapter selbst bediente Webseite (Node `http`, nur GET/HEAD, vier feste Dateien aus `www/`, `/api/model`, `/events` als Server-Sent-Events; max. 20 Zuhörer, CSP-Header). Standard an, Port 8183, Adresse 0.0.0.0 (Hinweis: LAN-sichtbar, nur lesend; `127.0.0.1` im Expertenmodus). Der Link steht über `common.localLinks._default` (`http://%ip%:%diagramPort%/`) in der Instanzenliste. Ein `ValueHub` bekommt jeden Zustandswert aus `put()`; das Modell (`buildDiagramModel`) entsteht aus den Zuständen mit echten Werten (Pufferspeicher, Warmwasser, Heizkreise, PV, Solar, Bivalenz, Räume), die Seite (Vanilla-JS, SVG) baut sich daraus auf und holt das Modell jede Minute neu. Erste Version zeichnet Wärmepumpe, Puffer, Warmwasser, Heizkreise, PV und Räume; Solar, Bivalenz, Kaskade, ISC, Booster und Animationen der Leitungen folgen.

## Nachträge (Oktober 2026)

- **Störungstexte:** Die Störungsnummer (Register 1004 `internal_message`, Navigator 1.x: 1500) wird zusätzlich als Text in der Systemsprache des ioBroker bereitgestellt (`system.internal_message_text`). Quelle: Navigator-2.0-Bedienungsanleitung, Kapitel 4 „Störungen“ (`docs/sources/IDM_Navigator_2.0_Bedienungsanleitung_2019-01.pdf`), nur Nummern und Benennungen, ohne die Beschreibungstexte (IDM-Urheberrecht). Tippfehler der Vorlage wurden korrigiert. 178 Nummern (Fühlerstörungen 100–197 paarweise Kurzschluss/Unterbrechung, Anlagenstörungen 020–552, Ereignisse 996–999). Offen: Nummern über 999 (Xerolux hat 2005 Einträge), Handbücher für Navigator 1.7 und 10.
- **Warmwasser-Boost:** Einmalige Ladung über die Warmwasseranforderung (1712). Nur auf Wunsch (`boostEnabled`), Ziel 40–65 °C (Standard 55), Zeitlimit 5–240 min (Standard 60). Die Anforderung endet laut Dokument nicht von selbst; der Adapter erneuert sie alle 30 s und schaltet sie immer wieder aus (Zieltemperatur, Zeitlimit, Anforderung, drei Fehlschläge, Beenden, Neustart). Nur gegen den Mock getestet; ein Test am Gerät braucht die ausdrückliche Freigabe des Nutzers. Xerolux löst den Boost anders (Systemmodus und Sollwert vorübergehend ändern, beides EEPROM-Register).
- **Zimmer-Feuchte/Betriebsart (am Gerät gefunden):** Im Blocklesen überschreibt die Raumfeuchte (dort ein FLOAT über 2006–2007) die Betriebsart bei 2007. Feuchte und Betriebsart jedes Raums werden einzeln gelesen (`overlapWith` in der Registerquelle), je Raum drei Anfragen statt einer (Temperatur mit Sollwert, Feuchte, Relais; die Betriebsart nur im Konfigurationsintervall).
- **Abtauung:** Zyklen und Dauer aus der Betriebsart 8 (`stats.runtime.defrost.{starts,hours}_{day,total}`), Genauigkeit gleich der Abtastung (30 s).
