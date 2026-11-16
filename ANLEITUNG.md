# Anleitung: VorratsFit veröffentlichen

Repository: https://github.com/ETHGG/vorratsfit · App: https://ethgg.github.io/vorratsfit/

Änderungen werden direkt per Git auf den Branch `main` übertragen. GitHub Pages
(Settings → Pages → „Deploy from a branch“ → `main` / root) veröffentlicht sie nach 1–2 Minuten automatisch.

Bei jeder neuen Version gleich hochzählen: `package.json` → `version`, `core/models.js` → `APP_VERSION`,
`service-worker.js` → `CACHE_VERSION`. Die statische Prüfung (`npm test`) meldet Abweichungen.

iPhone: Seite in Safari öffnen → Teilen → Zum Home-Bildschirm. Nach einem Update erscheint in der App
„Eine neue Version ist verfügbar“ → „Jetzt aktualisieren“. Deine Daten bleiben erhalten.
