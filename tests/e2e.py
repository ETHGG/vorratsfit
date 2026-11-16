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
FAILED_SECTIONS = set()
OPEN_PAGES = []


class SkipSection(Exception):
    pass


class section:
    """Abschnitt des Gesamtablaufs. Eine Ausnahme wird als Fehlschlag protokolliert, danach geht es weiter."""

    def __init__(self, name, requires=()):
        self.name = name
        self.requires = requires

    def __enter__(self):
        missing = [r for r in self.requires if r in FAILED_SECTIONS]
        if missing:
            check(f'Abschnitt „{self.name}“', False, f'nicht ausführbar wegen fehlgeschlagenem Abschnitt „{missing[0]}“')
            FAILED_SECTIONS.add(self.name)
            raise SkipSection()
        return self

    def __exit__(self, et, ev, tb):
        if et is None:
            return False
        if et is SkipSection:
            return True
        lines = f'{et.__name__}: {ev}'.splitlines()
        hint = next((l.strip() for l in lines if 'waiting for' in l), '')
        msg = (lines[0][:200] + (f' | {hint[:200]}' if hint else ''))
        check(f'Abschnitt „{self.name}“ ohne Ausnahme', False, msg)
        FAILED_SECTIONS.add(self.name)
        for pg in OPEN_PAGES:
            try:
                pg.evaluate("() => document.querySelectorAll('dialog[open]').forEach(d => d.close())")
            except Exception:
                pass
        return True


def run_section(name, fn, requires=()):
    try:
        with section(name, requires):
            fn()
    except SkipSection:
        pass


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


def wait_value(pg, js, timeout=15):
    """Wartet ohne eval (die App erlaubt per CSP kein 'unsafe-eval') auf einen Wert ungleich None."""
    import time
    end = time.time() + timeout
    while time.time() < end:
        v = pg.evaluate(js)
        if v is not None:
            return v
        pg.wait_for_timeout(100)
    raise TimeoutError(f'Zeitüberschreitung beim Warten auf {js}')


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


def prepare_v01_copy(tmp):
    """Legt die veröffentlichte Version 0.1.0 (Git-Tag v0.1.0) unter /vorratsfit-alt/ ab – gleiche Origin, gleiche IndexedDB."""
    import subprocess
    dest = os.path.join(tmp, 'vorratsfit-alt')
    os.makedirs(dest, exist_ok=True)
    arch = subprocess.run(['git', '-C', ROOT, 'archive', 'v0.1.0'], capture_output=True)
    if arch.returncode != 0:
        return None
    subprocess.run(['tar', '-x', '-C', dest], input=arch.stdout, check=True)
    return dest


def onboard(page, base, nickname='Erik'):
    page.goto(base)
    page.wait_for_selector('dialog.dialog')
    page.click('dialog button[value=ok]')
    page.wait_for_selector('h1:has-text("Willkommen")')
    page.fill('[name=nickname]', nickname)
    page.fill('[name=age]', '30'); page.fill('[name=heightCm]', '180'); page.fill('[name=weightKg]', '95'); page.fill('[name=targetWeightKg]', '85')
    page.select_option('[name=sex]', 'male')
    page.click('button:has-text("Weiter")')
    page.select_option('[name=activityLevel]', 'moderate'); page.select_option('[name=goal]', 'lose'); page.fill('[name=weeklyChangeKg]', '0.5')
    page.click('button:has-text("Weiter")')
    page.click('button:has-text("Weiter")')
    page.click('button:has-text("Profil speichern")')
    page.wait_for_selector('h1:text-is("Vorrat")')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--chrome', default=os.environ.get('CHROME_PATH'))
    ap.add_argument('--port', type=int, default=8790)
    args = ap.parse_args()

    tmp = tempfile.mkdtemp(prefix='vf-e2e-')
    site = os.path.join(tmp, 'vorratsfit')
    shutil.copytree(ROOT, site, ignore=shutil.ignore_patterns('.git', 'node_modules', '__pycache__'))
    alt = prepare_v01_copy(tmp)
    httpd = serve(tmp, args.port)
    base = f'http://127.0.0.1:{args.port}/vorratsfit/'
    alt_base = f'http://127.0.0.1:{args.port}/vorratsfit-alt/'
    errors = []
    S = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=args.chrome) if args.chrome else p.chromium.launch()

        # ================= Phase 0: Migration von 0.1 auf 0.2 =================
        def s_migration():
            if not alt:
                check('P2-12 Zweiter Tab mit 0.1 offen während Upgrade', False, 'nicht ausführbar: Git-Tag v0.1.0 fehlt')
                return
            c0 = browser.new_context(viewport={'width': 390, 'height': 844})
            old = c0.new_page()
            old.set_default_timeout(15000)
            onboard(old, alt_base, 'Alt')
            old.goto(alt_base + '#/vorrat')
            old.wait_for_selector('h1:text-is("Vorrat")')
            form = old.locator('section:has(h2:has-text("Hinzufügen")) form')
            form.locator('[name=name]').fill('Reis (trocken)'); form.locator('[name=amount]').fill('750'); form.locator('[name=unit]').select_option('g')
            form.locator('button[type=submit]').click()
            old.wait_for_selector('.pi-name:text-is("Reis (trocken)")')
            new = c0.new_page()
            new.set_default_timeout(15000)
            new_errors = []
            new.on('pageerror', lambda e: new_errors.append(str(e)))
            new.goto(base + '#/start')
            new.wait_for_selector('h1:has-text("Hallo Alt")')
            check('P1-01 E2E: Daten aus 0.1 nach Upgrade in 0.2 vorhanden (Profil)', True)
            new.goto(base + '#/vorrat'); new.wait_for_selector('.pi-name:text-is("Reis (trocken)")')
            check('P1-01 E2E: Vorrat aus 0.1 nach Upgrade vorhanden', '750 g' in new.inner_text('.pantry-list'))
            old.wait_for_selector('#update-banner:not([hidden])', timeout=10000)
            txt = old.inner_text('#update-banner')
            check('P2-12 Alter 0.1-Tab zeigt verständlichen Hinweis statt technischem Fehler', 'anderen Tab aktualisiert' in txt and 'Daten bleiben erhalten' in txt and 'VersionError' not in txt, txt)
            ver = new.evaluate("new Promise(r => { const q = indexedDB.open('vorratsfit-db'); q.onsuccess = () => { r(q.result.version); q.result.close(); }; })")
            check('Datenbank nach Upgrade auf Version 2', ver == 2, str(ver))
            check('Keine JavaScript-Fehler beim Upgrade in 0.2', not new_errors, ' | '.join(new_errors))
            S['alt_ok'] = True
            c0.close()
        run_section('Migration 0.1 → 0.2', s_migration)

        ctx = browser.new_context(viewport={'width': 390, 'height': 844}, locale='de-DE')
        REQUESTS = []
        ctx.on('request', lambda r: REQUESTS.append((r.url, r.post_data or '')))
        page = ctx.new_page()
        OPEN_PAGES.append(page)
        page.set_default_timeout(15000)
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)

        def s_1():

            page.goto(base)
            page.wait_for_selector('dialog.dialog')
            check('Datenschutzhinweis beim ersten Start', 'ausschließlich auf diesem Gerät' in page.inner_text('dialog.dialog'))
            page.click('dialog button[value=ok]')
            page.wait_for_selector('h1:has-text("Willkommen")')
            page.click('button:has-text("Weiter")')
            check('Pflichtfeld-Fehlermeldungen am richtigen Feld', 'Bitte gib dein Alter an.' in page.inner_text('main'))
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

        run_section('Datenschutz & Einrichtung', s_1, ())

        def s_2():

            page.goto(base + '#/tagesziel')
            page.wait_for_selector('h1:text-is("Tagesziel")')
            txt = page.inner_text('main')
            check('Tagesziel zeigt Grundumsatz/Gesamtverbrauch/Ziel als Schätzung', 'Geschätzter Grundumsatz' in txt and 'Gesamtverbrauch' in txt and 'Schätzung' in txt and 'Ballaststoff' in txt)
            check('Keine NaN/undefined/Infinity im Tagesziel', not re.search(r'NaN|undefined|Infinity', txt))
            page.fill('[name=manualCalorieTarget]', '2200')
            page.click('button:has-text("Speichern")')
            page.wait_for_selector('text=Manuell festgelegt')
            check('Manuelles Kalorienziel wird als „Manuell festgelegt“ markiert', page.locator('text=Manuell festgelegt').count() > 0)

        run_section('Tagesziel', s_2, ('Datenschutz & Einrichtung',))

        def s_3():

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

        run_section('Vorrat', s_3, ('Datenschutz & Einrichtung',))

        def s_4():

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

        run_section('Aus meinem Vorrat', s_4, ('Datenschutz & Einrichtung', 'Vorrat'))

        def s_5():

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

        run_section('Rezepte entdecken', s_5, ('Datenschutz & Einrichtung',))

        def s_6():

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

        run_section('Detail, Portionen, Einkaufsvorschau', s_6, ('Datenschutz & Einrichtung', 'Vorrat'))

        def s_7():

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

        run_section('Einkaufsliste', s_7, ('Datenschutz & Einrichtung', 'Vorrat', 'Detail, Portionen, Einkaufsvorschau'))

        def s_planner():
            tomorrow = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
            monday = (datetime.date.today() + datetime.timedelta(days=1))
            monday = (monday - datetime.timedelta(days=monday.weekday())).isoformat()
            # P3-08: Navigation – „Woche“ in der Leiste, „Start“ im Menü „Mehr“, Logo führt zur Startseite
            page.goto(base + '#/start'); page.wait_for_selector('h1')
            check('P3-08 „Start“ im Menü „Mehr“: „Mehr“ ist aktiv markiert', 'active' in (page.get_attribute('.more-btn', 'class') or ''))
            check('P3-08 Logo führt zur Startseite, „Woche“ in der unteren Leiste', page.get_attribute('.brand', 'href') == '#/start' and page.locator('.bottom-nav > ul a[data-route="woche"]').count() == 1)
            # Zum Plan hinzufügen aus dem Rezeptdetail
            page.goto(base + '#/rezept/chili-sin-carne?portionen=4'); page.wait_for_selector('h1:has-text("Chili sin Carne")')
            page.click('button:has-text("Zum Plan hinzufügen")')
            page.wait_for_selector('dialog.dialog')
            page.fill('dialog [name=date]', tomorrow)
            page.select_option('dialog [name=mealType]', 'abendessen')
            page.click('dialog button[value=ok]')
            page.wait_for_selector('.toast:has-text("Wochenplan")')
            page.goto(base + f'#/woche?start={monday}'); page.wait_for_selector('h1:text-is("Woche")')
            day = page.locator(f'section.day-card[data-date="{tomorrow}"]')
            check('Wochenplaner zeigt eingeplantes Rezept am richtigen Tag', 'Chili sin Carne' in day.inner_text() and 'Abendessen' in day.inner_text(), day.inner_text())
            check('„Woche“ in der Navigation als aktuelle Seite markiert', page.get_attribute('.bottom-nav a[data-route="woche"]', 'aria-current') == 'page')
            page.reload(); page.wait_for_selector(f'section.day-card[data-date="{tomorrow}"] .plan-entry')
            check('N1-02 Plan bleibt nach dem Neuladen erhalten', 'Chili sin Carne' in page.locator(f'section.day-card[data-date="{tomorrow}"]').inner_text())
            # N1-01: ausgeschlossenes Rezept nicht einplanbar
            page.goto(base + '#/rezept/erdnuss-haehnchen-bowl'); page.wait_for_selector('h1:has-text("Erdnuss")')
            check('N1-01 Ausgeschlossenes Rezept: kein „Zum Plan hinzufügen“, Begründung sichtbar', page.locator('button:has-text("Zum Plan hinzufügen")').count() == 0 and 'Erdnüsse' in page.inner_text('main'))
            page.goto(base + f'#/woche?start={monday}'); page.wait_for_selector('h1:text-is("Woche")')
            page.locator(f'section.day-card[data-date="{tomorrow}"] .plan-add').first.click()
            page.wait_for_selector('dialog.dialog')
            opt = page.locator('dialog select[name=recipeId] option', has_text='Erdnuss-Hähnchen-Bowl')
            check('N1-01 Im Planer ist das ausgeschlossene Rezept deaktiviert und begründet', opt.get_attribute('disabled') is not None and 'ausgeschlossen' in opt.inner_text())
            page.click('dialog button[value=cancel]')
            # Linsen-Dal per Planer einplanen (für P2-05)
            page.locator(f'section.day-card[data-date="{tomorrow}"] .plan-add').nth(1).click()
            page.wait_for_selector('dialog.dialog')
            page.select_option('dialog select[name=recipeId]', 'linsen-dal')
            page.fill('dialog [name=servings]', '2')
            page.click('dialog button[value=ok]')
            page.wait_for_selector(f'section.day-card[data-date="{tomorrow}"] .plan-entry:has-text("Linsen-Dal")')
            # P1-03 E2E: Plan-Artikel auf der Einkaufsliste, auch nach erneutem Öffnen
            page.goto(base + '#/einkauf'); page.wait_for_selector('.shop-item')
            page.reload(); page.wait_for_selector('.shop-item')
            txt = page.inner_text('main')
            check('P1-03 E2E: Plan-Artikel (Kidneybohnen, Linsen) bleiben auf der Einkaufsliste', 'Kidneybohnen' in txt and 'Rote Linsen' in txt)
            # P2-05: nachträgliche Allergie
            page.goto(base + '#/profil'); page.wait_for_selector('h1:text-is("Profil")')
            for _ in range(3):
                page.click('button:has-text("Weiter")')
            page.fill('[name=customAllergies]', 'Linsen')
            page.click('button:has-text("Profil speichern")')
            page.wait_for_selector('h1:text-is("Tagesziel")')
            page.goto(base + f'#/woche?start={monday}'); page.wait_for_selector('h1:text-is("Woche")')
            dal = page.locator(f'section.day-card[data-date="{tomorrow}"] .plan-entry:has-text("Linsen-Dal")')
            check('P2-05 E2E: Plan-Eintrag als „Passt nicht mehr zu deinem Profil“ markiert', 'Passt nicht mehr zu deinem Profil' in dal.inner_text(), dal.inner_text())
            page.goto(base + '#/einkauf'); page.wait_for_selector('h1:text-is("Einkaufsliste")'); page.wait_for_timeout(300)
            check('P2-05 E2E: ausgeschlossener Plan-Eintrag wird nicht eingekauft', 'Rote Linsen' not in page.inner_text('main') and 'Kidneybohnen' in page.inner_text('main'))
            page.goto(base + '#/profil'); page.wait_for_selector('h1:text-is("Profil")')
            for _ in range(3):
                page.click('button:has-text("Weiter")')
            page.fill('[name=customAllergies]', '')
            page.click('button:has-text("Profil speichern")')
            page.wait_for_selector('h1:text-is("Tagesziel")')
            # N1-04: Woche leeren
            before = pantry_amount(page, 'Reis (trocken)')
            done_before = None
            page.goto(base + '#/einkauf'); page.wait_for_selector('h1:text-is("Einkaufsliste")')
            done_before = page.locator('.shop-item.done').count()
            page.goto(base + f'#/woche?start={monday}'); page.wait_for_selector('h1:text-is("Woche")')
            page.click('button:has-text("Woche leeren")')
            page.wait_for_selector('dialog.dialog')
            check('N1-04 „Woche leeren“ fragt nach Bestätigung', 'Vorrat' in page.inner_text('dialog.dialog'))
            page.click('dialog button[value=ok]')
            page.wait_for_selector('text=Noch nichts geplant')
            page.goto(base + '#/einkauf'); page.wait_for_selector('h1:text-is("Einkaufsliste")'); page.wait_for_timeout(300)
            check('N1-04 Nach „Woche leeren“: Vorrat und abgehakte Artikel unverändert, Plan-Artikel weg',
                  pantry_amount(page, 'Reis (trocken)') == before and page.locator('.shop-item.done').count() == done_before and 'Kidneybohnen' not in page.inner_text('main'))
        run_section('Wochenplaner', s_planner, ('Datenschutz & Einrichtung', 'Vorrat'))

        def s_today():
            today = datetime.date.today().isoformat()
            tomorrow = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
            # Chili für heute einplanen
            page.goto(base + '#/rezept/chili-sin-carne?portionen=4'); page.wait_for_selector('h1:has-text("Chili sin Carne")')
            page.click('button:has-text("Zum Plan hinzufügen")'); page.wait_for_selector('dialog.dialog')
            page.fill('dialog [name=date]', today); page.select_option('dialog [name=mealType]', 'abendessen')
            page.click('dialog button[value=ok]'); page.wait_for_selector('.toast:has-text("Wochenplan")')
            page.goto(base + '#/heute'); page.wait_for_selector('h1:text-is("Heute")')
            page.wait_for_selector('.today-entry:has-text("Chili sin Carne")')
            bal = page.inner_text('.balance')
            check('Tagesbilanz zeigt Ziel, Geplant und Rest (Text, keine NaN)', 'Ziel' in bal and 'Geplant' in bal and 'noch' in bal and not re.search(r'NaN|undefined', bal), bal)
            # P1-07 E2E: Gekocht im Rezeptdetail, Plan-Eintrag gewählt
            reis_before = pantry_amount(page, 'Reis (trocken)')
            page.goto(base + '#/rezept/chili-sin-carne?portionen=4'); page.wait_for_selector('h1:has-text("Chili sin Carne")')
            page.click('button:has-text("Gekocht – aus Vorrat abziehen")'); page.wait_for_selector('dialog.dialog')
            check('P1-07 Rezeptdetail fragt nach dem passenden Plan-Eintrag', 'Welche Mahlzeit' in page.inner_text('dialog.dialog'))
            page.click('dialog button[value=ok]')
            page.wait_for_selector('dialog.dialog:has-text("gekocht")')
            page.click('dialog button[value=ok]')
            page.wait_for_selector('.toast:has-text("Gekocht")')
            check('P1-07 Vorrat einmal abgezogen (Reis − 200 g)', pantry_amount(page, 'Reis (trocken)') == reis_before - 200, f'{reis_before} → {pantry_amount(page, "Reis (trocken)")}')
            page.goto(base + '#/heute'); page.wait_for_selector('.today-entry:has-text("Chili sin Carne")')
            check('P1-07 Plan-Eintrag als „Gekocht“ markiert', 'Gekocht' in page.inner_text('.today-entry:has-text("Chili sin Carne")'))
            page.goto(base + '#/einkauf'); page.wait_for_selector('h1:text-is("Einkaufsliste")'); page.wait_for_timeout(300)
            check('P1-07 Zutaten kommen nicht erneut auf die Einkaufsliste', 'Kidneybohnen' not in page.inner_text('main'))
            # Gegessen + Schnell erfassen (P1-10 E2E-Sicht)
            reis_mid = pantry_amount(page, 'Reis (trocken)')
            page.goto(base + '#/heute'); page.wait_for_selector('.today-entry:has-text("Chili sin Carne")')
            page.locator('.today-entry:has-text("Chili sin Carne") button:has-text("Gegessen")').dblclick()
            page.wait_for_selector('.log-item:has-text("Chili sin Carne")'); page.wait_for_timeout(400)
            check('P1-09 E2E: Doppelklick auf „Gegessen“ ergibt genau einen Tagebucheintrag', page.locator('.log-item:has-text("Chili sin Carne")').count() == 1)
            check('P1-10 E2E: „Gegessen“ verändert den Vorrat nicht', pantry_amount(page, 'Reis (trocken)') == reis_mid)
            page.click('.quick-btn:has-text("Banane")'); page.wait_for_selector('.log-item:has-text("Banane")')
            check('Schnell erfassen: Banane im Tagebuch, Bilanz „Gegessen“ > 0', page.locator('.log-item').count() == 2 and 'Gegessen' in page.inner_text('.balance'))
            page.locator('details.more summary:has-text("Eigenes Schnell-Lebensmittel")').click()
            page.fill('form [name=name]', 'Mein Proteinriegel'); page.fill('form [name=kcal]', '200'); page.fill('form [name=protein]', '20')
            page.click('form button:has-text("Speichern")'); page.wait_for_selector('.quick-btn:has-text("Mein Proteinriegel")')
            check('Eigenes Schnell-Lebensmittel angelegt und angeboten', True)
            page.goto(base + '#/start'); page.wait_for_selector('h1')
            check('Startseite zeigt die heutige Tagesbilanz', 'Tagesbilanz öffnen' in page.inner_text('main') and 'Gegessen' in page.inner_text('main'))
            # N2-01: „Gekocht“ gleichzeitig in zwei Tabs
            page.goto(base + '#/rezept/gemuese-reis-ei-mikrowelle?portionen=2'); page.wait_for_selector('h1:has-text("Gemüse-Ei-Reis")')
            page.click('button:has-text("Zum Plan hinzufügen")'); page.wait_for_selector('dialog.dialog')
            page.fill('dialog [name=date]', tomorrow); page.fill('dialog [name=servings]', '2')
            page.click('dialog button[value=ok]'); page.wait_for_selector('.toast:has-text("Wochenplan")')
            entry_id = page.evaluate("""async () => { const db = await new Promise(r => { const q = indexedDB.open('vorratsfit-db'); q.onsuccess = () => r(q.result); });
              const all = await new Promise(r => { const q = db.transaction('mealPlan').objectStore('mealPlan').getAll(); q.onsuccess = () => r(q.result); }); db.close();
              return all.find(e => e.recipeId === 'gemuese-reis-ei-mikrowelle').id; }""")
            reis_before = pantry_amount(page, 'Reis (trocken)')
            p2 = ctx.new_page(); p2.set_default_timeout(15000)
            p2.goto(base + '#/heute'); p2.wait_for_selector('h1:text-is("Heute")')
            fire = """(args) => { window.__cookDone = null; (async () => { const st = await import(args.base + 'views/state.js'); const pl = await import(args.base + 'planner.js');
              return pl.cookPlanEntry(args.id, st.shoppingContext()); })().then(r => { window.__cookDone = r.status; }, e => { window.__cookDone = 'Fehler: ' + e.message; }); }"""
            page.evaluate(fire, {'base': base, 'id': entry_id}); p2.evaluate(fire, {'base': base, 'id': entry_id})
            statuses = sorted([wait_value(page, '() => window.__cookDone'), wait_value(p2, '() => window.__cookDone')])
            check('N2-01 „Gekocht“ gleichzeitig in zwei Tabs: einmal gekocht, einmal erkannt', statuses == ['already', 'cooked'], str(statuses))
            check('N2-01 Vorrat nur einmal abgezogen (Reis − 140 g)', pantry_amount(page, 'Reis (trocken)') == reis_before - 140, f'{reis_before} → {pantry_amount(page, "Reis (trocken)")}')
            p2.close()
            # N2-10 E2E: rückgängig über die Oberfläche stellt den Vorrat wieder her
            page.goto(base + f'#/heute?datum={tomorrow}'); page.wait_for_selector('.today-entry:has-text("Gemüse-Ei-Reis")')
            page.click('.today-entry:has-text("Gemüse-Ei-Reis") button:has-text("Gekocht rückgängig")')
            page.wait_for_selector('dialog.dialog'); page.click('dialog button[value=ok]')
            page.wait_for_selector('.toast:has-text("Rückgängig")')
            check('N2-10 E2E: „Gekocht“ rückgängig stellt den Vorrat wieder her', pantry_amount(page, 'Reis (trocken)') == reis_before)
        run_section('Tagesbilanz & Kochen', s_today, ('Datenschutz & Einrichtung', 'Vorrat'))

        def s_weekshop():
            far = datetime.date.today() + datetime.timedelta(days=70)
            far_monday = (far - datetime.timedelta(days=far.weekday())).isoformat()
            # N4-02: leerer Zeitraum
            page.goto(base + f'#/woche?start={far_monday}'); page.wait_for_selector('h1:text-is("Woche")')
            items_before = page.evaluate("""async () => { const db = await new Promise(r => { const q = indexedDB.open('vorratsfit-db'); q.onsuccess = () => r(q.result); });
              const n = await new Promise(r => { const q = db.transaction('shoppingList').objectStore('shoppingList').count(); q.onsuccess = () => r(q.result); }); db.close(); return n; }""")
            page.click('button:has-text("Einkaufsliste für diese Woche")')
            page.wait_for_selector('.notice:has-text("Es wurde nichts übernommen")')
            items_after = page.evaluate("""async () => { const db = await new Promise(r => { const q = indexedDB.open('vorratsfit-db'); q.onsuccess = () => r(q.result); });
              const n = await new Promise(r => { const q = db.transaction('shoppingList').objectStore('shoppingList').count(); q.onsuccess = () => r(q.result); }); db.close(); return n; }""")
            check('N4-02 E2E: leerer Zeitraum – Hinweis, nichts übernommen', items_before == items_after, f'{items_before} → {items_after}')
            # Wochenliste für eine geplante Woche mit Vorschau übernehmen
            d1 = (far + datetime.timedelta(days=1 - far.weekday())).isoformat()
            page.goto(base + '#/rezept/linsen-dal?portionen=4'); page.wait_for_selector('h1:has-text("Linsen-Dal")')
            page.click('button:has-text("Zum Plan hinzufügen")'); page.wait_for_selector('dialog.dialog')
            page.fill('dialog [name=date]', d1); page.click('dialog button[value=ok]'); page.wait_for_selector('.toast:has-text("Wochenplan")')
            page.goto(base + f'#/woche?start={far_monday}'); page.wait_for_selector('.plan-entry:has-text("Linsen-Dal")')
            page.click('button:has-text("Einkaufsliste für diese Woche")'); page.wait_for_selector('dialog.dialog')
            dlg = page.inner_text('dialog.dialog')
            check('Wochenliste: Vorschau mit Herkunft „Plan Di …“ und Übernehmen', 'Rote Linsen' in dlg and 'Plan Di' in dlg, dlg)
            page.click('dialog button[value=ok]'); page.wait_for_selector('h1:text-is("Einkaufsliste")'); page.wait_for_timeout(300)
            txt = page.inner_text('main')
            check('Wochenliste übernommen: Zeitraum angezeigt, Linsen auf der Liste', 'Wochenplan berücksichtigt' in txt and 'Rote Linsen' in txt)
            page.click('button:has-text("Alle geplanten Mahlzeiten berücksichtigen")'); page.wait_for_timeout(400)
            check('Zeitraum aufheben: „alle kommenden“ wird angezeigt', 'Alle kommenden' in page.inner_text('main'))
            # Aufräumen: Plan der fernen Woche leeren
            page.goto(base + f'#/woche?start={far_monday}'); page.wait_for_selector('h1:text-is("Woche")')
            page.click('button:has-text("Woche leeren")'); page.wait_for_selector('dialog.dialog'); page.click('dialog button[value=ok]')
            page.wait_for_selector('text=Noch nichts geplant')
        run_section('Wochen-Einkaufsliste', s_weekshop, ('Datenschutz & Einrichtung', 'Vorrat'))

        def s_mealprep():
            start = datetime.date.today() + datetime.timedelta(days=14)
            monday = (start - datetime.timedelta(days=start.weekday())).isoformat()
            page.goto(base + '#/rezept/haehnchen-meal-prep-boxen'); page.wait_for_selector('h1:has-text("Meal-Prep-Boxen")')
            page.click('button:has-text("Meal Prep planen")'); page.wait_for_selector('dialog.dialog')
            page.fill('dialog [name=boxes]', '5'); page.fill('dialog [name=startDate]', start.isoformat())
            page.click('dialog button[value=ok]'); page.wait_for_selector('.toast:has-text("5 Boxen")')
            page.goto(base + f'#/woche?start={monday}'); page.wait_for_selector('h1:text-is("Woche")')
            page.goto(base + f'#/woche?start={start.isoformat()}'); page.wait_for_selector('.box-tag')
            n_week = page.locator('.box-tag').count()
            later = (start + datetime.timedelta(days=4))
            page.goto(base + f'#/woche?start={later.isoformat()}'); page.wait_for_selector('.box-tag')
            box5 = page.locator('.plan-entry:has-text("Box 5/5")')
            check('P2-09 E2E: Box 5 (4 Tage nach dem Kochtag) zeigt Haltbarkeitshinweis', 'Kühlschrank' in box5.inner_text(), box5.inner_text())
            page.goto(base + '#/einkauf'); page.wait_for_selector('h1:text-is("Einkaufsliste")'); page.wait_for_timeout(300)
            h = page.locator('.shop-item:has(.shop-name:has-text("Hähnchenbrustfilet –"))')
            h.locator('details.sources summary').click()
            src = h.locator('details.sources').inner_text()
            check('Meal Prep: ein Kochvorgang auf der Einkaufsliste (Herkunft „Meal Prep … (5 Boxen)“, 5 Portionen)', h.count() == 1 and src.count('5 Boxen') == 1 and '(5 P.)' in src, src)
            # P2-08: eine Box löschen, dann alle
            page.goto(base + f'#/woche?start={later.isoformat()}'); page.wait_for_selector('.plan-entry:has-text("Box 5/5")')
            page.locator('.plan-entry:has-text("Box 5/5") button[aria-label*="entfernen"]').click()
            page.wait_for_selector('dialog.dialog')
            d = page.inner_text('dialog.dialog')
            check('P2-08 Abfrage „Nur diese Box“ oder „Alle Boxen“', 'Nur diese Box' in d and 'Alle Boxen' in d)
            page.click('dialog button[value=one]'); page.wait_for_selector('.toast:has-text("1 Box entfernt")')
            count = page.evaluate("""async () => { const db = await new Promise(r => { const q = indexedDB.open('vorratsfit-db'); q.onsuccess = () => r(q.result); });
              const all = await new Promise(r => { const q = db.transaction('mealPlan').objectStore('mealPlan').getAll(); q.onsuccess = () => r(q.result); }); db.close();
              return all.filter(e => e.mealPrepGroupId).length; }""")
            check('P2-08 Nach „Nur diese Box“ bleiben 4 Boxen', count == 4, str(count))
            page.goto(base + f'#/woche?start={start.isoformat()}'); page.wait_for_selector('.plan-entry:has-text("Box 1/5")')
            page.locator('.plan-entry:has-text("Box 1/5") button[aria-label*="entfernen"]').click()
            page.wait_for_selector('dialog.dialog'); page.click('dialog button[value=all]')
            page.wait_for_selector('.toast:has-text("4 Boxen entfernt")')
            page.goto(base + '#/einkauf'); page.wait_for_selector('h1:text-is("Einkaufsliste")'); page.wait_for_timeout(300)
            check('P2-08 Nach „Alle Boxen“ kein Meal-Prep-Bedarf mehr', '5 Boxen' not in page.inner_text('main') and '4 Boxen' not in page.inner_text('main'))
            check('Meal Prep: Boxen im Wochenplan sichtbar', n_week >= 1)
        run_section('Meal Prep', s_mealprep, ('Datenschutz & Einrichtung', 'Vorrat'))

        def s_quick():
            page.goto(base + '#/vorrat'); page.wait_for_selector('h1:text-is("Vorrat")')
            page.locator('details.more summary:has-text("Mehrere auf einmal")').click()
            page.fill('textarea[name=bulk]', '400 g Kartoffeln\nKartoffeln 400 g\n3 Tomaten')
            page.click('button:has-text("Vorschau")')
            prev = page.inner_text('.bulk-list')
            check('P3-03 E2E: Vorschau markiert umgedrehte Zeile mit „Menge bitte prüfen“', prev.count('OK') == 2 and 'Menge bitte prüfen' in prev, prev)
            page.click('button:has-text("Gültige Zeilen speichern")')
            page.wait_for_selector('.toast:has-text("2 gespeichert")')
            check('P3-02 E2E: 2 gültige Zeilen gespeichert', pantry_amount(page, 'Kartoffeln') == 400 and pantry_amount(page, 'Tomate') == 3)
            page.wait_for_selector('.quick-btn:has-text("Kartoffeln")')
            page.click('.quick-btn:has-text("Kartoffeln")'); page.wait_for_selector('.toast:has-text("Menge erhöht")')
            check('N5-03 E2E: Häufig-genutzt-Knopf erhöht vorhandene Menge', pantry_amount(page, 'Kartoffeln') == 800)
            # „Einkauf komplett übernehmen“ und N5-01 (zwei Tabs)
            page.goto(base + '#/einkauf'); page.wait_for_selector('h1:text-is("Einkaufsliste")')
            for n in ['Haferflocken', 'Bananen']:
                page.fill('form:has(button:has-text("Artikel hinzufügen")) [name=name]', n)
                page.fill('form:has(button:has-text("Artikel hinzufügen")) [name=amount]', '2')
                page.click('button:has-text("Artikel hinzufügen")'); page.wait_for_selector(f'.shop-name:has-text("{n}")')
            open_before = page.locator('.shop-item:not(.done)').count()
            p2 = ctx.new_page(); p2.set_default_timeout(15000)
            p2.goto(base + '#/einkauf'); p2.wait_for_selector('h1:text-is("Einkaufsliste")')
            fire = """(base) => { window.__allDone = null; (async () => { const st = await import(base + 'views/state.js'); const sh = await import(base + 'shopping.js');
              return sh.checkAllOpen(st.state.catalog); })().then(r => { window.__allDone = r.added; }, e => { window.__allDone = 'Fehler: ' + e.message; }); }"""
            page.evaluate(fire, base); p2.evaluate(fire, base)
            added = sorted([wait_value(page, '() => window.__allDone'), wait_value(p2, '() => window.__allDone')])
            check('N5-01 „Einkauf komplett übernehmen“ in zwei Tabs: keine Doppelbuchung', added[0] == 0 and added[1] >= 2, str(added))
            p2.close()
            check('N5-01 Haferflocken genau einmal im Vorrat (2 Stück)', page.evaluate("""async () => { const db = await new Promise(r => { const q = indexedDB.open('vorratsfit-db'); q.onsuccess = () => r(q.result); });
              const all = await new Promise(r => { const q = db.transaction('pantry').objectStore('pantry').getAll(); q.onsuccess = () => r(q.result); }); db.close();
              return all.filter(p => p.name === 'Haferflocken').reduce((a, p) => a + p.amount, 0); }""") == 2)
            page.reload(); page.wait_for_selector('h1:text-is("Einkaufsliste")'); page.wait_for_timeout(300)
            page.click('button:has-text("Einkauf komplett übernehmen")')
            page.wait_for_selector('.toast, dialog.dialog')
            if page.locator('dialog.dialog').count():
                dlg = page.inner_text('dialog.dialog')
                check('Einkauf komplett übernehmen: Vorschau listet keine bereits übernommenen Artikel', 'Haferflocken' not in dlg and 'Bananen' not in dlg, dlg)
                page.click('dialog button[value=cancel]')
            check('Einkauf komplett übernehmen: Haferflocken/Bananen sind erledigt', open_before >= 2 and not any(n.startswith(('Haferflocken', 'Bananen')) for n in page.locator('.shop-item:not(.done) .shop-name').all_inner_texts()))
        run_section('Schnellerfassen', s_quick, ('Datenschutz & Einrichtung', 'Vorrat'))

        def s_share():
            c = browser.new_context(viewport={'width': 390, 'height': 844}, permissions=['clipboard-read', 'clipboard-write'])
            sp = c.new_page(); sp.set_default_timeout(15000)
            OPEN_PAGES.append(sp)
            onboard(sp, base, 'Teilen')
            sp.goto(base + '#/einkauf'); sp.wait_for_selector('h1:text-is("Einkaufsliste")')
            check('N6-03 Leere Liste: „Liste teilen“ deaktiviert', sp.locator('button:has-text("Liste teilen")').is_disabled())
            for n in ['Hähnchenbrustfilet', 'Spülmittel']:
                sp.fill('form:has(button:has-text("Artikel hinzufügen")) [name=name]', n)
                sp.fill('form:has(button:has-text("Artikel hinzufügen")) [name=amount]', '2')
                sp.click('button:has-text("Artikel hinzufügen")'); sp.wait_for_selector(f'.shop-name:has-text("{n}")')
            # P3-05: Desktop ohne navigator.share → Zwischenablage
            sp.evaluate('() => { delete Navigator.prototype.share; }')
            sp.click('button:has-text("Liste teilen")'); sp.wait_for_selector('.toast:has-text("Zwischenablage")')
            clip = sp.evaluate('() => navigator.clipboard.readText()')
            check('P3-05 Ohne Teilen-Funktion landet die Liste in der Zwischenablage', clip.startswith('🛒 Einkaufsliste') and 'Spülmittel' in clip and 'Teilen' not in clip, clip)
            # N6-01: Teilen-Menü abgebrochen → keine Fehlermeldung
            sp.evaluate("""() => { window.__shared = null; Navigator.prototype.share = function (d) { window.__shared = d.text; return Promise.reject(new DOMException('abgebrochen', 'AbortError')); }; }""")
            sp.click('button:has-text("Liste teilen")'); sp.wait_for_timeout(500)
            check('N6-01 Abgebrochenes Teilen-Menü: keine Fehlermeldung', sp.locator('.toast-error').count() == 0 and 'Hähnchenbrustfilet' in (sp.evaluate('() => window.__shared') or ''))
            # N6-02: Zwischenablage verweigert → Textfeld zum manuellen Kopieren
            sp.evaluate("""() => { delete Navigator.prototype.share; Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('verweigert')) }, configurable: true }); }""")
            sp.click('button:has-text("Liste teilen")'); sp.wait_for_selector('textarea.share-text')
            check('N6-02 Zwischenablage verweigert: Text zum manuellen Kopieren angezeigt', sp.input_value('textarea.share-text').startswith('🛒 Einkaufsliste'))
            c.close()
        run_section('Teilen', s_share)

        def s_privacy():
            # N7-03: Online-Suche aktivieren und Netzwerk mitschneiden – externe Anfragen ohne persönliche Daten
            def fake(route):
                route.fulfill(status=200, content_type='application/json', body='{"meals":[{"idMeal":"52772","strMeal":"Teriyaki Chicken","strCategory":"Chicken","strArea":"Japanese","strInstructions":"Cook.","strIngredient1":"chicken breast","strMeasure1":"400g"}]}')
            ctx.route('https://www.themealdb.com/**', fake)
            page.goto(base + '#/einstellungen'); page.wait_for_selector('h1:text-is("Einstellungen")')
            page.check('[name=externalRecipes]'); page.wait_for_timeout(300)
            page.goto(base + '#/entdecken'); page.wait_for_selector('[name=online]')
            page.fill('[name=online]', 'chicken'); page.click('button:has-text("Online suchen")')
            page.wait_for_selector('.online-item:has-text("Teriyaki")')
            page.goto(base + '#/einstellungen'); page.wait_for_selector('h1:text-is("Einstellungen")')
            page.uncheck('[name=externalRecipes]'); page.wait_for_timeout(200)
            ctx.unroute('https://www.themealdb.com/**')
            external = [(u, b) for (u, b) in REQUESTS if not u.startswith('http://127.0.0.1')]
            leaks = [u for (u, b) in external if re.search(r'Erik|95|2200|kcal|gewicht|weight|allerg|plan|foodLog|tagebuch', u + b, re.I)]
            check('N7-03 Externe Anfragen enthalten keine Profil-, Plan- oder Tagebuchdaten', len(external) >= 1 and not leaks and all('search.php?s=chicken' in u for (u, _) in external), str(external[:3]) + str(leaks[:3]))
        run_section('Datenschutz (Netzwerk)', s_privacy, ('Datenschutz & Einrichtung',))

        def s_fullflow():
            # P2-13: planen → Meal Prep → Wochenliste → abhaken → kochen → essen → Bilanz (frisches Gerät, nachrechenbare Zahlen)
            c = browser.new_context(viewport={'width': 390, 'height': 844})
            fp = c.new_page(); fp.set_default_timeout(15000); OPEN_PAGES.append(fp)
            onboard(fp, base, 'Ablauf')
            today = datetime.date.today()
            monday = (today - datetime.timedelta(days=today.weekday())).isoformat()
            fp.goto(base + '#/rezept/haehnchen-meal-prep-boxen'); fp.wait_for_selector('h1:has-text("Meal-Prep-Boxen")')
            fp.click('button:has-text("Meal Prep planen")'); fp.wait_for_selector('dialog.dialog')
            fp.fill('dialog [name=boxes]', '4'); fp.fill('dialog [name=startDate]', today.isoformat())
            fp.click('dialog button[value=ok]'); fp.wait_for_selector('.toast:has-text("4 Boxen")')
            fp.goto(base + f'#/woche?start={monday}'); fp.wait_for_selector('.box-tag')
            fp.click('button:has-text("Einkaufsliste für diese Woche")'); fp.wait_for_selector('dialog.dialog')
            check('P2-13 Wochenliste: 800 g Hähnchen für 4 Boxen', '800 g Hähnchenbrustfilet' in fp.inner_text('dialog.dialog'))
            fp.click('dialog button[value=ok]'); fp.wait_for_selector('h1:text-is("Einkaufsliste")'); fp.wait_for_selector('.shop-item')
            fp.click('button:has-text("Einkauf komplett übernehmen")'); fp.wait_for_selector('dialog.dialog'); fp.click('dialog button[value=ok]')
            fp.wait_for_selector('.toast:has-text("in den Vorrat übernommen")')
            check('P2-13 Abhaken: 800 g Hähnchen im Vorrat', pantry_amount(fp, 'Hähnchenbrustfilet') == 800)
            fp.goto(base + '#/heute'); fp.wait_for_selector('.today-entry:has-text("Meal-Prep")')
            fp.locator('.today-entry button:has-text("Gekocht")').first.click()
            fp.wait_for_selector('dialog.dialog'); fp.click('dialog button[value=ok]'); fp.wait_for_selector('.toast:has-text("Gekocht")')
            check('P2-13 Kochen: Vorrat einmal für 4 Portionen abgezogen (0 g)', pantry_amount(fp, 'Hähnchenbrustfilet') == 0)
            fp.locator('.today-entry button:has-text("Gegessen")').first.click(); fp.wait_for_selector('.log-item')
            kcal = fp.evaluate("""async () => { const r = await fetch('data/recipes.json').then(x => x.json()); return r.recipes.find(x => x.id === 'haehnchen-meal-prep-boxen').nutritionPerServing.kcal; }""")
            bal = fp.inner_text('.balance')
            check('P2-13 Bilanz: „Gegessen“ = kcal einer Portion, Vorrat unverändert', f'{kcal} kcal' in bal and pantry_amount(fp, 'Hähnchenbrustfilet') == 0, f'{kcal} / {bal}')
            # P3-10: Tastaturbedienung im Wochenplaner
            fp.goto(base + f'#/woche?start={monday}'); fp.wait_for_selector('.plan-add')
            fp.locator('.plan-add').first.focus(); fp.keyboard.press('Enter')
            fp.wait_for_selector('dialog.dialog')
            focused = fp.evaluate('() => !!document.activeElement.closest("dialog")')
            fp.keyboard.press('Escape'); fp.wait_for_timeout(200)
            check('P3-10 Wochenplaner per Tastatur bedienbar (Enter öffnet Dialog, Fokus im Dialog, Esc schließt)', focused and fp.locator('dialog.dialog').count() == 0)
            c.close()
        run_section('Gesamtablauf 0.2', s_fullflow)

        def s_update_from_v01():
            # P1-13: echtes Programm-Update 0.1.0 → 0.2.0 über den Service Worker, mit vorhandenen Daten
            if not alt:
                check('P1-13 Update 0.1 → 0.2', False, 'nicht ausführbar: Git-Tag v0.1.0 fehlt'); return
            upd = os.path.join(tmp, 'vorratsfit-upd')
            shutil.rmtree(upd, ignore_errors=True); shutil.copytree(alt, upd)
            ub = f'http://127.0.0.1:{args.port}/vorratsfit-upd/'
            c = browser.new_context(viewport={'width': 390, 'height': 844})
            up = c.new_page(); up.set_default_timeout(20000); OPEN_PAGES.append(up)
            onboard(up, ub, 'Update')
            up.goto(ub + '#/vorrat'); up.wait_for_selector('h1:text-is("Vorrat")')
            form = up.locator('section:has(h2:has-text("Hinzufügen")) form')
            form.locator('[name=name]').fill('Reis (trocken)'); form.locator('[name=amount]').fill('321'); form.locator('[name=unit]').select_option('g')
            form.locator('button[type=submit]').click(); up.wait_for_selector('.pi-name:text-is("Reis (trocken)")')
            up.goto(ub + '#/start'); up.wait_for_function('navigator.serviceWorker.controller !== null', timeout=20000)
            check('P1-13 Vorher: 0.1 aktiv (kein Menüpunkt „Woche“)', up.locator('a[data-route="woche"]').count() == 0)
            # Programmdateien von 0.2 ausrollen (wie Upload zu GitHub)
            for name in os.listdir(upd):
                pth = os.path.join(upd, name)
                shutil.rmtree(pth) if os.path.isdir(pth) else os.remove(pth)
            shutil.copytree(site, upd, dirs_exist_ok=True)
            up.evaluate('navigator.serviceWorker.getRegistration().then(r => r.update())')
            up.wait_for_selector('#update-banner:not([hidden])', timeout=20000)
            check('P1-13 Update-Hinweis in 0.1 erscheint', 'bleiben erhalten' in up.inner_text('#update-banner'))
            with up.expect_navigation():
                up.click('#update-banner button:has-text("Jetzt aktualisieren")')
            up.wait_for_selector('h1:has-text("Hallo Update")')
            up.wait_for_selector('.bottom-nav a[data-route="woche"]')
            check('P1-13 Nach Update: 0.2 aktiv, Profil erhalten', up.locator('a[data-route="woche"]').count() >= 1)
            check('P1-13 Nach Update: Vorrat aus 0.1 erhalten (321 g Reis)', pantry_amount(up, 'Reis (trocken)') == 321)
            caches = up.evaluate('caches.keys()')
            check('P1-13 Nach Update: nur Programm-Cache 0.2.0', caches == ['vorratsfit-app-0.2.0'], str(caches))
            up.goto(ub + '#/woche'); up.wait_for_selector('.day-card')
            check('P1-13 Nach Update: Wochenplaner funktioniert', up.locator('.day-card').count() == 7)
            c.close()
        run_section('Update 0.1 → 0.2', s_update_from_v01)

        def s_8():

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

        run_section('Eigenes Rezept & Einstellungen', s_8, ('Datenschutz & Einrichtung',))

        def s_9():

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
            if alt:
                c3 = browser.new_context(viewport={'width': 390, 'height': 844})
                p3 = c3.new_page(); p3.set_default_timeout(15000)
                p3.goto(alt_base + '#/backup')
                p3.click('dialog button[value=ok]')
                p3.wait_for_selector('h1:text-is("Backup")')
                p3.fill('textarea[name=code]', code)
                p3.click('button:has-text("Backup prüfen")')
                p3.wait_for_selector('.notice-error')
                check('N0-04 0.1 lehnt ein 0.2-Backup verständlich ab („neuere App-Version“)', 'neueren App-Version' in p3.inner_text('.notice-error'), p3.inner_text('.notice-error'))
                c3.close()
            else:
                check('N0-04 0.1 lehnt ein 0.2-Backup ab', False, 'nicht ausführbar: Git-Tag v0.1.0 fehlt')

        run_section('Backup', s_9, ('Datenschutz & Einrichtung', 'Vorrat'))

        def s_10():

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
            page.goto(base + '#/woche'); page.wait_for_selector('.day-card')
            page.goto(base + '#/heute'); page.wait_for_selector('.balance')
            check('P3-12 Offline: Wochenplan, Tagesbilanz und Tagebuch verfügbar', page.locator('.day-card').count() == 0 and 'Gegessen' in page.inner_text('.balance'))
            page.goto(base + 'gibt-es-nicht.html')
            check('Offline-Fallback offline.html für nicht gecachte Seiten', 'Du bist offline' in page.inner_text('body'))
            ctx.set_offline(False)

        run_section('Offline', s_10, ('Datenschutz & Einrichtung',))

        def s_11():

            page.set_viewport_size({'width': 320, 'height': 700})
            bad = []
            for route in ['start', 'woche', 'heute', 'vorrat-rezepte', 'entdecken', 'einkauf', 'vorrat', 'favoriten', 'tagesziel', 'profil', 'backup', 'einstellungen', 'rezept/airfryer-haehnchen-paprika-reis', 'eigenes-rezept']:
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

        run_section('Responsive 320 px & Dark Mode', s_11, ('Datenschutz & Einrichtung',))

        def s_12():

            problems = []
            for route in ['woche', 'heute', 'vorrat', 'einkauf', 'entdecken', 'profil', 'backup', 'einstellungen']:
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

        run_section('Barrierearmut (Basisprüfung)', s_12, ('Datenschutz & Einrichtung',))

        def s_13():

            page.emulate_media(color_scheme='light')
            page.goto(base + '#/start'); page.wait_for_selector('h1')
            before = pantry_amount(page, 'Reis (trocken)')
            sw = os.path.join(site, 'service-worker.js')
            with open(sw, encoding='utf-8') as f:
                src = f.read()
            with open(sw, 'w', encoding='utf-8') as f:
                f.write(re.sub(r"const CACHE_VERSION = '[^']+';", "const CACHE_VERSION = '9.9.9-test';", src))
            page.evaluate('navigator.serviceWorker.getRegistration().then(r => r.update())')
            page.wait_for_selector('#update-banner:not([hidden])', timeout=15000)
            check('Update-Hinweis mit Datenschutz-Zusage', 'persönlichen Daten, Vorräte und Einkaufslisten bleiben erhalten' in page.inner_text('#update-banner'))
            with page.expect_navigation():
                page.click('#update-banner button:has-text("Jetzt aktualisieren")')
            page.wait_for_selector('h1')
            page.wait_for_timeout(800)
            caches = page.evaluate('caches.keys()')
            check('16 Update: alter Programm-Cache entfernt, neuer aktiv', caches == ['vorratsfit-app-9.9.9-test'], str(caches))
            check('16 Update erhält persönliche Daten (Vorrat, Profil)', pantry_amount(page, 'Reis (trocken)') == before and 'Erik' in page.inner_text('h1'))


        run_section('Update ohne Datenverlust', s_13, ('Datenschutz & Einrichtung', 'Vorrat'))

        browser.close()
    httpd.shutdown()
    real_errors = [e for e in errors if 'net::ERR_INTERNET_DISCONNECTED' not in e and 'Failed to fetch' not in e and 'status of 504' not in e]
    check('Keine JavaScript-Fehler in der Konsole', not real_errors, ' | '.join(real_errors[:5]))
    check('N7-01 Neuinstallation 0.2 ohne Daten: kompletter Ablauf ohne fehlgeschlagenen Abschnitt', not FAILED_SECTIONS, ', '.join(sorted(FAILED_SECTIONS)))
    failed = [r for r in RESULTS if not r[1]]
    print(f'\n{len(RESULTS) - len(failed)}/{len(RESULTS)} E2E-Prüfungen bestanden')
    shutil.rmtree(tmp, ignore_errors=True)
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
