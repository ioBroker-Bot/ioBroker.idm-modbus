# ioBroker.idm-modbus – Handbuch

Lokaler ioBroker-Adapter für IDM Wärmepumpen mit Navigatorregelung (Navigator 2.0 / Pro am Gerät geprüft, Navigator 10 und 1.0/1.7 nach den IDM-Dokumenten). Er spricht über **Modbus TCP** im eigenen Netzwerk mit dem Navigator, ohne Cloud. [English version](../en/manual.md)

## 1. Vorbereitung

Zwei Dinge müssen **einmalig am Navigator** eingerichtet werden, in der Regel auf Heizungsbauer- bzw. Serviceebene (im Zweifel den Installateur fragen):

1. **Modbus TCP** ist werkseitig ausgeschaltet. Im Hauptmenü „Einstellungen“ den Menüpunkt „Gebäudeleittechnik“ wählen und „Modbus TCP“ auf „Ein“ stellen. Dem Navigator eine feste IP-Adresse geben. Ohne Modbus TCP kann der Adapter nichts lesen; „Verbindung testen“ meldet dann einen Verbindungsfehler.
2. **Netzwerk-PIN**: nur für den optionalen Teil _Weboberfläche_ (Raumnamen, Raumdaten und Statistik aus den Webseiten des Navigators). Der Adapter funktioniert auch ohne.

Der Adapter schaltet keine Installateurfunktionen frei und ändert diese Einstellungen nie selbst.

**Sicherheit in Kürze:** Lesen ist immer unkritisch. Schreiben ist standardmäßig aus, je Gruppe einzeln freizugeben, und jeder Schreibvorgang wird geprüft, begrenzt und gezählt. Viele Einstellungen des Navigators liegen in einem EEPROM, das etwa 300.000 Schreibzyklen je Einstellung verträgt: niemals dauerhaft durch eine Automatisierung schreiben lassen.

## 2. Erste Einrichtung (5 Minuten)

1. Adapter installieren und eine Instanz anlegen.
2. Reiter **Verbindung**: IP-Adresse des Navigators eintragen und die Navigator-Generation wählen. **Verbindung testen** drücken: Es erscheinen die Außentemperatur und die erkannte Generation (bei Abweichung von Ihrer Wahl mit Hinweis).
3. Reiter **Anlage**: **Gerät scannen** drücken (etwa 3 Minuten, nur lesend; den Adapter währenddessen nicht neu starten; die Seite zeigt den Fortschritt). Steht in der Statuszeile _Scan beendet_, **Vorschlag übernehmen** drücken. Das setzt die Haken bei den Heizkreisen, Zonenmodulen und Blöcken, die der Navigator wirklich hat. Prüfen und **Speichern**.
4. Datenpunkte erscheinen, sobald der Navigator einen Wert meldet. Hardware, die Ihre Anlage nicht hat, bekommt keine leeren Datenpunkte.

Alles Weitere ist optional und bleibt aus, bis Sie es einschalten.

## 3. Einstellungen im Überblick

### Verbindung

| Einstellung              | Bedeutung                                                                                                                                                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigator Host / IP      | Adresse des Navigators. Eine feste Adresse verwenden.                                                                                                                                                                                                                                             |
| Navigator-Generation     | 2.0 (auch Pro), 1.7 oder 10. Der Test-Button erkennt sie für Sie.                                                                                                                                                                                                                                 |
| Weboberfläche (optional) | Auch Raumnamen, Raumdaten und Statistik aus der Weboberfläche lesen. Braucht die Netzwerk-PIN des Displays (verschlüsselt gespeichert, im lokalen Netz wie im Browser unverschlüsselt übertragen).                                                                                                |
| Experteneinstellungen    | Sichtbar im Expertenmodus des Admins: Port (502), Unit-ID (1), Request-Timeout, Pause zwischen Requests (mindestens 100 ms: Der Navigator stockt bei hartem Polling), Abfrageintervalle schnell/mittel/langsam/Einstellungen (30 s / 60 s / 300 s / 3600 s) und die Intervalle der Weboberfläche. |

### Anlage

Heizkreise A–G (mit optionalem Namen), Anzahl der Zonenmodule und Räume je Modul, optionale Registerblöcke (Solar, ISC, Kaskade, Bivalenz, PV- und Leistungswerte, Booster-Wärmepumpen beim Navigator 10), der Gerätescan mit „Vorschlag übernehmen“ und zwei Optionen dazu, welche Datenpunkte es gibt:

- **Datenpunkte von Hardware ausblenden, die keinen Wert meldet** (Standard: ein): Datenpunkte von Fühlern, Pumpen usw., die Ihre Anlage nicht hat, werden nicht angelegt; Reste aus früheren Starts werden etwa zwei Minuten nach dem Start entfernt. Ein Datenpunkt erscheint von selbst, sobald ein echter Wert kommt. Eigene Einstellungen (zum Beispiel Verlauf) eines entfernten Datenpunkts gehen verloren.
- **Datenpunkte von hier abgeschalteten Kreisen, Zonen und Blöcken löschen**: räumt auf, was Sie abgeschaltet haben.

### Statistik

Abgeleitete Werte und Statistik (siehe Abschnitt 6): optionaler externer Stromzähler (Zählerstand und/oder Leistung) und Wärmemengenzähler, welche Wärmequelle die Effizienzwerte speist, Preis pro kWh (fest oder aus einem Datenpunkt), Währung, CO₂ pro kWh (fest oder aus einem Datenpunkt), maximales Alter externer Werte, _Statistik zurücksetzen_.

### Steuern

Erlaubt das Schreiben an die Wärmepumpe. **Alles ist standardmäßig aus**, je Gruppe: Systembetriebsart und Störungsquittierung, Warmwasser-Einstellungen, jeder Heizkreis, Raumsolltemperaturen und Raumbetriebsarten der Zonenmodule (Navigator Pro), Solar-Betriebsart sowie Bivalenz und Kaskade (Expertenmodus). Dazu die einmalige Warmwasserladung, der Mindestabstand zwischen zwei Schreibvorgängen einer Einstellung (Standard 60 s) und eine Warnschwelle für Schreibvorgänge je Einstellung und Tag.

### Photovoltaik, Raumsensoren, Gebäudeleittechnik

Übergabe von Werten aus ioBroker-Datenpunkten an den Navigator, siehe Abschnitt 7.

### Diagnose

_Support-Datei erstellen_ (Abschnitt 9).

## 4. Der Objektbaum

Alle Datenpunkte liegen unter der Instanz (`idm-modbus.0.`). Die Namen sind in die Sprache Ihres ioBroker übersetzt.

| Kanal                                               | Inhalt                                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `info`                                              | `connection`, `family`, `errors`, `lastSuccess`                                                                                       |
| `system`                                            | Außentemperatur, Betriebsart System, Störungsnummer `internal_message` und ihr Text `internal_message_text`                           |
| `dhw`                                               | Warmwasser: Speicher- und Trinkwassererwärmertemperaturen, Solltemperaturen, einmalige Warmwasserladung (`boost_*`)                   |
| `hp`                                                | Wärmepumpe: Vor-/Rücklauf, Betriebsart, Verdichter, Pumpen, Ventile, Anforderungen, Summenstörung                                     |
| `hc.A` … `hc.G`                                     | je Heizkreis: Vorlauf, Raumtemperatur, Betriebsart, Solltemperaturen, Heizkurve, Grenzen                                              |
| `zones.1.rooms.1` …                                 | Zonenmodule: Raumtemperatur, Raumsolltemperatur, Raumfeuchte, Betriebsart, Relaisstatus (Namen aus der Weboberfläche, wenn aktiviert) |
| `energy`                                            | Wärmemengenzähler, Momentanleistung                                                                                                   |
| `solar`, `isc`, `cascade`, `bivalence`, `pv`, `glt` | optionale Blöcke                                                                                                                      |
| `calc`                                              | berechnete Werte: Temperaturdifferenzen, Vorlaufabweichung, momentaner COP                                                            |
| `stats`                                             | Energie je Betriebsart, COP und Jahresarbeitszahl, Kosten, CO₂, Betriebsstunden, Starts, Abtauungen                                   |
| `web`                                               | Raumdaten und Statistik aus der Weboberfläche                                                                                         |
| `diag`                                              | Anfragestatistik, letzter Fehler, Schreibzähler, Scan-Zustand                                                                         |

Regeln für die Werte:

- Temperaturen, Temperaturdifferenzen und Zähler (kWh, Stunden) zeigen **eine Nachkommastelle**.
- Ein Wert, den der Navigator als _nicht verfügbar_ meldet (Fühler fehlt), ist leer und hat ein schlechtes Qualitätsflag, nie eine erfundene Zahl.
- Beschreibbare Datenpunkte werden mit `ack=false` geschrieben; der Adapter bestätigt mit `ack=true`, nachdem der Navigator den Wert angenommen hat und er zurückgelesen wurde.

## 5. Schreiben und seine Schutzmechanismen

Jeder Schreibvorgang durchläuft diese Prüfungen: erlaubte Gruppe, gültiger Wert (nur der dokumentierte Bereich und erlaubte Werte), nur wenn er vom aktuellen Wert abweicht (bei EEPROM-Einstellungen), entprellt (1 s), mindestens 60 s zwischen zwei Schreibvorgängen derselben EEPROM-Einstellung (der neueste Wert gewinnt), geschrieben, nach 1 s **zurückgelesen** und gezählt (`diag.writes.<id>`). Eine Häufung oder mehr als die Tagesschwelle löst eine Warnung aus; drei Fehler in Folge sperren eine Einstellung für zehn Minuten. Solange der Navigator nicht erreichbar ist, wird nichts in eine Warteschlange gelegt, und ein abgelehnter Wert wird als der echte Wert zurückgezeigt.

**Einmalige Warmwasserladung** (Reiter Steuern, standardmäßig aus): `dhw.boost_start` / `dhw.boost_stop`. Sie schaltet die Warmwasseranforderung (Register 1712) ein, erneuert sie alle 30 s und **schaltet sie immer wieder aus**: bei der Zieltemperatur (Standard 55 °C), nach dem Zeitlimit (Standard 60 Minuten), auf Anforderung, nach drei fehlgeschlagenen Schreibvorgängen, beim Beenden des Adapters und nach einem Neustart.

## 6. Statistik

- **Berechnete Werte** (`calc`): Wärmepumpe Vorlauf minus Rücklauf, Wärmequelle Eintritt minus Austritt, Warmwasser minus Solltemperatur, Vorlaufabweichung je Heizkreis, momentaner COP (intern aus den Leistungsregistern des Navigators, extern mit eigenem Zähler).
- **Energie und Effizienz** (`stats`): elektrische und thermische Energie je Betriebsart (Heizen, Warmwasser, Kühlen, Abtauung) für heute, diesen Monat, dieses Jahr und seit Start, COP und Jahresarbeitszahl (auch für die letzten 365 Tage), Kosten zum Preis, der bei der Nutzung der Energie galt, CO₂ mit der damaligen Intensität (`stats.co2.intensity` zeigt den verwendeten Faktor), Betriebsstunden, Starts und kurze Läufe je Verdichter, Abtauzyklen und -stunden. Die Statistik übersteht Neustarts. Schutzregeln für den COP: mindestens 50 W, mindestens 0,1 kWh je Zeitraum.
- **Externe Zähler:** Ein Zählerstand wird bevorzugt (er zählt weiter, wenn der Adapter steht); ein reiner Leistungs-Datenpunkt wird integriert. Die Einheit wird aus dem Datenpunkt gelesen; hat er keine, bitte wählen, sonst bleibt die Quelle mit einer Warnung aus (der Adapter rät nie eine Einheit).
- **Web-Statistik** (`web.statistics`, braucht die PIN): Laufzeit, Wärmemenge und Stromverbrauch je Betriebsart für heute, Monat, Jahr und gesamt, ein JSON-Verlauf aus Tagen, Monaten und Jahren (bis zur ersten Inbetriebnahme) und der daraus berechnete COP. Vor dem Verlassen darauf mit den Modbus-Werten vergleichen; besonders der COP für Warmwasser hängt davon ab, wie der Navigator Energie zuordnet.

## 7. Werte an den Navigator senden

Alle drei Module sind **standardmäßig aus**, schreiben nur, wenn etwas konfiguriert ist, und lesen das Geschriebene zurück, um einen zweiten Schreiber zu erkennen (`*.writer_conflict`).

- **Photovoltaik** (Register 74–86): PV-Überschuss, Produktion, Hausverbrauch, Batterieentladung und -füllstand aus ioBroker-Datenpunkten. Ein Faktor rechnet auf kW um (1 bei kW, 0,001 bei W; es gibt bewusst keinen Standardwert), dazu Umkehren und Grenzen. Der Überschuss kommt direkt aus einem Datenpunkt oder wird als Produktion minus Hausverbrauch berechnet. Jeder Wert wird in jedem Zyklus geschrieben (standardmäßig 30 s). Fehlt die Überschussquelle oder ist sie zu alt, wird **0** geschrieben, damit die Wärmepumpe nicht auf einem alten Überschuss weiterläuft. Das PV-Menü des Navigators muss eingerichtet sein. Jedes andere Programm, das diese Register beschreibt, abschalten.
- **Raumsensoren** (Register 1650 ff.): Die Temperatur eines Datenpunkts als externe Raumtemperatur eines Heizkreises; geschrieben bei einer Änderung ab 0,2 °C oder im Heartbeat (300 s), nur im Bereich 15–30 °C und nicht aus Quellen, die älter als 15 Minuten sind (oder mit festem Ersatzwert). Im Navigator muss beim Heizkreis die Raumtemperaturerfassung auf „GLT Raumsensor“ stehen.
- **Gebäudeleittechnik** (Register 1690–1722): Außentemperatur, Feuchte, Temperaturanforderungen und Anforderungen Heizen/Kühlen/Warmwasser, Speichertemperaturen. Vorher im Navigator die passende GLT-Option einschalten (zum Beispiel „GLT Außentemperatur“). An einem echten Gerät nicht getestet.

## 8. Weboberfläche (optional)

Mit der PIN des Displays liest der Adapter die lokalen Webseiten des Navigators (nur lesend): Raum- und Heizkreisnamen (als Namen im Objektbaum), Raumtemperatur, Solltemperatur, Feuchte und Betriebsart je Raum sowie die Statistik. Die Weboberfläche ist von IDM nicht dokumentiert und kann sich mit Firmware-Updates ändern. Abfrage alle 60 s (Räume, Ein- und Ausgänge) und 15 Minuten (Statistik), nie schneller als 30 s bzw. 5 Minuten.

Die Ein- und Ausgänge aus dem Informationsmenü des Navigators (Fühler, Digitaleingänge, Analog- und Digitalausgänge) liegen unter `web.io`; die Namen bekannter Teile sind in allen Sprachen vorhanden, unbekannte stehen so, wie der Navigator sie zeigt. Modbus hat Vorrang: Was Modbus liefert (der Adapter erkennt das an der IDM-Bezeichnung in den Registernamen, z. B. B33, M64), wird aus diesen Tabellen nicht noch einmal angelegt, und für einen Raum, den Modbus liest, gibt es unter `web.rooms` keinen Eintrag (sein Name ist der Zustand `zones.<Zone>.rooms.<Raum>.name` und der Name des Kanals, seine Werte sind die Zonen-Zustände). Die Web-Variante erscheint nur, solange Modbus keinen Wert hat, zum Beispiel bei der Ladepumpe M73 im Stillstand. Reste früherer Versionen werden beim Start entfernt.

## 8a. Wärmepumpen-Diagramm

Der Adapter stellt eine Webseite nur zum Ansehen bereit: ein Schema der Anlage mit Livewerten (Standard-Port 8183, Reiter Verbindung). Sie öffnet sich über den Link neben der Instanz in der Instanzenliste. Das Schema baut sich selbst auf: Wärmepumpe (Außentemperatur, Vorlauf, Rücklauf, Leistung, COP, Betriebsart, ein Lüfter, der sich beim Verdichterlauf dreht), Pufferspeicher, Warmwasser, jeder Heizkreis, Photovoltaik (Erzeugung, Haus, Überschuss, Batterie) und alle Räume erscheinen nur, wenn der Adapter echte Werte dafür hat; die Leitungen sind nach Temperatur gefärbt. Jeder im Netzwerk, der die Adresse kennt, kann die Seite öffnen, sie kann aber nichts verändern. Mit der Lauschadresse 127.0.0.1 (Expertenmodus) bleibt sie auf dem ioBroker-Rechner; im Reiter Verbindung lässt sie sich auch abschalten.

## 9. Support

Reiter _Diagnose_ → **Support-Datei erstellen**: ein Bericht für Fehlermeldungen mit der Konfiguration (ohne Host, PIN und Datenpunkt-IDs), Verbindungszustand, Registern ohne Wert, dem letzten Wert jedes Registers und dem letzten Scan-Ergebnis. IP- und E-Mail-Adressen werden entfernt. Die Datei öffnet sich in einem neuen Tab und bleibt im Dateibereich `support` (die letzten fünf). Zusammen mit dem Adapter-Log anhängen (bei Verbindungsproblemen die Log-Stufe _Debug_ einstellen).

## 10. Fehlersuche

| Beobachtung                                             | Ursache / Abhilfe                                                                                                                                                                                                       |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| „Verbindung testen“ schlägt fehl                        | Modbus TCP am Navigator nicht eingeschaltet, falsche IP oder ein anderer Client blockiert den Port.                                                                                                                     |
| Verbunden, aber keine Außentemperatur                   | Unit-ID ungleich 1 (Experteneinstellungen).                                                                                                                                                                             |
| Viele leere Datenpunkte                                 | Hardware, die Ihre Anlage nicht hat: _Datenpunkte von Hardware ausblenden, die keinen Wert meldet_ eingeschaltet lassen oder den Scan ausführen und den Vorschlag übernehmen.                                           |
| Falsche oder fehlende Werte nach Wechsel der Generation | Die Generation wählen, die der Test-Button meldet.                                                                                                                                                                      |
| Der Navigator wird langsam                              | Abfrageintervalle oder Pause zwischen Requests zu kurz; die Standardwerte beibehalten.                                                                                                                                  |
| Der Scan bricht bei etwa 25 % ab                        | Der Adapter wurde während des Scans neu gestartet (auch durch Speichern der Konfiguration); erneut starten und den Adapter in Ruhe lassen.                                                                              |
| `web.connected` ist false                               | Falsche PIN, Weboberfläche nicht erreichbar oder am Navigator ist keine PIN gesetzt.                                                                                                                                    |
| Ein Schreibvorgang bleibt ohne Wirkung                  | Prüfen, ob die Gruppe im Reiter Steuern freigegeben ist; das Log nennt den Grund (Bereich, gleicher Wert, Mindestabstand, Sperre). Raumsolltemperaturen wirken nur, solange der Raum in der Betriebsart _Normal_ steht. |

## 11. Bekannte Grenzen

- Die Registerdateien für Navigator 10 und 1.0/1.7 stammen aus den IDM-Dokumenten und sind an echten Geräten ungetestet; Scans anderer Nutzer werden sie bestätigen. Die Spulenregister (3000–3003) des Navigators 1.7 werden nicht unterstützt.
- Der Navigator kann falsche Daten liefern, wenn überlappende Register in einem Block gelesen werden; der Adapter liest die betroffenen Register (zum Beispiel Raumfeuchte und Betriebsart) einzeln.
- Ein in der Navigator-App angelegter „Raum mit Modbus TCP“ kann von diesem Adapter noch nicht mit einer Temperatur versorgt werden; laut IDM-Dokument gehört die Raumtemperatur an die Adresse des Raums, für einen neunten Raum ist sie nicht dokumentiert.

## 12. Dank und Haftungsausschluss

Die Registerdefinitionen folgen den IDM-Dokumenten „Modbus TCP“ (Navigator 2.0: 812170 Rev.10, Navigator 10: 812663 Rev.0, Navigator 1.0/1.7: 812049 Rev.1). Dank an **Xerolux** ([idm-heatpump-api](https://github.com/Xerolux/idm-heatpump-api), [idm-heatpump-hass](https://github.com/Xerolux/idm-heatpump-hass), MIT) für die Vergleichsdaten und dafür, viele Eigenheiten der Geräte zuerst gefunden zu haben. Dies ist ein unabhängiges Community-Projekt, nicht mit IDM Energiesysteme GmbH verbunden oder von ihr unterstützt. Nutzung auf eigene Gefahr, besonders beim Schreiben.
