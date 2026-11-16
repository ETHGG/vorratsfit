# VorratsFit

**Progressive Web App für Rezepte, Vorräte, Einkaufslisten und persönliche Ernährungsplanung – ohne Backend, ohne Konto, alle Daten lokal.**

Version 0.1.0 (MVP) · Live: <https://ethgg.github.io/vorratsfit/>

## 1. Zweck

| Seite | Leitfrage |
|---|---|
| **Aus meinem Vorrat** | Was kann ich mit meinen vorhandenen Lebensmitteln kochen? |
| **Rezepte entdecken** | Was möchte ich kochen? |
| **Einkaufsliste** | Was muss ich dafür kaufen? |

Ablauf: Profil anlegen → Vorrat erfassen → Rezept wählen → Personenzahl festlegen → Mengen skalieren → mit Vorrat vergleichen → **nur die Differenz** auf die Einkaufsliste → gekaufte Menge eintragen → abhaken → Menge wird **genau einmal** in den Vorrat übernommen.

## 2. Funktionsumfang

- Einrichtungsassistent (4 Schritte) inkl. 14 Allergenen, Unverträglichkeiten, Ernährungsweisen, Geräten
- Tagesziel nach Mifflin-St.-Jeor; Defizit max. 25 %; unter 18 Jahren keine Abnehmstrategie; manuelles Ziel möglich
- Vorrat mit Gewürze-Reiter, Ablaufwarnung, Suche, Filter, optionalem Barcode (Open Food Facts)
- 36 selbst formulierte Rezepte mit berechneten Nährwerten, Allergenen und Tags
- Bewertung (max. 100 Punkte): Vorrat 40, Kalorien 15, Protein 15, Zeit 10, Geräte 5, Vorlieben 5, ablaufende Zutaten 10
- Allergien = harter Ausschluss; Unverträglichkeiten nur mit hinterlegten Alternativen; fehlende Daten gelten nie als „allergenfrei“
- Einkaufsliste: Vorschau, Zusammenführung mehrerer Rezepte, Vorrat nur einmal abgezogen, transaktionssicheres Abhaken, kontrolliertes Rückgängig
- Favoriten, eigene Rezepte, Backup (SHA-256, Base64URL, JSON), PWA offline, Hell/Dunkel, ab 320 px

## 3. Projektstruktur

```
index.html, styles.css, app.js, app-update.js, service-worker.js, manifest.webmanifest, offline.html
db.js  profile.js  pantry.js  recipes.js  shopping.js  nutrition.js  backup.js  api.js  units.js  settings.js
core/    reine Geschäftslogik (in Node testbar)
views/   Oberfläche (nur DOM, kein direkter DB-Zugriff)
data/    recipes.json (36 Rezepte), ingredients.json (94 Zutaten)
assets/  Icons
tests/   Logik-, IndexedDB-, Statik- und End-to-End-Tests
tools/   optionale Hilfsskripte zur Datenpflege (kein Pflicht-Build)
```

## 4. Lokal starten

```bash
python3 -m http.server 8080
```
Dann <http://localhost:8080/> öffnen (nicht per `file://`).

## 5. GitHub Pages

**Settings → Pages → Deploy from a branch → `main` / `(root)` → Save.** Alle Pfade sind relativ, Navigation per Hash (`#/einkauf`). `.nojekyll` muss im Repository liegen.

**Bei jeder neuen Version `CACHE_VERSION` in `service-worker.js` erhöhen**, sonst sehen installierte Apps das Update nicht.

## 6. Installation

- **iPhone:** Safari → Teilen → „Zum Home-Bildschirm“. Achtung: Daten in Safari und in der installierten App sind getrennt – zum Übertragen das Backup nutzen.
- **Android:** Chrome → ⋮ → „App installieren“.

## 7. Datenspeicherung und Datenschutz

| Art | Ort |
|---|---|
| Programmdateien | Service-Worker-Cache `vorratsfit-app-<Version>` |
| Persönliche Daten | IndexedDB `vorratsfit-db` |
| Farbschema | localStorage |

> Deine persönlichen Daten werden ausschließlich auf diesem Gerät gespeichert. Rezept- und Produktabfragen an externe Anbieter enthalten keine Angaben zu Alter, Gewicht, Kalorienziel oder persönlichen Gesundheitsdaten.

Keine Konten, kein Backend, keine Tracker. Externe Abfragen sind standardmäßig **aus**. Browserdaten können durch Löschen der Website-Daten verloren gehen → **regelmäßig Backup erstellen**.

## 8. Backup

*Backup → „Backup erstellen“* liefert Code und JSON-Datei. Beim Import werden Format, Version, Struktur und **Prüfsumme** geprüft; Import in einer Transaktion (alles oder nichts), wahlweise Zusammenführen oder Ersetzen. Ältere Backup-Versionen werden migriert.

## 9. Externe Quellen (optional)

| Quelle | Hinweis |
|---|---|
| TheMealDB | Test-Schlüssel `1`; Nutzungsbedingungen vor produktiver Nutzung prüfen. Nährwerte/Allergene gelten als unvollständig. |
| Open Food Facts | ODbL; Daten können unvollständig oder fehlerhaft sein. |
| Edamam | nicht eingebaut (geheimer Schlüssel auf GitHub Pages nicht schützbar). |

## 10. Lizenzen

Code, Rezepte und Stammdaten: MIT (`LICENSE`). Rezepte selbst formuliert. Nährwerte = gerundete Durchschnittswerte. Keine externen Bibliotheken.

## 11. Bekannte Einschränkungen

- Nährwerte sind Schätzungen, keine medizinische Beratung; Gewürze nicht eingerechnet.
- Externe Allergendaten können unvollständig sein – bei schweren Allergien immer selbst prüfen.
- Keine Synchronisation zwischen Geräten (nur Backup).
- Kamera-Barcode-Scan nur mit `BarcodeDetector` (z. B. Chrome auf Android).
- EL/TL/Prise werden nie in g/ml umgerechnet („Menge bitte prüfen“); Stückzahlen werden aufgerundet.

## 12. Tests

| Test | Befehl |
|---|---|
| Logik (Node ≥ 18) | `node tests/run-node.mjs` |
| Statik | `node tests/check-static.mjs` |
| Beides | `npm test` |
| Browser + IndexedDB | Server starten, `/tests/index.html` öffnen |
| End-to-End | `pip install playwright && playwright install chromium && python tests/e2e.py` |

## 13. Ideen für Version 2

Wochenplaner mit Tagesbilanz · verschlüsselte optionale Synchronisation · Preise/Budget · Einkaufsliste teilen · mehrere Haushaltsprofile · Ablauf-Erinnerungen
