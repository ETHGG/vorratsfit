# Fortschritt VorratsFit

## Wiederherstellung (16.11.2026)
- Die Arbeitsumgebung wurde zweimal zurückgesetzt. 0.2.0 und 0.3.0 wurden vollständig aus dem Projektverlauf neu geschrieben.
- Git-Historie: Basis-Commit und Tag **v0.2.0**, darauf 0.3.0 mit Tag **v0.3.0**. Ältere Phasen-Commits sind nicht mehr vorhanden.

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

## Letzte vollständige Testausführung (16.11.2026 20:04)
Logik 87/87 · Statik bestanden · Browser/DB 147/147 · E2E 143/143 · Meta T0-01 1/1

## Entscheidungen
- Profile ohne Geburtsdatum behalten ihr Alter, bis das Datum eingetragen wird; die Abfrage erscheint genau einmal.
- Ein Gewichtseintrag je Tag; nur der jüngste Eintrag setzt das Profilgewicht.
- „Tage im Ziel“: ±10 % vom Kalorienziel; Ø kcal/Protein nur aus Tagen mit vollständigen Einträgen.
- Diagramm als SVG über createElementNS (kein innerHTML), Textbeschreibung per aria-label.
