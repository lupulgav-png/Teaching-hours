# Private Booking Assistant

Separate, private Web-App für Tanz-Privatlektionen (unabhängig von der Unterrichts-App im Hauptordner).

**Aufruf:** `…/Teaching-hours/booking/` – in Safari öffnen → Teilen → «Zum Home-Bildschirm».

## Funktionen
- **Übersicht** aller Lektionen mit Status und nächstem Schritt (Raumanfrage kopieren, Raum bestätigt, Bestätigung kopieren, Kalender, Abschliessen).
- **Neuer Termin** per Sprache (Mikrofon-Knopf oder Diktat der iPhone-Tastatur) oder Formular. Mehrere Termine in einem Satz:
  «Privatlektion mit Sarah nächsten Mittwoch um 19 Uhr, 90 Minuten, Säulensaal und noch eine Privatlektion mit Anna Donnerstag 18:30 Panoramasaal».
  Erkannte Werte sind markiert (erkannt / Standard / bitte prüfen / fehlt) und vor dem Speichern editierbar.
- **Status:** Vereinbart (Raumanfrage offen) → Raum angefragt → Raum bestätigt → Schülerin bestätigt → Abgeschlossen, oder Storniert. Immer manuell.
- **Nachrichten:** individuelle Raumanfrage und (erst nach Raumbestätigung) Bestätigung an die Schülerin, per Du mit abwechselnder Begrüssung (Hallo/Hoi/Hey). Bearbeitbar, «↻» formuliert neu, Kopieren mit einem Tipp, WhatsApp/SMS öffnen (Versand immer manuell). Modus **«Nur Termin»** liefert nur die Termin-Zeile zum Einfügen.
- **Konfliktprüfung** gegen alle Termine in der App (Warnung, nichts wird verändert).
- **Kundenkartei** (freiwillig): Namensvorschläge, Telefon für WhatsApp/SMS, bisherige/letzte Lektionen.
- **Apple Kalender** per ICS-Datei, Titel «Privatlektion – Name».
- **Zugriffsschutz:** optionale PIN; Daten werden dann mit AES-GCM (Schlüssel aus PIN, PBKDF2) verschlüsselt gespeichert, automatische Sperre nach 5 Min. im Hintergrund.
- **Backup** als JSON-Datei (sichern/laden).

## Grenzen (bewusst ehrlich)
- Eine Web-App kann **Apple Kalender nicht lesen** und den Zielkalender nicht selbst wählen. Deshalb:
  - Konflikte werden nur gegen die Termine in dieser App geprüft.
  - Jeder Kalendereintrag gilt als «ICS übergeben – ungeprüft», bis du in der App «Im Kalender geprüft» tippst.
  - Einstellungen → Apple Kalender → «Test-Termin öffnen» einmal auf dem iPhone testen. Empfehlung: in iOS den gelben Kalender als Standardkalender setzen.
  - Für eine zuverlässig automatische Kalenderwahl und Konfliktprüfung gegen Apple Kalender bräuchte es einen Apple-Kurzbefehl oder eine native iOS-App.
- Daten liegen nur auf dem jeweiligen Gerät (kein Sync). Safari und die Home-Bildschirm-App haben auf iOS **getrennte Speicher** – immer dieselbe Variante benutzen.
- PIN vergessen = Daten nur über ein Backup wiederherstellbar.

## Dateien
`index.html` (Layout/CSS) · `core.js` (Parser, Nachrichten, ICS, Konflikte – ohne DOM) · `app.js` (Oberfläche, Speicher, PIN) · `sw.js` (Offline) · `manifest.webmanifest`, Icons.
