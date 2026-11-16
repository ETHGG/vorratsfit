# Anleitung: VorratsFit auf GitHub veröffentlichen

Repository: https://github.com/ETHGG/vorratsfit · App danach: https://ethgg.github.io/vorratsfit/

1. ZIP entpacken. Den Ordner `vorratsfit` öffnen.
2. Versteckte Dateien sichtbar machen (Mac: Cmd + Umschalt + Punkt; Windows: Ansicht → Ausgeblendete Elemente).
3. Auf GitHub im Repository „uploading an existing file“ anklicken (bzw. Add file → Upload files).
4. Den INHALT des Ordners (alles mit Cmd/Strg + A markieren) ins Upload-Feld ziehen – nicht den Ordner selbst, nicht die ZIP.
5. Commit-Nachricht „VorratsFit MVP 0.1.0“ → Commit changes.
6. Prüfen: `index.html` und `.nojekyll` liegen ganz oben; Ordner `core`, `views`, `data`, `assets`, `tests`, `tools` sind da.
7. Settings → Pages → Source „Deploy from a branch“ → Branch `main`, Ordner `/ (root)` → Save.
8. 1–2 Minuten warten, dann https://ethgg.github.io/vorratsfit/ öffnen.
9. iPhone: in Safari öffnen → Teilen → Zum Home-Bildschirm.

Bei späteren Updates: geänderte Dateien hochladen und vorher `CACHE_VERSION` in `service-worker.js` erhöhen.
