const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    for (const locale of ['', 'en/']) {
      const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        window.queryLocalFonts = async () => [{ family: 'Arial', fullName: 'Arial Regular', postscriptName: 'ArialMT', style: 'Regular' }];
      });
      await page.goto('http://127.0.0.1:8765/' + locale);
      await page.locator('#modePro').click();
      await page.locator('[data-tab="out"]').click();
      await page.locator('#outVideoSize').selectOption('1080x1920');
      assert.deepEqual(await page.evaluate(() => J.outputSize(J.ui.project)), [1080, 1920]);
      assert.equal(await page.locator('#eVideoSize').inputValue(), '1080x1920');
      await page.locator('#outVideoSize').selectOption('custom');
      await page.locator('#outVideoWidth').fill('1500'); await page.locator('#outVideoWidth').dispatchEvent('change');
      await page.locator('#outVideoHeight').fill('900'); await page.locator('#outVideoHeight').dispatchEvent('change');
      assert.deepEqual(await page.evaluate(() => J.outputSize(J.ui.project)), [1500, 900]);
      assert.equal(await page.locator('#outVideoSize').inputValue(), 'custom');
      await page.locator('#timelineZoomIn').click(); await page.locator('#timelineZoomIn').click();
      const widths = await page.evaluate(() => [document.querySelector('#timelineScroll').clientWidth, document.querySelector('#timelineStack').clientWidth]);
      assert.ok(widths[1] > widths[0] * 2, `timeline width: ${widths}`);
      await page.locator('[data-tab="style"]').click();
      assert.match(await page.locator('#fontRoles option[value="gothic_bold"]').first().evaluate(el => el.style.fontFamily), /Noto Sans JP/);
      await page.locator('#btnListFonts').click();
      assert.equal(await page.locator('#installedFonts option').count(), 1);
      await page.locator('#btnImportFont').click();
      assert.ok((await page.locator('#fontRoles option').allTextContents()).some(label => label.includes('Arial')));
      await page.locator('#compositeName').fill('Mixed test');
      await page.locator('#compositeBase').selectOption('gothic_bold');
      await page.locator('#compositeParts [data-part="latin"]').selectOption('local_41_72_69_61_6c_5f_52_65_67_75_6c_61_72');
      await page.locator('#btnSaveComposite').click();
      const composite = await page.evaluate(() => {
        const def = J.ui.project.compositeFonts[0];
        return { name: def.name, latin: J.fontForChar(def.key, 'A'), kana: J.fontForChar(def.key, 'あ'), punctuation: J.compositeCategory('・'), gaiji: J.compositeCategory('\uE000'), size: J.outputSize(J.ui.project), role: J.plan(J.ui.project, null).style.fonts.display[0], css: J.fontCSS(def.key, 40, 'A') };
      });
      assert.equal(composite.name, 'Mixed test'); assert.ok(composite.latin.startsWith('local_')); assert.equal(composite.kana, 'gothic_bold'); assert.equal(composite.punctuation, 'punctuation'); assert.equal(composite.gaiji, 'gaiji'); assert.ok(composite.role.startsWith('composite_')); assert.match(composite.css, /Arial/);
      assert.deepEqual(composite.size, [1500, 900]);
      await page.locator('#fontFile').setInputFiles('C:/Windows/Fonts/arial.ttf');
      await page.waitForFunction(() => J.ui.project.userFonts.some(font => font.file));
      await page.reload();
      assert.equal(await page.locator('#compositeList .composite-saved').count(), 1);
      assert.deepEqual(await page.evaluate(() => J.outputSize(J.ui.project)), [1500, 900]);
      await page.waitForFunction(() => [...document.fonts].some(face => face.family === 'UF_arial'));
      await page.locator('#sourceMedia').click();
      const img = name => ({ name, mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="red"/></svg>') });
      await page.locator('#mediaFiles').setInputFiles([img('one.svg'), img('two.svg'), img('three.svg')]);
      await page.locator('#mediaRandom').check(); await page.locator('#mediaLoop').check(); await page.locator('#btnTap').click();
      for (let i = 0; i < 5; i++) await page.evaluate(t => { J.ui.t = t; document.querySelector('#tapBtn').click(); }, i + 0.3);
      assert.deepEqual(await page.evaluate(() => {
        const order = J.mediaOrder(J.ui.project, 'media').map(item => item.id);
        return J.ui.plan.media.cuts.map((cut, index) => cut.itemId === order[index % order.length]);
      }), [true, true, true, true, true]);
      await page.locator('#tapStop').click();
      await page.locator('.foreground-placement-open').first().click();
      await page.evaluate(() => {
        const el = document.querySelector('#areaEditOverlay'), rect = document.querySelector('#areaEditRect').getBoundingClientRect();
        el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: rect.x + rect.width / 2, clientY: rect.y + 3 }));
      });
      const rotationCursor = await page.locator('#areaEditOverlay').evaluate(el => ({ inline: el.style.cursor, computed: getComputedStyle(el).cursor, rect: document.querySelector('#areaEditRect').style.cursor }));
      assert.match(rotationCursor.computed, /data:image\/svg\+xml/, JSON.stringify(rotationCursor));
      await page.locator('#areaCancel').click();
      await page.locator('#sourceForeground').click();
      await page.locator('#mediaFiles').setInputFiles([img('front-one.svg'), img('front-two.svg')]);
      await page.locator('#mediaLoop').check(); await page.locator('#btnTap').click();
      for (let i = 0; i < 3; i++) await page.evaluate(t => { J.ui.t = t; document.querySelector('#tapBtn').click(); }, i + 0.4);
      assert.deepEqual(await page.evaluate(() => {
        const order = J.mediaOrder(J.ui.project, 'foreground').map(item => item.id);
        return J.ui.plan.foreground.cuts.map((cut, index) => cut.itemId === order[index % order.length]);
      }), [true, true, true]);
      await page.locator('#tapStop').click();
      assert.deepEqual(errors, [], `${locale} page errors`);
      await page.close();
    }
  } finally { await browser.close(); }
  console.log('new features: OK');
})().catch(error => { console.error(error); process.exit(1); });
