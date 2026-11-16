# VorratsFit

**Progressive Web App für Rezepte, Vorräte, Wochenplanung, Einkaufslisten und persönliche Ernährungsziele – ohne Backend, ohne Konto, alle Daten lokal.**

Version 0.2.0 · Live: <https://ethgg.github.io/vorratsfit/>

## 1. Zweck

| Seite | Leitfrage |
|---|---|
| **Aus meinem Vorrat** | Was kann ich mit meinen vorhandenen Lebensmitteln kochen? |
| **Rezepte entdecken** | Was möchte ich kochen? |
| **Woche** | Was esse ich wann – und was koche ich vor? |
| **Heute** | Wie sieht meine Tagesbilanz aus? |
| **Einkaufsliste** | Was muss ich dafür kaufen? |

Ablauf: Profil anlegen → Vorrat erfassen → Rezepte einplanen (einzeln, im Wochenplan oder als Meal Prep) → Einkaufsliste berechnet **nur die Differenz** zum Vorrat → einkaufen und abhaken → kochen (zieht den Vorrat **einmal** ab) → essen (nur Tagebuch) → Tagesbilanz.

## 2. Funktionsumfang

**Seit 0.1**
- Einrichtungsassistent mit 14 Allergenen, Unverträglichkeiten, Ernährungsweisen und Geräten
- Tagesziel nach Mifflin-St.-Jeor; Defizit max. 25 %; unter 18 Jahren keine Abnehmstrategie; manuelles Ziel möglich
- Vorrat mit Gewürze-Reiter, Ablaufwarnung, Suche, Filter, optionalem Barcode (Open Food Facts)
- 36 selbst formulierte Rezepte mit berechneten Nährwerten, Allergenen und Tags; Bewertung bis 100 Punkte
- Allergien = harter Ausschluss; Unverträglichkeiten nur mit hinterlegten Alternativen; fehlende Daten gelten nie als „allergenfrei“
- Einkaufsliste mit Vorschau, Zusammenführung, transaktionssicherem Abhaken und kontrolliertem Rückgängig
- Favoriten, eigene Rezepte, Backup (SHA-256, Base64URL, JSON), PWA offline, Hell/Dunkel, ab 320 px

**Neu in 0.2**
- **Wochenplaner** (Menüpunkt „Woche“): pro Tag Frühstück, Mittag, Abend, Snack; einplanen, verschieben, Portionen ändern, löschen, „Woche leeren“. Im Rezept: „Zum Plan hinzufügen“.
- **Gemeinsame Bedarfsquelle**: Die Einkaufsliste rechnet Einzelrezepte und alle noch nicht gekochten Plan-Einträge zusammen. Herkunft je Artikel: „Einzelrezept“, „Plan Mo Mittag“, „Meal Prep … (4 Boxen)“.
- **Heute**: Tagesbilanz (Ziel, geplant, gegessen, Rest bzw. „über Ziel“), „Gekocht“ und „Gegessen“ getrennt, Schnellerfassen (Banane, Proteinriegel …, eigene Schnell-Lebensmittel), Tagebuch.
- **Kochen und Essen sind getrennt**: „Gekocht“ zieht den Vorrat einmal pro Kochvorgang ab (nie negativ, rückgängig machbar); „Gegessen“ verändert den Vorrat nie.
- **Meal Prep**: 2–14 Boxen (je 1 Portion) aus einem Kochvorgang; Haltbarkeitshinweis ab mehr als 3 Tagen nach dem Kochtag.
- **Wochen-Einkaufsliste**: für diese Woche oder einen frei gewählten Zeitraum, mit Vorschau; Vorrat wird nur einmal abgezogen.
- **Schnellerfassen im Vorrat**: Häufig-genutzt-Knöpfe, mehrere Zeilen auf einmal („500 g Hähnchen“), „Einkauf komplett übernehmen“.
- **Einkaufsliste teilen**: Teilen-Menü (z. B. WhatsApp) → sonst Zwischenablage → sonst Textfeld. Es wird nur die Liste geteilt.

## 3. Projektstruktur

```
index.html, styles.css, app.js, app-update.js, service-worker.js, manifest.webmanifest, offline.html
db.js profile.js pantry.js recipes.js shopping.js planner.js foodlog.js nutrition.js backup.js api.js units.js settings.js
core/    reine Geschäftslogik (in Node testbar): demand, plan-logic, cooking, day-balance, quick-entry, share-text, …
views/   Oberfläche (kein direkter DB-Zugriff): plannerView, todayView, shoppingView, …
data/    recipes.json (36 Rezepte), ingredients.json (94 Zutaten)
tests/   Logik-, IndexedDB-, Statik- und End-to-End-Tests, run-all.mjs
tools/   optionale Hilfsskripte zur Datenpflege (kein Pflicht-Build)
```

## 4. Lokal starten
```bash
python3 -m http.server 8080
```
Dann <http://localhost:8080/> öffnen (nicht per `file://`).

## 5. Veröffentlichen (GitHub Pages)
**Settings → Pages → Deploy from a branch → `main` / `(root)` → Save.** Alle Pfade sind relativ, `.nojekyll` muss im Repository liegen.
**Bei jeder neuen Version `CACHE_VERSION` in `service-worker.js` erhöhen** – sonst sehen installierte Apps das Update nicht. 0.2.0 ist gesetzt.

## 6. Installation
- **iPhone:** Safari → Teilen → „Zum Home-Bildschirm“. Daten in Safari und in der installierten App sind getrennt – zum Übertragen das Backup nutzen.
- **Android:** Chrome → ⋮ → „App installieren“.

## 7. Datenspeicherung, Update und Datenschutz

| Art | Ort |
|---|---|
| Programmdateien | Service-Worker-Cache `vorratsfit-app-<Version>` |
| Persönliche Daten | IndexedDB `vorratsfit-db` (Version 2: zusätzlich `mealPlan`, `foodLog`, `quickFoods`) |
| Farbschema | localStorage |

> Deine persönlichen Daten werden ausschließlich auf diesem Gerät gespeichert. Rezept- und Produktabfragen an externe Anbieter enthalten keine Angaben zu Alter, Gewicht, Kalorienziel oder persönlichen Gesundheitsdaten.

- **Update 0.1 → 0.2:** Die Datenbank wird beim ersten Start automatisch erweitert; es wird nichts gelöscht. Ist noch ein alter Tab offen, wartet das Update und zeigt einen Hinweis.
- **Backup:** Version 2, enthält zusätzlich Wochenplan, Tagebuch und eigene Schnell-Lebensmittel. Backups aus 0.1 werden eingelesen; 0.1 lehnt 0.2-Backups verständlich ab.
- **Nicht im Backup** (Geräteeinstellungen): Häufigkeit der Schnellerfassung und gewählter Einkaufszeitraum. „Alle Daten löschen“ entfernt auch diese.

## 8. Externe Quellen (optional, standardmäßig aus)

| Quelle | Hinweis |
|---|---|
| TheMealDB | Test-Schlüssel `1`; Nutzungsbedingungen prüfen. Nährwerte/Allergene gelten als unvollständig. |
| Open Food Facts | ODbL; Daten können unvollständig oder fehlerhaft sein. |

## 9. Bekannte Einschränkungen
- Nährwerte sind Schätzungen, keine medizinische Beratung; Gewürze nicht eingerechnet.
- „Geplant“ in der Tagesbilanz zählt je Plan-Eintrag eine Portion (deine eigene), auch wenn für mehrere Personen gekocht wird.
- Der Wochenplan reserviert keinen Vorrat für „Aus meinem Vorrat“ (geplant für später).
- Keine Synchronisation zwischen Geräten (nur Backup). Kamera-Barcode-Scan nur mit `BarcodeDetector`.

## 10. Tests

| Test | Befehl |
|---|---|
| **Alles** – bricht nie beim ersten Fehler ab, Zusammenfassung aller Fehlschläge am Ende | `npm test` |
| Logik (Node ≥ 18) | `node tests/run-node.mjs` |
| Statik | `node tests/check-static.mjs` |
| Browser + IndexedDB | `python3 tests/run-browser.py` |
| End-to-End (inkl. echtem Update von Git-Tag `v0.1.0`) | `pip install playwright && python3 -m playwright install chromium && python3 tests/e2e.py` |

Stand 0.2.0: Logik 68/68 · Statik bestanden · Browser/DB 122/122 · E2E 121/121.

## 11. Lizenzen
Code, Rezepte und Stammdaten: MIT (`LICENSE`). Keine externen Bibliotheken.
