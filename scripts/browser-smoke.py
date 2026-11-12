"""Packaged Firefox smoke tests with a local DOM fixture and mocked API boundary.

The production JS/CSS/HTML bundles are used unmodified. Only a temporary manifest
adds localhost permission and the test background supplies deterministic API data.
This does not establish compatibility with Codeforces' current live DOM.
"""
import argparse
import json
import os
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import tempfile
import threading
import zipfile

from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.support.ui import WebDriverWait

ROOT = Path(__file__).resolve().parents[1]


class FixtureHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/problemset/problem/'):
            html = '''<!doctype html><html><head><title>Codeforces problem fixture</title><style>
            body{margin:24px auto;max-width:1000px;background:#fff;color:#222;font:13px Arial}
            #header{height:70px;border-bottom:1px solid #ddd}.lang-chooser{float:right}
            #pageContent{width:760px;max-width:100%}.problem-statement{padding:20px;border:1px solid #ddd;margin-top:24px}
            .problem-statement .title{text-align:center;font-size:18px;font-weight:bold}
            </style></head><body><div id="header"><strong style="font-size:28px">Codeforces</strong>
            <div class="lang-chooser"><a href="/profile/practice_user">practice_user</a></div></div>
            <div id="pageContent"><div class="problem-statement"><div class="header"><div class="title">C. Practice problem</div></div>
            <p>Find the answer to the problem.</p></div></div></body></html>'''
            data = html.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        native = '' if 'unrated_user' in self.path else '<div id="userRatingGraphHolder" class="roundbox"><h2>Native rating graph</h2><div id="placeholder">Native chart fixture</div></div>'
        html = f'''<!doctype html><html><head><title>Codeforces profile fixture</title><style>
        body{{margin:24px auto;max-width:1000px;background:white;color:#222;font:13px Arial}}
        #header{{height:70px;border-bottom:1px solid #ddd}}.lang-chooser{{float:right}}
        a{{color:#245c96}} #pageContent{{width:760px}} .userbox,.roundbox{{border:1px solid #bbb;padding:20px;margin:20px 0}}
        </style></head><body><div id="header"><strong style="font-size:28px">Codeforces</strong>
        <div class="lang-chooser"><a href="/profile/practice_user">practice_user</a> | <a href="/logout?session=fixture">Logout</a></div></div>
        <div id="pageContent"><div class="userbox"><h1>{self.path.rsplit('/',1)[-1]}</h1><p>Contest rating: 1800</p></div>
        <div class="roundbox" id="unrelated">Unrelated profile content</div>
        {native}<div id="userActivityGraph" class="roundbox">Native activity graph</div></div></body></html>'''
        data = html.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_args):
        pass


MOCK_API = r'''
const smokeRequests = [];
globalThis.fetch = async function(input) {
  const url = new URL(input); smokeRequests.push({url: String(url), at: Date.now()});
  const handle = url.searchParams.get('handle') || url.searchParams.get('handles');
  let result;
  if (handle === 'unavailable') return new Response(JSON.stringify({status:'FAILED',comment:'Fixture API failure'}));
  if (url.pathname.endsWith('user.info')) result = [{handle, ...(handle === 'unrated_user' ? {} : {rating:1800,maxRating:1900})}];
  if (url.pathname.endsWith('user.rating')) result = handle === 'unrated_user' ? [] : [1200,1450,1380,1620,1800].map((rating,i) => ({handle,contestId:i+1,contestName:'Fixture contest '+(i+1),rank:500-i*50,oldRating:i?1200:0,newRating:rating,ratingUpdateTimeSeconds:Math.floor(Date.now()/1000)-(6-i)*86400*30}));
  if (url.pathname.endsWith('user.status')) result = [1,2].map((id,i) => ({id,creationTimeSeconds:Math.floor(Date.now()/1000)-60*i,verdict:'OK',problem:{contestId:100,index:i?'B':'A',name:'Accepted task '+id,rating:1700,tags:['dp']},author:{participantType:'PRACTICE',members:[{handle}]}}));
  if (url.pathname.endsWith('problemset.problems')) result = {problems:[{contestId:200,index:'A',name:'Warmup task',rating:1800,tags:['greedy']},{contestId:200,index:'B',name:'Stretch task',rating:2000,tags:['dp']}]};
  if (result === undefined) throw new Error('Unexpected test API request: '+url);
  return new Response(JSON.stringify({status:'OK',result}));
};
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts')
    parser.add_argument('--timer-only', action='store_true', help='Inspect the packaged problem timer without the profile checks')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault('SE_CACHE_PATH', str(Path(tempfile.gettempdir()) / 'cfchart-selenium'))
    server = ThreadingHTTPServer(('127.0.0.1', 0), FixtureHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    results = []
    with tempfile.TemporaryDirectory(prefix='cfchart-smoke-') as temp:
        archive = Path(temp) / 'cfchart.xpi'
        manifest = json.loads((ROOT / 'dist/manifest.json').read_text())
        manifest['content_scripts'][0]['matches'].append('http://127.0.0.1/*')
        manifest['host_permissions'].append('http://127.0.0.1/*')
        with zipfile.ZipFile(archive, 'w') as package:
            for source in (ROOT / 'dist').rglob('*'):
                if not source.is_file():
                    continue
                relative = source.relative_to(ROOT / 'dist').as_posix()
                data = source.read_bytes()
                if relative == 'manifest.json':
                    data = json.dumps(manifest).encode()
                elif relative == 'background.js':
                    suffix = '\nbrowser.runtime.onMessage.addListener(m => m.type === "CFCHART_SMOKE" ? Promise.resolve({requests:smokeRequests}) : m.type === "CFCHART_SMOKE_OPEN" ? browser.tabs.create({url:browser.runtime.getURL("popup.html")}).then(()=>true) : undefined);'
                    data = MOCK_API.encode() + data + suffix.encode()
                elif relative == 'content.js':
                    suffix = '''\ndocument.documentElement.dataset.cfchartPopup=browser.runtime.getURL('popup.html');
                    window.addEventListener('cfchart-smoke-info',()=>browser.runtime.sendMessage({type:'CFCHART_SMOKE'}).then(data=>document.documentElement.dataset.cfchartInfo=JSON.stringify(data)));'''
                    suffix += "\nwindow.addEventListener('cfchart-smoke-open',()=>browser.runtime.sendMessage({type:'CFCHART_SMOKE_OPEN'}));"
                    data += suffix.encode()
                package.writestr(relative, data)
        options = Options()
        options.add_argument('-headless')
        options.set_preference('extensions.autoDisableScopes', 0)
        driver = webdriver.Firefox(options=options)
        try:
            driver.set_window_size(1280, 1000)
            driver.install_web_extension(str(archive), permanent=False)
            wait = WebDriverWait(driver, 35)
            driver.get(origin + '/profile/viewed_user')

            def shadow(script):
                return driver.execute_script(script)

            def check_timer():
                driver.set_window_size(1280, 900)
                driver.get(origin + '/problemset/problem/2000/C')
                wait.until(lambda _: shadow("return document.querySelector('#cfchart-problem-host')?.shadowRoot?.querySelector('[data-testid=problem-timer-widget]') != null"))
                assert shadow("return document.querySelector('#cfchart-problem-host').shadowRoot.querySelector('[data-testid=timer-digits]').textContent") == '20:00'
                driver.save_screenshot(str(args.output / 'timer-expanded.png'))
                shadow("document.querySelector('#cfchart-problem-host').shadowRoot.querySelector('[aria-label=\"Timer settings\"]').click()")
                driver.save_screenshot(str(args.output / 'timer-settings.png'))
                shadow("document.querySelector('#cfchart-problem-host').shadowRoot.querySelector('[aria-label=\"Timer settings\"]').click()")
                shadow("document.querySelector('#cfchart-problem-host').shadowRoot.querySelector('[aria-label=\"Collapse timer\"]').click()")
                assert shadow("return document.querySelector('#cfchart-problem-host').shadowRoot.querySelector('[data-testid=timer-digits]').textContent") == '20:00'
                driver.save_screenshot(str(args.output / 'timer-collapsed.png'))
                shadow("document.querySelector('#cfchart-problem-host').shadowRoot.querySelector('[aria-label=\"Expand timer\"]').click()")
                driver.set_window_size(420, 900)
                shadow("document.querySelector('#pageContent').style.width='300px'")
                assert shadow("return document.documentElement.scrollWidth <= document.documentElement.clientWidth")
                driver.save_screenshot(str(args.output / 'timer-narrow.png'))
                results.append('Problem timer renders in the packaged extension; collapsed view keeps its clock.')

            if args.timer_only:
                check_timer()
                print(json.dumps({'checks': results, 'screenshots': ['timer-expanded.png', 'timer-settings.png', 'timer-collapsed.png', 'timer-narrow.png']}, indent=2))
                return

            wait.until(lambda _: shadow("return document.querySelector('#cfchart-profile-host')?.shadowRoot?.querySelector('svg') != null"))
            wait.until(lambda _: shadow("return document.querySelector('#cfchart-personal-host')?.shadowRoot?.textContent.includes('Today 2/2')"))
            assert shadow("return document.querySelectorAll('#cfchart-profile-host').length") == 1
            assert shadow("return getComputedStyle(document.querySelector('#userRatingGraphHolder')).display") == 'none'
            assert shadow("return getComputedStyle(document.querySelector('#userActivityGraph')).display") != 'none'
            assert shadow("return getComputedStyle(document.body).backgroundColor") == 'rgb(255, 255, 255)'
            assert shadow("return document.querySelector('#cfchart-profile-host').shadowRoot.textContent.includes('viewed_user')")
            results.append('Packaged content mounts one isolated chart; personal progress stays with practice_user; host styles/activity graph preserved.')
            driver.save_screenshot(str(args.output / 'profile.png'))

            shadow("Array.from(document.querySelector('#cfchart-profile-host').shadowRoot.querySelectorAll('button')).find(b=>b.textContent==='Original').click()")
            wait.until(lambda _: shadow("return getComputedStyle(document.querySelector('#userRatingGraphHolder')).display") != 'none')
            shadow("Array.from(document.querySelector('#cfchart-profile-host').shadowRoot.querySelectorAll('button')).find(b=>b.textContent==='Enhanced').click()")
            wait.until(lambda _: shadow("return getComputedStyle(document.querySelector('#userRatingGraphHolder')).display") == 'none')
            results.append('Original/Enhanced toggle actually restores and conceals the native chart.')

            shadow("window.dispatchEvent(new Event('cfchart-smoke-info'))")
            wait.until(lambda _: shadow("return !!document.documentElement.dataset.cfchartInfo"))
            requests = json.loads(shadow("return document.documentElement.dataset.cfchartInfo"))['requests']
            starts = [item['at'] for item in requests]
            assert all(b - a >= 2000 for a, b in zip(starts, starts[1:])), requests
            results.append(f'Shared API queue spaces {len(starts)} requests by at least two seconds.')

            shadow("document.querySelector('#cfchart-personal-host').shadowRoot.querySelector('button').click()")
            wait.until(lambda _: shadow("return document.querySelector('#cfchart-personal-host').shadowRoot.textContent.includes('practice_user')"))
            assert shadow("return !document.querySelector('#cfchart-personal-host').shadowRoot.textContent.includes('viewed_user')")
            results.append('Personal tracker opens in-page and remains attached to practice_user.')

            driver.get(origin + '/profile/unavailable')
            wait.until(lambda _: shadow("return document.querySelector('#cfchart-profile-host')?.shadowRoot?.textContent.includes('Fixture API failure')"))
            assert shadow("return getComputedStyle(document.querySelector('#userRatingGraphHolder')).display") != 'none'
            results.append('API failure displays an error and leaves the native graph visible.')

            driver.get(origin + '/profile/unrated_user')
            wait.until(lambda _: shadow("return document.querySelector('#cfchart-profile-host')?.shadowRoot?.textContent.includes('Unrated')"))
            assert shadow("return document.querySelector('#cfchart-profile-host').shadowRoot.textContent.includes('ML forecast unavailable')")
            assert not shadow("return document.querySelector('#cfchart-profile-host').shadowRoot.querySelector('.cf-scenario') != null")
            results.append('Unrated profile has no fictional rating/scenario; missing ML model is disclosed.')
            driver.set_window_size(720, 900)
            driver.save_screenshot(str(args.output / 'narrow.png'))
            check_timer()
            report = {'environment': 'Headless Firefox with installed packaged extension; localhost DOM fixture and mocked Codeforces API', 'checks': results, 'liveSite': 'Not established: public profile access returned a Cloudflare challenge.'}
            (args.output / 'browser-smoke.json').write_text(json.dumps(report, indent=2) + '\n')
            print(json.dumps(report, indent=2))
        finally:
            driver.quit()
            server.shutdown()


if __name__ == '__main__':
    main()
