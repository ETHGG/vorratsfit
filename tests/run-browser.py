"""Führt tests/index.html (Logik + IndexedDB) in Chromium aus. Aufruf: python3 tests/run-browser.py [--chrome PFAD]"""
import argparse, http.server, os, shutil, socketserver, sys, tempfile, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--chrome', default=os.environ.get('CHROME_PATH'))
    ap.add_argument('--port', type=int, default=8791)
    a = ap.parse_args()
    tmp = tempfile.mkdtemp(prefix='vf-browser-')
    shutil.copytree(ROOT, os.path.join(tmp, 'vorratsfit'), ignore=shutil.ignore_patterns('.git', 'node_modules', '__pycache__'))
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(('127.0.0.1', a.port), lambda *x, **k: Quiet(*x, directory=tmp, **k))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    code = 1
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(executable_path=a.chrome) if a.chrome else p.chromium.launch()
            pg = b.new_page()
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.goto(f'http://127.0.0.1:{a.port}/vorratsfit/tests/index.html')
            try:
                pg.wait_for_function('document.body.dataset.done', timeout=180000)
            except Exception as e:
                print(f'✘ Browser-Testlauf nicht abgeschlossen: {e}'.splitlines()[0])
            results = pg.evaluate('window.__testResults || []')
            for r in results:
                print(('✔ ' if r['ok'] else '✘ ') + r['name'] + ('' if r['ok'] else f" – {r.get('error')}"))
            for e in errs:
                print(f'✘ JavaScript-Fehler: {e}')
            failed = [r for r in results if not r['ok']]
            print(f'\n{len(results) - len(failed)}/{len(results)} Browser-Tests bestanden')
            code = 0 if results and not failed and not errs else 1
            b.close()
    finally:
        httpd.shutdown()
        shutil.rmtree(tmp, ignore_errors=True)
    sys.exit(code)


if __name__ == '__main__':
    main()
