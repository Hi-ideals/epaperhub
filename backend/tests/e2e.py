"""Full end-to-end browser test: super admin → client admin → reader. Writes results.json."""
import asyncio, json, os, time, re, urllib.request
from playwright.async_api import async_playwright

# Run against the built app (backend serving frontend/dist):  cd frontend && npm run build ; cd backend && npm start
#   pip install playwright && playwright install chromium
#   E2E_SA_EMAIL=you@mail.com E2E_SA_PASS=YourPass python tests/e2e.py
# It creates a test newspaper "e2etimes", runs every flow, then deletes it.
B = os.environ.get('E2E_BASE', 'http://localhost:5000')
SA = (os.environ.get('E2E_SA_EMAIL', 'admin@example.com'), os.environ.get('E2E_SA_PASS', 'Admin@12345'))
CHROME = os.environ.get('E2E_CHROME')  # optional path to Chrome; default = Playwright's Chromium
SLUG, CEMAIL, CPASS = 'e2etimes', 'owner@e2etimes.com', 'E2eTimes@123'
R = []           # results
ERR = []         # page errors / console errors / failed requests
SHOTS = os.environ.get('E2E_SHOTS', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'e2e-shots')); os.makedirs(SHOTS, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
cur = {'area': ''}

def api(method, path, body=None, token=None, tenant=None):
    req = urllib.request.Request(B + '/api/v1' + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {}), **({'X-Tenant': tenant} if tenant else {})})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')

def make_page(n):
    """Draw a simple newspaper page image for the upload test."""
    from PIL import Image, ImageDraw
    path = os.path.join(SHOTS, f'page{n}.jpg')
    im = Image.new('RGB', (1200, 1700), 'white'); d = ImageDraw.Draw(im)
    d.rectangle((40, 30, 1160, 150), fill=(180, 20, 30)); d.text((70, 70), f'E2E TIMES - PAGE {n}', fill='white')
    y = 190
    for b in range(5):
        d.text((50, y), f'Headline story {n}.{b + 1}', fill='black'); y += 40
        for _ in range(9): d.line((50, y, 1150, y), fill=(150, 150, 150), width=3); y += 22
        y += 40
    im.save(path, quality=85); return path

async def step(area, name, fn, page=None):
    cur['area'] = area
    t = time.time(); n0 = len(ERR)
    try:
        detail = await fn()
        errs = [e for e in ERR[n0:]]
        R.append({'area': area, 'name': name, 'ok': not errs, 'ms': int((time.time() - t) * 1000), 'detail': detail or '', 'errors': errs})
    except Exception as e:
        msg = str(e).split('\n')[0][:300]
        shot = ''
        if page:
            shot = f"{SHOTS}/fail-{len(R)}.png"
            try: await page.screenshot(path=shot)
            except Exception: shot = ''
        R.append({'area': area, 'name': name, 'ok': False, 'ms': int((time.time() - t) * 1000), 'detail': msg, 'errors': ERR[n0:], 'shot': shot})
    print(('PASS ' if R[-1]['ok'] else 'FAIL ') + area + ' · ' + name + ('' if R[-1]['ok'] else '  → ' + str(R[-1]['detail']) + ' ' + str(R[-1]['errors'][:2])), flush=True)

IGNORE = re.compile(r'status of 404 \(Not Found\)$|favicon|google|gstatic|recaptcha|/api/v1/auth/me|ERR_ABORTED|net::ERR_FAILED.*sw\.js|Failed to load resource: the server responded with a status of 401')
def watch(page, expect4xx=()):
    page.on('pageerror', lambda e: ERR.append(f'JS error: {e}'))
    page.on('console', lambda m: m.type == 'error' and not IGNORE.search(m.text) and ERR.append(f'console: {m.text[:200]}'))
    def resp(r):
        u = r.url
        if r.status >= 500 or (r.status >= 400 and '/api/' in u and not any(x in u for x in expect4xx) and r.status not in (401,)):
            if not IGNORE.search(u): ERR.append(f'HTTP {r.status} {r.request.method} {u.replace(B, "")}')
    page.on('response', resp)

async def no_crash(page):
    body = await page.inner_text('body')
    if re.search(r'Something went wrong|Unexpected Application Error|Cannot read prop', body): raise Exception('Error screen shown')
    return body

async def main():
    # clean leftovers
    s, j = api('POST', '/platform/auth/login', {'email': SA[0], 'password': SA[1]}); ptok = j['data']['token']
    s, j = api('GET', '/platform/clients?search=' + SLUG, token=ptok)
    for c in j.get('data', []):
        if c.get('slug') == SLUG: api('POST', f"/platform/clients/{c['id']}/delete", {'confirm': SLUG}, token=ptok)

    async with async_playwright() as p:
        br = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}), args=['--no-sandbox'])

        # ================= SUPER ADMIN =================
        ctx = await br.new_context(viewport={'width': 1440, 'height': 900}); pg = await ctx.new_page(); watch(pg, ('/platform/auth/login', '/settings/public'))
        A = 'Super admin'
        async def sa_root():
            await pg.goto(B + '/', wait_until='networkidle')
            if '/superadmin' not in pg.url: raise Exception('root did not redirect to /superadmin, got ' + pg.url)
            return pg.url.replace(B, '')
        await step(A, 'Root URL opens super admin login', sa_root, pg)
        async def sa_bad():
            await pg.fill('#sl-email', SA[0]); await pg.fill('#sl-pass', 'wrong-pass-1'); await pg.click('.sl-btn')
            await pg.wait_for_selector('text=/invalid/i', timeout=8000); return 'error message shown'
        await step(A, 'Wrong password is rejected', sa_bad, pg)
        async def sa_login():
            await pg.fill('#sl-pass', SA[1]); await pg.click('.sl-btn')
            await pg.wait_for_url(re.compile(r'/superadmin/?$'), timeout=10000); await pg.wait_for_load_state('networkidle'); await no_crash(pg)
            await pg.screenshot(path=f'{SHOTS}/sa-dashboard.png'); return 'dashboard loaded'
        await step(A, 'Login and dashboard', sa_login, pg)
        for path, label in [('/superadmin/clients', 'Clients list'), ('/superadmin/plans', 'Plans'), ('/superadmin/settings', 'Platform settings'),
                            ('/superadmin/settings/email', 'Platform email (SMTP)'), ('/superadmin/admins', 'Super admins'), ('/superadmin/activity', 'Activity log'), ('/superadmin/account', 'My account')]:
            async def visit(path=path):
                await pg.goto(B + path, wait_until='networkidle'); await no_crash(pg)
                if '/login' in pg.url: raise Exception('redirected to login')
                act = await pg.locator('.sa-sidebar a.active, nav a.active').count()
                return f'{act} active menu item(s)'
            await step(A, f'Open {label}', visit, pg)
        async def sa_create():
            await pg.goto(B + '/superadmin/clients/new', wait_until='networkidle')
            await pg.fill('input[placeholder="e.g. Kashi Putra"]', 'E2E Times')
            await pg.fill('input[placeholder="kashiputra"]', SLUG)
            await pg.locator('input[type=email]').first.fill(CEMAIL)
            pw = pg.locator('input[type=password], input[name=admin_password]').first
            if await pw.count(): await pw.fill(CPASS)
            else:
                lbl = pg.locator('label:has-text("Admin password")').locator('xpath=..').locator('input').first; await lbl.fill(CPASS)
            await pg.locator('label:has(input[name=plan])').last.click()
            await pg.locator('button:has-text("Create")').last.click()
            await pg.wait_for_url(re.compile(r'/superadmin/clients/\d+'), timeout=60000); await pg.wait_for_load_state('networkidle'); await no_crash(pg)
            await pg.screenshot(path=f'{SHOTS}/sa-client-detail.png')
            return 'client created via form → ' + pg.url.replace(B, '')
        await step(A, 'Create client (newspaper) from the form', sa_create, pg)
        cid = re.search(r'/clients/(\d+)', pg.url).group(1) if re.search(r'/clients/(\d+)', pg.url) else None
        async def sa_creds():
            body = await pg.inner_text('body')
            if CEMAIL not in body: raise Exception('admin email not shown on client page')
            return 'admin login shown'
        await step(A, 'Client detail shows admin credentials', sa_creds, pg)
        async def sa_list():
            await pg.goto(B + '/superadmin/clients', wait_until='networkidle')
            await pg.wait_for_selector(f'text=E2E Times', timeout=8000); return 'listed'
        await step(A, 'New client appears in list', sa_list, pg)
        async def sa_deact():
            s, j = api('PATCH', f'/platform/clients/{cid}/status', {'status': 'inactive'}, token=ptok)
            s2, j2 = api('GET', '/settings/public', tenant=SLUG)
            api('PATCH', f'/platform/clients/{cid}/status', {'status': 'active'}, token=ptok)
            s3, _ = api('GET', '/settings/public', tenant=SLUG)
            if s2 < 400 or s3 >= 400: raise Exception(f'deactivate→{s2}, activate→{s3}')
            return f'inactive → readers get {s2}; active again → {s3}'
        await step(A, 'Deactivate / activate client', sa_deact)
        await ctx.close()

        # ================= CLIENT ADMIN =================
        ctx = await br.new_context(viewport={'width': 1440, 'height': 900}); pg = await ctx.new_page(); watch(pg, ('/auth/login', '/auth/admin-login'))
        A = 'Newspaper admin'; T = f'{B}/n/{SLUG}'
        async def ad_login():
            await pg.goto(T + '/admin/login', wait_until='networkidle'); await pg.screenshot(path=f'{SHOTS}/admin-login.png')
            await pg.fill('#al-email', CEMAIL); await pg.fill('#al-pass', CPASS); await pg.click('.al-btn')
            await pg.wait_for_url(re.compile(r'/admin/dashboard'), timeout=10000); await pg.wait_for_load_state('networkidle'); await no_crash(pg)
            if await pg.locator('.st-pop').count(): await pg.click('.modal button:has-text("Close")')
            await pg.screenshot(path=f'{SHOTS}/admin-dashboard.png'); return 'dashboard loaded'
        await step(A, 'Login (new design) and dashboard', ad_login, pg)
        async def ad_forgot():
            p2 = await ctx.new_page(); watch(p2); await p2.goto(T + '/admin/forgot-password', wait_until='networkidle')
            await p2.fill('#al-femail', CEMAIL); await p2.click('.al-btn'); await p2.wait_for_selector('.al-steps', timeout=10000); await p2.close(); return '"Check your inbox" shown'
        await step(A, 'Forgot password page', ad_forgot, pg)
        async def ad_cat():
            await pg.goto(T + '/admin/categories', wait_until='networkidle'); await pg.click('button:has-text("Add category")')
            await pg.fill('input[placeholder="e.g. Kalaburagi Edition"]', 'City Edition'); await pg.click('.modal button:has-text("Save")')
            await pg.get_by_text('City Edition').first.wait_for(timeout=8000); return 'category saved'
        await step(A, 'Create edition category', ad_cat, pg)
        async def ad_ed():
            await pg.goto(T + '/admin/editions/new', wait_until='networkidle')
            await pg.fill('input[placeholder="e.g. Main Edition"]', 'E2E Morning Edition')
            sel = pg.locator('select').first; opts = await sel.locator('option').all_inner_texts()
            if 'City Edition' in opts: await sel.select_option(label='City Edition')
            await pg.click('button:has-text("Save & upload pages")'); await pg.wait_for_url(re.compile(r'/admin/publish/\d+'), timeout=10000); return pg.url.replace(B, '')
        await step(A, 'Create edition (draft)', ad_ed, pg)
        async def ad_upload():
            await pg.wait_for_load_state('networkidle')
            await pg.set_input_files('input[type=file][multiple]', [make_page(n) for n in (1, 2, 3)])
            for _ in range(60):
                n = await pg.locator('.page-tile').count()
                if n >= 3: break
                await pg.wait_for_timeout(500)
            done = pg.locator('.modal:has-text("Upload complete") button:has-text("Done")')
            if await done.count(): await done.click(); await pg.wait_for_timeout(300)
            await pg.screenshot(path=f'{SHOTS}/admin-pages.png'); return f'{n} page cards'
        await step(A, 'Upload 3 pages', ad_upload, pg)
        async def ad_publish():
            await pg.click('button:has-text("Next: Preview")'); await pg.wait_for_selector('button:has-text("Next: Publish"):not([disabled])', timeout=15000)
            await pg.click('button:has-text("Next: Publish")'); await pg.click('button:has-text("Publish now")')
            await pg.wait_for_selector('text=View on website', timeout=20000); await pg.screenshot(path=f'{SHOTS}/admin-published.png'); return 'published'
        await step(A, 'Preview, validate and publish', ad_publish, pg)
        # token for API-side setup
        if not cid: raise SystemExit('client was not created - stopping')
        tok = await pg.evaluate("Object.entries(localStorage).find(([k])=>k.startsWith('ep_token'))?.[1]")
        s, j = api('GET', '/editions?limit=5', token=tok, tenant=SLUG); ed = j['data'][0]; eid = ed['id']
        s, j = api('GET', f'/editions/{eid}', token=tok, tenant=SLUG); pages = j['data']['pages']
        async def ad_area():
            st, jj = api('POST', '/page-areas', {'page_id': pages[0]['id'], 'x': 0.04, 'y': 0.11, 'w': 0.45, 'h': 0.15, 'title': 'E2E lead story', 'description': '<p>Lead story body text.</p>'}, token=tok, tenant=SLUG)
            if st >= 400: raise Exception(f'create area {st} {jj.get("message")}')
            await pg.goto(T + f'/admin/editions/{eid}/areas', wait_until='networkidle'); await no_crash(pg); await pg.screenshot(path=f'{SHOTS}/admin-areas.png')
            return 'area created; mapping screen opens'
        await step(A, 'Area (article) mapping', ad_area, pg)
        routes = ['dashboard', 'editions', f'editions/{eid}', f'editions/{eid}/edit', 'publish', 'categories', 'areas', 'schedules', 'actions', 'clippings', 'comments', 'subscribers',
                  'notifications', 'messages', 'cms', 'cms/new', 'seo', 'settings/epaper', 'settings/theme', 'settings/watermark', 'settings/comments', 'settings/social',
                  'settings/recaptcha', 'settings/pwa', 'users', 'roles', 'audit-logs', 'backups', 'account', 'change-password']
        for r in routes:
            async def visit(r=r):
                await pg.goto(f'{T}/admin/{r}', wait_until='networkidle'); await no_crash(pg)
                if '/login' in pg.url: raise Exception('redirected to login')
                h = await pg.locator('h1, .page-title, h2').first.inner_text() if await pg.locator('h1, .page-title, h2').count() else ''
                return h.strip()[:60]
            await step(A + ' · pages', f'/admin/{r}', visit, pg)
        async def ad_theme():
            await pg.goto(T + '/admin/settings/theme', wait_until='networkidle')
            btn = pg.locator('button:has-text("Save")').first; await btn.click(); await pg.wait_for_timeout(1500); return 'theme saved'
        await step(A, 'Save theme settings', ad_theme, pg)
        async def ad_backup():
            await pg.goto(T + '/admin/backups', wait_until='networkidle')
            b = pg.locator('button:has-text("Back up now"), button:has-text("Create backup"), button:has-text("Backup now")').first
            await b.click()
            c = pg.locator('.modal button:has-text("Back up"), .modal button:has-text("Create"), .modal button:has-text("Start")')
            if await c.count(): await c.first.click()
            await pg.wait_for_selector('text=/\\.zip|\\.sql|\\.gz|completed|success|Manual/i', timeout=60000); return 'manual backup created'
        await step(A, 'Manual backup', ad_backup, pg)
        async def ad_mobile():
            m = await br.new_context(viewport={'width': 390, 'height': 844}, storage_state=await ctx.storage_state()); mp = await m.new_page(); watch(mp)
            await mp.goto(T + '/admin/editions', wait_until='networkidle'); await no_crash(mp)
            w = await mp.evaluate('document.documentElement.scrollWidth'); await mp.screenshot(path=f'{SHOTS}/admin-mobile.png'); await m.close()
            if w > 395: raise Exception(f'page scrolls sideways ({w}px wide on a 390px phone)')
            return 'no sideways scroll'
        await step(A, 'Mobile layout (390px)', ad_mobile, pg)
        await ctx.close()

        # ================= READER =================
        A = 'Reader website'
        ctx = await br.new_context(viewport={'width': 1440, 'height': 900}); pg = await ctx.new_page(); watch(pg, ('/auth/login',))
        T = f'{B}/n/{SLUG}'
        async def rd_home():
            t0 = time.time(); await pg.goto(T + '/', wait_until='networkidle'); await no_crash(pg)
            await pg.screenshot(path=f'{SHOTS}/reader-home.png'); return f'loaded in {int((time.time()-t0)*1000)} ms'
        await step(A, 'Home page', rd_home, pg)
        async def rd_edition():
            await pg.goto(T + f"/edition/{ed['slug']}", wait_until='networkidle'); await no_crash(pg)
            await pg.wait_for_selector('.vk-pg', timeout=10000); n = await pg.locator('.vk-pager .vk-pg').count()
            await pg.screenshot(path=f'{SHOTS}/reader-edition.png'); return f'{n} page buttons'
        await step(A, 'Open edition', rd_edition, pg)
        async def rd_nav():
            await pg.locator('.vk-pager .vk-pg:has-text("2")').first.click(); await pg.wait_for_timeout(800)
            if '/page/2' not in pg.url: raise Exception('URL did not change to page 2: ' + pg.url)
            return pg.url.replace(B, '')
        await step(A, 'Go to page 2', rd_nav, pg)
        async def rd_area():
            await pg.goto(T + f"/edition/{ed['slug']}", wait_until='networkidle'); await pg.wait_for_selector('.ep-area', timeout=10000)
            await pg.locator('.ep-area').first.click(); await pg.wait_for_selector('.modal, [role=dialog]', timeout=8000)
            t = await pg.locator('.modal, [role=dialog]').first.inner_text(); await pg.screenshot(path=f'{SHOTS}/reader-popup.png')
            if 'E2E lead story' not in t: raise Exception('popup does not show article title')
            await pg.keyboard.press('Escape'); return 'article popup opens'
        await step(A, 'Click mapped article → popup', rd_area, pg)
        async def rd_sub():
            await pg.click('.vk-btn-sub'); await pg.wait_for_selector('.vk-sub-modal input[type=email]', timeout=5000)
            await pg.fill('.vk-sub-modal input[type=email]', 'reader1@example.com'); await pg.locator('.vk-sub-modal button').first.click()
            await pg.wait_for_selector('text=/Subscribed|Thank|check your email/i', timeout=8000); await pg.keyboard.press('Escape'); return 'subscribed'
        await step(A, 'Subscribe by email', rd_sub, pg)
        async def rd_reg():
            await pg.goto(T + '/register', wait_until='networkidle')
            ins = pg.locator('form input');
            await pg.locator('input[autocomplete=name]').fill('Test Reader')
            await pg.locator('input[type=email]').first.fill('reader2@example.com')
            pw = pg.locator('input[type=password]');
            for i in range(await pw.count()): await pw.nth(i).fill('Reader@1234')
            terms = pg.locator('input[type=checkbox]')
            for i in range(await terms.count()):
                if not await terms.nth(i).is_checked(): await terms.nth(i).check()
            await pg.locator('form button[type=submit], form button.btn-primary').first.click()
            await pg.wait_for_timeout(2500); await no_crash(pg); return pg.url.replace(B, '')
        await step(A, 'Register a reader account', rd_reg, pg)
        async def rd_comment():
            await pg.goto(T + f"/edition/{ed['slug']}", wait_until='networkidle'); await pg.wait_for_selector('.ep-area', timeout=10000)
            await pg.locator('.ep-area').first.click(); await pg.wait_for_selector('[role=dialog] textarea, .modal textarea', timeout=8000)
            ta = pg.locator('[role=dialog] textarea, .modal textarea').first
            if await ta.is_disabled(): raise Exception('comment box disabled for the logged-in reader')
            await ta.fill('Great edition! (E2E test)'); await pg.locator('.ac-btn:has-text("Post")').first.click()
            await pg.get_by_text('Great edition! (E2E test)').first.wait_for(timeout=8000); await pg.screenshot(path=f'{SHOTS}/reader-comment.png')
            st, jj = api('GET', '/comments?limit=5', token=tok, tenant=SLUG)
            found = any('E2E test' in (c.get('body') or c.get('comment') or '') for c in jj.get('data', []))
            await pg.keyboard.press('Escape')
            if not found: raise Exception('comment not visible to admin')
            return 'posted in article popup; admin sees it for moderation'
        await step(A, 'Post a comment', rd_comment, pg)
        for path, label in [('/editions', 'Archive / all editions'), (f"/category/city-edition", 'Category page'), ('/page/about-us', 'CMS page (About Us)'), ('/account', 'My account'), ('/this-does-not-exist', '404 page')]:
            async def v(path=path):
                await pg.goto(T + path, wait_until='networkidle'); await no_crash(pg); return (await pg.title())[:60]
            await step(A, label, v, pg)
        async def rd_dark():
            await pg.goto(T + '/', wait_until='networkidle')
            b = pg.locator('[title*="ark"], [aria-label*="ark"], .theme-toggle').first; await b.click(); await pg.wait_for_timeout(400)
            d = await pg.evaluate("document.documentElement.dataset.theme || document.documentElement.dataset.bsTheme || document.body.className")
            await pg.screenshot(path=f'{SHOTS}/reader-dark.png'); return f'theme → {d}'
        await step(A, 'Dark mode toggle', rd_dark, pg)
        async def rd_lang():
            s = pg.locator('select').first
            opts = await s.locator('option').all_inner_texts();
            if len(opts) > 1: await s.select_option(index=1); await pg.wait_for_timeout(600)
            return 'languages: ' + ', '.join(o.strip() for o in opts)
        await step(A, 'Language switch', rd_lang, pg)
        async def rd_seo():
            s1 = urllib.request.urlopen(T + '/sitemap.xml').status; s2 = urllib.request.urlopen(T + '/robots.txt').status
            man = json.loads(urllib.request.urlopen(T + '/manifest.webmanifest').read()); return f"sitemap {s1}, robots {s2}, app '{man.get('name')}' scope {man.get('scope')}"
        await step(A, 'SEO files + install-app manifest', rd_seo)
        async def rd_mobile():
            m = await br.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True); mp = await m.new_page(); watch(mp)
            await mp.goto(T + f"/edition/{ed['slug']}", wait_until='networkidle'); await no_crash(mp)
            w = await mp.evaluate('document.documentElement.scrollWidth'); await mp.screenshot(path=f'{SHOTS}/reader-mobile.png'); await m.close()
            if w > 395: raise Exception(f'page scrolls sideways ({w}px)')
            return 'no sideways scroll'
        await step(A, 'Mobile edition view (390px)', rd_mobile, pg)
        await ctx.close(); await br.close()

    # cleanup
    if cid: api('POST', f'/platform/clients/{cid}/delete', {'confirm': SLUG}, token=ptok)
    json.dump(R, open(os.path.join(SHOTS, 'results.json'), 'w'), indent=1)
    print(f"\n{sum(r['ok'] for r in R)} passed, {sum(not r['ok'] for r in R)} failed")

asyncio.run(main())
