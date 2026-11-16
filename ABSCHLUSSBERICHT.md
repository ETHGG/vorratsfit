# Abschlussbericht VorratsFit 0.3.0

Stand: 16.11.2026 20:04

## 1. Ausgangslage
Die Arbeitsumgebung wurde zurückgesetzt. Das Projekt wurde vollständig aus dem Projektverlauf neu erzeugt: zuerst 0.2.0 (Tag `v0.2.0`), darauf 0.3.0 (Tag `v0.3.0`). Die Testsuite prüft dabei auch das echte Update von 0.2.0 auf 0.3.0.

## 2. Umgesetzt in 0.3
| Wunsch | Umsetzung |
|---|---|
| Generelles Ess-Tracking | „Heute“ → Lebensmittel erfassen (80 Lebensmittel, Menge in g/ml/Stück, Vorschau mit Makros), eigene Werte, „Zuletzt gegessen“. Verändert nie den Vorrat. |
| Gewicht tracken | Seite „Gewicht“ (Menü „Mehr“, Hinweis auf der Startseite). Ein Eintrag je Tag; der neueste wird Profilgewicht. |
| Wochenauswertung + Diagramm | SVG-Diagramm mit 7-Tage-Durchschnitt und Wunschgewicht (Standard 4 Wochen), Tabelle der letzten 6 Wochen. |
| Erinnerung | nach 7 Tagen ohne Eintrag |
| Makros genauer | Protein, Kohlenhydrate, Fett, Ballaststoffe mit Ziel, Balken und Status als Text |
| Geburtsdatum beim Update | einmalige Abfrage; Alter läuft automatisch weiter (auch 29.02.); „Später“ möglich |
| Dunkelmodus | Kontrast 13,1:1 statt 15,6:1, entsättigte Farben, alle Kombinationen ≥ 6,7:1 |

## 3. Letzte vollständige Testausführung (`npm test`, 16.11.2026 20:04)
| Testart | Ergebnis |
|---|---|
| Logik (Node) | **87/87** |
| Statische Prüfung | **bestanden** |
| Browser / IndexedDB | **147/147** (inkl. echter 0.2-Datenbank → Version 3) |
| End-to-End | **143/143** (inkl. echtem Update v0.2.0 → 0.3.0, Geburtsdatum-Abfrage, Netzwerkmitschnitt) |
| Meta T0-01 | **1/1** |

## 4. Gefundene und behobene Fehler (während der Entwicklung von 0.3)
| Fehlschlag | Ursache | Lösung |
|---|---|---|
| Diagramm: alle Punkte auf einer x-Position | vertauschte Argumente der Datumsdifferenz | korrigiert, Test W-05 |
| W-03 gleitender Durchschnitt | Testerwartung falsch (7-Tage-Fenster) | Testdaten korrigiert, Grenzfall ergänzt |
| Banane: Einheit „Stück“ nicht vorgewählt | vorherige Einheit blieb stehen | übliche Einheit wird beim Wechsel vorgewählt |
| Wochentabelle „0 von 0“ | Anzeige ohne erfasste Tage | zeigt „–“ |

## 5. Offen
Manuelle iPhone-Prüfung: Update-Hinweis → „Jetzt aktualisieren“ → Geburtsdatum → Gewicht eintragen → Diagramm → „Heute“ → Banane und Döner erfassen → Dunkelmodus.

## 6. Veröffentlichung
ZIP entpacken und den **Inhalt** des Ordners `vorratsfit` **ohne** den Ordner `.git` zu GitHub hochladen (`.nojekyll`, `.gitignore`, README, PROGRESS und dieser Bericht gehören dazu, außerdem deine `CLAUDE.md`). Es wurde nichts selbst veröffentlicht.
