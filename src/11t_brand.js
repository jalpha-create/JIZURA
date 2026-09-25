/* ============================================================
   JIZURA (jAlpha edition) — brand kits (engine side)
   project.brand = a copy of the active kit (so a project file carries it to other PCs):
     { id, name, colors: [hex…] (2–5), bg: hex|null (main background, one of colors),
       fonts: { display?, serif?, body? } (font keys), logo: { src (data URL), pos, size, opacity } | null }
   While a brand is active its colours and fonts win over every look setting (おまかせ, palettes, overrides),
   and the logo is drawn on top of every frame (preview and export; not into the back layer of layered PNGs).
   The kit list itself lives in the browser (src/12_ui.js, localStorage jizura.brands.v1).
   ============================================================ */
(() => {
'use strict';
const HEX = /^#[0-9a-f]{6}$/i;
J.brandColors = b => (b && Array.isArray(b.colors) ? b.colors.filter(c => HEX.test(c)).map(c => c.toUpperCase()) : []);

/* colours + fonts: resolve the style as if the brand were the user's palette and font choice */
const baseResolve = J.resolveStyle;
J.resolveStyle = (project) => {
  const b = project && project.brand;
  if (!b) return baseResolve(project);
  const p = Object.assign({}, project);
  const cols = J.brandColors(b);
  if (cols.length >= 2) {
    const bg = b.bg && cols.includes(b.bg.toUpperCase()) ? b.bg.toUpperCase() : null;
    p.colors = Object.assign({}, project.colors, { palette: { id: 'brand:' + b.id, v: 0, bg, cols }, enabled: false, accentOn: false });
  }
  const fo = {}; for (const r of ['display', 'serif', 'body']) if (b.fonts && b.fonts[r] && J.FONTS[b.fonts[r]]) fo[r] = b.fonts[r];
  p.fonts = Object.assign({}, project.fonts, fo);
  return baseResolve(p);
};

/* logo: carried on the plan so every renderer (preview, MP4, PNG, batch) sees it */
const basePlan = J.plan;
J.plan = (project, audio) => {
  const plan = basePlan(project, audio);
  const lg = project && project.brand && project.brand.logo;
  plan.brandLogo = lg && typeof lg.src === 'string' && lg.src.startsWith('data:image/') ? lg : null;
  return plan;
};
const images = new Map();
function logoImage(src) {
  let im = images.get(src);
  if (!im) { im = new Image(); im.decoding = 'async'; im.src = src; images.set(src, im); if (images.size > 8) images.delete(images.keys().next().value); }
  return im;
}
/* exports await this so the first frames already have the logo */
J.brandReady = async (plan) => {
  if (!plan || !plan.brandLogo) return;
  const im = logoImage(plan.brandLogo.src);
  if (!im.complete) await new Promise(r => { im.onload = im.onerror = r; setTimeout(r, 3000); });
  try { await im.decode(); } catch (e) {}
};
J.BRAND_POS = ['br', 'bl', 'tr', 'tl', 'bc', 'tc'];
function drawLogo(ctx, lg) {
  const im = logoImage(lg.src);
  if (!im.complete || !im.naturalWidth) return;
  const cw = ctx.canvas.width, ch = ctx.canvas.height, short = Math.min(cw, ch);
  const w = short * J.clamp((+lg.size || 16) / 100, 0.03, 0.6), h = w * im.naturalHeight / im.naturalWidth;
  const m = short * 0.045, pos = J.BRAND_POS.includes(lg.pos) ? lg.pos : 'br';
  const x = pos[1] === 'l' ? m : pos[1] === 'r' ? cw - m - w : (cw - w) / 2;
  const y = pos[0] === 't' ? m : ch - m - h;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  ctx.globalAlpha = J.clamp((lg.opacity ?? 100) / 100, 0, 1);
  ctx.drawImage(im, x, y, w, h);
  ctx.restore();
}
// draw once per frame, after the outermost call (the renderer calls itself for media / foreground layers)
const baseFrame = J.Renderer.prototype.frame;
J.Renderer.prototype.frame = function (ctx, plan, t, opt = {}) {
  this._brandDepth = (this._brandDepth || 0) + 1;
  try { return baseFrame.call(this, ctx, plan, t, opt); }
  finally {
    this._brandDepth--;
    if (!this._brandDepth && plan && plan.brandLogo && !opt.noBrand && !(opt.transparent && opt.layer === 'back')) drawLogo(ctx, plan.brandLogo);
  }
};
})();
