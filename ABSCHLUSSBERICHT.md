# Abschlussbericht VorratsFit 0.6.0

Stand: 16.11.2026

## Überblick
Ausgehend von 0.3.0 wurde VorratsFit in drei Etappen überarbeitet und jeweils direkt auf `main` veröffentlicht:

| Version | Etappe | Inhalt |
|---|---|---|
| 0.4.0 | Technik & Bedienung | Untere Leiste Start · Rezepte · Woche · Einkauf · Heute, Rezept-Umschalter, Gewicht aus der Einrichtung als erster Verlaufseintrag, nur ein Hinweis gleichzeitig, kompakte Woche, eingeklappte Filter, Update-Tests ohne Git-Tag |
| 0.5.0 | Neues Aussehen | Bereichsfarben, warmer Grundton, eigene SVG-Illustrationen, Rezeptbilder, neue Startseite, Kalorien-Ring, farbige Makros, Kategorie-Symbole |
| 0.6.0 | Neue Funktionen | Kochmodus mit Timer, Gänge-Reihenfolge, Resteverwertung, Wasser-Tracker, Erfolge, 14 neue Rezepte, eigene Rezeptfotos |

## Datenformat
- IndexedDB Version 4 (neu: `waterLog`) – Migration ergänzt nur, es wird nichts gelöscht.
- Backup Version 4 – ältere Backups (0–3) werden migriert. Eine ältere App lehnt ein neues Backup verständlich ab.

## Letzte vollständige Testausführung (`npm test`)
| Testart | Ergebnis |
|---|---|
| Logik (Node) | **100/100** |
| Statische Prüfung | **bestanden** |
| Browser / IndexedDB | **163/163** |
| End-to-End | **157/157** (inkl. echtem Update von der veröffentlichten 0.3.0) |
| Meta T0-01 | **1/1** |

## Offen / manuell zu prüfen
iPhone: Update-Hinweis → „Jetzt aktualisieren“ → Startseite (Farben, Ring, Wasser, Erfolge) → Rezept → „Kochmodus starten“ (Bildschirm bleibt an, Timer-Ton) → Einkaufsliste „Gänge sortieren“ → eigenes Rezept mit Foto → Dunkelmodus.
