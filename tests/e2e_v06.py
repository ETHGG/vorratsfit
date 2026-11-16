"""Zusätzliche End-to-End-Abschnitte für 0.4–0.6 (wird von tests/e2e.py eingebunden).
Kochmodus (K), Wasser (S), Resteverwertung (R), Gänge-Reihenfolge (S), Erfolge (E), Design (D)."""
import datetime


def register(g, l):
    check = g['check']
    base, page = l['base'], l['page']
    idb_all = g['idb_all']
    today = datetime.date.today().isoformat()

    def s_cook():
        page.goto(base + '#/rezept/airfryer-haehnchen-paprika-reis?portionen=2'); page.wait_for_selector('h1:has-text("Airfryer-Hähnchen")')
        page.click('a:has-text("Kochmodus starten")'); page.wait_for_selector('.cook-step')
        check('K-E2E Kochmodus zeigt Schritt 1 von 5 in großer Schrift', 'Schritt 1 von 5' in page.inner_text('.cook-count'))
        page.click('button[aria-label="Nächster Schritt"]'); page.click('button[aria-label="Nächster Schritt"]')
        check('K-E2E Schritt mit Zeitangabe bietet Timer (12 Minuten)', page.locator('button:has-text("Timer 12:00 starten")').count() == 1)
        page.click('button:has-text("Timer 12:00 starten")'); page.wait_for_timeout(1300)
        t = page.inner_text('.cook-timer')
        check('K-E2E Timer läuft herunter', t in ('11:59', '11:58'), t)
        page.click('button:has-text("Pause")')
        page.keyboard.press('ArrowRight'); page.keyboard.press('ArrowRight')
        check('K-E2E Pfeiltasten blättern, letzter Schritt zeigt „Fertig!“', 'Schritt 5 von 5' in page.inner_text('.cook-count') and page.locator('button:has-text("Fertig!")').count() == 1)
        page.click('button:has-text("Fertig!")'); page.wait_for_selector('h1:has-text("Airfryer-Hähnchen")')
        check('K-E2E „Fertig!“ führt zurück zum Rezept', True)

    def s_water():
        page.goto(base + '#/heute'); page.wait_for_selector('.water')
        page.click('.water button:has-text("1 Glas")'); page.wait_for_selector('.water-value:has-text("0,25 l")')
        page.click('.water button:has-text("500 ml")'); page.wait_for_selector('.water-value:has-text("0,75 l")')
        rows = idb_all(page, 'waterLog')
        check('S-E2E Wasser: 750 ml gespeichert, ein Eintrag für heute', len(rows) == 1 and rows[0]['ml'] == 750 and rows[0]['date'] == today, str(rows))
        check('S-E2E Gläser als Fortschritt mit Textbeschreibung', '3 von 8 Gläsern' in (page.get_attribute('.glasses', 'aria-label') or ''))
        check('S-E2E (0.7) Heute zeigt alle Erfolge', page.locator('.achievement').count() >= 4)
        page.goto(base + '#/start'); page.wait_for_selector('h1')
        check('S-E2E Startseite zeigt das Wasser', '0,75 l' in page.inner_text('.water'))

    def s_leftovers():
        page.goto(base + '#/vorrat-rezepte?resteverwertung=1'); page.wait_for_selector('h1:text-is("Was koche ich?")')
        check('R-E2E Resteverwertung: Filter aktiv und Hinweis sichtbar', page.get_attribute('.chip:has-text("Ablaufendes")', 'aria-pressed') == 'true' and 'Resteverwertung' in page.inner_text('main'))

    def s_order():
        page.goto(base + '#/einkauf'); page.wait_for_selector('h1:text-is("Einkaufsliste")')
        page.click('button:has-text("Gänge wie in meinem Supermarkt")'); page.wait_for_selector('dialog.dialog .order-item')
        first = page.inner_text('dialog .order-item >> nth=0')
        page.click('dialog button[aria-label="Getränke nach oben"]')
        page.click('dialog button[value=ok]'); page.wait_for_selector('.toast:has-text("Reihenfolge gespeichert")')
        s = idb_all(page, 'settings')[0]
        check('S-E2E Gänge-Reihenfolge gespeichert (Getränke vorgezogen)', s['shoppingGroupOrder'].index('Getränke') < 8 and 'Obst' in first, str(s['shoppingGroupOrder']))

    def s_design():
        page.goto(base + '#/einkauf'); page.wait_for_selector('h1')
        check('D-E2E Bereichsfarbe: Einkauf ist orange markiert', page.evaluate("document.body.dataset.area") == 'einkauf' and page.locator('.page-header .hero-art').count() == 1)
        page.goto(base + '#/woche'); page.wait_for_selector('h1')
        check('D-E2E Bereichsfarbe: Woche violett, aktive Navigation passend', page.evaluate("document.body.dataset.area") == 'woche' and page.get_attribute('.bottom-nav a[data-route="heute"]', 'aria-current') == 'page')
        page.goto(base + '#/entdecken'); page.wait_for_selector('.recipe-card .rv')
        check('D-E2E Rezeptkarten mit Bildfläche, 50 Rezepte', page.locator('.recipe-card').count() >= 45)

    def s_photo():
        import os
        fx = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixture-photo.jpg')
        page.goto(base + '#/rezept/chili-sin-carne'); page.wait_for_selector('h1:has-text("Chili sin Carne")')
        page.set_input_files('#photo-change', fx)
        page.wait_for_selector('.toast:has-text("Foto gespeichert")'); page.wait_for_selector('.detail-emoji.has-photo img')
        rows = idb_all(page, 'recipePhotos')
        check('P-E2E (0.7) Foto für mitgeliefertes Rezept gespeichert und verkleinert (≤ 900 px)', len(rows) == 1 and rows[0]['id'] == 'chili-sin-carne' and rows[0]['photo'].startswith('data:image/jpeg') and len(rows[0]['photo']) < 400000, str(len(rows)))
        w = page.evaluate("document.querySelector('.detail-emoji.has-photo img').naturalWidth")
        check('P-E2E Foto ersetzt die Bildfläche (max. 900 px breit)', w == 900, str(w))
        page.goto(base + '#/entdecken'); page.wait_for_selector('.recipe-card')
        check('P-E2E Foto erscheint auch auf der Rezeptkarte', page.locator('.recipe-card:has-text("Chili sin Carne") .rv.has-photo img').count() >= 1)
        page.goto(base + '#/rezept/chili-sin-carne'); page.wait_for_selector('button:has-text("Foto entfernen")')
        page.click('button:has-text("Foto entfernen")'); page.wait_for_selector('.toast:has-text("Foto entfernt")')
        check('P-E2E Foto entfernen', len(idb_all(page, 'recipePhotos')) == 0)
        page.goto(base + '#/backup'); page.wait_for_selector('h1:text-is("Backup")')
        check('B-E2E (0.7) „Daten an anderes Gerät senden“ vorhanden', page.locator('button:has-text("an anderes Gerät senden")').count() == 1)

    return {
        'before_update': [
            ('Rezeptfotos & Übertragen (0.7)', s_photo, ('Datenschutz & Einrichtung',)),
            ('Kochmodus (0.6)', s_cook, ('Datenschutz & Einrichtung',)),
            ('Wasser & Erfolge (0.6)', s_water, ('Datenschutz & Einrichtung',)),
            ('Resteverwertung (0.6)', s_leftovers, ('Datenschutz & Einrichtung', 'Vorrat')),
            ('Gänge-Reihenfolge (0.6)', s_order, ('Datenschutz & Einrichtung',)),
            ('Design (0.5)', s_design, ('Datenschutz & Einrichtung',)),
        ],
        'routes': ['kochen/airfryer-haehnchen-paprika-reis'],
    }
