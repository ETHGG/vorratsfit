# Fortschritt VorratsFit

## Wiederherstellung (16.11.2026)
- Die Arbeitsumgebung wurde zweimal zurückgesetzt. 0.2.0 und 0.3.0 wurden vollständig aus dem Projektverlauf neu geschrieben.
- Git-Historie: Basis-Commit und Tag **v0.2.0**, darauf 0.3.0 mit Tag **v0.3.0**. Ältere Phasen-Commits sind nicht mehr vorhanden.

## 0.7.2
- [x] Einrichtung ohne Navigation, Willkommens-Tipps im Vorrat
- [x] Wochenauswertung ohne leere Wochen, gerundeter Platzhalter in der Einkaufsliste, Tagesbilanz ≤ 360 px
- [x] Wasser-Test zeitzonensicher (Mitternacht)

## 0.7.1 – Nutzungstest (mehrere simulierte Tage, 320/390/1280 px, hell/dunkel)
- [x] Dezimalfelder als Textfeld mit Zahlentastatur (Komma-Eingabe), Werte mit Komma angezeigt
- [x] Einkaufsliste: Mengenfeld eingeklappt, Herkunft dezenter

## 0.7.0 – Nacht 16./17.11.2026 (Sicherung des Vorstands: Branch `sicherung-0.6.0`)
- [x] Untere Leiste mit Vorrat; Plan-Tab mit Umschalter Heute/Woche/Gewicht
- [x] Fotos zu allen Rezepten (IndexedDB v5 `recipePhotos`, Backup v5, `photos.js`, `views/photo-input.js`)
- [x] Startseite gestrafft (Hinweise nur bei Bedarf, Ideen nach Tageszeit, nur erreichte Erfolge)
- [x] Übertragen per Teilen-Menü (AirDrop usw.); QR-Code verworfen: Backups mit Fotos sind zu groß und iPhone-Safari kann QR-Codes nicht ohne Zusatzbibliothek lesen
- [x] Allergene aller 94 Zutaten geprüft – keine Fehler gefunden

## 0.6.0 – Etappe 3: Neue Funktionen (16.11.2026)
- [x] Kochmodus `#/kochen/<id>` mit Timer-Erkennung (`core/cook-steps.js`), Wake Lock, Ton/Vibration
- [x] Gänge-Reihenfolge in den Einstellungen (`shoppingGroupOrder`), Dialog auf der Einkaufsliste
- [x] Resteverwertung (Filter `resteverwertung`, Sortierung nach Dringlichkeit, Link von der Startseite)
- [x] Wasser-Tracker: IndexedDB v4 Store `waterLog`, Backup v4 (Migration 3 → 4), Wasserziel in den Einstellungen
- [x] Erfolge (`core/achievements.js`), ohne Gewichtsabnahme-Erfolge für Minderjährige
- [x] 14 neue Rezepte (50 insgesamt), eigene Fotos für eigene Rezepte (nur Bild-Daten-URLs, max. ca. 1,5 MB)
- [x] Neue Tests: `test-cases-v06.js`, `db-tests-v06.js`, `e2e_v06.py`

## Letzte vollständige Testausführung (16.11.2026, 0.6.0)
Logik 100/100 · Statik bestanden · Browser/DB 163/163 · E2E 157/157 · Meta T0-01 1/1

## 0.5.0 – Etappe 2: Neues Aussehen (16.11.2026)
- [x] Bereichsfarben über `data-area` (Body, Navigation, Kacheln, Abschnitte), Kontraste geprüft (hell ≥ 4,5:1, dunkel ≥ 7:1)
- [x] Illustrationen `assets/illustrations/*.svg` im Seitenkopf, in Kacheln und leeren Zuständen
- [x] Rezeptbilder `recipeArt()` (Fläche je Mahlzeit + Emoji; eigene/externe Fotos ersetzen sie)
- [x] Startseite neu, Kalorien-Ring, farbige Makros, Kategorie-Symbole
- [x] Kürzere, freundlichere Seitentexte; „Aus meinem Vorrat“ heißt jetzt „Was koche ich?“

## 0.4.0 – Etappe 1: Technik & Bedienung (16.11.2026)
- [x] Update-Tests nutzen die veröffentlichte Version 0.3.0 (Commit da170a8) statt eines fehlenden Git-Tags
- [x] Geburtsdatum-Test simuliert ein Altprofil, braucht keine Vorgängerversion mehr
- [x] Versionsmerkmal `<html data-app-version>` für Update-Tests
- [x] Untere Leiste: Start · Rezepte · Woche · Einkauf · Heute · Mehr; Rezept-Umschalter
- [x] Gewicht aus der Einrichtung = erster Verlaufseintrag
- [x] Nur ein Hinweis (Toast) gleichzeitig
- [x] Kompakte Woche, „Weitere Filter“, Kohlenhydrat-Status, Tages-/Wochen-Pfeile, Meal-Prep-Emoji 🥡

## 0.3.0 (16.11.2026 20:04)
- [x] Geburtsdatum statt Alter, einmalige Abfrage nach dem Update
- [x] Gewicht: weight.js, IndexedDB v3 (weightLog), Seite „Gewicht“, Diagramm, Wochenauswertung, Erinnerung (7 Tage)
- [x] Freies Ess-Tracking: core/food.js, eigene Werte, „Zuletzt gegessen“
- [x] Makros in der Tagesbilanz
- [x] Dunkelmodus mit ruhigerem Kontrast
- [x] Backup Version 3, Migration 2 → 3

## Testausführung 0.3.0 (16.11.2026 20:04)
Logik 87/87 · Statik bestanden · Browser/DB 147/147 · E2E 143/143 · Meta T0-01 1/1

## Entscheidungen
- Profile ohne Geburtsdatum behalten ihr Alter, bis das Datum eingetragen wird; die Abfrage erscheint genau einmal.
- Ein Gewichtseintrag je Tag; nur der jüngste Eintrag setzt das Profilgewicht.
- „Tage im Ziel“: ±10 % vom Kalorienziel; Ø kcal/Protein nur aus Tagen mit vollständigen Einträgen.
- Diagramm als SVG über createElementNS (kein innerHTML), Textbeschreibung per aria-label.
