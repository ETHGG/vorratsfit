"""Zusätzliche End-to-End-Abschnitte für Version 0.3 (wird von tests/e2e.py eingebunden).
Geburtsdatum (G), Gewicht (W), freies Ess-Tracking (F), Makros (M), Dunkelmodus (DM)."""
import datetime


def register(g, l):
    check = g['check']
    browser, base, alt_base, page = l['browser'], l['base'], l['alt_base'], l['page']
    onboard, idb_all = g['onboard'], g['idb_all']
    open_pages = g['OPEN_PAGES']
    today = datetime.date.today()
    iso = lambda d: (today + datetime.timedelta(days=d)).isoformat()  # noqa: E731

    def legacy_profile(pg):
        """Simuliert ein Profil aus 0.2 (Alter statt Geburtsdatum, noch nie nach dem Datum gefragt)."""
        pg.evaluate("""() => new Promise((res, rej) => {
            const q = indexedDB.open('vorratsfit-db');
            q.onsuccess = () => {
                const db = q.result; const t = db.transaction(['profile', 'metadata'], 'readwrite');
                const ps = t.objectStore('profile');
                ps.getAll().onsuccess = (e) => { for (const p of e.target.result) { delete p.birthDate; p.age = 30; ps.put(p); } };
                t.objectStore('metadata').delete('birthDatePrompted');
                t.oncomplete = () => { db.close(); res(); }; t.onerror = () => rej(t.error);
            };
        })""")

    def s_birth():
        c = browser.new_context(viewport={'width': 390, 'height': 844})
        bp = c.new_page(); bp.set_default_timeout(15000); open_pages.append(bp)
        onboard(bp, base, 'Geburt')
        g['dismiss_extra_dialogs'](bp)
        legacy_profile(bp)
        bp.goto(base + '#/start'); bp.reload(); bp.wait_for_selector('dialog.dialog:has-text("Geburtsdatum")')
        txt = bp.inner_text('dialog.dialog')
        check('G-E2E Nach dem Update: einmalige Abfrage „Geburtsdatum statt Alter“ mit bisherigem Alter', '30 Jahre' in txt and 'Später' in txt, txt)
        birth = today.replace(year=today.year - 25).isoformat()
        bp.fill('dialog [name=birthDate]', birth)
        bp.click('dialog button[value=ok]'); bp.wait_for_selector('.toast:has-text("Dein Alter: 25 Jahre")')
        prof = idb_all(bp, 'profile')[0]
        check('G-E2E Geburtsdatum gespeichert, Alter automatisch 25 (Geburtstag heute)', prof.get('birthDate') == birth and prof.get('age') == 25, str(prof.get('age')))
        bp.reload(); bp.wait_for_selector('h1'); bp.wait_for_timeout(500)
        check('G-E2E Abfrage erscheint nach dem Speichern nicht erneut', bp.locator('dialog.dialog').count() == 0)
        bp.goto(base + '#/profil'); bp.wait_for_selector('h1:text-is("Profil")')
        check('G-E2E Profil zeigt das Geburtsdatum statt des Alters', bp.input_value('[name=birthDate]') == birth and bp.locator('[name=age]').count() == 0)
        c.close()
        c2 = browser.new_context(viewport={'width': 390, 'height': 844})
        lp = c2.new_page(); lp.set_default_timeout(15000); open_pages.append(lp)
        onboard(lp, base, 'Später')
        g['dismiss_extra_dialogs'](lp)
        legacy_profile(lp)
        lp.goto(base + '#/start'); lp.reload(); lp.wait_for_selector('dialog.dialog:has-text("Geburtsdatum")')
        lp.click('dialog button[value=later]'); lp.wait_for_timeout(300)
        lp.reload(); lp.wait_for_selector('h1:has-text("Hallo Später")'); lp.wait_for_timeout(500)
        check('G-E2E „Später“: kein erneutes Nachfragen, bisheriges Alter bleibt (30)', lp.locator('dialog.dialog').count() == 0 and idb_all(lp, 'profile')[0].get('age') == 30)
        c2.close()

    def s_weight():
        page.goto(base + '#/start'); page.wait_for_selector('h1')
        first = idb_all(page, 'weightLog')
        check('W-E2E (0.4) Gewicht aus der Einrichtung ist erster Verlaufseintrag (95 kg, heute)', len(first) == 1 and first[0]['weightKg'] == 95 and first[0]['date'] == iso(0), str(first))
        check('W-E2E (0.4) Startseite zeigt keine „noch kein Gewicht“-Erinnerung', 'noch kein Gewicht eingetragen' not in page.inner_text('main'))
        page.goto(base + '#/gewicht'); page.wait_for_selector('h1:text-is("Gewicht")')
        for d, w in [(-60, '97.1'), (-14, '96.2'), (-7, '95.4'), (0, '94.9'), (0, '94.8')]:
            page.fill('[name=date]', iso(d)); page.fill('[name=weightKg]', w)
            page.click('button:has-text("Speichern")'); page.wait_for_selector('.toast'); page.wait_for_timeout(250)
        weights = sorted(idb_all(page, 'weightLog'), key=lambda x: x['date'])
        check('W-E2E Ein Eintrag je Tag (zweiter Eintrag heute ersetzt den ersten)', [w['weightKg'] for w in weights] == [97.1, 96.2, 95.4, 94.8], str([w['weightKg'] for w in weights]))
        check('W-E2E Neuester Eintrag wird Profilgewicht', idb_all(page, 'profile')[0]['weightKg'] == 94.8)
        check('W-E2E Diagramm: Standard 4 Wochen zeigt 3 Punkte, keine Erinnerung mehr', page.locator('svg.chart circle').count() == 3 and 'noch kein Gewicht' not in page.inner_text('main'))
        page.click('.chip:has-text("Alles")'); page.wait_for_timeout(200)
        check('W-E2E Zeitraum „Alles“ zeigt alle 4 Punkte', page.locator('svg.chart circle').count() == 4)
        label = page.get_attribute('svg.chart', 'aria-label') or ''
        check('W-E2E Diagramm hat eine Textbeschreibung (Screenreader)', 'Gewichtsverlauf' in label and '94,8 kg' in label, label)
        row = page.inner_text('table.weeks tbody tr:first-child')
        check('W-E2E Wochenauswertung: aktuelle Woche mit Ø-Gewicht und Veränderung', '94,8 kg' in row and '−0,6 kg' in row, row)
        page.goto(base + '#/tagesziel'); page.wait_for_selector('h1:text-is("Tagesziel")')
        check('W-E2E Tagesziel rechnet mit dem neuen Gewicht (keine NaN)', 'NaN' not in page.inner_text('main'))

    def s_food():
        page.goto(base + f'#/heute?datum={iso(-1)}'); page.wait_for_selector('h1:text-is("Heute")')
        before = idb_all(page, 'pantry')
        page.fill('[name=food]', 'Banane'); page.dispatch_event('[name=food]', 'change'); page.wait_for_timeout(200)
        prev = page.inner_text('.food-preview')
        check('F-E2E Banane: Einheit „Stück“ vorgewählt, Vorschau mit Makros', page.input_value('[name=foodUnit]') == 'Stück' and '1 Stück Banane: 108 kcal' in prev and 'Kohlenhydrate 24 g' in prev, prev)
        page.click('button:has-text("Erfassen")'); page.wait_for_selector('.log-item:has-text("Banane (1 Stück)")')
        page.fill('[name=food]', 'Gibt es nicht'); page.dispatch_event('[name=food]', 'change')
        page.click('button:has-text("Erfassen")'); page.wait_for_timeout(200)
        check('F-E2E Unbekanntes Lebensmittel wird nicht geraten, sondern abgelehnt', page.locator('.log-item').count() == 1 and page.locator('[name=food][aria-invalid=true]').count() == 1)
        page.locator('summary:has-text("Eigene Werte")').click()
        cf = page.locator('details:has(summary:has-text("Eigene Werte")) form')
        cf.locator('[name=name]').fill('Döner'); cf.locator('[name=kcal]').fill('650'); cf.locator('[name=protein]').fill('30')
        cf.locator('button[type=submit]').click(); page.wait_for_selector('.log-item:has-text("Döner")')
        logs = page.inner_text('section:has(h2:text-is("Tagebuch"))')
        check('F-E2E Eigene Werte: Döner mit 650 kcal, fehlende Makros als „unbekannt“, nicht 0', '650 kcal' in logs and 'KH unbekannt' in logs, logs)
        macros = page.inner_text('.macros')
        check('M-E2E Tagesbilanz zeigt Protein, Kohlenhydrate, Fett, Ballaststoffe mit Zielen', all(x in macros for x in ['Protein', 'Kohlenhydrate', 'Fett', 'Ballaststoffe', 'mind.', 'ca.']) and 'fehlen Angaben' in macros, macros)
        recent = page.locator('section:has(h2:text-is("Zuletzt gegessen")) .quick-btn')
        check('F-E2E „Zuletzt gegessen“ bietet Döner und Banane an', recent.count() >= 2)
        page.click('section:has(h2:text-is("Zuletzt gegessen")) .quick-btn:has-text("Döner")'); page.wait_for_timeout(400)
        check('F-E2E Ein Tipp wiederholt den Eintrag', page.locator('.log-item:has-text("Döner")').count() == 2)
        check('F-E2E Erfassen verändert den Vorrat nicht', idb_all(page, 'pantry') == before)

    def offline_check(pg, b):
        pg.goto(b + '#/gewicht'); pg.wait_for_selector('svg.chart')
        check('W-E2E Offline: Gewicht und Verlauf verfügbar', pg.locator('svg.chart circle').count() >= 1)

    def dark_check(pg, b):
        ratio = pg.evaluate("""() => {
          const parse = (c) => c.match(/\\d+/g).slice(0, 3).map(Number);
          const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
          const t = lum(parse(getComputedStyle(document.body).color)); const bg = lum(parse(getComputedStyle(document.body).backgroundColor));
          return (Math.max(t, bg) + 0.05) / (Math.min(t, bg) + 0.05);
        }""")
        check('DM-E2E Dunkelmodus: weicherer Kontrast (unter 14:1), weiterhin gut lesbar (über 7:1)', 7 < ratio < 14, f'{ratio:.1f}:1')

    return {
        'before_update': [('Geburtsdatum (0.3)', s_birth, ()), ('Gewicht (0.3)', s_weight, ('Datenschutz & Einrichtung',)), ('Lebensmittel & Makros (0.3)', s_food, ('Datenschutz & Einrichtung', 'Vorrat'))],
        'offline': [('Gewicht offline', offline_check)],
        'routes': ['gewicht'],
        'dark_bg': 'rgb(23, 21, 19)',
        'dark': [('Kontrast', dark_check)],
    }
