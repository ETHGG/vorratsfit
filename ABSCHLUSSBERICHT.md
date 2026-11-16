# Abschlussbericht VorratsFit 0.2.0

Stand: 16.11.2026 · Release-Commit: siehe `git log` (Tag-Vorschlag: v0.2.0)

## 1. Ausgangslage
- Das GitHub-Repository enthielt laut Nutzer unverändert die ausgelieferte Version 0.1.0. Ein Original-`.git` war nicht verfügbar; 0.1.0 wurde aus dem Projektverlauf wiederhergestellt, als Basis-Commit gesichert und als Git-Tag `v0.1.0` markiert.
- Erster Testlauf (Ausgangsstand): **Logik 27/27 · Statik bestanden · Browser/DB 38/38 · E2E 55/55** – entspricht exakt dem bekannten 0.1-Stand.

## 2. Erstellte und geänderte Dateien
**Neu:** `planner.js`, `foodlog.js`, `core/demand.js`, `core/plan-logic.js`, `core/cooking.js`, `core/day-balance.js`, `core/quick-entry.js`, `core/share-text.js`, `views/plannerView.js`, `views/todayView.js`, `tests/test-cases-v02.js`, `tests/db-tests-v02.js`, `tests/run-all.mjs`, `tests/run-browser.py`, `PROGRESS.md`, `ABSCHLUSSBERICHT.md`
**Geändert:** `db.js`, `core/models.js`, `core/utils.js`, `core/shopping-logic.js`, `backup.js`, `settings.js`, `shopping.js`, `pantry.js`, `app.js`, `service-worker.js`, `styles.css`, `package.json`, `README.md`, `views/router.js`, `views/dom.js`, `views/recipeDetailView.js`, `views/shoppingView.js`, `views/pantryView.js`, `views/startView.js`, `views/backupView.js`, `views/settingsView.js`, `tests/test-cases.js`, `tests/run-node.mjs`, `tests/browser-runner.js`, `tests/check-static.mjs`, `tests/e2e.py`

## 3. Umgesetzte Funktionen je Phase
| Phase | Ergebnis |
|---|---|
| 0 Migration | DB-Version 2 mit `mealPlan`, `foodLog`, `quickFoods` (Datums-Index), Normalisierer, Backup-Version 2 mit Migration 1→2, „Alle Daten löschen“/Import erweitert, verständliche Meldungen bei blockiertem Upgrade und bei neuerer DB-Version, `npm test` läuft immer vollständig durch |
| 1b Bedarfsquelle | Einkaufsliste rechnet Einzelrezepte und ungekochte Plan-Einträge gemeinsam; Herkunft mit `sourceType`/`sourceId`/Label |
| 1 Wochenplaner | Seite „Woche“, Einplanen/Verschieben/Portionen/Löschen/Woche leeren, „Zum Plan hinzufügen“, Status „Passt nicht mehr zu deinem Profil“/„nicht mehr verfügbar“, Navigation (Start unter „Mehr“) |
| 2 Tagesbilanz | Seite „Heute“: Bilanz, Gekocht (einmaliger Abzug, rückgängig), Gegessen (nur Tagebuch), Schnellerfassen, eigene Schnell-Lebensmittel, Tagebuch; Bilanz auch auf Start und im Wochenplaner |
| 4 Wochen-Einkaufsliste | „Einkaufsliste für diese Woche“ und freier Zeitraum mit Vorschau; Zeitraum sichtbar und aufhebbar |
| 3 Meal Prep | 2–14 Boxen als ein Kochvorgang, Haltbarkeitshinweis > 3 Tage, Löschen „nur diese Box“/„alle Boxen“ |
| 5 Schnellerfassen | Häufig-genutzt-Knöpfe, Mehrzeilen-Eingabe mit Vorschau, „Einkauf komplett übernehmen“ (eine Transaktion, idempotent) |
| 6 Teilen | Teilen-Menü → Zwischenablage → Textfeld; nur offene Artikel, keine persönlichen Daten |
| 7 Release | Versionen 0.2.0, echter Update-Test 0.1.0 → 0.2.0, Netzwerkmitschnitt, Gesamtablauf, README |

## 4. Ergebnis der letzten vollständigen Testausführung (`npm test`, 16.11.2026 17:43)
| Testart | Ergebnis |
|---|---|
| Logik (Node) | **68/68** |
| Statische Prüfung | **bestanden** (inkl. P3-11, N7-02) |
| Browser / IndexedDB | **122/122** |
| End-to-End | **121/121** |
| Meta T0-01 (Suite läuft trotz Fehlschlag vollständig) | **1/1** |

Alle 0.1-Tests sind enthalten und grün. Von den 90 Katalog-Tests sind 89 automatisiert und bestanden; N7-05 ist manuell (siehe 6).

## 5. Gefundene und behobene Fehler
| Phase | Fehlschlag | Ursache | Lösung |
|---|---|---|---|
| 0 | B1 (0.1-Test) | erwartete fest Backup-Version 1 | Erwartung auf `BACKUP_VERSION` (=2), weil CLAUDE.md Abschnitt 5 Version 2 vorschreibt |
| 2 | P1-12 | Fehlerinjektion griff nicht (kein zweiter Plan-Eintrag) | Testaufbau ergänzt; Erwartung (vollständiges Zurückrollen) unverändert |
| 2 | E2E Zwei-Tab-Test | `wait_for_function` mit Text wird von der CSP der App (kein `unsafe-eval`) blockiert – korrektes App-Verhalten | Test wartet per Abfrage-Schleife |
| 3 | E2E Meal-Prep-Herkunft | Herkunft steht im eingeklappten Detailbereich | Test klappt ihn auf |
| 5 | N5-03 | Gleichstand der Häufigkeit war mehrdeutig | Testaufbau eindeutig; Reihenfolge = Häufigkeit, dann zuletzt genutzt |
| 5 | E2E „Schnellerfassen“ (+2 Folgefehler) | Test erwartete Meldung statt korrektem Bestätigungsdialog; offener Dialog blockierte Folgeabschnitte | Test korrigiert; fehlgeschlagene Abschnitte schließen jetzt offene Dialoge |
| 7 | E2E Update 0.1→0.2 | Test wartete auf den bei 390 px unsichtbaren Seitenleisten-Link | Test auf die untere Leiste ausgerichtet |

Kein Fehler lag in der Geschäftslogik der App; keine Testerwartung wurde abgeschwächt.

## 6. Offene Punkte und Blockaden
- **N7-05 (manuell, offen):** Prüfung auf einem echten iPhone – Installation über Safari, Teilen-Menü (WhatsApp), Update-Hinweis nach dem Upload von 0.2.0, Offline-Start. Ist nicht automatisierbar. Checkliste:
  - [ ] Nach dem Upload öffnet die installierte App den Hinweis „Neue Version verfügbar“ → „Jetzt aktualisieren“ → Profil und Vorrat sind noch da
  - [ ] „Woche“ in der unteren Leiste, Rezept einplanen
  - [ ] Einkaufsliste → „Liste teilen“ öffnet das iOS-Teilen-Menü, WhatsApp zeigt die Liste
  - [ ] Flugmodus an → App starten → Woche, Heute und Einkaufsliste funktionieren
- Keine technischen Blockaden.

## 7. Abweichungen von der CLAUDE.md
- Kein Original-`.git`: lokales Repository mit Basis-Commit 0.1.0 und einem Commit pro Phase.
- N0-06 als Browser-/DB-Test umgesetzt (rohe v1-Verbindung blockiert das Upgrade) statt E2E mit zwei Tabs; P2-12 zusätzlich als echter E2E-Test mit offenem 0.1-Tab.
- Phase 4: Vier Logiktests waren beim Schreiben bereits grün, weil der Zeitraumfilter schon in Phase 1b angelegt war; die zugehörigen DB-Tests schlugen vorher fehl.
- „Geplant“ in der Tagesbilanz zählt je Plan-Eintrag eine Portion (die eigene), auch wenn für mehrere Personen gekocht wird.
- Der Einkaufszeitraum wird wie die Häufigkeitsdaten als Geräteeinstellung in `metadata` gespeichert und ist nicht im Backup.
- „Alle Daten löschen“ entfernt zusätzlich diese Geräteeinstellungen (über die CLAUDE.md hinaus, aus Datenschutzgründen).
- Die CLAUDE.md selbst liegt nicht in der ZIP – bitte deine Fassung ins Repository legen.

## 8. Veröffentlichung
1. ZIP entpacken. Im Ordner `vorratsfit` sind alle Dateien inkl. `.nojekyll` und `.git` (Historie mit allen Phasen-Commits).
2. Auf GitHub per **Add file → Upload files** den **Inhalt** des Ordners hochladen (ohne den Ordner `.git`) – gleichnamige Dateien werden ersetzt. Alternativ mit Git: `git remote add origin https://github.com/ETHGG/vorratsfit.git` und `git push -f origin HEAD:main` (überschreibt den alten Stand – nur, wenn auf GitHub nichts anderes geändert wurde).
3. `CACHE_VERSION` ist auf **0.2.0** gesetzt – installierte Apps zeigen dadurch den Update-Hinweis. Daten bleiben erhalten.
4. Danach die Checkliste N7-05 auf dem iPhone durchgehen.
Es wurde nichts selbst veröffentlicht oder gepusht.
