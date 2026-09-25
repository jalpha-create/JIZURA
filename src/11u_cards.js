/* ============================================================
   JIZURA (jAlpha edition) — title card / CTA (end) card
   project.cards = {
     title: { on, dur, text, sub, date, logo: 'none'|'brand'|'custom', logoSrc },
     cta:   { on, dur, text, sub, qr, date, logo, logoSrc }
   }
   Cards are drawn over the whole frame after everything else (preview and every export), in the look's colours and
   fonts: the title card for the first `dur` seconds (it replaces the automatic title cut), the CTA card for the last
   `dur` seconds. QR codes use the bundled qrcode-generator (vendor/qrcode-generator.js, MIT) and are always drawn
   dark-on-white with a quiet zone so phones can read them.
   ============================================================ */
(() => {
'use strict';
const E = J.E;
J.CARD_DEFAULTS = {
  title: { on: false, dur: 3, text: '', sub: '', date: '', logo: 'brand', logoSrc: '' },
  cta: { on: false, dur: 4, text: '配信中', sub: '', qr: '', date: '', logo: 'brand', logoSrc: '' },
};
J.cardsOf = (project) => {
  const c = (project && project.cards) || {};
  const out = {};
  for (const k of ['title', 'cta']) out[k] = Object.assign({}, J.CARD_DEFAULTS[k], c[k] || {});
  return out;
};
const logoOf = (card, project) => {
  if (card.logo === 'custom') return typeof card.logoSrc === 'string' && card.logoSrc.startsWith('data:image/') ? card.logoSrc : null;
  if (card.logo === 'brand') { const l = project.brand && project.brand.logo; return l && l.src || null; }
  return null;
};

/* ---------- plan: carry the cards, drop the automatic title cut when the title card is on ---------- */
const basePlan = J.plan;
J.plan = (project, audio) => {
  const plan = basePlan(project, audio);
  const cards = J.cardsOf(project), D = plan.duration || 0;
  const pc = {};
  if (cards.title.on && D > 0.5) {
    const dur = J.clamp(+cards.title.dur || 3, 0.8, Math.max(0.8, D / 2));
    const t = { start: 0, end: dur, text: cards.title.text || plan.title || '', sub: cards.title.sub || plan.artist || '', date: cards.title.date, logo: logoOf(cards.title, project) };
    // nothing to show (no title, artist, date or logo): keep the automatic title and draw no card
    if (t.text || t.sub || t.date || t.logo) { pc.title = t; plan.cuts = plan.cuts.filter(c => !(c.layout === 'title' && c.line === -1)); }
  }
  if (cards.cta.on && D > 0.5) {
    const dur = J.clamp(+cards.cta.dur || 4, 0.8, Math.max(0.8, D / 2));
    pc.cta = { start: Math.max(0, D - dur), end: D + 1, text: cards.cta.text, sub: cards.cta.sub, qr: String(cards.cta.qr || '').trim(), date: cards.cta.date, logo: logoOf(cards.cta, project) };
  }
  pc.key = J.keyMode(project) ? J.KEY_BG[J.keyMode(project)] : null;
  plan.cards = pc;
  J._cardChars = [pc.title, pc.cta].filter(Boolean).map(c => [c.text, c.sub, c.date].join('')).join('');
  return plan;
};
// the characters of the cards must be loaded too (fonts are fetched per character range)
const baseEnsure = J.ensureFonts;
J.ensureFonts = (text, keys) => baseEnsure(String(text || '') + (J._cardChars || ''), keys);

/* ---------- images & QR ---------- */
const images = new Map();
function img(src) {
  let im = images.get(src);
  if (!im) { im = new Image(); im.src = src; images.set(src, im); if (images.size > 8) images.delete(images.keys().next().value); }
  return im;
}
J.cardsReady = async (plan) => {
  const srcs = plan && plan.cards ? [plan.cards.title, plan.cards.cta].filter(c => c && c.logo).map(c => c.logo) : [];
  await Promise.all(srcs.map(async s => { const im = img(s); if (!im.complete) await new Promise(r => { im.onload = im.onerror = r; setTimeout(r, 3000); }); try { await im.decode(); } catch (e) {} }));
};
const qrCache = new Map();
J.qrMatrix = (text) => {
  if (!text || typeof qrcode !== 'function') return null;
  if (qrCache.has(text)) return qrCache.get(text);
  let m = null;
  try {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
    const q = qrcode(0, 'M'); q.addData(text, 'Byte'); q.make();
    const n = q.getModuleCount(); m = [];
    for (let r = 0; r < n; r++) { const row = []; for (let c = 0; c < n; c++) row.push(q.isDark(r, c)); m.push(row); }
  } catch (e) { console.warn('QR', e); m = null; }   // text too long for a QR code
  qrCache.set(text, m); if (qrCache.size > 16) qrCache.delete(qrCache.keys().next().value);
  return m;
};
function drawQR(ctx, m, x, y, size) {
  const n = m.length, quiet = 4, cell = size / (n + quiet * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, size, size, cell * 1.5); else ctx.rect(x, y, size, size); ctx.fill();
  ctx.fillStyle = '#000000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) ctx.fillRect(Math.floor(x + (c + quiet) * cell), Math.floor(y + (r + quiet) * cell), Math.ceil(cell), Math.ceil(cell));
}

/* ---------- drawing ---------- */
function fitText(ctx, text, fontKey, maxW, maxPx) {
  let px = maxPx;
  ctx.font = J.fontCSS(fontKey, px);
  const w = ctx.measureText(text).width;
  if (w > maxW) { px = Math.max(8, px * maxW / w); ctx.font = J.fontCSS(fontKey, px); }
  return px;
}
function drawCard(ctx, plan, card, kind, t, opt) {
  const cw = ctx.canvas.width, ch = ctx.canvas.height, S = Math.min(cw, ch), tall = ch > cw * 1.05;
  const lt = t - card.start;
  const pin = E.outCubic(J.clamp(lt / 0.45));
  const pout = kind === 'title' ? E.inCubic(J.clamp((t - (card.end - 0.35)) / 0.35)) : 0;
  const a = pin * (1 - pout);
  if (a <= 0) return;
  const st = plan.style, sc = st.schemes[0];
  const disp = (st.fonts.display || ['gothic_black'])[0], body = (st.fonts.body || ['gothic_med'])[0], mono = (st.fonts.mono || ['mono'])[0];
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  // plate: the scheme background — the key colour for green / black exports, none for transparent PNGs
  if (!opt.transparent) { ctx.globalAlpha = a; ctx.fillStyle = plan.cards.key || sc.bg; ctx.fillRect(0, 0, cw, ch); }
  else { ctx.globalAlpha = a; ctx.clearRect(0, 0, cw, ch); }
  const rise = (1 - pin) * S * 0.04;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const logo = card.logo ? img(card.logo) : null, hasLogo = !!(logo && logo.complete && logo.naturalWidth);
  const qr = kind === 'cta' && card.qr ? J.qrMatrix(card.qr) : null;
  // layout: a text column; the QR sits beside it (landscape) or under it (portrait)
  const qrSize = qr ? S * (tall ? 0.34 : 0.36) : 0;
  const colW = qr && !tall ? cw * 0.5 : cw * 0.84;
  const colX = qr && !tall ? cw * 0.36 : cw / 2;
  const items = [];
  if (hasLogo) { const lw = S * 0.2, lh = Math.min(lw * logo.naturalHeight / logo.naturalWidth, S * 0.16); items.push({ kind: 'logo', h: lh, w: lh * logo.naturalWidth / logo.naturalHeight }); }
  if (card.text) items.push({ kind: 'text', text: card.text, font: disp, px: fitText(ctx, card.text, disp, colW, S * (kind === 'title' ? 0.13 : 0.12)), color: sc.fg });
  if (card.sub) items.push({ kind: 'text', text: card.sub, font: body, px: fitText(ctx, card.sub, body, colW, S * 0.05), color: sc.accent });
  if (card.date) items.push({ kind: 'text', text: card.date, font: mono, px: fitText(ctx, card.date, mono, colW, S * 0.035), color: sc.sub });
  if (qr && tall) items.push({ kind: 'qr', h: qrSize });
  const gap = S * 0.035;
  const totalH = items.reduce((s, it) => s + (it.h || it.px * 1.15), 0) + gap * Math.max(0, items.length - 1);
  let y = ch / 2 - totalH / 2 + rise;
  items.forEach((it, i) => {
    const h = it.h || it.px * 1.15;
    const d = J.clamp((lt - i * 0.08) / 0.45);   // small stagger
    ctx.globalAlpha = a * E.outCubic(d);
    if (it.kind === 'logo') ctx.drawImage(logo, colX - it.w / 2, y, it.w, it.h);
    else if (it.kind === 'qr') drawQR(ctx, qr, cw / 2 - qrSize / 2, y, qrSize);
    else { ctx.font = J.fontCSS(it.font, it.px); ctx.fillStyle = it.color; ctx.fillText(it.text, colX, y + h / 2); }
    // a short accent rule under the main line
    if (it.kind === 'text' && it === items.find(x => x.kind === 'text')) { ctx.fillStyle = sc.accent; const rw = Math.min(colW * 0.25, S * 0.18) * E.outCubic(d); ctx.fillRect(colX - rw / 2, y + h + gap * 0.35, rw, Math.max(2, S * 0.006)); }
    y += h + gap;
  });
  if (qr && !tall) { ctx.globalAlpha = a * E.outCubic(J.clamp((lt - 0.15) / 0.45)); drawQR(ctx, qr, cw * 0.72 - qrSize / 2, ch / 2 - qrSize / 2 + rise, qrSize); }
  ctx.restore();
}
const baseFrame = J.Renderer.prototype.frame;
J.Renderer.prototype.frame = function (ctx, plan, t, opt = {}) {
  this._cardDepth = (this._cardDepth || 0) + 1;
  try { return baseFrame.call(this, ctx, plan, t, opt); }
  finally {
    this._cardDepth--;
    const cards = plan && plan.cards;
    if (!this._cardDepth && cards && !opt.noCards && !(opt.transparent && opt.layer === 'back')) {
      for (const k of ['title', 'cta']) { const c = cards[k]; if (c && t >= c.start && t < c.end) drawCard(ctx, plan, c, k, t, opt); }
    }
  }
};
})();
