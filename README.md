# VorratsFit

**Progressive Web App für Rezepte, Vorräte, Wochenplanung, Einkaufslisten, Ernährungs- und Gewichtstracking – ohne Backend, ohne Konto, alle Daten lokal.**

Version 0.4.0 · Live: <https://ethgg.github.io/vorratsfit/>

## Funktionen

| Bereich | Inhalt |
|---|---|
| Aus meinem Vorrat / Rezepte entdecken | 36 eigene Rezepte, Allergien als harter Ausschluss, Vorratsabgleich, Bewertung bis 100 Punkte |
| Woche | Wochenplaner, Meal Prep (2–14 Boxen), Einkaufsliste für die Woche oder einen Zeitraum |
| Einkaufsliste | nur die Differenz zum Vorrat, Abhaken übernimmt in den Vorrat, „Einkauf komplett übernehmen“, Teilen |
| Vorrat | Gewürze getrennt, Ablaufwarnung, Schnellerfassen, Barcode (optional) |
| **Heute** | Tagesbilanz mit **Kalorien, Protein, Kohlenhydraten, Fett und Ballaststoffen**, Gekocht und Gegessen getrennt, **jedes Lebensmittel frei erfassen** (g/ml/Stück), **eigene Werte**, **„Zuletzt gegessen“**, Schnell-Lebensmittel, Tagebuch |
| **Gewicht** (Menü „Mehr“) | Gewicht eintragen (ein Eintrag je Tag), **Diagramm** mit 7-Tage-Durchschnitt und Wunschgewicht (4 Wochen / 3 Monate / Alles), **Wochenauswertung**, **Erinnerung nach 7 Tagen**; neuester Eintrag = Profilgewicht |
| Profil | **Geburtsdatum** statt Alter – das Alter läuft automatisch weiter; unter 18 gelten die Schutzregeln automatisch |
| Darstellung | Hell, Dunkel (seit 0.3 mit ruhigerem Kontrast), System |

## Neu in 0.4
- **Navigation:** Start · Rezepte · Woche · Einkauf · Heute direkt in der unteren Leiste; „Mein Vorrat / Alle Rezepte / Favoriten“ als Umschalter.
- **Gewicht aus der Einrichtung** wird automatisch erster Eintrag im Verlauf.
- **Ruhigere Hinweise:** immer nur eine Meldung gleichzeitig.
- **Kompakte Woche:** ein „+“ je Tag, nur geplante Mahlzeiten werden angezeigt.
- **Weniger Filter auf einen Blick:** die wichtigsten sichtbar, der Rest unter „Weitere Filter“.
- Kohlenhydrate zeigen jetzt „noch X g“ wie die übrigen Nährwerte.

## Neu in 0.3
- **Geburtsdatum:** Bestehende Profile werden nach dem Update **einmalig** gefragt („Später im Profil“ möglich).
- **Gewichtsverlauf** mit Diagramm, Wochenauswertung und Erinnerung.
- **Freies Ess-Tracking** für 80 Lebensmittel mit Nährwerten, eigene Werte, „Zuletzt gegessen“. Verändert nie den Vorrat.
- **Makros genauer:** Protein (Bereich), Kohlenhydrate (Richtwert), Fett und Ballaststoffe (Mindestmenge). Fehlende Angaben werden nie als 0 gezählt.
- **Dunkelmodus ruhiger:** Text/Hintergrund 13,1:1 statt 15,6:1, weiterhin deutlich über WCAG AA.

## Lokal starten
`python3 -m http.server 8080` → <http://localhost:8080/>

## Veröffentlichen (GitHub Pages)
Settings → Pages → Deploy from a branch → `main` / `(root)`. `.nojekyll` muss im Repository liegen.
**Bei jeder neuen Version `CACHE_VERSION` in `service-worker.js` erhöhen** (0.4.0 ist gesetzt).

## Daten, Update, Datenschutz
- Persönliche Daten: IndexedDB `vorratsfit-db`, Version 3 (neu: `weightLog`). Das Update erweitert die Datenbank, es wird nichts gelöscht.
- Backup Version 3 (inkl. Gewichtsverlauf). Backups aus 0.1 und 0.2 werden eingelesen.
- Externe Abfragen (standardmäßig aus) enthalten nie Alter, Geburtsdatum, Gewicht, Ziele, Plan oder Tagebuch – automatisch per Netzwerkmitschnitt geprüft.

## Bekannte Einschränkungen
- Nährwerte und Ziele sind Schätzungen, keine medizinische Beratung. Die Gewichtsauswertung ist ein Rückblick, keine Prognose.
- Markenprodukte bitte über „Eigene Werte“ erfassen. Keine Synchronisation zwischen Geräten (nur Backup).

## Tests
`npm test` führt alles aus (Logik, Statik, Browser/IndexedDB, End-to-End inkl. echtem Update von Git-Tag `v0.2.0`) und läuft auch nach Fehlschlägen vollständig durch.
Stand 0.3.0: Logik 87/87 · Statik bestanden · Browser/DB 147/147 · E2E 143/143 · T0-01 1/1.

## Lizenz
MIT (`LICENSE`). Keine externen Bibliotheken.
