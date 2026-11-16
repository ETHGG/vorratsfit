"""End-to-End-Test für VorratsFit (optional, benötigt Python + Playwright + Chromium).

Aufruf (aus dem Projektordner):
    python tests/e2e.py [--chrome /pfad/zu/chrome]

Der Test kopiert das Projekt in einen temporären Ordner und stellt es unter dem Unterpfad
/vorratsfit/ bereit (wie GitHub Pages). Für den Update-Test wird nur die Kopie verändert.
"""
import argparse
import datetime
import http.server
import os
import re
import shutil
import socketserver
import sys
import tempfile
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESULTS = []


def check(name, cond, detail=''):
    RESULTS.append((name, bool(cond), detail))
    print(('✔ ' if cond else '✘ ') + name + (f' – {detail}' if detail and not cond else ''))


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve(directory, port):
    handler = lambda *a, **k: QuietHandler(*a, directory=directory, **k)  # noqa: E731
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(('127.0.0.1', port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def pantry_amount(page, name):
    return page.evaluate("""async (name) => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('vorratsfit-db'); r.onsuccess = () => res(r.result); r.onerror = rej; });
      const all = await new Promise((res) => { const r = db.transaction('pantry').objectStore('pantry').getAll(); r.onsuccess = () => res(r.result); });
      db.close();
      return all.filter(p => p.name === name).reduce((a, p) => a + p.amount, 0);
    }""", name)


def no_hscroll(page):
    return page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1')


def add_pantry(page, name, amount, unit, category=None, expiry=None):
    form = page.locator('section:has(h2:has-text("Hinzufügen")) form')
    form.locator('[name=name]').fill(name)
    form.locator('[name=amount]').fill(str(amount))
    form.locator('[name=unit]').select_option(unit)
    if category:
        form.locator('[name=category]').select_option(category)
    if expiry:
        form.locator('[name=expiryDate]').fill(expiry)
    form.locator('button[type=submit]').click()
    page.wait_for_selector(f'.pi-name:text-is("{name}")')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--chrome', default=os.environ.get('CHROME_PATH'))
    ap.add_argument('--port', type=int, default=8790)
    args = ap.parse_args()

    tmp = tempfile.mkdtemp(prefix='vf-e2e-')
    site = os.path.join(tmp, 'vorratsfit')
    shutil.copytree(ROOT, site, ignore=shutil.ignore_patterns('.git', 'node_modules', '__pycache__'))
    httpd = serve(tmp, args.port)
    base = f'http://127.0.0.1:{args.port}/vorratsfit/'
    errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=args.chrome) if args.chrome else p.chromium.launch()
        ctx = browser.new_context(viewport={'width': 390, 'height': 844}, locale='de-DE')
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)

        # ---------- Datenschutz & Einrichtung ----------
        page.goto(base)
        page.wait_for_selector('dialog.dialog')
        check('Datenschutzhinweis beim ersten Start', 'ausschließlich auf diesem Gerät' in page.inner_text('dialog.dialog'))
        page.click('dialog button[value=ok]')
        page.wait_for_selector('h1:has-text("Willkommen")')
        page.click('button:has-text("Weiter")')
        check('Pflichtfeldprüfung im Assistenten', 'Bitte gib dein Alter an.' in page.inner_text('form'))
        page.fill('[name=nickname]', 'Erik')
        page.fill('[name=age]', '30'); page.fill('[name=heightCm]', '180'); page.fill('[name=weightKg]', '95'); page.fill('[name=targetWeightKg]', '85')
        page.select_option('[name=sex]', 'male')
        page.click('button:has-text("Weiter")')
        page.select_option('[name=activityLevel]', 'moderate'); page.select_option('[name=goal]', 'lose'); page.fill('[name=weeklyChangeKg]', '0.5')
        page.click('button:has-text("Weiter")')
        page.check('input[name=devices][value=airfryer]'); page.check('input[name=devices][value=mikrowelle]')
        page.click('button:has-text("Weiter")')
        page.check('input[name=allergies][value=erdnuesse]')
        page.check('input[name=intolerances][value=laktose]')
        page.click('button:has-text("Profil speichern")')
        page.wait_for_selector('h1:text-is("Vorrat")')
        check('Profil gespeichert, Weiterleitung zum Vorrat', page.url.endswith('#/vorrat'))

        # ---------- Tagesziel ----------
        page.goto(base + '#/tagesziel')
        page.wait_for_selector('h1:text-is("Tagesziel")')
        txt = page.inner_text('main')
        check('Tagesziel zeigt Grundumsatz/Gesamtverbrauch/Ziel als Schätzung', 'Geschätzter Grundumsatz' in txt and 'Gesamtverbrauch' in txt and 'Schätzung' in txt and 'Ballaststoff' in txt)
        check('Keine NaN/undefined/Infinity im Tagesziel', not re.search(r'NaN|undefined|Infinity', txt))
        page.fill('[name=manualCalorieTarget]', '2200')
        page.click('button:has-text("Speichern")')
        page.wait_for_selector('text=Manuell festgelegt')
        check('Manuelles Kalorienziel wird als „Manuell festgelegt“ markiert', page.locator('text=Manuell festgelegt').count() > 0)

        # ---------- Vorrat ----------
        page.goto(base + '#/vorrat')
        page.wait_for_selector('h1:text-is("Vorrat")')
        add_pantry(page, 'Hähnchenbrustfilet', 300, 'g')
        add_pantry(page, 'Reis (trocken)', 500, 'g')
        add_pantry(page, 'Paprika', 1, 'Stück')
        add_pantry(page, 'Olivenöl', 100, 'ml')
        add_pantry(page, 'Laktosefreie Milch (1,5 % Fett)', 1, 'l', expiry=datetime.date.today().isoformat())
        page.click('#tab-spice')
        add_pantry(page, 'Salz', 500, 'g', category='Gewürze')
        check('Gewürze werden getrennt angezeigt', page.locator('.pi-name:text-is("Salz")').count() == 1 and 'Gewürze (1)' in page.inner_text('#tab-spice'))
        page.click('#tab-food')
        check('Bald ablaufende Lebensmittel gekennzeichnet (Text, nicht nur Farbe)', page.locator('text=Läuft heute ab').count() >= 1)
        page.fill('[name=q]', 'reis')
        check('Vorratssuche filtert', page.locator('.pantry-item').count() == 1)
        page.fill('[name=q]', '')
        page.reload()
        page.wait_for_selector('h1:text-is("Vorrat")')
        page.wait_for_selector('.pi-name')
        check('15 Neustart erhält Vorrat', page.locator('.pantry-item').count() == 5)

        # ---------- Aus meinem Vorrat ----------
        page.goto(base + '#/vorrat-rezepte')
        page.wait_for_selector('h1:text-is("Aus meinem Vorrat")')
        page.wait_for_selector('.recipe-card')
        body = page.inner_text('main')
        check('„Aus meinem Vorrat“ zeigt Match-Prozent und vorhandene/fehlende Zutaten', '% Übereinstimmung' in body and 'Vorhanden:' in body and 'Fehlt:' in body)
        page.click('summary:has-text("ausgeschlossen")')
        check('21 Erdnuss-Rezept wegen Allergie ausgeschlossen (mit Text)', 'Erdnuss-Hähnchen-Bowl' in page.inner_text('.excluded') and 'Erdnüsse' in page.inner_text('.excluded'))
        check('Erdnuss-Rezept nicht normal vorgeschlagen', page.locator('.recipe-card h3:has-text("Erdnuss-Hähnchen-Bowl")').count() == 0)
        page.click('.chip:has-text("vegan")')
        check('Filter „vegan“ wirkt', all('Hähnchen' not in t for t in page.locator('.recipe-card h3').all_inner_texts()))
        page.click('.chip:has-text("vegan")')

        # ---------- Rezepte entdecken ----------
        page.goto(base + '#/entdecken')
        page.wait_for_selector('.recipe-card')
        check('Mindestens 30 lokale Rezepte sichtbar', page.locator('.recipe-card').count() >= 30, str(page.locator('.recipe-card').count()))
        check('Entdecken zeigt „Du hast bereits X von Y benötigten Zutaten.“', page.locator('text=/Du hast bereits \\d+ von \\d+ benötigten Zutaten/').count() > 0)
        page.fill('[name=q]', 'Linsen')
        page.wait_for_timeout(300)
        check('Rezeptsuche', 0 < page.locator('.recipe-card').count() <= 4)
        page.fill('[name=q]', '')
        page.wait_for_timeout(300)
        page.select_option('[name=sort]', 'protein')
        prot = [float(m.replace(',', '.')) for m in re.findall(r'([\d,]+) g Protein', ' '.join(page.locator('.recipe-card .meta').all_inner_texts()))]
        check('Sortierung Protein absteigend', prot == sorted(prot, reverse=True) and len(prot) > 5)
        page.locator('.recipe-card').first.locator('button.fav').click()
        page.wait_for_timeout(200)
        page.goto(base + '#/favoriten')
        page.wait_for_selector('h1:text-is("Favoriten")')
        page.wait_for_selector('.recipe-card')
        check('24 Favoriten gespeichert und angezeigt', page.locator('.recipe-card').count() == 1)

        # ---------- Detail, Portionen, Einkaufsvorschau ----------
        page.goto(base + '#/rezept/airfryer-haehnchen-paprika-reis?portionen=2')
        page.wait_for_selector('h1:has-text("Airfryer-Hähnchen")')
        page.click('button[aria-label="Person mehr"]'); page.click('button[aria-label="Person mehr"]')
        page.wait_for_selector('text=Zutaten für 4 Personen')
        ing = page.inner_text('.ing-list')
        check('06 Portionsskalierung 2→4: 800 g Hähnchen', '800 g' in ing and 'Hähnchenbrustfilet' in ing)
        check('Statusanzeige mit Text („Zu wenig“, „Fehlt“, „Vorhanden“)', 'Zu wenig' in ing and 'Fehlt' in ing and 'Vorhanden' in ing)
        check('Nährwerte als Schätzung gekennzeichnet', 'typischer Zutatenwerte geschätzt' in page.inner_text('main'))
        page.click('button:has-text("Fehlende Zutaten prüfen")')
        page.wait_for_selector('dialog.dialog')
        dlg = page.inner_text('dialog.dialog')
        check('Vorschau „Für 4 Personen“', 'Für 4 Personen' in dlg)
        suff = dlg.split('Bereits ausreichend vorhanden')[1].split('Noch benötigt')[0]
        need = dlg.split('Noch benötigt')[1]
        check('Vorschau: Reis und Öl ausreichend', 'Reis' in suff and 'Olivenöl' in suff, suff)
        check('Vorschau: 500 g Hähnchen, 3 Paprika, 2 Zwiebeln', '500 g Hähnchenbrustfilet' in need and '3 Stück Paprika' in need and '2 Stück Zwiebel' in need, need)
        page.click('dialog button[value=add]')
        page.wait_for_selector('.toast:has-text("Einkaufsliste aktualisiert")')

        page.goto(base + '#/rezept/protein-overnight-oats?portionen=1')
        page.wait_for_selector('h1:has-text("Overnight Oats")')
        check('Unverträglichkeit: hinterlegte Alternative (laktosefreier Skyr)', 'Laktosefreier Skyr' in page.inner_text('main'))

        # ---------- Einkaufsliste ----------
        page.goto(base + '#/einkauf')
        page.wait_for_selector('h1:text-is("Einkaufsliste")')
        page.wait_for_selector('.shop-item')
        lst = page.inner_text('main')
        names = page.locator('.shop-item .shop-name').all_inner_texts()
        check('Nur Differenzen auf der Liste (kein Reis/Öl)', not any(n.startswith('Reis') or n.startswith('Olivenöl') for n in names), ' | '.join(names))
        check('Sortierung nach Gruppen (Obst und Gemüse vor Fleisch und Fisch)', lst.find('Obst und Gemüse') < lst.find('Fleisch und Fisch'))
        chicken = page.locator('.shop-item:has(.shop-name:has-text("Hähnchenbrustfilet"))')
        chicken.locator('input[type=number]').fill('600')
        chicken.locator('input[type=number]').dispatch_event('change')
        page.wait_for_timeout(200)
        chicken.locator('.check-btn').click()
        page.wait_for_selector('.toast:has-text("in den Vorrat übernommen")')
        check('11 Abhaken: 300 g + 600 g gekauft → 900 g im Vorrat', pantry_amount(page, 'Hähnchenbrustfilet') == 900, str(pantry_amount(page, 'Hähnchenbrustfilet')))
        pap = page.locator('.shop-item:not(.done):has(.shop-name:has-text("Paprika –"))')
        pap.locator('.check-btn').dblclick()
        page.wait_for_timeout(800)
        check('13 Doppelklick: Paprika 1 + 3 = 4 (nicht 7)', pantry_amount(page, 'Paprika') == 4, str(pantry_amount(page, 'Paprika')))
        page.reload()
        page.wait_for_selector('h1:text-is("Einkaufsliste")')
        page.wait_for_timeout(500)
        check('12 Neu laden/Rendern fügt nicht erneut hinzu', pantry_amount(page, 'Hähnchenbrustfilet') == 900 and pantry_amount(page, 'Paprika') == 4)

        page.fill('form:has(button:has-text("Artikel hinzufügen")) [name=name]', 'Spülmittel')
        page.fill('form:has(button:has-text("Artikel hinzufügen")) [name=amount]', '1')
        page.click('button:has-text("Artikel hinzufügen")')
        page.wait_for_selector('.shop-name:has-text("Spülmittel")')
        check('Manueller Artikel hinzugefügt', True)

        page.evaluate("""async () => {
          const db = await new Promise((res) => { const r = indexedDB.open('vorratsfit-db'); r.onsuccess = () => res(r.result); });
          const tx = db.transaction('pantry', 'readwrite'); const st = tx.objectStore('pantry');
          const all = await new Promise((res) => { const r = st.getAll(); r.onsuccess = () => res(r.result); });
          const c = all.find(p => p.name === 'Hähnchenbrustfilet'); c.amount = 200; st.put(c);
          await new Promise((res) => { tx.oncomplete = res; }); db.close();
        }""")
        page.reload(); page.wait_for_selector('.shop-item.done')
        page.locator('.shop-item.done:has-text("Hähnchenbrustfilet") .check-btn').click()
        page.wait_for_selector('dialog.dialog')
        d = page.inner_text('dialog.dialog')
        check('23 Rückfrage beim Wiederöffnen mit 3 Optionen', 'bereits deinem Vorrat hinzugefügt' in d and 'Aus Vorrat entfernen' in d and 'Nur auf Einkaufsliste zurücksetzen' in d and 'Abbrechen' in d)
        check('23 Warnung bei verändertem Bestand', 'inzwischen verändert' in d)
        page.click('dialog button[value=removeFromPantry]')
        page.wait_for_timeout(600)
        check('14 Rückgängig: keine negative Menge (200 − min(600,200) = 0)', pantry_amount(page, 'Hähnchenbrustfilet') == 0)

        page.goto(base + '#/rezept/chili-sin-carne?portionen=4')
        page.wait_for_selector('h1:has-text("Chili sin Carne")')
        page.click('button:has-text("Fehlende Zutaten prüfen")')
        page.click('dialog button[value=add]')
        page.wait_for_selector('.toast:has-text("Einkaufsliste aktualisiert")')
        page.goto(base + '#/einkauf')
        page.wait_for_selector('.shop-item')
        z = page.locator('.shop-item:has(.shop-name:has-text("Zwiebel –"))')
        check('21 Zusammengeführt: „Benötigt für 2 Rezepte“, 4 Zwiebeln', 'Benötigt für 2 Rezepte' in z.inner_text() and '4 Stück' in z.inner_text(), z.inner_text())
        page.click('button[aria-label="Chili sin Carne aus der Auswahl entfernen"]')
        page.wait_for_timeout(800)
        z = page.locator('.shop-item:has(.shop-name:has-text("Zwiebel –"))')
        check('Rezept entfernen berechnet gemeinsame Zutaten neu (2 Zwiebeln)', '2 Stück' in z.inner_text() and 'Kidneybohnen' not in page.inner_text('main'), z.inner_text())

        # ---------- Eigenes Rezept & Einstellungen ----------
        page.goto(base + '#/eigenes-rezept')
        page.wait_for_selector('h1:text-is("Eigenes Rezept")')
        page.fill('[name=title]', 'Testbowl')
        page.fill('[name=ingredients]', '200 g Reis\n2 Eier\n1 TL Salz')
        page.fill('[name=instructions]', 'Reis kochen\nEier braten')
        page.click('button:has-text("Rezept speichern")')
        page.wait_for_selector('h1:text-is("Testbowl")')
        check('Eigenes Rezept gespeichert und angezeigt', 'Reis' in page.inner_text('.ing-list') and 'Eigenes Rezept' in page.inner_text('main'))
        page.goto(base + '#/einstellungen')
        page.wait_for_selector('h1:text-is("Einstellungen")')
        check('Externe Quellen standardmäßig deaktiviert', not page.is_checked('[name=externalRecipes]') and not page.is_checked('[name=externalProducts]'))
        page.select_option('[name=theme]', 'dark')
        check('Dunkler Modus manuell wählbar', page.evaluate("document.documentElement.dataset.theme") == 'dark')
        page.select_option('[name=theme]', 'system')

        # ---------- Backup ----------
        page.goto(base + '#/backup')
        page.wait_for_selector('h1:text-is("Backup")')
        page.click('button:has-text("Backup erstellen")')
        page.wait_for_selector('textarea.code[readonly]')
        code = page.input_value('textarea.code[readonly]')
        check('Backup-Code (Base64URL) erzeugt', bool(re.fullmatch(r'[A-Za-z0-9_-]+', code)))

        ctx2 = browser.new_context(viewport={'width': 390, 'height': 844})
        p2 = ctx2.new_page()
        p2.goto(base + '#/backup')
        p2.click('dialog button[value=ok]')
        p2.wait_for_selector('h1:text-is("Backup")')
        tampered = code[:-6] + ('A' if code[-6] != 'A' else 'B') + code[-5:]
        p2.fill('textarea[name=code]', tampered)
        p2.click('button:has-text("Backup prüfen")')
        p2.wait_for_selector('.notice-error')
        check('18 Manipulierter Code wird abgelehnt', 'Prüfsumme' in p2.inner_text('.notice-error') or 'gelesen' in p2.inner_text('.notice-error'))
        p2.fill('textarea[name=code]', code)
        p2.click('button:has-text("Backup prüfen")')
        p2.wait_for_selector('text=Importvorschau')
        check('Importvorschau angezeigt', 'Vorrat' in p2.inner_text('table'))
        p2.click('button:has-text("Import durchführen")')
        p2.wait_for_selector('text=Import abgeschlossen')
        p2.goto(base + '#/vorrat')
        p2.wait_for_selector('.pi-name')
        check('Wiederherstellung auf anderem Gerät: Vorrat übertragen', p2.locator('.pantry-item').count() >= 5)
        ctx2.close()

        # ---------- Offline ----------
        page.goto(base + '#/start')
        page.wait_for_function('navigator.serviceWorker.controller !== null', timeout=15000)
        ctx.set_offline(True)
        page.reload()
        page.wait_for_selector('h1')
        page.goto(base + '#/entdecken')
        page.wait_for_selector('.recipe-card')
        check('19 Offline: lokale Rezepte verfügbar', page.locator('.recipe-card').count() >= 30)
        check('Offline-Hinweis angezeigt', page.is_visible('#offline-banner') and 'Du bist offline' in page.inner_text('#offline-banner'))
        page.goto(base + '#/einkauf'); page.wait_for_selector('.shop-item')
        check('Offline: Einkaufsliste verfügbar', page.locator('.shop-item').count() > 0)
        page.goto(base + 'gibt-es-nicht.html')
        check('Offline-Fallback offline.html für nicht gecachte Seiten', 'Du bist offline' in page.inner_text('body'))
        ctx.set_offline(False)

        # ---------- Responsive 320 px & Dark Mode ----------
        page.set_viewport_size({'width': 320, 'height': 700})
        bad = []
        for route in ['start', 'vorrat-rezepte', 'entdecken', 'einkauf', 'vorrat', 'favoriten', 'tagesziel', 'profil', 'backup', 'einstellungen', 'rezept/airfryer-haehnchen-paprika-reis', 'eigenes-rezept']:
            page.goto(base + '#/' + route)
            page.wait_for_selector('h1')
            page.wait_for_timeout(250)
            if not no_hscroll(page):
                bad.append(route)
            if re.search(r'\bNaN\b|undefined|Infinity', page.inner_text('main')):
                bad.append(route + ' (NaN/undefined)')
        check('Ab 320 px ohne horizontales Scrollen, keine NaN/undefined', not bad, ', '.join(bad))
        page.emulate_media(color_scheme='dark')
        page.goto(base + '#/einkauf'); page.wait_for_selector('h1')
        bg = page.evaluate("getComputedStyle(document.body).backgroundColor")
        check('Dark Mode (Systemmodus) aktiv', bg == 'rgb(15, 23, 19)', bg)

        # ---------- Barrierearmut (Basisprüfung) ----------
        problems = []
        for route in ['vorrat', 'einkauf', 'entdecken', 'profil', 'backup', 'einstellungen']:
            page.goto(base + '#/' + route); page.wait_for_selector('h1'); page.wait_for_timeout(200)
            problems += page.evaluate("""(route) => {
              const out = [];
              document.querySelectorAll('main input:not([type=hidden]), main select, main textarea').forEach(el => {
                const labelled = el.getAttribute('aria-label') || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label');
                if (!labelled) out.push(route + ': ' + (el.name || el.type));
              });
              document.querySelectorAll('button, a[href]').forEach(el => {
                const name = (el.getAttribute('aria-label') || el.textContent || '').trim();
                if (!name && el.offsetParent !== null) out.push(route + ': Schaltfläche ohne Namen');
                const r = el.getBoundingClientRect();
                if (el.matches('.btn, .chip, .check-btn, .bottom-nav a') && el.offsetParent !== null && (r.height < 43 || r.width < 43)) out.push(route + ': Touchfläche zu klein ' + (el.textContent || el.getAttribute('aria-label')).trim().slice(0, 20));
              });
              return out;
            }""", route)
        check('Alle Eingaben beschriftet, Schaltflächen benannt, Touchflächen ≥ 44 px', not problems, '; '.join(problems[:8]))

        # ---------- Update ohne Datenverlust ----------
        page.emulate_media(color_scheme='light')
        page.goto(base + '#/start'); page.wait_for_selector('h1')
        before = pantry_amount(page, 'Reis (trocken)')
        sw = os.path.join(site, 'service-worker.js')
        with open(sw, encoding='utf-8') as f:
            src = f.read()
        with open(sw, 'w', encoding='utf-8') as f:
            f.write(src.replace("const CACHE_VERSION = '0.1.0';", "const CACHE_VERSION = '0.1.1-test';"))
        page.evaluate('navigator.serviceWorker.getRegistration().then(r => r.update())')
        page.wait_for_selector('#update-banner:not([hidden])', timeout=15000)
        check('Update-Hinweis mit Datenschutz-Zusage', 'persönlichen Daten, Vorräte und Einkaufslisten bleiben erhalten' in page.inner_text('#update-banner'))
        with page.expect_navigation():
            page.click('#update-banner button:has-text("Jetzt aktualisieren")')
        page.wait_for_selector('h1')
        page.wait_for_timeout(800)
        caches = page.evaluate('caches.keys()')
        check('16 Update: alter Programm-Cache entfernt, neuer aktiv', caches == ['vorratsfit-app-0.1.1-test'], str(caches))
        check('16 Update erhält persönliche Daten (Vorrat, Profil)', pantry_amount(page, 'Reis (trocken)') == before and 'Erik' in page.inner_text('h1'))

        browser.close()
    httpd.shutdown()
    real_errors = [e for e in errors if 'net::ERR_INTERNET_DISCONNECTED' not in e and 'Failed to fetch' not in e and 'status of 504' not in e]
    check('Keine JavaScript-Fehler in der Konsole', not real_errors, ' | '.join(real_errors[:5]))
    failed = [r for r in RESULTS if not r[1]]
    print(f'\n{len(RESULTS) - len(failed)}/{len(RESULTS)} E2E-Prüfungen bestanden')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
