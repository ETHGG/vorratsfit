# Fortschritt VorratsFit 0.2
## Ausgangsstand (Sitzung 1)
- 0.1.0 aus dem Gesprächsverlauf wiederhergestellt (GitHub-Stand laut Nutzer unverändert).
- npm test: Logik 27/27 · Statik bestanden · Browser/DB 38/38 · E2E 55/55
## Phasen
- [x] 0 Migration (DB v2, neue Stores mealPlan/foodLog/quickFoods, Backup v2, run-all.mjs, E2E-Abschnitte)
- [x] 1b Gemeinsame Bedarfsquelle (core/demand.js, Plan + Einzelrezepte gemeinsam, Herkunft mit sourceType/Label)
- [x] 1 Wochenplaner (planner.js, core/plan-logic.js, views/plannerView.js, Navigation „Woche“, „Zum Plan hinzufügen“)
- [x] 2 Tagesbilanz, Kochen, Essen (core/cooking.js, core/day-balance.js, foodlog.js, views/todayView.js, Gekocht/Gegessen/Rückgängig)
- [x] 4 Wochen-Einkaufsliste (Einkaufszeitraum in metadata, Vorschau, „Anderer Zeitraum“, „Alle geplanten“)
- [x] 3 Meal Prep (addMealPrep, deleteMealPrepBox, Haltbarkeitshinweis > 3 Tage, ein Kochvorgang pro Gruppe)
- [x] 5 Schnellerfassen (core/quick-entry.js, Häufig-genutzt-Knöpfe, Mehrzeilen-Eingabe, „Einkauf komplett übernehmen“)
- [x] 6 Teilen (core/share-text.js, Teilen-Menü → Zwischenablage → Textfeld)
- [x] 7 Release (0.2.0, Update-Test von v0.1.0, Netzwerkmitschnitt, Gesamtablauf, README, Abschlussbericht)
## Letzte vollständige Testausführung
- 0.1.0-Basis: Logik 27/27 · Statik ok · Browser/DB 38/38 · E2E 55/55
- Phase 0: Logik 31/31 · Statik ok · Browser/DB 50/50 · E2E 61/61 · Meta T0-01 1/1
- Phase 1b: Logik 37/37 · Statik ok · Browser/DB 60/60 · E2E 61/61 · Meta T0-01 1/1
- Phase 1: Logik 42/42 · Statik ok · Browser/DB 70/70 · E2E 73/73 · Meta T0-01 1/1
- Phase 2: Logik 52/52 · Statik ok · Browser/DB 92/92 · E2E 86/86 · Meta T0-01 1/1
- Phase 4: Logik 56/56 · Statik ok · Browser/DB 99/99 · E2E 90/90 · Meta T0-01 1/1
- Phase 3: Logik 61/61 · Statik ok · Browser/DB 107/107 · E2E 96/96 · Meta T0-01 1/1
- Phase 5: Logik 64/64 · Statik ok · Browser/DB 117/117 · E2E 102/102 · Meta T0-01 1/1
- Phase 6: Logik 66/66 · Statik ok · Browser/DB 119/119 · E2E 107/107 · Meta T0-01 1/1
- Phase 7 / 0.2.0 (16.11.2026 17:43): Logik 68/68 · Statik ok · Browser/DB 122/122 · E2E 121/121 · Meta T0-01 1/1
## Offene Fehler
- keine (offen nur: manuelle iPhone-Prüfung N7-05)
## Nächster Schritt
- Manuelle iPhone-Prüfung N7-05, dann veröffentlichen
## Getroffene Entscheidungen / Abweichungen
- Kein Original-.git verfügbar: lokales Repository neu angelegt, Basis-Commit = 0.1.0.
- B1 (0.1-Test) erwartete fest Backup-Version 1; angepasst auf BACKUP_VERSION, weil CLAUDE.md Abschnitt 5 Version 2 vorschreibt.
- N0-06 als DB-Test im Browser umgesetzt (rohe v1-Verbindung blockiert Upgrade), statt E2E mit zwei Tabs – gleiche Aussage, stabiler.
- P2-12 doppelt abgedeckt: DB-Test (VersionError → verständlicher Text) und E2E mit echtem 0.1-Tab (Git-Tag v0.1.0 unter /vorratsfit-alt/).
- Plan-Einträge mit Datum vor heute, gekocht oder gegessen erzeugen keinen Einkaufsbedarf (planEntryNeedsShopping).
- Meal-Prep-Gruppen sind in core/demand.js bereits als ein Kochvorgang vorbereitet (Kochtag = früheste Box); UI folgt in Phase 3.
- README war beim Wiederherstellen kurz ein Platzhalter; vor dem Commit von 1b wieder vollständig hergestellt.
- Plan-Änderungen berechnen die Einkaufsliste sofort in derselben Transaktion neu; die Einkaufsliste gleicht beim Öffnen immer ab.
- Plan-Einträge speichern den Rezepttitel als Kopie, damit gelöschte Rezepte lesbar bleiben.
- P1-12: Fehlerinjektion im Test brauchte einen zweiten ungekochten Plan-Eintrag, damit die Neuberechnung nach dem Abzug das Profil erneut liest. Erwartung (vollständiges Zurückrollen) unverändert.
- E2E: wait_for_function mit Zeichenkette wird von der CSP der App (kein 'unsafe-eval') blockiert – korrektes App-Verhalten; Test wartet jetzt per Abfrage-Schleife.
- Tagebuch speichert Nährwerte JE PORTION plus Portionszahl; Summen = Wert × Portionen.
- „Geplant“ in der Tagesbilanz zählt je Plan-Eintrag 1 Portion (die eigene Portion), auch wenn für mehrere Personen gekocht wird.
- run-all.mjs dauert inzwischen > 1 Minute; in dieser Umgebung im Hintergrund gestartet und abgefragt.
- Phase 4: Die Logiktests N4-01, P2-10, P2-11, N4-04 waren beim Schreiben bereits grün, weil der Zeitraumfilter schon in Phase 1b (core/demand.js) angelegt war; die DB-Tests schlugen vor der Umsetzung fehl.
- Einkaufszeitraum: Standard = alle kommenden Mahlzeiten; „Einkaufsliste für diese Woche“ setzt den Zeitraum (metadata.shoppingRange), wird beim Neuberechnen gelesen. Bewusst nicht im Backup (Geräteeinstellung).
- Phase 3 E2E: Herkunft steht im eingeklappten Detailbereich; Test klappt ihn jetzt auf (Erwartung unverändert).
- Meal-Prep-Boxen: 2–14 Boxen, je 1 Portion, aufeinanderfolgende Tage; Kochtag = früheste Box bzw. tatsächlicher Kochtag.
- N5-03: Testaufbau eindeutig gemacht (Gleichstand der Häufigkeit war mehrdeutig); Reihenfolge = Häufigkeit, dann zuletzt genutzt.
- E2E „Schnellerfassen“: Test erwartete eine Meldung, korrekt war der Bestätigungsdialog; zusätzlich schließt ein fehlgeschlagener E2E-Abschnitt jetzt offene Dialoge (verhindert Folgefehler in späteren Abschnitten).
- Phase 7: E2E-Update-Test wartete auf den unsichtbaren Seitenleisten-Link „Woche“ (bei 390 px doppelt vorhanden); Test auf die untere Leiste ausgerichtet.
- „Alle Daten löschen“ entfernt zusätzlich Häufigkeiten, Einkaufszeitraum und Backup-Datum (Datenschutz-Bestätigung bleibt).
