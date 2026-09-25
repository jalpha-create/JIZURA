/* ============================================================
   JIZURA — editor UI
   ============================================================ */
(() => {
'use strict';
if (!document.getElementById('app')) return;          // engine-only pages (tests)
const $ = id => document.getElementById(id);
const LS_KEY = 'jizura.project.v1';
const MEDIA_DELETE_KEY = 'jizura.media.pendingDelete.v1';
const HUD_CHARS = '0123456789:./-_()【】・No.LYRICRECUNTITLEDXYlinebpminterlude—─／ ';
const ICON = {
  dice: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="2" width="12" height="12" rx="2"/><circle cx="5.5" cy="5.5" r="1" fill="currentColor"/><circle cx="10.5" cy="10.5" r="1" fill="currentColor"/><circle cx="10.5" cy="5.5" r="1" fill="currentColor"/><circle cx="5.5" cy="10.5" r="1" fill="currentColor"/></svg>',
  lock: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5 7V5a3 3 0 0 1 6 0v2"/></svg>',
  frontmost: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="5" width="10" height="8" rx="1"/><path d="M5 2h9v8M8 4l2 2 2-2"/></svg>',
};

const S = { project: null, plan: null, audio: null, renderer: new J.Renderer(), playing: false, t: 0, t0: 0, loop: true, need: true, exporting: null, tap: null, linkDrag: null, slow: false, lineEls: [], blankEls: new Map(), mediaLineEls: [], sourceTab: 'lyrics', curLine: -2, timelineZoom: 1 };

/* WebAudio player (works inside sandboxed pages where blob media may be blocked) */
const AP = {
  ctx: null, src: null, startAt: 0, gain: null, vol: 0.8, muted: false,
  play(buffer, offset) {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.stop();
    if (!this.gain) { this.gain = this.ctx.createGain(); this.gain.connect(this.ctx.destination); this.applyVol(); }
    const s = this.ctx.createBufferSource(); s.buffer = buffer; s.connect(this.gain);
    const off = Math.max(0, Math.min(offset, buffer.duration - 0.01));
    s.start(0, off); this.src = s; this.startAt = this.ctx.currentTime - off;
  },
  stop() { if (this.src) { try { this.src.stop(); } catch (e) {} try { this.src.disconnect(); } catch (e) {} this.src = null; } },
  time() { return this.ctx ? this.ctx.currentTime - this.startAt : 0; },
  /* preview volume only (exports keep the original level) */
  setVol(v, muted) { if (v != null) this.vol = Math.max(0, Math.min(1, v)); if (muted != null) this.muted = !!muted; this.applyVol(); },
  applyVol() { if (!this.gain) return; const v = this.muted ? 0 : this.vol * this.vol; try { this.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.015); } catch (e) { this.gain.gain.value = v; } },
};
/* プレビュー音量: remembered per browser */
function initVolume() {
  const el = $('vol'), mb = $('btnMute'); if (!el || !mb) return;
  let v = 0.8, m = false;
  try { const o = JSON.parse(localStorage.getItem('jizura.previewVolume') || 'null'); if (o) { v = +o.v; m = !!o.m; } } catch (e) {}
  if (!(v >= 0 && v <= 1)) v = 0.8;
  const show = () => { el.value = Math.round(AP.vol * 100); mb.textContent = AP.muted || AP.vol === 0 ? '消音' : '音量'; mb.setAttribute('aria-pressed', String(AP.muted)); el.title = '音量 ' + Math.round(AP.vol * 100) + '%'; };
  const save = () => { try { localStorage.setItem('jizura.previewVolume', JSON.stringify({ v: AP.vol, m: AP.muted })); } catch (e) {} };
  AP.setVol(v, m); show();
  el.addEventListener('input', () => { AP.setVol(el.value / 100, false); show(); save(); });
  mb.addEventListener('click', () => { AP.setVol(null, !AP.muted); show(); save(); });
}
const NO_AUDIO_LABEL = '曲なし（読み込むと拍を検出してカットを合わせます）';
function removeAudio() {
  if (!S.audio) return;
  pause(); S.audio = null;
  $('audioFile').value = '';
  $('audioName').textContent = NO_AUDIO_LABEL;
  $('btnRemoveAudio').hidden = true;
  syncUI(); replan();
}

/* ---------------- project persistence ---------------- */
function mergeProject(p) {
  const d = J.defaultProject();
  const o = Object.assign(d, p || {});
  if (o.videoSize) { const [w, h] = J.outputSize(o); o.videoSize = { w, h }; }
  o.fx = Object.assign(J.defaultProject().fx, (p && p.fx) || {});
  o.timing = Object.assign(J.defaultProject().timing, (p && p.timing) || {});
  o.timing.cutTimes = o.timing.cutTimes || {};
  const en = J.defaultProject().enabled;
  for (const g of Object.keys(en)) en[g] = Object.assign(en[g], ((p && p.enabled) || {})[g] || {});
  o.enabled = en;
  o.overrides = (p && p.overrides) || {};
  o.lyricCutOptions = (p && p.lyricCutOptions) || {};
  o.lyricBlankCuts = Array.isArray(p && p.lyricBlankCuts) ? p.lyricBlankCuts : [];
  o.timelineLinks = Array.isArray(p && p.timelineLinks) ? p.timelineLinks : [];
  o.media = J.normalizeMedia(p && p.media);
  o.foreground = J.normalizeMedia(p && p.foreground);
  o.colors = Object.assign({ enabled: false }, (p && p.colors) || {});
  o.fonts = (p && p.fonts) || {};
  o.userFonts = (p && p.userFonts) || [];
  for (const uf of o.userFonts) if (!J.FONTS[uf.key]) J.addUserFont(uf.key, uf.label, uf.family, uf.weight || 400);
  o.compositeFonts = Array.isArray(p && p.compositeFonts) ? p.compositeFonts : [];
  J.setCompositeFonts(o.compositeFonts);
  return o;
}
function setBadges(d) {
  return (d && d.extra ? '<span class="set-badge ex" title="最初の公開版のあとに追加">追加</span>' : '') + (d && d.wa ? '<span class="set-badge" title="和風の演出">和</span>' : '');
}
function loadLocal() { try { const s = localStorage.getItem(LS_KEY); if (s) return mergeProject(JSON.parse(s)); } catch (e) {} return mergeProject(null); }
function pendingMediaDeletes() { try { const ids = JSON.parse(localStorage.getItem(MEDIA_DELETE_KEY) || '[]'); return Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : []; } catch (e) { return []; } }
function queueMediaDeletion(id) { try { localStorage.setItem(MEDIA_DELETE_KEY, JSON.stringify([...new Set([...pendingMediaDeletes(), id])])); } catch (e) {} }
async function cleanupDeletedMedia() {
  const active = new Set([...S.project.media.items, ...S.project.foreground.items].map(item => item.id));
  const pending = pendingMediaDeletes(), failed = [];
  for (const id of pending) {
    if (active.has(id)) continue;
    try {
      await J.removeMedia(id);
      const asset = J.mediaAssets.get(id);
      if (asset) { URL.revokeObjectURL(asset.url); J.mediaAssets.delete(id); }
    } catch (e) { failed.push(id); }
  }
  try { localStorage.setItem(MEDIA_DELETE_KEY, JSON.stringify(pendingMediaDeletes().filter(id => !pending.includes(id) || failed.includes(id)))); } catch (e) {}
}
const U = { list: [], i: -1, restoring: false, pendingGroup: null, lastGroup: null, lastAt: 0 };
function initUndo() { U.list = [JSON.stringify(S.project)]; U.i = 0; updateUndoButtons(); }
function markUndoGroup(group) { U.pendingGroup = group; }
function updateUndoButtons() {
  if ($('btnUndo')) $('btnUndo').disabled = U.i <= 0;
  if ($('btnRedo')) $('btnRedo').disabled = U.i >= U.list.length - 1;
}
function recordUndoState() {
  if (U.restoring || !S.project) return;
  const snap = JSON.stringify(S.project), group = U.pendingGroup, now = Date.now();
  U.pendingGroup = null;
  if (U.i < 0) { U.list = [snap]; U.i = 0; updateUndoButtons(); return; }
  if (snap === U.list[U.i]) return;
  const atTip = U.i === U.list.length - 1;
  U.list = U.list.slice(0, U.i + 1);
  if (group && atTip && group === U.lastGroup && now - U.lastAt < 1200 && U.i > 0) U.list[U.i] = snap;
  else { U.list.push(snap); U.i++; }
  if (U.list.length > 100) { U.list.shift(); U.i--; }
  U.lastGroup = group; U.lastAt = now;
  updateUndoButtons();
}
function undoMove(direction) {
  if (S.exporting) return;
  recordUndoState();
  const next = U.i + direction;
  if (next < 0 || next >= U.list.length) return;
  pause(); clearTimeout(replanTimer);
  if (S.areaEdit) cancelAreaEditor();
  S.tap = null; S.timelineDrag = null; S.linkDrag = null;
  $('tapPanel').hidden = true; $('btnTap').setAttribute('aria-pressed', 'false');
  U.restoring = true; U.i = next; U.pendingGroup = null; U.lastGroup = null;
  S.project = mergeProject(JSON.parse(U.list[next]));
  fontKey = ''; syncUI(); replan(); flushSave();
  U.restoring = false; updateUndoButtons();
}
let saveTimer = 0;
function autosave() { recordUndoState(); clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 700); }
function flushSave() { recordUndoState(); clearTimeout(saveTimer); try { localStorage.setItem(LS_KEY, JSON.stringify(S.project)); } catch (e) {} }
window.addEventListener('pagehide', () => { if (S.project) { flushSave(); cleanupDeletedMedia(); } });

/* ---------------- planning ---------------- */
function audioLike() {
  const T = S.project.timing;
  if (S.audio) {
    const a = Object.assign({}, S.audio);
    if (T.bpm > 0) a.beats = J.beatGrid(T.bpm, T.beatOffset || 0, S.audio.duration);
    return a;
  }
  if (T.bpm > 0) return { beats: J.beatGrid(T.bpm, T.beatOffset || 0, 600) };
  return null;
}
/* 自動判定のとき、判定結果を言語欄の横に出す */
function langNote() {
  const el = $('langNote'); if (!el) return;
  el.textContent = (S.project.lang || 'auto') === 'auto' ? '→ ' + J.LANG_LABEL[J.resolveLang(S.project)] : '';
  if (langNote.last !== undefined && langNote.last !== J.lang) { try { renderFontRoles(); } catch (e) {} }   // font menus show the language's faces
  langNote.last = J.lang;
}
function replan() {
  S.plan = J.plan(S.project, audioLike());
  S.plan.media = J.planMedia(S.project, S.plan, S.audio && S.audio.duration);
  S.plan.foreground = J.planMedia(S.project, S.plan, S.audio && S.audio.duration, 'foreground');
  S.plan.duration = Math.max(S.plan.media.duration, S.plan.foreground.duration);
  for (const layer of ['media', 'foreground']) {
    S.plan[layer].duration = S.plan.duration;
    const last = S.plan[layer].cuts.at(-1); if (last && last.videoDuration == null) last.end = S.plan.duration;
  }
  if (S.tap && S.tap.append && !S.audio) extendTapPreview(S.t);
  langNote();
  if (S.t > S.plan.duration) S.t = Math.max(0, S.plan.duration - 1e-3);
  const temporarilyHidden = ref => S.project.durationOverride != null && /^l:\d+:\d+$/.test(ref) && +ref.split(':')[1] < S.plan.lines.length;
  S.project.timelineLinks = S.project.timelineLinks.filter(link => link && link.a !== link.b && (boundaryCut(link.a) || temporarilyHidden(link.a)) && (boundaryCut(link.b) || temporarilyHidden(link.b)));
  renderLines(); renderMediaList(); renderMediaLines(); sizeViewport(); drawTimeline(); drawTimelineLinks(); updateTimeUI();
  S.need = true; autosave(); ensureFonts(); drawSwatch(); showNow();
  clearTimeout(warmTimer); warmTimer = setTimeout(warm, 450);
}
/* pre-decompose glyphs used by piece animations while the editor is idle, so playback does not hitch */
let warmTimer = 0, warmJob = 0;
function warm() {
  const job = ++warmJob;
  const cuts = S.plan.cuts.filter(c => c.enter === 'assemble' || ['explode', 'fall', 'drift'].includes(c.exit));
  const src = $('view');
  const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
  const ctx = cv.getContext('2d');
  let i = 0;
  const idle = window.requestIdleCallback ? (f) => window.requestIdleCallback(f, { timeout: 400 }) : (f) => setTimeout(() => f(null), 40);
  const step = (deadline) => {
    if (job !== warmJob || S.exporting) return;
    do {
      const c = cuts[i++]; if (!c) break;
      const ts = [];
      if (c.enter === 'assemble') ts.push(c.start + Math.min(c.inDur * 0.3, c.dur * 0.2));
      if (c.outDur > 0) ts.push(c.end - c.outDur * 0.5);
      for (const t of ts) { try { S.renderer.frame(ctx, S.plan, t, { scale: cv.width / S.plan.W, fast: true, noHud: true, noGhost: true }); } catch (e) {} }
    } while (i < cuts.length && deadline && deadline.timeRemaining() > 10);
    if (i < cuts.length) idle(step);
  };
  idle(step);
}
let replanTimer = 0;
const replanSoon = (ms = 220) => { clearTimeout(replanTimer); replanTimer = setTimeout(replan, ms); };
let fontKey = '';
let thumbFonts = null;
async function ensureFonts() {
  const txt = S.project.lyrics + (S.project.title || '') + (S.project.artist || '') + HUD_CHARS;
  const keys = J.fontsOfPlan(S.plan);                       // only the faces this plan draws with
  const key = txt + '|' + keys.join(',') + '|' + Object.keys(J.FONTS).length;
  if (key === fontKey) return;
  fontKey = key;
  showMsg('フォントを読み込み中…');
  try { await J.ensureFonts(txt, keys); } catch (e) {}
  showMsg(null); S.need = true; drawStyleGrid(); loadThumbFonts();
}
// style thumbnails need two glyphs of every style's display face — fetched only once the style grid is actually shown
function loadThumbFonts() {
  if (thumbFonts || !$('styleGrid').offsetParent) return;
  thumbFonts = J.ensureFonts('字面', [...new Set(J.STYLE_ORDER.map(k => J.STYLES[k].fonts.display[0]))]).then(() => drawStyleGrid()).catch(() => {});
}
function showMsg(m) { const el = $('viewMsg'); if (!m) { el.hidden = true; return; } el.textContent = m; el.hidden = false; }

/* ---------------- viewport & drawing ---------------- */
/* ---------------- セーフエリア表示 (jAlpha edition) ----------------
   preview-only guides: what the app UI of each short-video platform covers on a 9:16 frame (rough guides —
   the apps change their layouts), plus classic broadcast action / title safe for every aspect. Never exported. */
const SAFE_KEY = 'jizura.safeArea';
const SAFE = {   // fractions of the frame, measured on 1080×1920: top / right / bottom / left covered by the app UI
  tiktok: { name: 'TikTok', t: 160 / 1920, r: 150 / 1080, b: 480 / 1920, l: 60 / 1080 },
  reels: { name: 'Instagram リール', t: 220 / 1920, r: 140 / 1080, b: 420 / 1920, l: 60 / 1080 },
  shorts: { name: 'YouTube ショート', t: 190 / 1920, r: 190 / 1080, b: 440 / 1920, l: 60 / 1080 },
};
let safeMode = 'off';
try { safeMode = localStorage.getItem(SAFE_KEY) || 'off'; } catch (e) {}
function drawSafeOverlay() {
  const box = $('safeOverlay'); if (!box || !S.plan) return;
  const sel = $('safeMode'); if (sel && sel.value !== safeMode) sel.value = safeMode;
  box.hidden = safeMode === 'off';
  if (box.hidden) { box.innerHTML = ''; return; }
  const W = S.plan.W, H = S.plan.H, tall = Math.abs(W / H - 9 / 16) < 0.01;
  const u = Math.min(W, H) / 1080;   // stroke / text scale
  const rect = (x, y, w, h, fill, extra = '') => `<rect x="${x}" y="${y}" width="${Math.max(0, w)}" height="${Math.max(0, h)}" fill="${fill}" ${extra}/>`;
  const label = (x, y, text, anchor = 'start') => `<text x="${x}" y="${y}" font-size="${26 * u}" text-anchor="${anchor}" fill="#fff" stroke="#000" stroke-width="${5 * u}" paint-order="stroke" font-family="IBM Plex Sans JP, sans-serif" font-weight="600">${escapeHtml(text)}</text>`;
  let svg = '';
  if (safeMode === 'broadcast') {
    const a = 0.035, t = 0.05;   // action safe 93%, title safe 90%
    svg += rect(W * a, H * a, W * (1 - 2 * a), H * (1 - 2 * a), 'none', `stroke="#16F4D4" stroke-width="${3 * u}" stroke-dasharray="${14 * u} ${10 * u}"`);
    svg += rect(W * t, H * t, W * (1 - 2 * t), H * (1 - 2 * t), 'none', `stroke="#F5A50C" stroke-width="${3 * u}" stroke-dasharray="${14 * u} ${10 * u}"`);
    svg += label(W * t + 10 * u, H * t + 34 * u, 'タイトルセーフ 90%') + label(W * a + 10 * u, H * (1 - a) - 12 * u, 'アクションセーフ 93%');
  } else if (!tall) {
    svg += label(W / 2, 48 * u, `${safeMode === 'all' ? 'SNS' : SAFE[safeMode].name} の枠は 9:16 用です（いまは ${S.project.aspect}）`, 'middle');
  } else {
    const list = safeMode === 'all' ? Object.values(SAFE) : [SAFE[safeMode]];
    const z = { t: Math.max(...list.map(p => p.t)), r: Math.max(...list.map(p => p.r)), b: Math.max(...list.map(p => p.b)), l: Math.max(...list.map(p => p.l)) };
    const x0 = W * z.l, y0 = H * z.t, x1 = W * (1 - z.r), y1 = H * (1 - z.b), shade = 'rgba(255,60,90,0.22)';
    svg += rect(0, 0, W, y0, shade) + rect(0, y1, W, H - y1, shade) + rect(0, y0, x0, y1 - y0, shade) + rect(x1, y0, W - x1, y1 - y0, shade);
    // rough shapes of the app UI: tabs on top, a column of buttons on the right, caption lines at the bottom
    const ui = 'rgba(255,255,255,0.55)';
    svg += rect(W * 0.3, H * 0.035, W * 0.16, 10 * u, ui, `rx="${5 * u}"`) + rect(W * 0.54, H * 0.035, W * 0.16, 10 * u, ui, `rx="${5 * u}"`);
    const cx = W * (1 - z.r / 2), r = Math.min(W * z.r * 0.3, 34 * u);
    for (let i = 0; i < 5; i++) svg += `<circle cx="${cx}" cy="${y1 - (i + 0.6) * r * 3.1}" r="${r}" fill="${ui}"/>`;
    svg += rect(W * 0.05, H * (1 - z.b * 0.78), W * 0.3, 16 * u, ui, `rx="${8 * u}"`) + rect(W * 0.05, H * (1 - z.b * 0.62), W * 0.62, 12 * u, ui, `rx="${6 * u}"`) + rect(W * 0.05, H * (1 - z.b * 0.5), W * 0.48, 12 * u, ui, `rx="${6 * u}"`);
    svg += rect(x0, y0, x1 - x0, y1 - y0, 'none', `stroke="#16F4D4" stroke-width="${4 * u}" stroke-dasharray="${16 * u} ${10 * u}"`);
    svg += label(x0 + 12 * u, y0 + 36 * u, `セーフエリア（${list.map(p => p.name).join('・')}・目安）`);
  }
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${svg}</svg>`;
}
function positionSafeOverlay() {
  const box = $('safeOverlay'); if (!box) return;
  const vpEl = $('viewport'), view = $('view').getBoundingClientRect(), viewport = vpEl.getBoundingClientRect();
  // absolute offsets start inside the viewport's border
  Object.assign(box.style, { left: `${view.left - viewport.left - vpEl.clientLeft}px`, top: `${view.top - viewport.top - vpEl.clientTop}px`, width: `${view.width}px`, height: `${view.height}px` });
}
function setSafeMode(m) {
  safeMode = m in SAFE || m === 'all' || m === 'broadcast' ? m : 'off';
  try { localStorage.setItem(SAFE_KEY, safeMode); } catch (e) {}
  positionSafeOverlay(); drawSafeOverlay();
}

function sizeViewport() {
  const vp = $('viewport'), c = $('view');
  const ar = S.plan.W / S.plan.H;
  let cssW = vp.clientWidth || 800, cssH = cssW / ar;
  const maxH = Math.max(220, window.innerHeight * 0.68);
  if (cssH > maxH) { cssH = maxH; cssW = cssH * ar; }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pw = Math.round(Math.min(S.plan.W, cssW * dpr)), ph = Math.round(pw / ar);
  if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
  c.style.width = cssW + 'px'; c.style.height = cssH + 'px';
  positionAreaEditor();
  positionSafeOverlay(); drawSafeOverlay();
  S.need = true;
}
function draw() {
  const c = $('view'), ctx = c.getContext('2d');
  J.syncMediaPreview(S.plan, S.t, S.playing);
  const t0 = performance.now();
  const previewCuts = S.areaEdit && S.areaEdit.kind === 'lyric' && S.areaEdit.draft ? S.plan.cuts.filter(cut => cut.line === S.areaEdit.index) : [];
  const previousAreas = previewCuts.map(cut => cut.area);
  previewCuts.forEach(cut => { cut.area = { ...S.areaEdit.draft, angle: S.areaEdit.angle }; });
  const edit = S.areaEdit, mediaCut = edit && edit.kind !== 'lyric' && S.plan[edit.kind].cuts[edit.index];
  const previousMedia = mediaCut && { placement: mediaCut.placement, zoom: mediaCut.zoom, hold: mediaCut.hold, enter: mediaCut.enter, exit: mediaCut.exit, trans: mediaCut.trans };
  if (mediaCut) Object.assign(mediaCut, { placement: { cx: edit.draft.x + edit.draft.w / 2, cy: edit.draft.y + edit.draft.h / 2, w: edit.draft.w, h: edit.draft.h, lockAspect: edit.lockAspect, angle: edit.angle }, zoom: 100, hold: 'still', enter: 'cut', exit: 'cut', trans: undefined });
  try { S.renderer.frame(ctx, S.plan, S.t, { scale: c.width / S.plan.W, fast: !!edit || S.playing && S.slow, noTrans: !!edit, noPost: !!edit, previewEdit: !!edit, noForeground: !!edit && edit.kind === 'media' }); }
  finally { previewCuts.forEach((cut, i) => { cut.area = previousAreas[i]; }); if (mediaCut) Object.assign(mediaCut, previousMedia); }
  const dt = performance.now() - t0;
  S.slow = S.playing ? (dt > 30 ? true : dt < 14 ? false : S.slow) : false;
  updateTimeUI(); drawTimeline(); updateCutInfo();
}
function tick(now) {
  requestAnimationFrame(tick);
  if (S.exporting) return;
  if (S.playing) {
    // rAF timestamps can precede the moment play()/seek() stamped t0 → clamp so t never goes negative
    let t = Math.max(0, S.audio ? AP.time() : (now - S.t0) / 1000);
    if (S.tap && S.tap.append && !S.audio && t >= S.plan.duration - 2) extendTapPreview(t);
    const stopAt = S.tap && S.tap.append && S.audio ? Math.min(S.plan.duration, S.audio.duration) : S.plan.duration;
    if (t >= stopAt - 1e-3) {
      if (S.loop && !S.tap) { seek(0); t = 0; }
      else { pause(); t = stopAt - 1e-3; if (S.tap) stopTap(); }
    }
    S.t = t; S.need = true;
  }
  if (S.need) { S.need = false; draw(); }
}
function updateTimeUI() {
  $('timeNow').textContent = J.fmtTime(S.t);
  $('timeDur').textContent = J.fmtTime(S.durationDrag ? S.durationDrag.preview : S.plan.duration);
  $('timeDur').classList.toggle('manual', S.project.durationOverride != null || !!S.durationDrag);
  if (!S.scrubbing) $('scrub').value = String(Math.round(S.t / Math.max(0.001, S.plan.duration) * 10000));
}
function minimumProjectDuration() {
  let minimum = 0.1;
  for (const line of S.plan.lines) minimum = Math.max(minimum, line.start + 0.04);
  for (const blank of S.project.lyricBlankCuts || []) if (Number.isFinite(+blank.start)) minimum = Math.max(minimum, +blank.start + 0.04);
  for (const layer of ['media', 'foreground']) {
    minimum = Math.max(minimum, S.plan[layer].cuts.length * 0.04);
    for (const [index, time] of Object.entries(S.project[layer].timing.lineTimes)) {
      if (+index < S.plan[layer].cuts.length && Number.isFinite(+time)) minimum = Math.max(minimum, +time + (S.plan[layer].cuts.length - +index) * 0.04);
    }
  }
  return Math.ceil(minimum * 100) / 100;
}
function parseProjectDuration(raw) {
  const parts = String(raw).trim().split(':');
  if (parts.length > 3 || !parts.every(p => /^\d+(?:\.\d{1,2})?$/.test(p))) return NaN;
  if (parts.slice(0, -1).some(p => p.includes('.'))) return NaN;
  if (parts.length > 1 && +parts.at(-1) >= 60) return NaN;
  if (parts.length === 3 && +parts[1] >= 60) return NaN;
  return parts.reduce((seconds, part) => seconds * 60 + +part, 0);
}
function setProjectDuration(seconds) {
  if (S.exporting || S.tap) return false;
  const minimum = minimumProjectDuration();
  if (seconds != null && (!Number.isFinite(seconds) || seconds < minimum - 1e-6 || seconds > 21600)) {
    toast(`動画全体の長さは ${J.fmtTime(minimum)} ～ 06:00:00 の範囲で入力してください`);
    return false;
  }
  if (S.areaEdit) cancelAreaEditor();
  pause();
  S.project.durationOverride = seconds == null ? null : Math.round(seconds * 100) / 100;
  replan();
  return true;
}
function play() {
  if (S.audio) AP.play(S.audio.buffer, S.t);
  else S.t0 = performance.now() - S.t * 1000;
  S.playing = true; $('btnPlay').textContent = '❚❚'; $('btnPlay').setAttribute('aria-label', '一時停止');
}
function pause() {
  S.playing = false; AP.stop();
  J.syncMediaPreview(S.plan, S.t, false);
  $('btnPlay').textContent = '▶'; $('btnPlay').setAttribute('aria-label', '再生'); S.need = true;
}
function seek(t) {
  S.t = J.clamp(t, 0, Math.max(0, S.plan.duration - 1e-3));
  if (S.audio) { if (S.playing) AP.play(S.audio.buffer, S.t); }
  else S.t0 = performance.now() - S.t * 1000;
  J.syncMediaPreview(S.plan, S.t, S.playing);
  S.need = true;
}

/* ---------------- timeline ---------------- */
const layoutHue = k => (J.LAYOUT_ORDER.indexOf(k) * 37 + 30) % 360;
function sizeTimelineStack() {
  const scroll = $('timelineScroll'), stack = $('timelineStack');
  const width = Math.max(10, Math.round(scroll.clientWidth * S.timelineZoom));
  if (stack.style.width !== `${width}px`) stack.style.width = `${width}px`;
}
function setTimelineZoom(zoom) {
  const scroll = $('timelineScroll'), stack = $('timelineStack');
  const center = scroll.scrollLeft + scroll.clientWidth / 2;
  const fraction = center / Math.max(1, stack.clientWidth);
  S.timelineZoom = J.clamp(zoom, 1, 8);
  sizeTimelineStack();
  scroll.scrollLeft = Math.max(0, fraction * stack.clientWidth - scroll.clientWidth / 2);
  $('timelineZoomValue').textContent = `${Math.round(S.timelineZoom * 100)}%`;
  $('timelineZoomOut').disabled = S.timelineZoom <= 1;
  $('timelineZoomIn').disabled = S.timelineZoom >= 8;
  drawTimeline(); drawTimelineLinks();
}
function drawTimeline() {
  sizeTimelineStack();
  const c = $('timeline'), dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(10, Math.round(c.clientWidth * dpr)), h = Math.max(10, Math.round(c.clientHeight * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const x = c.getContext('2d'), D = Math.max(0.001, S.plan.duration), X = t => t / D * w;
  x.fillStyle = '#131316'; x.fillRect(0, 0, w, h);
  if (S.audio && S.audio.peaks) {
    const pk = S.audio.peaks, n = pk.length, sd = S.audio.duration;
    x.fillStyle = '#2b2b33';
    for (let i = 0; i < w; i += 2) { const t = i / w * D; if (t > sd) break; const v = pk[Math.min(n - 1, Math.floor(t / sd * n))]; const hh = v * h * 0.8; x.fillRect(i, h * 0.6 - hh / 2, 1.5, hh); }
  }
  const beats = S.plan.beats || [];
  x.fillStyle = '#3a3a44';
  for (const b of beats) { if (b > D) break; x.fillRect(Math.round(X(b)), h - 6 * dpr, 1, 6 * dpr); }
  const top = h * 0.3, bot = h - 8 * dpr;
  for (const cut of S.plan.cuts) {
    const x0 = X(cut.start), x1 = X(cut.end);
    const hue = cut.blank ? 190 : layoutHue(cut.layout);
    x.fillStyle = `hsla(${hue},70%,58%,0.28)`; x.fillRect(x0, top, Math.max(1, x1 - x0 - 1), bot - top);
    x.fillStyle = `hsla(${hue},80%,62%,0.95)`; x.fillRect(x0, top, Math.max(1, 2 * dpr), bot - top);
    if (cut.line >= 0) x.fillRect(x0 - 2 * dpr, top - 3 * dpr, 6 * dpr, 6 * dpr);
    if (x1 - x0 > 34 * dpr) {
      x.fillStyle = 'rgba(236,231,225,0.85)'; x.font = `${10 * dpr}px ${getComputedStyle(document.body).getPropertyValue('--mono') || 'monospace'}`;
      x.save(); x.beginPath(); x.rect(x0, top, x1 - x0 - 3, bot - top); x.clip();
      x.fillText(cut.blank ? '無表示' : (cut.text || cut.lineText || ''), x0 + 5 * dpr, top + 13 * dpr); x.restore();
    }
  }
  x.font = `${10 * dpr}px monospace`;
  for (const ln of S.plan.lines) {
    const lx = X(ln.start);
    x.fillStyle = '#5d5a63'; x.fillRect(lx, 0, 1, top);
    x.fillStyle = '#8e8a94'; x.fillText(String(ln.index + 1).padStart(2, '0'), lx + 3 * dpr, 12 * dpr);
  }
  const px = X(S.t);
  x.fillStyle = '#f5a50c'; x.fillRect(Math.round(px) - dpr, 0, 2 * dpr, h);
  drawTimelineDragGuide(x, w, h, dpr, 'lyrics');
  drawMediaTimeline();
  drawMediaTimeline('foreground');
}
function extendTapPreview(t) {
  const end = Math.max(S.plan.duration, t + 10);
  S.plan.duration = end;
  for (const layer of ['media', 'foreground']) {
    S.plan[layer].duration = end;
    const last = S.plan[layer].cuts.at(-1); if (last && last.videoDuration == null) last.end = end;
  }
}
function drawMediaTimeline(layer = 'media') {
  const c = $(layer === 'media' ? 'mediaTimeline' : 'foregroundTimeline'), dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(10, Math.round(c.clientWidth * dpr)), h = Math.max(10, Math.round(c.clientHeight * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const x = c.getContext('2d'), D = Math.max(0.001, S.plan.duration), X = t => t / D * w;
  x.fillStyle = '#131316'; x.fillRect(0, 0, w, h);
  x.fillStyle = '#8e8a94'; x.font = `${10 * dpr}px monospace`; x.fillText(layer === 'media' ? '背景' : '前景', 6 * dpr, 12 * dpr);
  for (const cut of S.plan[layer].cuts) {
    const a = X(cut.start), b = X(cut.end);
    x.fillStyle = cut.type === 'video' ? 'rgba(22,244,212,0.28)' : 'rgba(245,165,12,0.28)'; x.fillRect(a, 17 * dpr, Math.max(1, b - a - 1), h - 20 * dpr);
    x.fillStyle = cut.type === 'video' ? '#16f4d4' : '#f5a50c'; x.fillRect(a, 17 * dpr, 2 * dpr, h - 20 * dpr);
    x.fillRect(a - 2 * dpr, 14 * dpr, 6 * dpr, 6 * dpr);
    if (b - a > 45 * dpr) { x.save(); x.beginPath(); x.rect(a, 17 * dpr, b - a - 3, h - 20 * dpr); x.clip(); x.fillStyle = '#ece7e1'; x.fillText(cut.name, a + 5 * dpr, 31 * dpr); x.restore(); }
  }
  x.fillStyle = '#f5a50c'; x.fillRect(Math.round(X(S.t)) - dpr, 0, 2 * dpr, h);
  drawTimelineDragGuide(x, w, h, dpr, layer);
}
function drawTimelineDragGuide(ctx, width, height, dpr, layer) {
  const drag = S.timelineDrag;
  if (!drag || !drag.moved || !linkedRefs(drag.ref).some(ref => boundaryLayer(ref) === layer)) return;
  const px = drag.preview / Math.max(0.001, S.plan.duration) * width;
  ctx.fillStyle = '#16f4d4'; ctx.fillRect(Math.round(px) - 2 * dpr, 0, 4 * dpr, height);
  ctx.fillStyle = '#101318'; ctx.fillRect(J.clamp(px + 5 * dpr, 0, width - 47 * dpr), 1 * dpr, 47 * dpr, 15 * dpr);
  ctx.fillStyle = '#16f4d4'; ctx.font = `${11 * dpr}px monospace`;
  ctx.fillText(`${drag.preview.toFixed(2)}s`, J.clamp(px + 8 * dpr, 3 * dpr, width - 44 * dpr), 12 * dpr);
}
function timelineSeek(ev) {
  const r = ev.currentTarget.getBoundingClientRect();
  seek((ev.clientX - r.left) / r.width * S.plan.duration);
}
function boundaryRef(layer, cut) {
  if (layer === 'foreground') return `f:${cut.index}`;
  if (layer === 'media') return `m:${cut.index}`;
  return cut.blank ? `l:blank:${cut.blankId}` : `l:${cut.line}:${cut.part}`;
}
function boundaryLayer(ref) { return ref[0] === 'f' ? 'foreground' : ref[0] === 'm' ? 'media' : 'lyrics'; }
function boundaryCut(ref) {
  if (typeof ref !== 'string' || !S.plan) return null;
  const layer = boundaryLayer(ref);
  if (layer !== 'lyrics') {
    const index = +ref.slice(2);
    return Number.isInteger(index) && index >= 0 && ref === `${ref[0]}:${index}` ? S.plan[layer].cuts[index] || null : null;
  }
  if (ref.startsWith('l:blank:')) return S.plan.cuts.find(c => c.blank && c.blankId === ref.slice(8)) || null;
  return S.plan.cuts.find(c => c.line >= 0 && boundaryRef('lyrics', c) === ref) || null;
}
function linkedRefs(ref) {
  const seen = new Set([ref]), queue = [ref];
  for (const cur of queue) for (const link of S.project.timelineLinks) {
    const next = link.a === cur ? link.b : link.b === cur ? link.a : null;
    if (next && !seen.has(next)) { seen.add(next); queue.push(next); }
  }
  return queue;
}
function timelineMarkers() {
  const stack = $('timelineStack'), D = Math.max(0.001, S.plan.duration), markers = [];
  for (const [layer, id] of [['foreground', 'foregroundTimeline'], ['lyrics', 'timeline'], ['media', 'mediaTimeline']]) {
    const canvas = $(id), cuts = layer === 'lyrics' ? S.plan.cuts.filter(c => c.line >= 0 || c.blank) : S.plan[layer].cuts;
    const y = canvas.offsetTop + 11;
    for (const cut of cuts) markers.push({ ref: boundaryRef(layer, cut), layer, x: canvas.offsetLeft + cut.start / D * canvas.clientWidth, y });
  }
  return markers;
}
function rerollLyricLine(index) {
  const line = S.plan.lines[index]; if (!line) return;
  const current = S.project.overrides[index] || {};
  setOv(index, { seed: (current.seed | 0) + 1, lock: false });
  replan(); seek(line.start + 0.001);
}
function toggleLyricLineLock(index) {
  const line = S.plan.lines[index]; if (!line) return;
  const current = S.project.overrides[index] || {};
  setOv(index, current.lock ? { lock: false, lockedSeed: undefined } : { lock: true, lockedSeed: line.seed });
  replan();
}
function toggleLyricCutFrontmost(line, part) {
  const key = `${line}:${part}`, options = S.project.lyricCutOptions;
  if (options[key] && options[key].frontmost) delete options[key];
  else options[key] = { frontmost: true };
  replan();
}
function mediaCutOptions(layer, index) {
  const cut = S.plan[layer].cuts[index]; if (!cut) return null;
  const media = S.project[layer];
  return Object.assign({}, media.overrides[cut.itemId] || {}, media.cutOverrides[index] || {});
}
function rerollMediaCut(layer, index) {
  const cut = S.plan[layer].cuts[index], options = mediaCutOptions(layer, index);
  if (!cut || !options) return;
  mediaOv(index, { seed: (options.seed | 0) + 1, lock: false }, layer);
  replan(); seek(cut.start + 0.001);
}
function toggleMediaCutLock(layer, index) {
  const cut = S.plan[layer].cuts[index], options = mediaCutOptions(layer, index);
  if (!cut || !options) return;
  mediaOv(index, options.lock ? { lock: false, lockedSeed: undefined } : { lock: true, lockedSeed: cut.seed }, layer);
  replan();
}
function performTimelineAction(control) {
  const layer = control.dataset.layer, index = +control.dataset.index;
  if (!Number.isInteger(index) || index < 0) return;
  if (control.dataset.action === 'area') {
    if (layer === 'lyrics') openAreaEditor(index);
    else if (layer === 'foreground' || layer === 'media') openMediaEditor(index, layer);
    return;
  }
  if (control.dataset.action === 'frontmost' && layer === 'lyrics') {
    toggleLyricCutFrontmost(index, +control.dataset.part);
    return;
  }
  if (layer === 'lyrics') {
    if (control.dataset.action === 'dice') rerollLyricLine(index);
    else toggleLyricLineLock(index);
  } else if (layer === 'foreground' || layer === 'media') {
    if (control.dataset.action === 'dice') rerollMediaCut(layer, index);
    else toggleMediaCutLock(layer, index);
  }
}
function drawTimelineLinks() {
  const svg = $('timelineLinks'), stack = $('timelineStack');
  if (!svg || !S.plan) return;
  const width = stack.clientWidth, height = stack.clientHeight;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const markers = timelineMarkers();
  if (S.timelineDrag && S.timelineDrag.moved) {
    const moving = new Set(linkedRefs(S.timelineDrag.ref));
    for (const marker of markers) if (moving.has(marker.ref)) {
      const canvas = $(marker.layer === 'lyrics' ? 'timeline' : marker.layer === 'media' ? 'mediaTimeline' : 'foregroundTimeline');
      marker.x = canvas.offsetLeft + S.timelineDrag.preview / Math.max(0.001, S.plan.duration) * canvas.clientWidth;
    }
  }
  const byRef = new Map(markers.map(m => [m.ref, m]));
  const links = S.project.timelineLinks.map((link, index) => {
    const a = byRef.get(link.a), b = byRef.get(link.b);
    if (!a || !b) return '';
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    return `<line class="link-wire" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/><g class="link-remove" data-edge="${index}" role="button" aria-label="リンクを解除"><circle cx="${mx}" cy="${my}" r="9"/><text x="${mx}" y="${my + 0.5}">×</text></g>`;
  }).join('');
  const preview = S.linkDrag ? `<line class="link-preview" x1="${S.linkDrag.sourceX}" y1="${S.linkDrag.sourceY}" x2="${S.linkDrag.x}" y2="${S.linkDrag.y}"/>` : '';
  const handles = markers.map(m => `<g class="link-handle ${linkedRefs(m.ref).length > 1 ? 'linked' : ''}" data-ref="${escapeHtml(m.ref)}" role="button" aria-label="境界をリンク"><circle cx="${m.x}" cy="${m.y}" r="9"/><text x="${m.x}" y="${m.y + 0.5}">🔗</text></g>`).join('');
  const action = (layer, cut, index, locked) => {
    const canvas = $(layer === 'lyrics' ? 'timeline' : layer === 'foreground' ? 'foregroundTimeline' : 'mediaTimeline');
    const startX = canvas.offsetLeft + cut.start / Math.max(0.001, S.plan.duration) * canvas.clientWidth;
    const left = J.clamp(startX + 25, canvas.offsetLeft + 9, canvas.offsetLeft + canvas.clientWidth - 63);
    const y = canvas.offsetTop + 11;
    const areaIcon = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="12" height="10"/><path d="M2 6h12M5 3v10"/></svg>';
    const actions = [['dice', false, layer === 'lyrics' ? 'この行を再抽選' : 'このカットを再抽選', ICON.dice], ['lock', locked, layer === 'lyrics' ? 'この行の構成をロック' : 'このカットをロック', ICON.lock]];
    if (layer === 'lyrics' || J.mediaAssets.has(cut.itemId)) actions.push(['area', false, layer === 'lyrics' ? 'この行の表示エリアを編集' : 'このカットの配置とサイズを編集', areaIcon]);
    return actions.map(([name, active, label, icon], n) => {
      const x = left + n * 20, graphic = icon.replace('<svg ', '<svg x="-7" y="-7" width="14" height="14" ');
      return `<g class="timeline-action ${active ? 'locked' : ''}" data-action="${name}" data-layer="${layer}" data-index="${index}" role="button" tabindex="0" aria-label="${label}" ${name === 'lock' ? `aria-pressed="${active}"` : ''} transform="translate(${x} ${y})"><rect x="-9" y="-9" width="18" height="18" rx="3"/>${graphic}</g>`;
    }).join('');
  };
  const lyricActions = S.plan.lines.map(line => {
    const cut = S.plan.cuts.find(c => c.line === line.index && c.part === 0);
    return cut ? action('lyrics', cut, line.index, !!(S.project.overrides[line.index] || {}).lock) : '';
  }).join('');
  const frontmostActions = S.plan.cuts.filter(cut => cut.line >= 0 && Number.isInteger(cut.part)).map(cut => {
    const canvas = $('timeline'), startX = canvas.offsetLeft + cut.start / Math.max(0.001, S.plan.duration) * canvas.clientWidth;
    const x = J.clamp(startX + 10, canvas.offsetLeft + 9, canvas.offsetLeft + canvas.clientWidth - 9);
    const y = canvas.offsetTop + 33, active = !!cut.frontmost;
    const graphic = ICON.frontmost.replace('<svg ', '<svg x="-7" y="-7" width="14" height="14" ');
    return `<g class="timeline-action ${active ? 'frontmost' : ''}" data-action="frontmost" data-layer="lyrics" data-index="${cut.line}" data-part="${cut.part}" role="button" tabindex="0" aria-label="${cut.line + 1}行目${cut.part + 1}カット目を最前に表示" aria-pressed="${active}" transform="translate(${x} ${y})"><rect x="-9" y="-9" width="18" height="18" rx="3"/>${graphic}</g>`;
  }).join('');
  const mediaActions = ['foreground', 'media'].map(layer => S.plan[layer].cuts.map(cut => action(layer, cut, cut.index, !!mediaCutOptions(layer, cut.index).lock)).join('')).join('');
  svg.innerHTML = links + preview + handles + lyricActions + frontmostActions + mediaActions;
}
function markerNear(clientX, clientY, sourceLayer) {
  const rect = $('timelineStack').getBoundingClientRect(), x = clientX - rect.left, y = clientY - rect.top;
  let best = null, distance = 18;
  for (const marker of timelineMarkers()) {
    if (marker.layer === sourceLayer) continue;
    const d = Math.hypot(marker.x - x, marker.y - y);
    if (d < distance) { best = marker; distance = d; }
  }
  return best;
}
function timelineBoundaryAt(ev, layer) {
  const rect = ev.currentTarget.getBoundingClientRect(), duration = S.plan.duration;
  const cuts = layer === 'lyrics' ? S.plan.cuts.filter(c => c.line >= 0 || c.blank) : S.plan[layer].cuts;
  let chosen = null, distance = 9;
  for (const cut of cuts) {
    const px = rect.left + cut.start / duration * rect.width, delta = Math.abs(ev.clientX - px);
    if (delta < distance) { chosen = cut; distance = delta; }
  }
  return chosen ? timelineBoundaryForCut(chosen, layer) : null;
}
function timelineBoundaryForCut(chosen, layer) {
  const duration = S.plan.duration;
  let min, max, target;
  if (layer !== 'lyrics') {
    const cutsForLayer = S.plan[layer].cuts, index = chosen.index;
    min = index ? cutsForLayer[index - 1].start + 0.04 : 0;
    max = index + 1 < cutsForLayer.length ? cutsForLayer[index + 1].start - 0.04 : duration - 0.04;
    target = { index };
  } else if (chosen.blank) {
    const rows = [...S.plan.lines.map(line => ({ start: line.start })), ...S.plan.cuts.filter(c => c.blank).map(c => ({ start: c.start, id: c.blankId }))].sort((a, b) => a.start - b.start);
    const i = rows.findIndex(row => row.id === chosen.blankId);
    min = i > 0 ? rows[i - 1].start + 0.04 : 0;
    max = i + 1 < rows.length ? rows[i + 1].start - 0.04 : duration - 0.04;
    target = { blankId: chosen.blankId };
  } else if (chosen.part === 'interlude') {
    const previous = S.plan.cuts.find(c => c.line === chosen.line && typeof c.part === 'number' && c.end === chosen.start);
    min = previous ? previous.start + 0.22 : S.plan.lines[chosen.line].start + 0.5;
    max = chosen.end - 1.31;
    target = { line: chosen.line, part: 'interlude' };
  } else if (chosen.part === 0) {
    const line = chosen.line, lines = S.plan.lines;
    min = line ? lines[line - 1].start + 0.35 : 0;
    max = line + 1 < lines.length ? lines[line + 1].start - 0.5 : duration - 0.5;
    const firstInner = S.project.timing.cutTimes && S.project.timing.cutTimes[`${line}:1`];
    if (firstInner != null && Number.isFinite(+firstInner)) max = Math.min(max, +firstInner - 0.22);
    target = { line, part: 0, nextLineStart: lines[line + 1] && lines[line + 1].start };
  } else {
    const previous = S.plan.cuts.find(c => c.line === chosen.line && c.part === chosen.part - 1);
    min = previous ? previous.start + 0.22 : S.plan.lines[chosen.line].start + 0.22;
    max = chosen.end - 0.22;
    target = { line: chosen.line, part: chosen.part };
  }
  return max > min ? { layer, ref: boundaryRef(layer, chosen), start: chosen.start, min, max, ...target } : null;
}
function setTimelineBoundaryTime(drag, t) {
  if (drag.layer === 'lyrics') {
    const timing = S.project.timing;
    if (drag.blankId) {
      const blank = S.project.lyricBlankCuts.find(b => b.id === drag.blankId);
      if (blank) blank.start = t;
    } else if (drag.part === 0) {
      timing.lineTimes[drag.line] = t;
      if (drag.nextLineStart != null && timing.lineTimes[drag.line + 1] == null) timing.lineTimes[drag.line + 1] = +drag.nextLineStart.toFixed(3);
    } else {
      if (!timing.cutTimes) timing.cutTimes = {};
      timing.cutTimes[`${drag.line}:${drag.part}`] = t;
    }
  } else S.project[drag.layer].timing.lineTimes[drag.index] = t;
}
function boundaryGroupLimits(ref) {
  const members = linkedRefs(ref).map(id => {
    const cut = boundaryCut(id);
    return cut && timelineBoundaryForCut(cut, boundaryLayer(id));
  });
  if (members.some(x => !x)) return null;
  return { members, min: Math.max(...members.map(x => x.min)), max: Math.min(...members.map(x => x.max)) };
}
function commitTimelineBoundary(drag) {
  const t = +drag.preview.toFixed(3);
  const group = boundaryGroupLimits(drag.ref);
  if (!group || group.max < group.min) return;
  for (const member of group.members) setTimelineBoundaryTime(member, t);
  replan();
}
function connectTimelineBoundaries(source, target) {
  const from = linkedRefs(source), to = linkedRefs(target);
  if (from.includes(target)) return;
  const layers = from.map(boundaryLayer);
  if (to.some(ref => layers.includes(boundaryLayer(ref)))) { toast('同じレイヤーの境界は同時にリンクできません'); return; }
  const limits = [source, target].map(boundaryGroupLimits);
  if (limits.some(x => !x)) return;
  const min = Math.max(...limits.map(x => x.min)), max = Math.min(...limits.map(x => x.max));
  const targetTime = boundaryCut(target).start;
  if (targetTime < min - 0.001 || targetTime > max + 0.001) { toast('この開始位置にはリンクできません'); return; }
  for (const ref of [...from, ...to]) setTimelineBoundaryTime(timelineBoundaryForCut(boundaryCut(ref), boundaryLayer(ref)), targetTime);
  S.project.timelineLinks.push({ a: source, b: target });
  replan();
}

/* ---------------- cut info ---------------- */
let lastCutIdx = -2;
function updateCutInfo() {
  const cut = J.cutAt(S.plan, S.t);
  const mc = J.mediaAt(S.plan, S.t);
  const fc = J.mediaAt(S.plan, S.t, 'foreground');
  const idx = `${cut ? cut.index : -1}/${mc ? mc.index : -1}/${fc ? fc.index : -1}`;
  const li = cut ? cut.line : -1;
  if (li !== S.curLine) { S.lineEls.forEach((el, i) => el.classList.toggle('cur', i === li)); S.curLine = li; }
  S.blankEls.forEach((el, id) => el.classList.toggle('cur', !!cut && cut.blankId === id));
  const active = S.sourceTab === 'foreground' ? fc : mc;
  S.mediaLineEls.forEach((el, i) => el.classList.toggle('cur', !!active && i === active.index));
  if (idx === lastCutIdx) return;
  lastCutIdx = idx;
  const el = $('cutInfo');
  if (!cut && !mc && !fc) { el.innerHTML = '<span class="hint">この位置にカットはありません</span>'; return; }
  const chip = (cls, k, v) => `<span class="chip ${cls}"><b>${k}</b>${v}</span>`;
  const n = (tbl, k) => (tbl[k] ? tbl[k].name : k);
  el.innerHTML = (cut && cut.blank ? [chip('l', '歌詞', '無表示')] : cut ? [
    `<span class="chip mono">#${String(cut.index + 1).padStart(2, '0')}</span>`,
    chip('l', 'レイアウト', n(J.LAYOUTS, cut.layout)), chip('e', '登場', n(J.ENTER, cut.enter)), chip('h', '保持', n(J.HOLD, cut.hold)), chip('x', '退場', n(J.EXIT, cut.exit)),
    cut.decor && cut.decor.length ? chip('', '装飾', cut.decor.map(d => n(J.DECOR, d.id)).join('・')) : '',
    cut.treat && cut.treat !== 'none' ? chip('t', '加工', n(J.TREAT, cut.treat)) : '',
    cut.bg && cut.bg !== 'none' ? chip('b', '背景', n(J.BG, cut.bg)) : '',
    cut.cam && cut.cam !== 'push' ? chip('c', 'カメラ', n(J.CAMERA, cut.cam)) : '',
    cut.trans ? chip('c', 'つなぎ', n(J.TRANS, cut.trans)) : '',
  ] : []).concat(...[mc, fc].map((mediaCut, i) => mediaCut ? [chip('b', i ? '前景' : '背景', escapeHtml(mediaCut.name)), chip('l', '表示', J.MEDIA_LAYOUT[mediaCut.layout]), chip('e', '登場', J.MEDIA_ENTER[mediaCut.enter]), chip('h', '保持', J.MEDIA_HOLD[mediaCut.hold]), chip('x', '退場', J.MEDIA_EXIT[mediaCut.exit]), chip('t', '加工', J.MEDIA_TREAT[mediaCut.treat]), mediaCut.trans ? chip('c', 'つなぎ', J.mediaTransOptions()[mediaCut.trans]) : '', mediaCut.placement && mediaCut.placement.angle ? chip('c', '角度', `${mediaCut.placement.angle}°`) : '', mediaCut.chromaKey ? chip('c', 'クロマキー', mediaCut.chromaColor) : ''] : [])).join('');
}

/* ---------------- line list ---------------- */
function insertLyricBlankCut(rows, position) {
  if (S.project.lyricBlankCuts.length >= 1000) { toast('カット数の上限に達しました'); return; }
  const previous = rows[position - 1], next = rows[position];
  let start = previous ? (next ? (previous.start + next.start) / 2 : (previous.start + S.plan.duration) / 2) : 0;
  if (next && next.start - start < 0.04) {
    if (next.blankId) {
      const blank = S.project.lyricBlankCuts.find(b => b.id === next.blankId);
      if (blank) blank.start = +Math.max(0.4, next.start + 0.4).toFixed(3);
    } else S.project.timing.lineTimes[next.line] = +Math.max(0.4, next.start + 0.4).toFixed(3);
  }
  if (!next && S.plan.duration - start < 0.04) start = Math.max(0, S.plan.duration - 0.4);
  S.project.lyricBlankCuts.push({ id: crypto.randomUUID(), beforeLine: next ? next.line ?? next.beforeLine : S.plan.lines.length, start: +start.toFixed(3) });
  replan(); seek(start + 0.001);
}
function reconcileLyricLines(previous, next) {
  const oldLines = J.parseLyrics(previous).lines, newLines = J.parseLyrics(next).lines;
  if (oldLines.length === newLines.length) return false;
  const same = (a, b) => a.text === b.text && a.lrc === b.lrc;
  let prefix = 0, suffix = 0;
  while (prefix < Math.min(oldLines.length, newLines.length) && same(oldLines[prefix], newLines[prefix])) prefix++;
  while (suffix < Math.min(oldLines.length, newLines.length) - prefix && same(oldLines[oldLines.length - 1 - suffix], newLines[newLines.length - 1 - suffix])) suffix++;
  const oldMiddle = oldLines.length - prefix - suffix, newMiddle = newLines.length - prefix - suffix;
  const oldToNew = new Map();
  for (let i = 0; i < prefix; i++) oldToNew.set(i, i);
  for (let i = 0; i < suffix; i++) oldToNew.set(oldLines.length - suffix + i, newLines.length - suffix + i);
  if (oldMiddle * newMiddle <= 250000) {
    const dp = Array.from({ length: oldMiddle + 1 }, () => new Uint16Array(newMiddle + 1));
    for (let i = oldMiddle - 1; i >= 0; i--) for (let j = newMiddle - 1; j >= 0; j--) {
      dp[i][j] = same(oldLines[prefix + i], newLines[prefix + j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
    for (let i = 0, j = 0; i < oldMiddle && j < newMiddle;) {
      if (same(oldLines[prefix + i], newLines[prefix + j])) { oldToNew.set(prefix + i, prefix + j); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
  }
  const anchors = [[-1, -1], ...[...oldToNew].sort((a, b) => a[0] - b[0]), [oldLines.length, newLines.length]];
  for (let a = 1; a < anchors.length; a++) {
    const [oldBefore, newBefore] = anchors[a - 1], [oldAfter, newAfter] = anchors[a];
    for (let k = 1; k <= Math.min(oldAfter - oldBefore - 1, newAfter - newBefore - 1); k++) oldToNew.set(oldBefore + k, newBefore + k);
  }
  const oldStarts = J.computeTiming(S.project, { lines: oldLines }, audioLike()).starts;
  const oldTimes = S.project.timing.lineTimes || {};
  const newTimes = {};
  for (const [key, value] of Object.entries(oldTimes)) {
    const mapped = oldToNew.get(+key);
    if (mapped != null) newTimes[mapped] = value;
  }
  // Preserve following lines, and preserve every LRC time if a new plain line disables all-LRC timing.
  const preserveAll = oldLines.length > 0 && oldLines.every(line => line.lrc != null) && newLines.some(line => line.lrc == null);
  for (let i = preserveAll ? 0 : oldLines.length - suffix; i < oldLines.length; i++) {
    const mapped = oldToNew.get(i);
    if (mapped != null && newTimes[mapped] == null) newTimes[mapped] = +oldStarts[i].toFixed(3);
  }
  const newToOld = new Map([...oldToNew].map(([oldIndex, newIndex]) => [newIndex, oldIndex]));
  for (let i = 0; i < newLines.length;) {
    if (newToOld.has(i)) { i++; continue; }
    let end = i; while (end < newLines.length && !newToOld.has(end)) end++;
    if (end < newLines.length) {
      const before = newToOld.get(i - 1), after = newToOld.get(end);
      const left = before == null ? 0 : oldStarts[before], right = oldStarts[after];
      for (let j = i; j < end; j++) newTimes[j] = +(left + (right - left) * (j - i + 1) / (end - i + 1)).toFixed(3);
    }
    i = end;
  }
  S.project.timing.lineTimes = newTimes;
  const remap = source => {
    const result = {};
    for (const [key, value] of Object.entries(source || {})) {
      const mapped = oldToNew.get(+key);
      if (mapped != null) result[mapped] = value;
    }
    return result;
  };
  S.project.overrides = remap(S.project.overrides);
  const newCutTimes = {};
  for (const [key, value] of Object.entries(S.project.timing.cutTimes || {})) {
    const match = key.match(/^(\d+):(.*)$/), mapped = match && oldToNew.get(+match[1]);
    if (mapped != null) newCutTimes[`${mapped}:${match[2]}`] = value;
  }
  S.project.timing.cutTimes = newCutTimes;
  const newCutOptions = {};
  for (const [key, value] of Object.entries(S.project.lyricCutOptions || {})) {
    const match = key.match(/^(\d+):(.*)$/), mapped = match && oldToNew.get(+match[1]);
    if (mapped != null) newCutOptions[`${mapped}:${match[2]}`] = value;
  }
  S.project.lyricCutOptions = newCutOptions;
  const newStarts = J.computeTiming(S.project, { lines: newLines }, audioLike()).starts;
  for (const blank of S.project.lyricBlankCuts) {
    const following = newStarts.findIndex(start => start > +blank.start + 1e-6);
    blank.beforeLine = following < 0 ? newLines.length : following;
  }
  const mapRef = ref => {
    const match = /^l:(\d+):(.*)$/.exec(ref);
    if (!match) return ref;
    const mapped = oldToNew.get(+match[1]);
    return mapped == null ? null : `l:${mapped}:${match[2]}`;
  };
  S.project.timelineLinks = S.project.timelineLinks.flatMap(link => {
    const a = mapRef(link.a), b = mapRef(link.b);
    return a && b ? [{ a, b }] : [];
  });
  return true;
}
function renderLines() {
  const ol = $('lineList'); ol.innerHTML = ''; S.lineEls = []; S.blankEls = new Map(); S.curLine = -2;
  const ov = S.project.overrides;
  const layoutOpts = '<option value="">自動</option>' + J.LAYOUT_ORDER.map(k => `<option value="${k}">${J.LAYOUTS[k].name}</option>`).join('');
  const rows = [...S.plan.lines.map(ln => ({ line: ln.index, start: ln.start })), ...S.plan.cuts.filter(c => c.blank).map(c => ({ blankId: c.blankId, beforeLine: c.beforeLine, start: c.start }))].sort((a, b) => a.start - b.start);
  const addButton = position => {
    const row = document.createElement('li'); row.className = 'media-cut-insert';
    row.innerHTML = `<button class="ghost small" type="button" aria-label="${position + 1}番目に無表示カットを追加">＋ 無表示カットを追加</button>`;
    row.querySelector('button').addEventListener('click', () => insertLyricBlankCut(rows, position));
    ol.appendChild(row);
  };
  rows.forEach((row, position) => {
    addButton(position);
    if (row.blankId) {
      const li = document.createElement('li'); li.className = 'ln lyric-ln lyric-blank-ln';
      li.innerHTML = `<span class="no">—</span><input class="time mono" type="number" step="0.01" min="0" value="${row.start.toFixed(2)}" aria-label="無表示カットの開始秒"><span class="txt">無表示</span><div class="meta"><span class="cuts"></span><span class="tools"><button class="ghost small remove-blank" type="button" aria-label="無表示カットを削除">削除</button></span></div>`;
      li.querySelector('.time').addEventListener('change', e => { const blank = S.project.lyricBlankCuts.find(b => b.id === row.blankId); if (blank) blank.start = Math.max(0, parseFloat(e.target.value) || 0); replan(); });
      li.querySelector('.txt').addEventListener('click', () => seek(row.start + 0.001));
      li.querySelector('.remove-blank').addEventListener('click', () => { S.project.lyricBlankCuts = S.project.lyricBlankCuts.filter(b => b.id !== row.blankId); replan(); });
      ol.appendChild(li); S.blankEls.set(row.blankId, li);
      return;
    }
    const i = row.line, ln = S.plan.lines[i];
    const o = ov[i] || {};
    const li = document.createElement('li'); li.className = 'ln lyric-ln';
    const manual = S.project.timing.lineTimes && S.project.timing.lineTimes[i] != null;
    const area = J.lyricArea(o.area) || { x: 0, y: 0, w: 1, h: 1 };
    li.innerHTML = `<span class="no">${String(i + 1).padStart(2, '0')}</span>
      <input class="time mono" type="number" step="0.01" min="0" value="${ln.start.toFixed(2)}" title="開始（秒）${manual ? '・手動' : '・自動'}" aria-label="${i + 1}行目の開始秒" style="${manual ? 'border-color:var(--cyan)' : ''}">
      <span class="txt" title="${escapeHtml(ln.text)}">${escapeHtml(ln.text)}</span>
      <button class="lyric-area-thumb" title="${i + 1}行目の歌詞表示エリアを編集" aria-label="${i + 1}行目の歌詞表示エリアを編集"><i style="left:${area.x * 100}%;top:${area.y * 100}%;width:${area.w * 100}%;height:${area.h * 100}%;transform:rotate(${area.angle || 0}deg)"></i></button>
      <div class="meta"><span class="cuts"></span>
      <span class="tools">
        <select aria-label="レイアウト指定">${layoutOpts}</select>
        <button class="icon ghost dice" title="この行を再抽選">${ICON.dice}</button>
        <button class="icon ghost lock" title="この行の構成をロック" aria-pressed="${o.lock ? 'true' : 'false'}">${ICON.lock}</button>
      </span></div>`;
    li.querySelector('select').value = o.layout || '';
    li.querySelector('.time').addEventListener('change', e => {
      const v = parseFloat(e.target.value);
      if (!S.project.timing.lineTimes) S.project.timing.lineTimes = {};
      if (isFinite(v)) S.project.timing.lineTimes[i] = Math.max(0, v); else delete S.project.timing.lineTimes[i];
      replan();
    });
    li.querySelector('.txt').addEventListener('click', () => seek(ln.start + 0.001));
    li.querySelector('.lyric-area-thumb').addEventListener('click', () => openAreaEditor(i));
    li.querySelector('select').addEventListener('change', e => { setOv(i, { layout: e.target.value || undefined }); replan(); });
    li.querySelector('.dice').addEventListener('click', () => rerollLyricLine(i));
    li.querySelector('.lock').addEventListener('click', () => toggleLyricLineLock(i));
    const cutsEl = li.querySelector('.cuts');
    S.plan.cuts.filter(c => c.line === i && J.LAYOUTS[c.layout] && !J.LAYOUTS[c.layout].special).forEach(c => {
      const cutOption = document.createElement('span'); cutOption.className = 'lyric-cut-option';
      cutOption.style.borderColor = `hsla(${layoutHue(c.layout)},70%,58%,0.7)`;
      const name = document.createElement('button'); name.type = 'button'; name.className = 'lyric-cut-name';
      name.textContent = `${c.part + 1}: ${J.LAYOUTS[c.layout].name}`;
      name.title = `${c.text}｜${J.ENTER[c.enter].name} → ${J.EXIT[c.exit].name}`;
      name.addEventListener('click', () => seek(c.start + Math.min(c.dur * 0.5, c.inDur + 0.05)));
      const label = document.createElement('label'); label.className = 'lyric-frontmost';
      const input = document.createElement('input'); input.type = 'checkbox'; input.checked = !!c.frontmost;
      input.setAttribute('aria-label', `${i + 1}行目${c.part + 1}カット目を最前に表示`);
      input.addEventListener('change', () => toggleLyricCutFrontmost(i, c.part));
      label.append(input, document.createTextNode('最前に表示'));
      cutOption.append(name, label); cutsEl.appendChild(cutOption);
    });
    ol.appendChild(li); S.lineEls.push(li);
  });
  addButton(rows.length);
  $('linesInfo').textContent = `${S.plan.lines.length}行 / ${S.plan.cuts.length}カット`;
  syncSourceTab();
}
function positionAreaEditor() {
  if (!S.areaEdit) return;
  const view = $('view').getBoundingClientRect(), viewport = $('viewport').getBoundingClientRect(), overlay = $('areaEditOverlay');
  Object.assign(overlay.style, { left: `${view.left - viewport.left}px`, top: `${view.top - viewport.top}px`, width: `${view.width}px`, height: `${view.height}px` });
}
function showAreaDraft() {
  const edit = S.areaEdit, area = edit && edit.draft, rect = $('areaEditRect'), media = !!edit && edit.kind !== 'lyric';
  rect.hidden = !area;
  if (area) Object.assign(rect.style, { left: `${area.x * 100}%`, top: `${area.y * 100}%`, width: `${area.w * 100}%`, height: `${area.h * 100}%`, transform: `rotate(${edit.angle}deg)` });
  $('areaEditOverlay').classList.toggle('media-edit', !!edit);
  $('areaEditOverlay').querySelector('.area-edit-hint').textContent = '内側をドラッグして移動・四隅でサイズ変更・枠の周囲をドラッグして回転';
  $('mediaAreaSizeControls').hidden = !edit;
  if (area) { $('mediaAreaAspectLock').checked = edit.lockAspect; $('mediaAreaWidth').value = String(Math.round(area.w * 1000) / 10); $('mediaAreaHeight').value = String(Math.round(area.h * 1000) / 10); }
  $('mediaAreaAngleField').hidden = !edit;
  if (edit) $('mediaAreaAngle').value = String(edit.angle);
  $('areaResetFull').hidden = !edit || media;
  $('areaApplyOne').textContent = media ? 'このカットだけに適用' : 'この行だけに適用';
  $('areaApplyOne').disabled = !area;
  $('areaApplyFollowing').disabled = !area;
  S.need = true;
}
function openAreaEditor(index) {
  if (S.exporting || S.tap) return;
  if (S.areaEdit) cancelAreaEditor();
  const line = S.plan.lines[index]; if (!line) return;
  pause();
  clearTimeout(warmTimer); ++warmJob;
  const saved = J.lyricArea((S.project.overrides[index] || {}).area);
  S.areaEdit = { kind: 'lyric', index, oldTime: S.t, draft: saved || { x: 0, y: 0, w: 1, h: 1 }, ratio: saved ? saved.h / saved.w : 1, lockAspect: saved ? saved.lockAspect : true, angle: saved ? saved.angle : 0, drag: null };
  const cut = S.plan.cuts.find(c => c.line === index);
  seek(cut ? cut.start + Math.min(cut.dur * 0.6, cut.inDur + 0.25) : line.start);
  $('areaEditTitle').textContent = `${index + 1}行目「${line.text}」の表示エリア`;
  $('areaEditOverlay').hidden = false; $('areaEditControls').hidden = false;
  positionAreaEditor(); showAreaDraft();
}
function openMediaEditor(index, layer) {
  if (S.exporting || S.tap) return;
  if (S.areaEdit) cancelAreaEditor();
  const cut = S.plan[layer].cuts[index], asset = cut && J.mediaAssets.get(cut.itemId);
  if (!asset) return;
  const source = asset.element, sw = source.videoWidth || source.naturalWidth, sh = source.videoHeight || source.naturalHeight;
  const draft = J.mediaPlacementRect(cut.placement, sw, sh, S.plan.W, S.plan.H);
  if (!draft) return;
  pause();
  clearTimeout(warmTimer); ++warmJob;
  S.areaEdit = { kind: layer, index, oldTime: S.t, draft, ratio: S.plan.W / S.plan.H * sh / sw, lockAspect: !cut.placement || cut.placement.lockAspect !== false, type: cut.type, angle: cut.placement && cut.placement.angle || 0, drag: null };
  seek(cut.start + Math.min(0.5, Math.max(0.001, (cut.end - cut.start) / 2)));
  $('areaEditTitle').textContent = `${index + 1}カット目「${cut.name}」の配置・サイズ`;
  $('areaEditOverlay').hidden = false; $('areaEditControls').hidden = false;
  positionAreaEditor(); showAreaDraft();
}
function cancelAreaEditor() {
  if (!S.areaEdit) return;
  const oldTime = S.areaEdit.oldTime;
  S.areaEdit = null; $('areaEditOverlay').hidden = true; $('areaEditControls').hidden = true;
  seek(oldTime);
}
function applyAreaEditor(following) {
  if (!S.areaEdit || !S.areaEdit.draft) return;
  const { kind, index, draft } = S.areaEdit;
  remember();
  if (kind !== 'lyric') {
    for (let i = index; i < (following ? S.plan[kind].cuts.length : index + 1); i++) {
      mediaOv(i, { placement: { cx: draft.x + draft.w / 2, cy: draft.y + draft.h / 2, w: draft.w, h: draft.h, lockAspect: S.areaEdit.lockAspect, angle: S.areaEdit.angle }, zoom: undefined, focus: undefined }, kind);
    }
  } else {
    const full = draft.x === 0 && draft.y === 0 && draft.w === 1 && draft.h === 1 && S.areaEdit.angle === 0;
    for (let i = index; i < (following ? S.plan.lines.length : index + 1); i++) setOv(i, { area: full ? undefined : J.lyricArea({ ...draft, angle: S.areaEdit.angle, lockAspect: S.areaEdit.lockAspect }) });
  }
  S.areaEdit = null; $('areaEditOverlay').hidden = true; $('areaEditControls').hidden = true;
  replan(); commit();
}
function areaPointer(ev) {
  const box = $('areaEditOverlay').getBoundingClientRect();
  return { x: J.clamp((ev.clientX - box.left) / box.width), y: J.clamp((ev.clientY - box.top) / box.height) };
}
function mediaPointer(ev) {
  const box = $('areaEditOverlay').getBoundingClientRect();
  return { x: (ev.clientX - box.left) / box.width, y: (ev.clientY - box.top) / box.height };
}
function mediaHit(ev) {
  const edit = S.areaEdit, area = edit.draft, box = $('areaEditOverlay').getBoundingClientRect();
  const cx = box.left + (area.x + area.w / 2) * box.width, cy = box.top + (area.y + area.h / 2) * box.height;
  const dx = ev.clientX - cx, dy = ev.clientY - cy, radians = edit.angle * Math.PI / 180;
  const x = Math.abs(dx * Math.cos(radians) + dy * Math.sin(radians));
  const y = Math.abs(-dx * Math.sin(radians) + dy * Math.cos(radians));
  const halfW = area.w * box.width / 2, halfH = area.h * box.height / 2;
  const band = Math.min(18, Math.min(halfW, halfH) * 0.35);
  if (x <= halfW + 18 && y <= halfH + 18 && (x >= halfW - band || y >= halfH - band)) return 'rotate';
  return x <= halfW && y <= halfH ? 'move' : null;
}
function mediaPointerAngle(ev, area) {
  const box = $('areaEditOverlay').getBoundingClientRect();
  const cx = box.left + (area.x + area.w / 2) * box.width, cy = box.top + (area.y + area.h / 2) * box.height;
  return Math.atan2(ev.clientY - cy, ev.clientX - cx);
}
function wrapMediaAngle(angle) { return ((angle + 180) % 360 + 360) % 360 - 180; }
function setMediaDraftSize(width, height) {
  const edit = S.areaEdit, draft = edit.draft, cx = draft.x + draft.w / 2, cy = draft.y + draft.h / 2;
  const min = edit.kind === 'lyric' ? 0.04 : 0.005, max = edit.kind === 'lyric' ? 1 : 4;
  let w = J.clamp(width, min, max), h = J.clamp(height, min, max);
  if (edit.lockAspect) { w = Math.min(w, max / edit.ratio); h = w * edit.ratio; }
  edit.draft = { x: J.clamp(cx, edit.kind === 'lyric' ? w / 2 : 0, edit.kind === 'lyric' ? 1 - w / 2 : 1) - w / 2, y: J.clamp(cy, edit.kind === 'lyric' ? h / 2 : 0, edit.kind === 'lyric' ? 1 - h / 2 : 1) - h / 2, w, h };
  showAreaDraft();
}
function moveMediaDraft(ev) {
  const edit = S.areaEdit, drag = edit.drag, point = mediaPointer(ev), dx = point.x - drag.start.x, dy = point.y - drag.start.y, a = drag.previous;
  const lyric = edit.kind === 'lyric', min = lyric ? 0.04 : 0.005, max = lyric ? 1 : 4;
  if (drag.handle === 'rotate') {
    const difference = mediaPointerAngle(ev, a) - drag.pointerAngle;
    edit.angle = Math.round(wrapMediaAngle(drag.previousAngle + Math.atan2(Math.sin(difference), Math.cos(difference)) * 180 / Math.PI) * 10) / 10;
  } else if (drag.handle === 'move') {
    edit.draft = { x: J.clamp(a.x + dx, lyric ? 0 : -a.w / 2, lyric ? 1 - a.w : 1 - a.w / 2), y: J.clamp(a.y + dy, lyric ? 0 : -a.h / 2, lyric ? 1 - a.h : 1 - a.h / 2), w: a.w, h: a.h };
  } else {
    const east = drag.handle.includes('e'), south = drag.handle.includes('s');
    const radians = edit.angle * Math.PI / 180, box = $('areaEditOverlay').getBoundingClientRect();
    const localX = (dx * box.width * Math.cos(radians) + dy * box.height * Math.sin(radians)) / box.width;
    const localY = (-dx * box.width * Math.sin(radians) + dy * box.height * Math.cos(radians)) / box.height;
    const deltaX = localX * (east ? 1 : -1), deltaY = localY * (south ? 1 : -1);
    const w = edit.lockAspect ? J.clamp(a.w + (Math.abs(deltaX) > Math.abs(deltaY / edit.ratio) ? deltaX : deltaY / edit.ratio), min, Math.min(max, max / edit.ratio)) : J.clamp(a.w + deltaX, min, max);
    const h = edit.lockAspect ? w * edit.ratio : J.clamp(a.h + deltaY, min, max);
    const x = east ? a.x : a.x + a.w - w, y = south ? a.y : a.y + a.h - h;
    edit.draft = { x: J.clamp(x + w / 2, lyric ? w / 2 : 0, lyric ? 1 - w / 2 : 1) - w / 2, y: J.clamp(y + h / 2, lyric ? h / 2 : 0, lyric ? 1 - h / 2 : 1) - h / 2, w, h };
  }
  showAreaDraft();
}
function syncSourceTab() {
  const layer = activeMediaLayer(), media = !!layer, m = media && S.project[layer];
  $('sourceLyrics').setAttribute('aria-selected', String(!media)); $('sourceMedia').setAttribute('aria-selected', String(layer === 'media'));
  $('sourceForeground').setAttribute('aria-selected', String(layer === 'foreground'));
  $('lyricsPane').hidden = media; $('mediaPane').hidden = !media;
  $('lineList').hidden = media; $('mediaLineList').hidden = !media;
  $('mediaPaneTitle').textContent = layer === 'foreground' ? '前景' : '背景';
  $('foregroundBlendFields').hidden = layer !== 'foreground';
  $('lyricBlend').value = S.project.media.blend;
  $('lyricOpacity').value = S.project.media.opacity;
  $('linesInfo').textContent = media ? `${m.items.length}素材 / ${S.plan[layer].cuts.length}カット` : `${S.plan.lines.length}行 / ${S.plan.cuts.length}カット`;
  $('mediaRandom').disabled = !media || m.items.length < 2 || m.manualCuts;
  $('mediaRandom').title = media && m.manualCuts ? '手動で追加したカットでは素材を個別に指定します' : '';
  $('mediaLoop').disabled = !media || (m.items.length === 0 && S.plan[layer].cuts.length === 0);
  $('mediaCutCountField').hidden = !media || !m.loop || (m.items.length === 0 && S.plan[layer].cuts.length === 0);
}
function activeMediaLayer() { return S.sourceTab === 'foreground' ? 'foreground' : S.sourceTab === 'media' ? 'media' : null; }
function mediaThumb(item, cls = '') {
  if (!item) return `<span class="missing media-ln-thumb" aria-hidden="true">—</span>`;
  const asset = J.mediaAssets.get(item.id);
  if (!asset) return `<span class="missing">素材なし</span>`;
  return `<img class="${cls}" src="${asset.poster || asset.url}" alt="">`;
}
function renderMediaList() {
  const layer = activeMediaLayer() || 'media', m = S.project[layer];
  const box = $('mediaList'); box.innerHTML = '';
  m.items.forEach((item, i) => {
    const row = document.createElement('div'); row.className = 'media-item'; row.dataset.id = item.id;
    row.innerHTML = `${mediaThumb(item)}<span class="name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span><button class="ghost small" aria-label="${escapeHtml(item.name)}を削除">×</button>`;
    row.querySelector('button').addEventListener('click', () => {
      freezeMediaCuts(layer);
      m.items.splice(i, 1);
      for (const cut of S.plan[layer].cuts) if (cut.itemId === item.id) mediaOv(cut.index, { itemId: null }, layer);
      delete m.overrides[item.id];
      // Keep the file until this session's undo history is no longer available.
      queueMediaDeletion(item.id);
      replan();
    });
    box.appendChild(row);
  });
  $('mediaRandom').checked = !!m.randomOrder;
  $('mediaLoop').checked = !!m.loop;
  $('mediaCutCount').min = '0';
  $('mediaCutCount').value = String(m.manualCuts ? m.cutCount : m.cutCount || m.items.length * 2 || 1);
  $('mediaBlend').value = m.blend;
  $('mediaOpacity').value = m.opacity;
}
function mediaOv(index, patch, layer = activeMediaLayer() || 'media') {
  const m = S.project[layer];
  const o = Object.assign({}, m.cutOverrides[index] || {}, patch);
  for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === '') delete o[k];
  if (Object.keys(o).length) m.cutOverrides[index] = o; else delete m.cutOverrides[index];
}
function freezeMediaCuts(layer) {
  const m = S.project[layer], cuts = S.plan[layer].cuts;
  cuts.forEach((cut, i) => { m.cutOverrides[i] = Object.assign({}, m.cutOverrides[i] || {}, { itemId: cut.itemId }); });
  m.manualCuts = true;
  m.cutCount = cuts.length;
}
function insertMediaCut(index, layer = activeMediaLayer() || 'media') {
  const m = S.project[layer], cuts = S.plan[layer].cuts;
  if (cuts.length >= 1000) { toast('カット数の上限に達しました'); return; }
  const starts = cuts.map(cut => cut.start);
  const overrides = {};
  cuts.forEach((cut, i) => {
    overrides[i >= index ? i + 1 : i] = Object.assign({}, m.cutOverrides[i] || {}, { itemId: cut.itemId });
  });
  overrides[index] = { itemId: null };
  let start;
  if (!cuts.length) start = 0;
  else if (index === 0) {
    start = 0;
    starts[0] = Math.max(starts[0], Math.min(cuts[0].end, starts[0] + Math.max(0.04, (cuts[0].end - starts[0]) / 2)));
  } else if (index === cuts.length) {
    start = Math.max(cuts[index - 1].start + 0.04, (cuts[index - 1].start + S.plan.duration) / 2);
  } else start = (cuts[index - 1].start + cuts[index].start) / 2;
  const times = {};
  starts.forEach((time, i) => { times[i >= index ? i + 1 : i] = +time.toFixed(3); });
  times[index] = +start.toFixed(3);
  m.manualCuts = true;
  m.cutCount = cuts.length + 1;
  m.cutOverrides = overrides;
  m.timing.lineTimes = times;
  const prefix = layer === 'foreground' ? 'f:' : 'm:';
  for (const link of S.project.timelineLinks) for (const end of ['a', 'b']) {
    if (link[end].startsWith(prefix) && +link[end].slice(2) >= index) link[end] = prefix + (+link[end].slice(2) + 1);
  }
  replan(); seek(start);
}
function removeMediaCut(index, layer = activeMediaLayer() || 'media') {
  const m = S.project[layer], cuts = S.plan[layer].cuts;
  if (!Number.isInteger(index) || index < 0 || index >= cuts.length) return;
  cancelAreaEditor();
  if (S.tap) stopTap();
  const overrides = {}, times = {};
  cuts.forEach((cut, oldIndex) => {
    if (oldIndex === index) return;
    const newIndex = oldIndex > index ? oldIndex - 1 : oldIndex;
    overrides[newIndex] = Object.assign({}, m.cutOverrides[oldIndex] || {}, { itemId: cut.itemId });
    times[newIndex] = +cut.start.toFixed(3);
  });
  m.manualCuts = true;
  m.cutCount = cuts.length - 1;
  m.cutOverrides = overrides;
  m.timing.lineTimes = times;
  const prefix = layer === 'foreground' ? 'f:' : 'm:';
  const remapRef = ref => {
    if (typeof ref !== 'string' || !ref.startsWith(prefix)) return ref;
    const oldIndex = +ref.slice(prefix.length);
    if (!Number.isInteger(oldIndex)) return ref;
    return oldIndex === index ? null : prefix + (oldIndex > index ? oldIndex - 1 : oldIndex);
  };
  S.project.timelineLinks = S.project.timelineLinks.flatMap(link => {
    const a = remapRef(link.a), b = remapRef(link.b);
    return a && b ? [{ a, b }] : [];
  });
  replan();
}
async function addMediaFiles(files, layer) {
  const m = S.project[layer];
  for (const file of files) {
    const type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : null;
    if (!type) continue;
    const existing = m.items.find(x => x.name === file.name && x.size === file.size && !J.mediaAssets.has(x.id));
    const item = existing || { id: crypto.randomUUID(), name: file.name, size: file.size, type };
    try {
      const el = await J.attachMedia(item, file);
      el.addEventListener('seeked', () => { S.need = true; });
      if (type === 'video') item.duration = el.duration || 0;
      if (!existing) m.items.push(item);
      await J.storeMedia(item.id, file);
    } catch (err) { toast(`${file.name}: 読み込めませんでした`); }
  }
  replan();
}
function renderMediaLines() {
  const layer = activeMediaLayer() || 'media', m = S.project[layer];
  const ol = $('mediaLineList'); ol.innerHTML = ''; S.mediaLineEls = [];
  const select = (key, obj, val) => `<select aria-label="${key}"><option value="">自動</option>${Object.entries(obj).map(([k, label]) => `<option value="${k}" ${val === k ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
  const addButton = index => {
    const row = document.createElement('li'); row.className = 'media-cut-insert';
    row.innerHTML = `<button class="ghost small" type="button" aria-label="${index + 1}番目にカットを追加">＋ カットを追加</button>`;
    row.querySelector('button').addEventListener('click', () => insertMediaCut(index, layer));
    ol.appendChild(row);
  };
  S.plan[layer].cuts.forEach((cut, i) => {
    addButton(i);
    const item = m.items.find(x => x.id === cut.itemId), ov = Object.assign({}, m.overrides[cut.itemId] || {}, m.cutOverrides[i] || {});
    const fileSelect = `<select class="media-cut-file" aria-label="${i + 1}カット目の素材"><option value="">画像無し</option>${m.items.map(asset => `<option value="${escapeHtml(asset.id)}" ${cut.itemId === asset.id ? 'selected' : ''}>${escapeHtml(asset.name)}</option>`).join('')}</select>`;
    if (ov.layout === 'stretch') ov.layout = 'cover';
    for (const key of ['layout', 'enter', 'hold', 'exit', 'treat']) if (ov[key] === undefined) ov[key] = cut[key];
    const asset = J.mediaAssets.get(cut.itemId), source = asset && asset.element;
    const sw = source && (source.videoWidth || source.naturalWidth), sh = source && (source.videoHeight || source.naturalHeight);
    const placement = J.mediaPlacementRect(cut.placement, sw, sh, S.plan.W, S.plan.H);
    const placementControl = `<span class="foreground-placement-controls"><button class="foreground-placement-open ghost" type="button" ${placement ? '' : 'disabled'} aria-label="${i + 1}カット目の配置とサイズを編集"><span class="foreground-placement-thumb"><i style="left:${(placement ? placement.x : 0) * 100}%;top:${(placement ? placement.y : 0) * 100}%;width:${(placement ? placement.w : 1) * 100}%;height:${(placement ? placement.h : 1) * 100}%;transform:rotate(${cut.placement ? cut.placement.angle || 0 : 0}deg)"></i></span>配置・サイズを編集</button>${cut.placement ? '<button class="foreground-placement-reset ghost" type="button">自動配置に戻す</button>' : ''}</span>`;
    const li = document.createElement('li'); li.className = 'ln media-ln';
    li.innerHTML = `<span class="no">${String(i + 1).padStart(2, '0')}</span><input class="time mono" type="number" step="0.01" min="0" value="${cut.start.toFixed(2)}" aria-label="${i + 1}カット目の開始秒">${fileSelect}${mediaThumb(item, 'media-ln-thumb')}<div class="meta"><span class="cuts"><span>${J.MEDIA_LAYOUT[cut.layout]}</span><span>${J.MEDIA_ENTER[cut.enter]} → ${J.MEDIA_EXIT[cut.exit]}</span>${cut.trans ? `<span>${J.mediaTransOptions()[cut.trans]}</span>` : ''}</span><span class="tools">${select('表示方法', J.MEDIA_LAYOUT, ov.layout)}${select('登場', J.MEDIA_ENTER, ov.enter)}${select('保持', J.MEDIA_HOLD, ov.hold)}${select('退場', J.MEDIA_EXIT, ov.exit)}${select('加工', J.MEDIA_TREAT, ov.treat)}${select('つなぎ', J.mediaTransOptions(), ov.trans)}<button class="icon ghost dice" title="このカットを再抽選">${ICON.dice}</button><button class="icon ghost lock" title="このカットをロック" aria-pressed="${ov.lock ? 'true' : 'false'}">${ICON.lock}</button><button class="ghost small remove-media-cut" type="button" aria-label="${i + 1}カット目を削除">削除</button></span>${placementControl}${cut.type === 'video' ? `<label class="media-video-loop"><input type="checkbox" ${cut.videoLoop ? 'checked' : ''}>動画をループ再生</label><label class="media-video-duration">動画の長さ（秒）<input type="number" min="0.04" max="3600" step="0.01" placeholder="自動" value="${ov.videoDuration ?? ''}" aria-label="${i + 1}カット目の動画の長さ（秒）"></label>` : ''}</div>`;
    if (cut.type === 'video') li.querySelector('.meta').insertAdjacentHTML('beforeend', `<span class="media-chroma"><label><input class="media-chroma-toggle" type="checkbox" ${cut.chromaKey ? 'checked' : ''}>クロマキー合成</label><label>色<input class="media-chroma-color" type="color" value="${cut.chromaColor}" aria-label="${i + 1}カット目のクロマキー色" ${cut.chromaKey ? '' : 'disabled'}></label></span>`);
    li.querySelector('.time').addEventListener('change', e => { m.timing.lineTimes[i] = Math.max(0, parseFloat(e.target.value) || 0); replan(); });
    li.querySelector('.media-cut-file').addEventListener('change', e => { mediaOv(i, { itemId: e.target.value || null }, layer); replan(); });
    ['layout', 'enter', 'hold', 'exit', 'treat', 'trans'].forEach((key, n) => li.querySelectorAll('.tools select')[n].addEventListener('change', e => { mediaOv(i, { [key]: e.target.value || null }, layer); replan(); }));
    if (i === 0) li.querySelector('select[aria-label="つなぎ"]').disabled = true;
    const videoLoop = li.querySelector('.media-video-loop input');
    if (videoLoop) videoLoop.addEventListener('change', e => { mediaOv(i, { videoLoop: e.target.checked }); replan(); });
    const videoDuration = li.querySelector('.media-video-duration input');
    if (videoDuration) videoDuration.addEventListener('change', e => { const v = +e.target.value; mediaOv(i, { videoDuration: e.target.value && Number.isFinite(v) && v > 0 ? J.clamp(v, 0.04, 3600) : undefined }, layer); replan(); });
    const placementOpen = li.querySelector('.foreground-placement-open');
    if (placementOpen) placementOpen.addEventListener('click', () => openMediaEditor(i, layer));
    const placementReset = li.querySelector('.foreground-placement-reset');
    if (placementReset) placementReset.addEventListener('click', () => { mediaOv(i, { placement: undefined }); replan(); });
    const chroma = li.querySelector('.media-chroma-toggle');
    if (chroma) {
      chroma.addEventListener('change', e => { mediaOv(i, { chromaKey: e.target.checked }); replan(); });
      li.querySelector('.media-chroma-color').addEventListener('change', e => { mediaOv(i, { chromaColor: e.target.value }); replan(); });
    }
    li.querySelector('.dice').addEventListener('click', () => rerollMediaCut(layer, i));
    li.querySelector('.lock').addEventListener('click', () => toggleMediaCutLock(layer, i));
    li.querySelector('.remove-media-cut').addEventListener('click', () => removeMediaCut(i, layer));
    ol.appendChild(li); S.mediaLineEls.push(li);
  });
  addButton(S.plan[layer].cuts.length);
  syncSourceTab();
}
async function restoreMediaAssets() {
  for (const item of [...S.project.media.items, ...S.project.foreground.items]) {
    if (J.mediaAssets.has(item.id)) continue;
    try { const blob = await J.loadMedia(item.id); if (blob) { const el = await J.attachMedia(item, blob); el.addEventListener('seeked', () => { S.need = true; }); } } catch (e) {}
  }
  replan();
}
function setOv(i, patch) {
  const cur = Object.assign({}, S.project.overrides[i] || {}, patch);
  for (const k of Object.keys(cur)) if (cur[k] === undefined || cur[k] === false || cur[k] === '') delete cur[k];
  if (Object.keys(cur).length) S.project.overrides[i] = cur; else delete S.project.overrides[i];
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ---------------- style tab ---------------- */
function drawStyleGrid() {
  const g = $('styleGrid');
  if (!g.children.length) {
    J.STYLE_ORDER.forEach(k => {
      const b = document.createElement('button'); b.className = 'stile'; b.dataset.k = k;
      b.title = J.STYLES[k].desc;
      b.innerHTML = `<canvas width="192" height="108"></canvas><span>${J.STYLES[k].name}</span><span class="badges">${setBadges(J.STYLES[k])}</span>`;
      b.addEventListener('click', () => { remember(); S.project.style = k; S.project.colors.enabled = false; syncUI(); replan(); commit(); });
      g.appendChild(b);
    });
  }
  [...g.children].forEach(b => {
    const k = b.dataset.k, st = J.STYLES[k], sc = st.schemes[0], cv = b.querySelector('canvas'), x = cv.getContext('2d');
    b.setAttribute('aria-pressed', S.project.style === k ? 'true' : 'false');
    const off = !J.randomOk(S.project, 'style', k);
    b.classList.toggle('set-off', off);
    b.title = st.desc + (off ? (st.extra && S.project.extra !== true ? '（追加分がオフのため、おまかせでは選ばれません）' : '（和風の演出がオフのため、おまかせでは選ばれません）') : '');
    x.fillStyle = sc.bg; x.fillRect(0, 0, 192, 108);
    st.schemes.slice(1, 4).forEach((s2, i) => { x.fillStyle = s2.bg; x.fillRect(192 - 14 * (i + 1), 0, 14, 10); });
    const f = st.fonts.display[0];
    x.font = J.fontCSS(f, 46); x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = sc.ghostB; x.fillText('字面', 96 - 3, 54 - 1);
    x.fillStyle = sc.ghostA; x.fillText('字面', 96 + 3, 54 + 2);
    x.fillStyle = sc.fg; x.fillText('字面', 96, 54);
    x.fillStyle = sc.accent; x.fillRect(12, 90, 30, 4);
    x.font = J.fontCSS('mono', 9); x.textAlign = 'left'; x.fillStyle = sc.sub; x.fillText(k.toUpperCase(), 48, 93);
  });
}
function fontSelectOptions(sel) {
  return '<option value="">スタイルの既定</option>' + Object.entries(J.FONTS).map(([k, f]) => {
    const g = J.faceOf ? J.faceOf(k) : f, alt = g.label && g.label !== f.label ? ' → ' + g.label : '';   // the face actually used for the lyric language
    return `<option value="${escapeHtml(k)}" style="font-family:${escapeHtml(g.family)},sans-serif;font-weight:${g.weight}" ${sel === k ? 'selected' : ''}>${escapeHtml(f.label + alt)}</option>`;
  }).join('');
}
function renderFontRoles() {
  const box = $('fontRoles'); box.innerHTML = '';
  [['display', '見出し'], ['serif', '明朝枠'], ['body', '小さな文字']].forEach(([role, label]) => {
    const row = document.createElement('div'); row.className = 'font-row';
    row.innerHTML = `<span class="muted">${label}</span><select aria-label="${label}のフォント">${fontSelectOptions(S.project.fonts[role])}</select>`;
    row.querySelector('select').addEventListener('change', e => { if (e.target.value) S.project.fonts[role] = e.target.value; else delete S.project.fonts[role]; fontKey = ''; replan(); });
    box.appendChild(row);
  });
  renderCompositeFonts();
}
function renderCompositeFonts() {
  const choices = Object.entries(J.FONTS).filter(([, f]) => !f.composite).map(([key, f]) => `<option value="${escapeHtml(key)}" style="font-family:${escapeHtml((J.faceOf ? J.faceOf(key) : f).family)},sans-serif">${escapeHtml(f.label)}</option>`).join('');
  const base = $('compositeBase');
  if (!base) return;
  const selected = base.value; base.innerHTML = choices;
  if (selected && J.FONTS[selected]) base.value = selected;
  const parts = $('compositeParts'), existing = Object.fromEntries([...parts.querySelectorAll('select')].map(el => [el.dataset.part, el.value]));
  parts.innerHTML = Object.entries(J.COMPOSITE_PARTS).map(([key, label]) => `<label>${label}<select data-part="${key}"><option value="">ベースを使用</option>${choices}</select></label>`).join('');
  for (const select of parts.querySelectorAll('select')) if (existing[select.dataset.part]) select.value = existing[select.dataset.part];
  $('compositeList').innerHTML = (S.project.compositeFonts || []).map(def => `<div class="composite-saved"><span>${escapeHtml(def.name)}</span><button type="button" data-key="${escapeHtml(def.key)}" aria-label="${escapeHtml(def.name)}を削除">×</button></div>`).join('');
}
const BASE_KEYS = [['bg', '背景'], ['fg', '文字'], ['sub', '補助']];
const ACCENT_KEYS = [['accent', 'アクセント'], ['ghostA', 'ズレ色A'], ['ghostB', 'ズレ色B']];
function renderColors() {
  const sc = effScheme0();
  const c = S.project.colors;
  $('colorOn').checked = !!c.enabled;
  $('accentOn').checked = !!c.accentOn;
  const fill = (rowId, keys, flag) => {
    const row = $(rowId); row.innerHTML = '';
    keys.forEach(([k, label]) => {
      const l = document.createElement('label');
      const v = (c[flag] && c[k]) || c[k] || sc[k];
      l.innerHTML = `${label}<input type="color" value="${toColorInput(v)}">`;
      l.querySelector('input').addEventListener('input', e => {
        c[k] = e.target.value.toUpperCase();
        if (!c[flag]) { c[flag] = true; $(flag === 'enabled' ? 'colorOn' : 'accentOn').checked = true; }
        markUndoGroup(`color:${k}`); replanSoon(60); drawSwatch();
      });
      row.appendChild(l);
    });
  };
  fill('colorRow', BASE_KEYS, 'enabled');
  fill('colorRowAccent', ACCENT_KEYS, 'accentOn');
  drawSwatch();
  renderLibPalettes();
}
const toColorInput = v => { const h = String(v || '#000000'); return /^#[0-9a-f]{6}$/i.test(h) ? h.toLowerCase() : J.toHex(...J.hex(h)).toLowerCase(); };
function swatchHTML(cols) { return cols.map(c => `<i style="background:${c}" title="${c}"></i>`).join(''); }
function drawSwatch() {
  const sc = S.plan ? S.plan.style.schemes[0] : null; if (!sc) return;
  $('paletteSwatch').innerHTML = swatchHTML([sc.accent, sc.ghostA, sc.ghostB]);
}
function randomPalette() {
  if (brandHasColors()) { toast('ブランドの配色を使用中です（ブランドを「使わない」にすると変えられます）'); return; }
  remember();
  const c = S.project.colors;
  const sc0 = effScheme0();
  const bg = c.enabled && c.bg ? c.bg : sc0.bg;
  let p, guard = 0;
  do { p = J.randomPalette(bg); } while (guard++ < 6 && p.ghostA === c.ghostA && p.ghostB === c.ghostB);
  Object.assign(c, { accent: p.accent, ghostA: p.ghostA, ghostB: p.ghostB, accentOn: true });
  renderColors(); replan(); commit();
  toast('配色：アクセント・ズレ色A/Bを変更', [p.accent, p.ghostA, p.ghostB]);
}

/* ---------------- 配色ライブラリ (jAlpha edition, data: src/11r_library.js) ---------------- */
const LIB_CAT_EN = { 'ビビッド': 'Vivid', 'パステル': 'Pastel', 'ナチュラル': 'Natural', '寒色': 'Cool', '暖色': 'Warm', 'ダーク': 'Dark', 'モノトーン': 'Monotone', 'レトロ': 'Retro' };
const libEn = () => document.documentElement.lang === 'en';
const libCat = c => (libEn() ? LIB_CAT_EN[c] || c : c);
const libPalTitle = p => libEn() ? `${p.id} · ${libCat(p.category)}` : `${p.id} ${p.name}（${p.category}）`;
let libCatSel = '';
/* the main scheme as it is drawn now (palette included), for colour pickers and random accents */
function effScheme0() {   // brand and palette included; the green / black key is ignored here
  return J.resolveStyle(Object.assign({}, S.project, { keyBg: 'off' })).schemes[0];
}
function setLibPalette(val, msg) {
  if (val && brandHasColors()) { toast('ブランドの配色を使用中です（ブランドを「使わない」にすると変えられます）'); return; }
  remember();
  const c = S.project.colors;
  if (val) { c.palette = val; c.accentOn = false; c.enabled = false; } else delete c.palette;
  renderColors(); replan(); commit();
  if (val) { const sc = effScheme0(); toast(msg || `配色ライブラリ：${val.id}`, [sc.bg, sc.fg, sc.accent, sc.ghostA, sc.ghostB]); } else toast('配色ライブラリ：解除（スタイルの配色）');
}
function pickLibPalette() {
  if (brandHasColors()) { toast('ブランドの配色を使用中です（ブランドを「使わない」にすると変えられます）'); return; }
  const cur = S.project.colors.palette; let v, guard = 0;
  do { v = J.randomLibPalette(); } while (v && cur && v.id === cur.id && guard++ < 6);
  if (v) setLibPalette(v);
}
function renderLibPalettes() {
  const grid = $('libPalGrid'), cats = $('libPalCats'); if (!grid || !J.LIB_PALETTES) return;
  const cur = S.project.colors.palette;
  if (!grid.childElementCount) {
    const catList = [...new Set(J.LIB_PALETTES.map(p => p.category))];
    cats.innerHTML = '';
    [''].concat(catList).forEach(c => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'ghost small libpal-cat'; b.dataset.cat = c;
      b.textContent = c ? libCat(c) : 'すべて';
      b.addEventListener('click', () => { libCatSel = c; renderLibPalettes(); });
      cats.appendChild(b);
    });
    for (const p of J.LIB_PALETTES) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'libpal'; b.dataset.id = p.id; b.dataset.cat = p.category;
      b.title = libPalTitle(p); b.setAttribute('aria-label', libPalTitle(p));
      b.innerHTML = `<span class="libpal-sw">${p.colors.map(h => `<i style="background:${h}"></i>`).join('')}</span><span class="libpal-id">${p.id}</span>`;
      b.addEventListener('click', () => {
        const now = S.project.colors.palette;
        if (now && now.id === p.id) setLibPalette(Object.assign({}, now, { v: (now.v | 0) + 1 }), `配色ライブラリ：${p.id}（背景を切り替え）`);
        else setLibPalette(J.libPaletteValue(p.id, 0));
      });
      grid.appendChild(b);
    }
  }
  cats.querySelectorAll('.libpal-cat').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cat === libCatSel)));
  grid.querySelectorAll('.libpal').forEach(b => { b.hidden = !!libCatSel && b.dataset.cat !== libCatSel; b.classList.toggle('on', !!cur && cur.id === b.dataset.id); });
  const p = cur && J.LIB_PALETTE_BY_ID[cur.id];
  $('libPalNow').textContent = cur ? (p ? libPalTitle(p) : cur.id) : '未使用（スタイルの配色）';
  $('libPalSwap').disabled = !cur; $('libPalClear').disabled = !cur;
  $('libPalCount').textContent = `${J.LIB_PALETTES.length}`;
}
/* おまかせ: with the library switch on, often dress the new look in a library palette */
function libOmakase(r) {
  if (S.project.lib === true && Math.random() < 0.6) {
    const v = J.randomLibPalette();
    if (v) { r.colors.palette = v; r.colors.accentOn = false; }
  } else delete r.colors.palette;
}

/* ---------------- ブランドキット (jAlpha edition, engine: src/11t_brand.js) ----------------
   kits are kept in this browser (any number); the project keeps a copy of the active one in project.brand */
const BRAND_KEY = 'jizura.brands.v1', BRAND_MAX_COLORS = 5;
const BRAND_POS_LABEL = { br: '右下', bl: '左下', tr: '右上', tl: '左上', bc: '下中央', tc: '上中央' };
const BR = { list: [], draft: null };
function loadBrands() {
  try { const a = JSON.parse(localStorage.getItem(BRAND_KEY) || '[]'); BR.list = Array.isArray(a) ? a.filter(b => b && b.id && b.name) : []; } catch (e) { BR.list = []; }
  const cur = S.project.brand;   // a project opened from a file may bring a kit this browser does not have yet
  if (cur && cur.id && !BR.list.some(b => b.id === cur.id)) { BR.list.push(JSON.parse(JSON.stringify(cur))); saveBrands(); }
}
function saveBrands() {
  try { localStorage.setItem(BRAND_KEY, JSON.stringify(BR.list)); return true; }
  catch (e) { toast('ブランドキットを保存できませんでした（ブラウザの保存容量がいっぱいです。ロゴを小さくしてください）'); return false; }
}
const brandActive = () => !!(S.project.brand && S.project.brand.id);
const brandHasColors = () => brandActive() && J.brandColors(S.project.brand).length >= 2;
function useBrand(id) {
  const b = BR.list.find(x => x.id === id);
  S.project.brand = b ? JSON.parse(JSON.stringify(b)) : null;
  fontKey = ''; renderBrands(); renderColors(); renderFontRoles(); replan(); flushSave();
  toast(b ? `ブランド：${b.name}（配色と書体はブランドの設定が優先されます）` : 'ブランド：使わない');
  restartPreview();
}
function renderBrands() {
  const cur = S.project.brand;
  ['brandSel', 'eBrandSel'].forEach(id => {
    const sel = $(id); if (!sel) return;
    sel.innerHTML = '<option value="">使わない</option>' + BR.list.map(b => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`).join('');
    sel.value = cur && cur.id ? cur.id : '';
  });
  const note = cur && cur.id
    ? `ブランド「${cur.name}」を使用中：${[J.brandColors(cur).length >= 2 ? '配色' : '', Object.values(cur.fonts || {}).some(Boolean) ? '書体' : '', cur.logo ? 'ロゴ' : ''].filter(Boolean).join('・') || '（まだ中身がありません）'}をブランドの設定で固定しています。おまかせで振っても変わりません。`
    : 'ブランドキットを選ぶと、配色・書体・ロゴをそのブランドの設定で固定できます。';
  ['brandNote', 'eBrandNote'].forEach(id => { const el = $(id); if (el) el.textContent = note; });
  $('brandEdit').disabled = !($('brandSel').value); $('brandDel').disabled = !($('brandSel').value);
  $('brandCount').textContent = BR.list.length ? `${BR.list.length}件` : '';
}
/* ----- editor dialog ----- */
function openBrandEditor(id) {
  const src = id ? BR.list.find(b => b.id === id) : null;
  BR.draft = src ? JSON.parse(JSON.stringify(src)) : {
    id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: `ブランド ${BR.list.length + 1}`,
    colors: ['#111111', '#FFFFFF', '#F5A50C'], bg: '#111111', fonts: {}, logo: null,
  };
  BR.draft.fonts = BR.draft.fonts || {};
  $('brandDlgTitle').textContent = src ? 'ブランドキットを編集' : 'ブランドキットを作成';
  $('brandName').value = BR.draft.name;
  renderBrandDraft();
  $('brandDlg').showModal();
}
function renderBrandDraft() {
  const d = BR.draft, box = $('brandColors'); box.innerHTML = '';
  d.colors.forEach((c, i) => {
    const row = document.createElement('div'); row.className = 'brand-color';
    row.innerHTML = `<input type="color" value="${toColorInput(c)}" aria-label="ブランドカラー ${i + 1}"><label class="brand-bg"><input type="radio" name="brandBg" ${d.bg && d.bg.toUpperCase() === c.toUpperCase() ? 'checked' : ''}>背景</label><button type="button" class="ghost small icon-txt" title="この色を外す" aria-label="ブランドカラー ${i + 1} を外す">×</button>`;
    const [inp, radio, del] = [row.querySelector('input[type=color]'), row.querySelector('input[type=radio]'), row.querySelector('button')];
    inp.addEventListener('input', () => { const was = d.colors[i]; d.colors[i] = inp.value.toUpperCase(); if (d.bg && was && d.bg.toUpperCase() === was.toUpperCase()) d.bg = d.colors[i]; });
    radio.addEventListener('change', () => { d.bg = d.colors[i]; });
    del.addEventListener('click', () => { const was = d.colors.splice(i, 1)[0]; if (d.bg && d.bg.toUpperCase() === String(was).toUpperCase()) d.bg = d.colors[0] || null; renderBrandDraft(); });
    box.appendChild(row);
  });
  $('brandAddColor').disabled = d.colors.length >= BRAND_MAX_COLORS;
  $('brandColorHint').textContent = d.colors.length === 1 ? '色が1つだけのときは配色を固定しません（2色以上で固定）' : d.colors.length ? '' : '色を登録しないと、配色はスタイルのままです';
  [['display', 'brandFontDisplay'], ['serif', 'brandFontSerif'], ['body', 'brandFontBody']].forEach(([r, id]) => {
    $(id).innerHTML = fontSelectOptions(d.fonts[r] || '').replace('<option value="">スタイルの既定</option>', '<option value="">指定なし</option>');
  });
  const lg = d.logo;
  $('brandLogoPrev').hidden = !lg; if (lg) $('brandLogoPrev').src = lg.src;
  $('brandLogoClear').disabled = !lg;
  ['brandLogoPos', 'brandLogoSize', 'brandLogoOpacity'].forEach(id => { $(id).disabled = !lg; });
  $('brandLogoPos').value = (lg && lg.pos) || 'br';
  $('brandLogoSize').value = (lg && lg.size) || 16; $('brandLogoOpacity').value = lg && lg.opacity != null ? lg.opacity : 100;
  $('brandLogoSizeVal').textContent = $('brandLogoSize').value + '%'; $('brandLogoOpacityVal').textContent = $('brandLogoOpacity').value + '%';
}
async function readLogoFile(file) {
  const url = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
  const im = new Image(); im.src = url;
  await new Promise((res, rej) => { im.onload = res; im.onerror = () => rej(new Error('画像を読み込めませんでした')); });
  const max = 800, w0 = im.naturalWidth || 512, h0 = im.naturalHeight || 512, k = Math.min(1, max / Math.max(w0, h0));
  const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(w0 * k)); cv.height = Math.max(1, Math.round(h0 * k));
  cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/png');   // keeps transparency; SVGs become pixels at up to 800px
}
function saveBrandDraft() {
  const d = BR.draft; if (!d) return;
  d.name = String($('brandName').value || '').trim().slice(0, 40) || '無題のブランド';
  d.colors = d.colors.map(c => c.toUpperCase());
  if (d.bg && !d.colors.includes(d.bg.toUpperCase())) d.bg = d.colors[0] || null;
  for (const r of ['display', 'serif', 'body']) if (!d.fonts[r]) delete d.fonts[r];
  const i = BR.list.findIndex(b => b.id === d.id), before = BR.list.slice();
  if (i >= 0) BR.list[i] = d; else BR.list.push(d);
  if (!saveBrands()) { BR.list = before; return false; }
  if (S.project.brand && S.project.brand.id === d.id) { S.project.brand = JSON.parse(JSON.stringify(d)); fontKey = ''; renderColors(); renderFontRoles(); replan(); flushSave(); }
  renderBrands();
  toast(`ブランドキットを保存：${d.name}`);
  return true;
}
function deleteBrand(id) {
  const b = BR.list.find(x => x.id === id); if (!b) return;
  const inUse = S.project.brand && S.project.brand.id === id;
  if (!confirm(`ブランドキット「${b.name}」を削除しますか？${inUse ? '\nこのプロジェクトでは使うのをやめます。' : ''}`)) return;
  BR.list = BR.list.filter(x => x.id !== id); saveBrands();
  if (inUse) useBrand(''); else renderBrands();
}
async function exportBrands() {
  if (!BR.list.length) { toast('ブランドキットがまだありません'); return; }
  await J.saveFile('jizura_brands.json', new Blob([JSON.stringify({ app: 'jizura', kind: 'brands', version: 1, brands: BR.list })], { type: 'application/json' }));
}
async function importBrands(file) {
  try {
    const d = JSON.parse(await file.text());
    const list = d && Array.isArray(d.brands) ? d.brands : null;
    if (!list) throw new Error('ブランドキットのファイルではありません');
    const clean = b => ({
      id: String(b.id), name: String(b.name || '無題のブランド').slice(0, 40),
      colors: J.brandColors(b).slice(0, BRAND_MAX_COLORS), bg: typeof b.bg === 'string' ? b.bg.toUpperCase() : null,
      fonts: Object.fromEntries(['display', 'serif', 'body'].filter(r => b.fonts && typeof b.fonts[r] === 'string').map(r => [r, b.fonts[r]])),
      logo: b.logo && typeof b.logo.src === 'string' && b.logo.src.startsWith('data:image/') ? { src: b.logo.src, pos: J.BRAND_POS.includes(b.logo.pos) ? b.logo.pos : 'br', size: J.clamp(+b.logo.size || 16, 3, 60), opacity: J.clamp(+b.logo.opacity || 100, 10, 100) } : null,
    });
    const have = new Set(BR.list.map(b => b.id));
    const add = list.filter(b => b && b.id && b.name && !have.has(String(b.id))).map(clean);
    if (!add.length) { toast('新しいブランドキットはありませんでした（すべて登録済みです）'); return; }
    const before = BR.list; BR.list = before.concat(add);
    if (!saveBrands()) { BR.list = before; return; }
    renderBrands(); toast(`ブランドキットを ${add.length} 件読み込みました`);
  } catch (e) { toast('読み込めませんでした：' + (e.message || e)); }
}
function bindBrands() {
  ['brandSel', 'eBrandSel'].forEach(id => $(id).addEventListener('change', e => useBrand(e.target.value)));
  $('brandNew').addEventListener('click', () => openBrandEditor(null));
  $('brandEdit').addEventListener('click', () => { const id = $('brandSel').value; if (id) openBrandEditor(id); });
  $('brandDel').addEventListener('click', () => { const id = $('brandSel').value; if (id) deleteBrand(id); });
  $('brandExport').addEventListener('click', exportBrands);
  $('brandImport').addEventListener('click', () => $('brandFile').click());
  $('brandFile').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) importBrands(f); e.target.value = ''; });
  $('brandAddColor').addEventListener('click', () => { const d = BR.draft; if (d.colors.length < BRAND_MAX_COLORS) { d.colors.push('#888888'); if (!d.bg) d.bg = d.colors[0]; renderBrandDraft(); } });
  [['display', 'brandFontDisplay'], ['serif', 'brandFontSerif'], ['body', 'brandFontBody']].forEach(([r, id]) => $(id).addEventListener('change', e => { if (e.target.value) BR.draft.fonts[r] = e.target.value; else delete BR.draft.fonts[r]; }));
  $('brandLogoFile').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
    try { const src = await readLogoFile(f); const lg = BR.draft.logo || { pos: 'br', size: 16, opacity: 100 }; BR.draft.logo = Object.assign(lg, { src }); renderBrandDraft(); }
    catch (err) { toast('ロゴ：' + (err.message || err)); }
  });
  $('brandLogoClear').addEventListener('click', () => { BR.draft.logo = null; renderBrandDraft(); });
  $('brandLogoPos').addEventListener('change', e => { if (BR.draft.logo) BR.draft.logo.pos = e.target.value; });
  $('brandLogoSize').addEventListener('input', e => { if (BR.draft.logo) BR.draft.logo.size = +e.target.value; $('brandLogoSizeVal').textContent = e.target.value + '%'; });
  $('brandLogoOpacity').addEventListener('input', e => { if (BR.draft.logo) BR.draft.logo.opacity = +e.target.value; $('brandLogoOpacityVal').textContent = e.target.value + '%'; });
  $('brandSave').addEventListener('click', e => { e.preventDefault(); if (saveBrandDraft()) $('brandDlg').close(); });
  $('brandCancel').addEventListener('click', e => { e.preventDefault(); $('brandDlg').close(); });
  $('brandDlg').addEventListener('close', () => { BR.draft = null; });
}

/* ---------------- history of looks (◀ ▶) ---------------- */
// only the "look" is tracked — lyrics, timing and output settings are never rolled back
const HKEYS = ['style', 'mood', 'seed', 'fx', 'enabled', 'fonts', 'colors', 'overrides'];
const H = { list: [], i: -1 };
const lookSnap = () => JSON.stringify(Object.fromEntries(HKEYS.map(k => [k, S.project[k] ?? null])));
function remember() {            // call before changing the look: makes sure the current look is on the stack
  const s = lookSnap();
  if (H.i >= 0 && H.list[H.i] === s) return;
  H.list = H.list.slice(0, H.i + 1); H.list.push(s); H.i = H.list.length - 1;
}
function commit() {              // call after changing the look
  const s = lookSnap();
  if (H.list[H.i] !== s) { H.list = H.list.slice(0, H.i + 1); H.list.push(s); H.i = H.list.length - 1; }
  if (H.list.length > 80) { H.list.splice(0, H.list.length - 80); H.i = H.list.length - 1; }
  updateHist();
}
function histGo(d) {
  if (S.exporting) return;
  remember();                    // hand edits made since the last step become a stop of their own
  const j = H.i + d; if (j < 0 || j >= H.list.length) return;
  H.i = j;
  Object.assign(S.project, JSON.parse(H.list[j]));
  fontKey = ''; syncUI(); replan(); updateHist();
  toast(`${j + 1} / ${H.list.length} 案目`);
  restartPreview();
}
function updateHist() {
  const canB = H.i > 0, canF = H.i < H.list.length - 1;
  ['btnPrev', 'btnPrev2'].forEach(id => { $(id).disabled = !canB; });
  ['btnNext', 'btnNext2'].forEach(id => { $(id).disabled = !canF; });
  $('histPos').textContent = H.list.length > 1 ? `${H.i + 1} / ${H.list.length}` : '';
}

/* ---------------- お気に入り (jAlpha edition) ----------------
   named looks (the same keys as ◀ ▶) kept in this browser, so a look can be reused on other songs.
   Per-line overrides belong to the lyrics they were made for: they come back only when the lyrics match. */
const FAV_KEY = 'jizura.favorites.v1', FAV_MAX = 100;
const FAV = { list: [] };
const lyricsKey = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + ':' + s.length; };
function loadFavs() {
  try { const a = JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); FAV.list = Array.isArray(a) ? a.filter(f => f && f.id && f.look) : []; } catch (e) { FAV.list = []; }
}
function saveFavs() {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(FAV.list)); return true; }
  catch (e) { toast('お気に入りを保存できませんでした（ブラウザの保存容量がいっぱいか、保存が無効です）'); return false; }
}
async function favThumb() {
  if (!S.plan) return '';
  try {
    const cuts = S.plan.cuts.filter(c => c.line >= 0 && c.layout !== 'interlude');
    const c = cuts[0] || S.plan.cuts[0];
    const t = c ? c.start + (c.end - c.start) * 0.6 : 0;
    const cv = document.createElement('canvas'); cv.width = 240; cv.height = Math.max(1, Math.round(240 * S.plan.H / S.plan.W));
    await J.prepareMediaFrame(S.plan, t);
    new J.Renderer().frame(cv.getContext('2d'), S.plan, t, { scale: cv.width / S.plan.W });
    return cv.toDataURL('image/jpeg', 0.72);
  } catch (e) { console.warn(e); return ''; }
}
async function addFav() {
  if (S.exporting) return;
  if (FAV.list.length >= FAV_MAX) { toast(`お気に入りは ${FAV_MAX} 件までです。不要なものを削除してください`); return; }
  const P = S.project;
  const moodName = P.mood && J.MOODS[P.mood] ? J.MOODS[P.mood].name : 'カスタム';
  const fav = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: `${J.STYLES[P.style] ? J.STYLES[P.style].name : P.style} × ${moodName}`,
    created: Date.now(), look: JSON.parse(lookSnap()), lyricsKey: lyricsKey(P.lyrics || ''), aspect: P.aspect,
    thumb: await favThumb(),
  };
  FAV.list.unshift(fav);
  if (!saveFavs()) { FAV.list.shift(); return; }
  renderFavs();
  toast(`お気に入りに追加：${fav.name}`);
}
function applyFav(id) {
  if (S.exporting || S.tap) return;
  const f = FAV.list.find(x => x.id === id); if (!f) return;
  if (!J.STYLES[f.look.style]) { toast('このお気に入りのスタイルが見つかりません（別の版で作ったお気に入りかもしれません）'); return; }
  const look = Object.assign({}, f.look);
  const sameLyrics = f.lyricsKey === lyricsKey(S.project.lyrics || '');
  if (!sameLyrics) delete look.overrides;
  for (const k of Object.keys(look)) if (look[k] === null && k !== 'mood') delete look[k];
  remember();
  Object.assign(S.project, look);
  fontKey = ''; syncUI(); replan(); commit();
  toast(`お気に入り：${f.name}${sameLyrics ? '' : '（行ごとの指定は今の歌詞のまま）'}`);
  restartPreview();
}
function renameFav(id, name) {
  const f = FAV.list.find(x => x.id === id); if (!f) return;
  name = String(name || '').trim().slice(0, 60);
  if (!name || name === f.name) { renderFavs(); return; }
  f.name = name; saveFavs(); renderFavs();
}
function deleteFav(id) {
  const f = FAV.list.find(x => x.id === id); if (!f) return;
  if (!confirm(`お気に入り「${f.name}」を削除しますか？`)) return;
  FAV.list = FAV.list.filter(x => x.id !== id); saveFavs(); renderFavs();
}
function renderFavs() {
  ['favList', 'eFavList'].forEach(boxId => {
    const box = $(boxId); if (!box) return;
    box.innerHTML = '';
    if (!FAV.list.length) { const p = document.createElement('p'); p.className = 'hint fav-empty'; p.textContent = '気に入った案を「☆ お気に入りに追加」で残すと、ここからいつでも呼び戻せます。別の曲にも使えます。'; box.appendChild(p); return; }
    for (const f of FAV.list) {
      const card = document.createElement('div'); card.className = 'fav-card';
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'fav-thumb'; btn.title = `「${f.name}」の見た目にする`;
      if (f.thumb) { const img = document.createElement('img'); img.src = f.thumb; img.alt = ''; btn.appendChild(img); } else btn.textContent = '字面';
      btn.addEventListener('click', () => applyFav(f.id));
      const row = document.createElement('div'); row.className = 'fav-row';
      const name = document.createElement('span'); name.className = 'fav-name'; name.textContent = f.name; name.title = f.name;
      const ren = document.createElement('button'); ren.type = 'button'; ren.className = 'ghost small icon-txt'; ren.textContent = '✎'; ren.title = '名前を変える'; ren.setAttribute('aria-label', `「${f.name}」の名前を変える`);
      ren.addEventListener('click', () => {
        const inp = document.createElement('input'); inp.type = 'text'; inp.value = f.name; inp.maxLength = 60; inp.className = 'fav-name-input'; inp.setAttribute('aria-label', 'お気に入りの名前');
        let done = false; const fin = ok => { if (done) return; done = true; if (ok) renameFav(f.id, inp.value); else renderFavs(); };
        inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') fin(true); else if (e.key === 'Escape') fin(false); });
        inp.addEventListener('blur', () => fin(true));
        name.replaceWith(inp); inp.focus(); inp.select();
      });
      const del = document.createElement('button'); del.type = 'button'; del.className = 'ghost small icon-txt'; del.textContent = '×'; del.title = '削除'; del.setAttribute('aria-label', `「${f.name}」を削除`);
      del.addEventListener('click', () => deleteFav(f.id));
      row.append(name, ren, del);
      card.append(btn, row); box.appendChild(card);
    }
  });
  ['favCount', 'eFavCount'].forEach(id => { const el = $(id); if (el) el.textContent = FAV.list.length ? `${FAV.list.length}件` : ''; });
}
async function exportFavs() {
  if (!FAV.list.length) { toast('お気に入りがまだありません'); return; }
  const data = JSON.stringify({ app: 'jizura', kind: 'favorites', version: 1, favorites: FAV.list });
  await J.saveFile('jizura_favorites.json', new Blob([data], { type: 'application/json' }));
}
async function importFavs(file) {
  try {
    const d = JSON.parse(await file.text());
    const list = Array.isArray(d) ? d : d && Array.isArray(d.favorites) ? d.favorites : null;
    if (!list) throw new Error('お気に入りのファイルではありません');
    const have = new Set(FAV.list.map(f => f.id));
    const add = list.filter(f => f && f.id && f.look && typeof f.look === 'object' && !have.has(f.id))
      .map(f => ({ id: String(f.id), name: String(f.name || '無題').slice(0, 60), created: +f.created || Date.now(), look: f.look, lyricsKey: String(f.lyricsKey || ''), aspect: f.aspect, thumb: typeof f.thumb === 'string' && f.thumb.startsWith('data:image/') ? f.thumb : '' }));
    if (!add.length) { toast('新しいお気に入りはありませんでした（すべて登録済みです）'); return; }
    const before = FAV.list;
    FAV.list = before.concat(add).slice(0, FAV_MAX);
    if (!saveFavs()) { FAV.list = before; return; }
    renderFavs();
    toast(`お気に入りを ${Math.min(add.length, FAV_MAX - before.length)} 件読み込みました`);
  } catch (e) { toast('読み込めませんでした：' + (e.message || e)); }
}

/* ---------------- おまかせ ---------------- */
function restartPreview() { seek(0); if (!S.playing && S.mode === 'easy') play(); }
function omakase() {
  if (S.exporting || S.tap) return;
  remember();
  const r = J.omakase(S.project);
  libOmakase(r);
  Object.assign(S.project, r);
  fontKey = ''; syncUI(); replan(); commit();
  toast(`おまかせ：${J.STYLES[r.style].name} × ${J.MOODS[r.mood].name}`, r.colors.accentOn ? [r.colors.accent, r.colors.ghostA, r.colors.ghostB] : null);
  restartPreview();
}
let jevBusy = false;
async function jevOmakase() {
  if (jevBusy || S.exporting || S.tap) return;
  jevBusy = true;
  ['btnJev', 'btnJevBig'].forEach(id => { $(id).disabled = true; });
  showMsg('Jev が歌詞と演出を選定中…');
  try {
    const lyrics = S.project.lyrics, jevPrompt = S.project.jevPrompt;
    const selected = await J.jevSuggest(S.project);
    if (S.project.lyrics !== lyrics || S.project.jevPrompt !== jevPrompt) throw new Error('選定中に歌詞か追加指示が変わりました。もう一度実行してください');
    remember();
    const look = J.applyJev(S.project, selected);
    Object.assign(S.project, look);
    fontKey = ''; syncUI(); replan(); commit();
    toast(`Jev：${J.STYLES[look.style].name} × ${J.MOODS[look.mood].name}`);
    restartPreview();
  } catch (e) {
    toast(`Jev：${e.message || e}`);
    console.error(e);
  } finally {
    showMsg(null);
    jevBusy = false;
    ['btnJev', 'btnJevBig'].forEach(id => { $(id).disabled = false; });
  }
}
// change just one aspect of the current look
function rerollPart(part) {
  if (S.exporting || S.tap) return;
  remember();
  const P = S.project;
  let msg = '';
  if (part === 'style') {
    let pool = J.STYLE_ORDER.filter(k => k !== P.style && J.randomOk(P, 'style', k));
    if (!pool.length) pool = J.STYLE_ORDER.filter(k => k !== P.style);
    P.style = pool[Math.floor(Math.random() * pool.length)];
    P.colors.enabled = false;
    msg = `スタイル：${J.STYLES[P.style].name}`;
  } else if (part === 'mood') {
    const r = J.omakase(P);
    Object.assign(P, { mood: r.mood, fx: r.fx, enabled: r.enabled });
    msg = `雰囲気：${J.MOODS[r.mood].name}`;
  } else if (part === 'cut') {
    P.seed = (Math.random() * 1e9) | 0;
    msg = '構成：レイアウトと動きを再抽選';
  }
  fontKey = ''; syncUI(); replan(); commit();
  toast(msg);
  restartPreview();
}
function showNow() {
  const el = $('easyNow'); if (!el || !S.plan || el.closest('[hidden]')) return;
  const P = S.project, sc = S.plan.style.schemes[0];
  const moodName = P.mood && J.MOODS[P.mood] ? J.MOODS[P.mood].name : 'カスタム';
  const fk = S.plan.style.fonts.display[0];
  const fontName = J.FONTS[fk] ? J.FONTS[fk].label : fk;
  const cuts = S.plan.cuts.filter(c => c.line >= 0 && c.layout !== 'interlude');
  const kinds = new Set(cuts.map(c => c.layout)).size;
  const row = (k, v) => `<div class="now-row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  el.innerHTML = row('スタイル', `<b>${escapeHtml(J.STYLES[P.style].name)}</b>`)
    + row('雰囲気', escapeHtml(moodName))
    + row('配色', `<span class="swatches">${swatchHTML([sc.bg, sc.fg, sc.accent, sc.ghostA, sc.ghostB])}</span>${P.colors.palette ? `<span class="tagl">${escapeHtml(P.colors.palette.id)}</span>` : P.colors.accentOn ? '<span class="tagl">ランダム</span>' : ''}`)
    + row('見出し書体', escapeHtml(fontName))
    + row('構成', `${cuts.length} カット・レイアウト ${kinds} 種`)
    + row('演出', `加工 ${cuts.filter(c => c.treat && c.treat !== 'none').length}・背景 ${new Set(cuts.map(c => c.bg).filter(b => b && b !== 'none')).size}種・カメラ ${cuts.filter(c => c.cam && c.cam !== 'push').length}`);
}
let toastTimer = 0;
function toast(m, cols) {
  const el = $('toast'); if (!el) return;
  el.innerHTML = escapeHtml(m) + (cols ? `<span class="swatches">${swatchHTML(cols)}</span>` : '');
  el.hidden = false; el.classList.remove('out'); void el.offsetWidth; el.classList.add('in');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('in'); el.classList.add('out'); toastTimer = setTimeout(() => { el.hidden = true; }, 260); }, 1700);
}

/* ---------------- かんたん / 詳細 ---------------- */
function setMode(m) {
  S.mode = m === 'easy' ? 'easy' : 'pro';
  const easy = S.mode === 'easy';
  $('app').classList.toggle('is-easy', easy);
  $('easyPanel').hidden = !easy;
  $('modeEasy').setAttribute('aria-pressed', String(easy));
  $('modePro').setAttribute('aria-pressed', String(!easy));
  try { localStorage.setItem('jizura.mode', S.mode); } catch (e) {}
  if (easy) { showNow(); syncOut(); codecNote(); }
  sizeViewport(); drawTimeline(); loadThumbFonts();
}

/* ---------------- fx tab ---------------- */
const FX = [['motion', '動きの強さ'], ['glitch', 'グリッチ'], ['chroma', '色ズレ'], ['decor', '装飾の量'], ['density', 'カットの細かさ'], ['texture', '質感'], ['bgSwitch', '背景の切替']];
function renderFx() {
  const box = $('fxSliders'); box.innerHTML = '';
  FX.forEach(([k, label]) => {
    const row = document.createElement('div'); row.className = 'slider';
    const v = S.project.fx[k] ?? 0.5;
    row.innerHTML = `<label for="fx_${k}">${label}</label><input id="fx_${k}" type="range" min="0" max="1" step="0.01" value="${v}"><output>${Math.round(v * 100)}</output>`;
    const inp = row.querySelector('input'), out = row.querySelector('output');
    inp.addEventListener('input', () => { S.project.fx[k] = +inp.value; S.project.mood = null; out.textContent = Math.round(inp.value * 100); markUndoGroup(`fx:${k}`); replanSoon(120); });
    box.appendChild(row);
  });
  $('fxFlash').checked = !!S.project.fx.flash;
  $('fxKoma').value = String(J.komaOf(S.project.fx));
  $('fxHud').value = S.project.fx.hud || 'auto';
  $('seed').value = S.project.seed;
}

/* ---------------- technique tab ---------------- */
const GROUPS = [['layout', 'レイアウト'], ['enter', '登場'], ['hold', '保持'], ['exit', '退場'], ['decor', '装飾'], ['treat', '文字の加工'], ['bg', '背景'], ['cam', 'カメラ'], ['fx', '画面効果'], ['trans', 'カット間のつなぎ']];
const openGroups = new Set();
function techItems(g) { return J.order(g).filter(k => J.registry(g)[k] && !J.registry(g)[k].special); }
function renderTech() {
  const box = $('techLists'); box.innerHTML = '';
  const q = ($('techFilter').value || '').trim().toLowerCase();
  let total = 0, onAll = 0;
  GROUPS.forEach(([g, label]) => {
    const tbl = J.registry(g), items = techItems(g), en = S.project.enabled[g] || (S.project.enabled[g] = {});
    const shown = q ? items.filter(k => (tbl[k].name + ' ' + k).toLowerCase().includes(q)) : items;
    const onN = items.filter(k => en[k] !== false).length;
    total += items.length; onAll += onN;
    if (q && !shown.length) return;
    const d = document.createElement('details'); d.className = 'tgroup';
    d.open = !!q || openGroups.has(g);
    d.addEventListener('toggle', () => { if (d.open) openGroups.add(g); else openGroups.delete(g); });
    d.innerHTML = `<summary><span class="tg-name">${label}</span><span class="tg-cnt mono">${onN}/${items.length}</span></summary><div class="tg-tools"><button class="ghost small" data-a="on">すべてON</button><button class="ghost small" data-a="off">すべてOFF</button><button class="ghost small" data-a="flip">反転</button></div>`;
    const list = document.createElement('div'); list.className = 'checks';
    shown.forEach(k => {
      const l = document.createElement('label');
      l.title = k + (tbl[k].tags && tbl[k].tags.length ? '（' + tbl[k].tags.map(t => (J.MOODS[t] ? J.MOODS[t].name : t)).join('・') + '）' : '');
      if (!J.randomOk(S.project, g, k)) { l.classList.add('set-off'); l.title += tbl[k].extra && S.project.extra !== true ? '（追加分がオフのため、自動では選ばれません）' : '（和風の演出がオフのため、自動では選ばれません）'; }
      l.innerHTML = `<input type="checkbox" ${en[k] !== false ? 'checked' : ''}> ${escapeHtml(tbl[k].name)}${setBadges(tbl[k])}`;
      l.querySelector('input').addEventListener('change', e => { en[k] = e.target.checked; S.project.mood = null; d.querySelector('.tg-cnt').textContent = `${items.filter(x => en[x] !== false).length}/${items.length}`; replanSoon(60); });
      list.appendChild(l);
    });
    d.querySelectorAll('.tg-tools button').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.a;
      shown.forEach(k => { en[k] = a === 'on' ? true : a === 'off' ? false : en[k] === false; });
      // keep a fallback so the planner always has something to use
      if (g === 'layout' && !items.some(k => en[k] !== false)) en.center = true;
      if (g === 'enter') en.cut = true; if (g === 'exit') en.cut = true; if (g === 'hold') en.still = true;
      if (g === 'treat') en.none = true; if (g === 'bg') en.none = true; if (g === 'cam') en.push = true;
      S.project.mood = null; openGroups.add(g); renderTech(); replan();
    }));
    d.appendChild(list);
    box.appendChild(d);
  });
  $('techTotal').textContent = `${onAll}/${total}`;
}

/* ---------------- output tab ---------------- */
function syncOut() {
  $('outAspect').value = S.project.aspect; $('outRes').value = String(S.project.res); $('outFps').value = String(S.project.fps);
  $('eAspect').value = S.project.aspect; $('eRes').value = String(S.project.res); $('eFps').value = String(S.project.fps);
  const size = S.project.videoSize;
  const preset = size ? `${size.w}x${size.h}` : 'legacy';
  for (const id of ['out', 'e']) {
    const selector = $(`${id}VideoSize`);
    selector.value = S.project.videoSizeMode === 'custom' ? 'custom' : [...selector.options].some(option => option.value === preset) ? preset : 'custom';
    if (!size) selector.value = 'legacy';
    $(`${id}VideoWidth`).value = size ? size.w : J.outputSize(S.project)[0];
    $(`${id}VideoHeight`).value = size ? size.h : J.outputSize(S.project)[1];
    $(`${id}VideoWidth`).closest('label').hidden = selector.value !== 'custom';
    $(`${id}VideoHeight`).closest('label').hidden = selector.value !== 'custom';
  }
  for (const id of ['outAspect', 'outRes', 'eAspect', 'eRes']) $(id).disabled = !!size;
  $('outQuality').value = S.project.quality || 'high'; $('outAudio').checked = S.project.includeAudio !== false;
  const k = J.keyMode(S.project) || 'off';
  $('outKey').value = k; $('eKey').value = k;
  const kb = $('keyBadge');
  kb.hidden = k === 'off';
  if (k !== 'off') kb.innerHTML = `<i style="background:${J.KEY_BG[k]}"></i>${k === 'green' ? 'グリーンバック' : 'ブラックバック'}`;
  renderBatchAspects();
}
async function codecNote() {
  const [w, h] = J.outputSize(S.project);
  const vc = await J.pickVideoCodec(w, h, S.project.fps, 12e6);
  $('codecNote').textContent = vc ? `このブラウザでは ${vc.label} で書き出します（${w}×${h} / ${S.project.fps}fps）。書き出し中はタブを開いたままにしてください。` : 'このブラウザは動画エンコード（WebCodecs）に対応していません。Chrome / Edge の最新版で開くか、連番PNGを使ってください。';
  $('btnMP4').disabled = !vc; $('eMP4').disabled = !vc; $('btnBatchMP4').disabled = !vc; $('eBatchMP4').disabled = !vc;
  if (!vc) $('eMP4').title = 'このブラウザは MP4 書き出しに対応していません（Chrome / Edge 推奨）';
}
const EXP_BTNS = ['btnMP4', 'btnPNG', 'btnPNGA', 'btnPNGL', 'eMP4', 'btnBatchMP4', 'eBatchMP4'];

/* まとめて書き出し (jAlpha edition): one MP4 per selected aspect, each re-planned for that frame from the same project/seed */
const BATCH_ASPECTS = ['16:9', '9:16', '1:1', '4:5', '4:3', '3:4', '21:9'];
const BATCH_DEFAULT = ['16:9', '9:16', '1:1'];
const TALL_MARK = ' 縦';
function batchAspects() {
  const a = Array.isArray(S.project.batchAspects) ? S.project.batchAspects : BATCH_DEFAULT;
  return BATCH_ASPECTS.filter(x => a.includes(x));
}
function renderBatchAspects() {
  const sel = batchAspects();
  ['batchAspects', 'eBatchAspects'].forEach(id => {
    const box = $(id); if (!box) return;
    box.innerHTML = '';
    for (const a of BATCH_ASPECTS) {
      const [w, h] = a.split(':').map(Number);
      const l = document.createElement('label'); l.className = 'batch-chip';
      const c = document.createElement('input'); c.type = 'checkbox'; c.value = a; c.checked = sel.includes(a);
      c.addEventListener('change', () => {
        const cur = new Set(batchAspects()); if (c.checked) cur.add(a); else cur.delete(a);
        S.project.batchAspects = BATCH_ASPECTS.filter(x => cur.has(x));
        renderBatchAspects(); flushSave();
      });
      l.append(c, document.createTextNode(a + (h > w ? TALL_MARK : '')));
      box.appendChild(l);
    }
  });
  const n = sel.length;
  ['btnBatchMP4', 'eBatchMP4'].forEach(id => { const b = $(id); if (b) b.textContent = n ? `${n}つの画面比でまとめて書き出す` : 'まとめて書き出す画面比を選んでください'; });
}
async function runBatchExport() {
  if (S.exporting) return;
  const list = batchAspects();
  if (!list.length) { toast('まとめて書き出す画面比を選んでください'); return; }
  pause();
  const ac = new AbortController(); S.exporting = ac;
  const boxes = [...document.querySelectorAll('.exp-box')];
  const setText = m => boxes.forEach(b => { b.querySelector('.exp-text').textContent = m; });
  const setBar = p => boxes.forEach(b => { b.querySelector('.exp-bar').style.width = (p * 100).toFixed(1) + '%'; });
  boxes.forEach(b => { b.hidden = false; }); setBar(0);
  setText('準備中…');
  EXP_BTNS.forEach(id => { $(id).disabled = true; });
  const t0 = performance.now(), done = [];
  try {
    for (let k = 0; k < list.length; k++) {
      const aspect = list[k], tag = `[${k + 1}/${list.length}] ${aspect}`;
      const project = Object.assign({}, S.project, { aspect });
      const plan = aspect === S.project.aspect ? S.plan : J.plan(project, audioLike());
      setText(`${tag} 準備中…`);
      await J.ensureFonts(S.project.lyrics + (S.project.title || '') + (S.project.artist || '') + HUD_CHARS, J.fontsOfPlan(plan));
      await J.brandReady(plan);
      const r = await J.exportMP4({
        plan, project, audio: S.project.includeAudio !== false ? S.audio : null, quality: S.project.quality || 'high', signal: ac.signal,
        onProgress: (p, m) => { setBar((k + p) / list.length); setText(`${tag} ${m}`); },
      });
      const res = await J.saveFile(`${baseName()}_${aspect.replace(':', 'x')}.mp4`, r.blob);
      done.push(`${aspect} ${(r.blob.size / 1048576).toFixed(1)}MB${res === 'declined' ? '（保存キャンセル）' : ''}`);
    }
    setBar(1);
    setText(`完成 ${done.join('・')}・${((performance.now() - t0) / 1000).toFixed(0)}秒`);
  } catch (e) {
    setText('エラー: ' + (e && e.message ? e.message : e) + (done.length ? `（書き出し済み: ${done.join('・')}）` : ''));
    console.error(e);
  } finally {
    S.exporting = null; S.need = true;
    EXP_BTNS.forEach(id => { $(id).disabled = false; });
    codecNote();
  }
}
function baseName() {
  const k = J.keyMode(S.project);
  return ((S.project.title || 'jizura').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'jizura') + (k ? (k === 'green' ? '_greenback' : '_blackback') : '');
}
async function runExport(kind) {
  if (S.exporting) return;
  pause();
  const ac = new AbortController(); S.exporting = ac;
  const boxes = [...document.querySelectorAll('.exp-box')];
  const setText = m => boxes.forEach(b => { b.querySelector('.exp-text').textContent = m; });
  const txt = { set textContent(m) { setText(m); }, get textContent() { return boxes[0].querySelector('.exp-text').textContent; } };
  boxes.forEach(b => { b.hidden = false; b.querySelector('.exp-bar').style.width = '0%'; });
  setText('準備中…');
  EXP_BTNS.forEach(id => { $(id).disabled = true; });
  const onProgress = (p, m) => { boxes.forEach(b => { b.querySelector('.exp-bar').style.width = (p * 100).toFixed(1) + '%'; }); setText(m); };
  const t0 = performance.now();
  try {
    await J.ensureFonts(S.project.lyrics + (S.project.title || '') + (S.project.artist || '') + HUD_CHARS, J.fontsOfPlan(S.plan));
    await J.brandReady(S.plan);
    if (kind === 'mp4') {
      const r = await J.exportMP4({ plan: S.plan, project: S.project, audio: S.project.includeAudio !== false ? S.audio : null, quality: S.project.quality || 'high', onProgress, signal: ac.signal });
      txt.textContent = `完成 ${(r.blob.size / 1048576).toFixed(1)}MB・${r.codec}${r.audio ? ' + ' + r.audio.toUpperCase() : ''}・${((performance.now() - t0) / 1000).toFixed(0)}秒`;
      const res = await J.saveFile(baseName() + '.mp4', r.blob);
      if (res === 'declined') txt.textContent += '（保存はキャンセルされました）';
    } else {
      const blob = await J.exportPNGZip({ plan: S.plan, project: S.project, transparent: kind === 'pnga', layers: kind === 'pngl', onProgress, signal: ac.signal });
      txt.textContent = `完成 ${(blob.size / 1048576).toFixed(1)}MB`;
      await J.saveFile(baseName() + (kind === 'pnga' ? '_alpha' : kind === 'pngl' ? '_layers' : '') + '_png.zip', blob);
    }
  } catch (e) {
    txt.textContent = 'エラー: ' + (e && e.message ? e.message : e);
    console.error(e);
  } finally {
    S.exporting = null; S.need = true;
    EXP_BTNS.forEach(id => { $(id).disabled = false; });
    codecNote();
  }
}

/* ---------------- tap sync ---------------- */
function startTap() {
  const layer = activeMediaLayer();
  if (!(layer ? S.plan[layer].cuts.length || S.project[layer].loop : S.plan.lines.length)) return;
  S.tap = { i: 0, layer, append: !!layer && S.project[layer].loop };
  if (!S.project.timing.lineTimes) S.project.timing.lineTimes = {};
  $('tapHint').textContent = S.tap.append ? 'タップするたびに素材をループしてカットを追加します。終了するまで続けられます。' : '曲に合わせて、各行・素材が始まる瞬間に Space かボタンを押してください。';
  $('tapPanel').hidden = false; $('btnTap').setAttribute('aria-pressed', 'true');
  if (S.tap.append && !S.audio) extendTapPreview(0);
  seek(0); play(); updateTap();
  $('tapBtn').focus();
}
function tapNow() {
  if (!S.tap) return;
  if (S.tap.append) {
    const i = S.tap.i;
    const m = S.project[S.tap.layer];
    if (i === 0) { m.timing.lineTimes = {}; m.cutOverrides = {}; m.manualCuts = true; }
    m.cutCount = i + 1;
    const order = J.mediaOrder(S.project, S.tap.layer);
    m.cutOverrides[i] = { itemId: order.length ? order[i % order.length].id : null };
    m.timing.lineTimes[i] = +S.t.toFixed(3);
    S.tap.i++;
    replan();
    if (S.tap.i >= 1000) { pause(); stopTap(); toast('カット数の上限に達しました'); }
    else updateTap();
    return;
  }
  const layer = S.tap.layer;
  (layer ? S.project[layer].timing : S.project.timing).lineTimes[S.tap.i] = +S.t.toFixed(3);
  S.tap.i++;
  replan();
  if (S.tap.i >= (layer ? S.plan[layer].cuts.length : S.plan.lines.length)) stopTap(); else updateTap();
}
function stopTap() { S.tap = null; $('tapPanel').hidden = true; $('btnTap').setAttribute('aria-pressed', 'false'); replan(); }
function updateTap() {
  if (S.tap.append) {
    const order = J.mediaOrder(S.project, S.tap.layer);
    $('tapLine').textContent = `${S.tap.i + 1}. ${order.length ? order[S.tap.i % order.length].name : '画像無し'}`; return;
  }
  const ln = S.tap.layer ? S.plan[S.tap.layer].cuts[S.tap.i] : S.plan.lines[S.tap.i];
  $('tapLine').textContent = ln ? `${S.tap.i + 1}. ${S.tap.layer ? ln.name : ln.text}` : '—';
}

/* ---------------- sync all inputs from project ---------------- */
function syncUI() {
  renderBrands();
  $('songTitle').value = S.project.title || ''; $('songArtist').value = S.project.artist || '';
  $('lyrics').value = S.project.lyrics;
  $('jevPrompt').value = S.project.jevPrompt || '';
  $('bpm').value = S.project.timing.bpm > 0 ? S.project.timing.bpm : '';
  $('bpm').placeholder = S.audio ? `自動 ${S.audio.bpm}` : 'なし';
  $('offset').value = S.project.timing.offset ?? 0.4;
  $('lineScale').value = S.project.timing.lineScale ?? 1;
  $('snap').checked = !!S.project.timing.snap;
  document.querySelectorAll('.wa-toggle').forEach(el => { el.checked = S.project.wa !== false; });
  document.querySelectorAll('.extra-toggle').forEach(el => { el.checked = S.project.extra === true; });
  document.querySelectorAll('.lib-toggle').forEach(el => { el.checked = S.project.lib === true; });
  $('lyricLang').value = J.LANG_LABEL[S.project.lang] ? S.project.lang : 'auto'; langNote();
  renderFontRoles(); renderColors(); renderFx(); renderTech(); syncOut(); drawStyleGrid();
}

/* ---------------- wiring ---------------- */
function bind() {
  $('timelineZoomOut').addEventListener('click', () => setTimelineZoom(S.timelineZoom / 1.5));
  $('timelineZoomIn').addEventListener('click', () => setTimelineZoom(S.timelineZoom * 1.5));
  $('timelineZoomOut').disabled = true;
  $('sourceLyrics').addEventListener('click', () => { cancelAreaEditor(); S.sourceTab = 'lyrics'; syncSourceTab(); });
  $('sourceMedia').addEventListener('click', () => { cancelAreaEditor(); S.sourceTab = 'media'; renderMediaList(); renderMediaLines(); });
  $('sourceForeground').addEventListener('click', () => { cancelAreaEditor(); S.sourceTab = 'foreground'; renderMediaList(); renderMediaLines(); });
  const areaOverlay = $('areaEditOverlay');
  areaOverlay.addEventListener('pointerdown', e => {
    if (!S.areaEdit) return;
    const handle = e.target.closest('[data-handle]'), mode = handle ? handle.dataset.handle : mediaHit(e);
    if (!mode) return;
    e.preventDefault(); areaOverlay.setPointerCapture(e.pointerId);
    S.areaEdit.drag = { start: mediaPointer(e), previous: { ...S.areaEdit.draft }, previousAngle: S.areaEdit.angle, pointerAngle: mediaPointerAngle(e, S.areaEdit.draft), handle: mode };
    areaOverlay.style.cursor = mode === 'rotate' ? 'var(--rotate-cursor)' : '';
    $('areaEditRect').style.cursor = mode === 'rotate' ? 'var(--rotate-cursor)' : '';
  });
  areaOverlay.addEventListener('pointermove', e => {
    if (!S.areaEdit) return;
    if (S.areaEdit.drag) moveMediaDraft(e);
    else {
      const mode = mediaHit(e), cursor = mode === 'rotate' ? 'var(--rotate-cursor)' : mode === 'move' ? 'move' : 'default';
      areaOverlay.style.cursor = cursor; $('areaEditRect').style.cursor = cursor;
    }
  });
  areaOverlay.addEventListener('pointerup', e => {
    if (!S.areaEdit) return;
    S.areaEdit.drag = null; areaOverlay.style.cursor = ''; $('areaEditRect').style.cursor = '';
  });
  areaOverlay.addEventListener('pointercancel', () => { if (!S.areaEdit) return; if (S.areaEdit.drag) { S.areaEdit.draft = S.areaEdit.drag.previous; S.areaEdit.angle = S.areaEdit.drag.previousAngle; } S.areaEdit.drag = null; areaOverlay.style.cursor = ''; $('areaEditRect').style.cursor = ''; showAreaDraft(); });
  $('mediaAreaAspectLock').addEventListener('change', e => { if (!S.areaEdit) return; S.areaEdit.lockAspect = e.target.checked; if (e.target.checked) S.areaEdit.ratio = S.areaEdit.draft.h / S.areaEdit.draft.w; showAreaDraft(); });
  $('mediaAreaWidth').addEventListener('change', e => { if (!S.areaEdit) return; const w = J.clamp(+e.target.value / 100, 0.005, S.areaEdit.kind === 'lyric' ? 1 : 4); setMediaDraftSize(w, S.areaEdit.lockAspect ? w * S.areaEdit.ratio : S.areaEdit.draft.h); });
  $('mediaAreaHeight').addEventListener('change', e => { if (!S.areaEdit) return; const h = J.clamp(+e.target.value / 100, 0.005, S.areaEdit.kind === 'lyric' ? 1 : 4); setMediaDraftSize(S.areaEdit.lockAspect ? h / S.areaEdit.ratio : S.areaEdit.draft.w, h); });
  $('mediaAreaAngle').addEventListener('input', e => { if (!S.areaEdit || e.target.value === '') return; S.areaEdit.angle = J.clamp(+e.target.value || 0, -180, 180); showAreaDraft(); });
  $('areaResetFull').addEventListener('click', () => { if (!S.areaEdit || S.areaEdit.kind !== 'lyric') return; S.areaEdit.draft = { x: 0, y: 0, w: 1, h: 1 }; S.areaEdit.ratio = 1; S.areaEdit.angle = 0; showAreaDraft(); });
  $('areaApplyOne').addEventListener('click', () => applyAreaEditor(false));
  $('areaApplyFollowing').addEventListener('click', () => applyAreaEditor(true));
  $('areaCancel').addEventListener('click', cancelAreaEditor);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.areaEdit) { e.preventDefault(); cancelAreaEditor(); } });
  $('mediaFiles').addEventListener('change', async e => { const files = Array.from(e.target.files || []); e.target.value = ''; await addMediaFiles(files, activeMediaLayer() || 'media'); });
  const mediaPane = $('mediaPane');
  const hasFiles = e => Array.from(e.dataTransfer && e.dataTransfer.types || []).includes('Files');
  mediaPane.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; mediaPane.classList.add('media-drop-active'); });
  mediaPane.addEventListener('dragleave', e => { if (!mediaPane.contains(e.relatedTarget)) mediaPane.classList.remove('media-drop-active'); });
  mediaPane.addEventListener('drop', async e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); mediaPane.classList.remove('media-drop-active');
    await addMediaFiles(Array.from(e.dataTransfer.files || []), activeMediaLayer() || 'media');
  });
  $('mediaRandom').addEventListener('change', e => { S.project[activeMediaLayer()].randomOrder = e.target.checked; replan(); });
  $('mediaLoop').addEventListener('change', e => {
    const m = S.project[activeMediaLayer()]; m.loop = e.target.checked;
    if (e.target.checked && !m.cutCount) m.cutCount = Math.min(1000, m.items.length * 2);
    replan();
  });
  $('mediaCutCount').addEventListener('change', e => {
    const layer = activeMediaLayer(), m = S.project[layer], count = J.clamp(Math.floor(+e.target.value || 0), 0, 1000);
    if (count !== S.plan[layer].cuts.length) {
      freezeMediaCuts(layer);
      for (let i = m.cutCount; i < count; i++) m.cutOverrides[i] = { itemId: null };
      for (const key of Object.keys(m.cutOverrides)) if (+key >= count) delete m.cutOverrides[key];
      for (const key of Object.keys(m.timing.lineTimes)) if (+key >= count) delete m.timing.lineTimes[key];
    }
    m.cutCount = count;
    replan();
  });
  $('lyricBlend').addEventListener('change', e => { S.project.media.blend = e.target.value; replan(); });
  $('lyricOpacity').addEventListener('change', e => { S.project.media.opacity = J.clamp(+e.target.value || 0, 0, 100); replan(); });
  $('mediaBlend').addEventListener('change', e => { S.project.foreground.blend = e.target.value; replan(); });
  $('mediaOpacity').addEventListener('change', e => { S.project.foreground.opacity = J.clamp(+e.target.value || 0, 0, 100); replan(); });
  $('lyrics').addEventListener('input', e => {
    const changedCount = reconcileLyricLines(S.project.lyrics, e.target.value);
    S.project.lyrics = e.target.value;
    markUndoGroup('lyrics');
    if (changedCount) { clearTimeout(replanTimer); replan(); }
    else replanSoon(260);
  });
  $('jevPrompt').addEventListener('input', e => { S.project.jevPrompt = e.target.value; markUndoGroup('jevPrompt'); autosave(); });
  $('lyricLang').addEventListener('change', e => {
    remember();
    S.project.lang = e.target.value; replan(); renderFontRoles(); commit(); flushSave();
    const l = J.resolveLang(S.project);
    toast((S.project.lang === 'auto' ? '歌詞の言語：自動判定 → ' : '歌詞の言語：') + J.LANG_LABEL[l]);
  });
  $('songTitle').addEventListener('input', e => { S.project.title = e.target.value; markUndoGroup('title'); replanSoon(300); });
  $('songArtist').addEventListener('input', e => { S.project.artist = e.target.value; markUndoGroup('artist'); replanSoon(300); });
  $('btnSyntax').addEventListener('click', e => { const s = $('syntax'); s.hidden = !s.hidden; e.target.setAttribute('aria-expanded', String(!s.hidden)); });
  $('bpm').addEventListener('change', e => { S.project.timing.bpm = Math.max(0, parseFloat(e.target.value) || 0); replan(); });
  $('offset').addEventListener('change', e => { S.project.timing.offset = Math.max(0, parseFloat(e.target.value) || 0); replan(); });
  $('lineScale').addEventListener('change', e => { S.project.timing.lineScale = J.clamp(parseFloat(e.target.value) || 1, 0.3, 4); replan(); });
  $('snap').addEventListener('change', e => { S.project.timing.snap = e.target.checked; replan(); });
  $('btnResetTimes').addEventListener('click', () => { const layer = activeMediaLayer(), timing = layer ? S.project[layer].timing : S.project.timing; timing.lineTimes = {}; if (!layer) timing.cutTimes = {}; replan(); });
  $('audioFile').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    $('audioName').textContent = '解析中…';
    try {
      pause();
      S.audio = await J.analyzeAudio(f);
      $('audioName').textContent = `${f.name}（${J.fmtTime(S.audio.duration)}・約${S.audio.bpm}BPM）`;
      $('btnRemoveAudio').hidden = false;
      S.project.timing.snap = true;
      syncUI(); replan();
    } catch (err) { $('audioName').textContent = '読み込めませんでした: ' + err.message; S.audio = null; $('btnRemoveAudio').hidden = true; }
  });
  $('btnRemoveAudio').addEventListener('click', removeAudio);
  $('btnTap').addEventListener('click', () => (S.tap ? stopTap() : startTap()));
  $('tapBtn').addEventListener('click', tapNow);
  $('tapStop').addEventListener('click', () => { pause(); stopTap(); });
  $('btnPlay').addEventListener('click', () => (S.playing ? pause() : play()));
  $('btnUndo').addEventListener('click', () => undoMove(-1));
  $('btnRedo').addEventListener('click', () => undoMove(1));
  $('btnLoop').addEventListener('click', e => { S.loop = !S.loop; e.target.setAttribute('aria-pressed', String(S.loop)); });
  $('btnShuffle').addEventListener('click', () => { remember(); S.project.seed = (Math.random() * 1e9) | 0; $('seed').value = S.project.seed; replan(); commit(); });
  const sc = $('scrub');
  sc.addEventListener('input', () => { S.scrubbing = true; seek(sc.value / 10000 * S.plan.duration); });
  sc.addEventListener('change', () => { S.scrubbing = false; });
  const durationValue = $('timeDur'), durationInput = $('timeDurInput'), durationHandle = $('timelineDurationHandle');
  const closeDurationInput = save => {
    if (durationInput.hidden) return;
    const raw = durationInput.value.trim();
    durationInput.hidden = true; durationValue.hidden = false;
    if (save) setProjectDuration(raw ? parseProjectDuration(raw) : null);
    updateTimeUI();
  };
  durationValue.addEventListener('click', () => {
    if (S.exporting || S.tap) return;
    pause(); durationValue.hidden = true; durationInput.hidden = false;
    durationInput.value = J.fmtTime(S.plan.duration); durationInput.focus(); durationInput.select();
  });
  durationInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); closeDurationInput(true); }
    else if (e.key === 'Escape') { e.preventDefault(); closeDurationInput(false); }
  });
  durationInput.addEventListener('blur', () => closeDurationInput(true));
  durationHandle.addEventListener('pointerdown', e => {
    if (S.exporting || S.tap) return;
    e.preventDefault();
    closeDurationInput(false); pause();
    S.durationDrag = { pointerId: e.pointerId, originX: e.clientX, originDuration: S.plan.duration, preview: S.plan.duration, moved: false };
    durationHandle.setPointerCapture(e.pointerId);
    durationHandle.classList.add('dragging');
  });
  durationHandle.addEventListener('pointermove', e => {
    const drag = S.durationDrag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const width = Math.max(1, $('timelineStack').clientWidth);
    if (Math.abs(e.clientX - drag.originX) >= 2) drag.moved = true;
    drag.preview = Math.round(J.clamp(drag.originDuration * (1 + (e.clientX - drag.originX) / width), minimumProjectDuration(), 21600) * 100) / 100;
    durationHandle.style.transform = `translateX(${(drag.preview / drag.originDuration - 1) * width}px)`;
    updateTimeUI();
  });
  durationHandle.addEventListener('pointerup', e => {
    const drag = S.durationDrag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    S.durationDrag = null; durationHandle.classList.remove('dragging'); durationHandle.style.transform = '';
    if (drag.moved) setProjectDuration(drag.preview);
    else durationValue.click();
    updateTimeUI();
  });
  durationHandle.addEventListener('pointercancel', () => {
    S.durationDrag = null; durationHandle.classList.remove('dragging'); durationHandle.style.transform = ''; updateTimeUI();
  });
  for (const tl of [$('timeline'), $('mediaTimeline'), $('foregroundTimeline')]) {
    const layer = tl.id === 'timeline' ? 'lyrics' : tl.id === 'foregroundTimeline' ? 'foreground' : 'media';
    let drag = null;
    tl.addEventListener('pointerdown', e => {
      const boundary = !S.exporting && !S.tap && timelineBoundaryAt(e, layer);
      const limits = boundary && boundaryGroupLimits(boundary.ref);
      drag = boundary && limits && limits.max > limits.min ? { ...boundary, min: limits.min, max: limits.max, mode: 'boundary', originX: e.clientX, preview: boundary.start, moved: false, duration: S.plan.duration } : { mode: 'seek' };
      tl.setPointerCapture(e.pointerId);
      if (boundary) { pause(); S.timelineDrag = drag; }
      else timelineSeek(e);
    });
    tl.addEventListener('pointermove', e => {
      if (!drag) { tl.style.cursor = !S.exporting && !S.tap && timelineBoundaryAt(e, layer) ? 'ew-resize' : 'pointer'; return; }
      if (drag.mode === 'seek') { timelineSeek(e); return; }
      if (Math.abs(e.clientX - drag.originX) >= 3) drag.moved = true;
      if (!drag.moved) return;
      const rect = tl.getBoundingClientRect();
      drag.preview = J.clamp((e.clientX - rect.left) / rect.width * drag.duration, drag.min, drag.max);
      drawTimeline();
      drawTimelineLinks();
    });
    tl.addEventListener('pointerup', () => {
      if (!drag) return;
      if (drag.mode === 'boundary') {
        S.timelineDrag = null;
        if (drag.moved) commitTimelineBoundary(drag);
        else seek(drag.start);
        drawTimeline();
        drawTimelineLinks();
      }
      drag = null;
    });
    tl.addEventListener('pointercancel', () => { drag = null; S.timelineDrag = null; drawTimeline(); drawTimelineLinks(); });
  }
  const linkSvg = $('timelineLinks');
  linkSvg.addEventListener('pointerdown', e => {
    const action = e.target.closest('.timeline-action');
    if (action) { e.preventDefault(); e.stopPropagation(); performTimelineAction(action); return; }
    const remove = e.target.closest('.link-remove');
    if (remove) {
      e.preventDefault(); e.stopPropagation();
      S.project.timelineLinks.splice(+remove.dataset.edge, 1);
      drawTimelineLinks(); autosave();
      return;
    }
    const handle = e.target.closest('.link-handle');
    if (!handle || S.exporting || S.tap) return;
    e.preventDefault(); e.stopPropagation(); pause();
    const marker = timelineMarkers().find(m => m.ref === handle.dataset.ref);
    if (!marker) return;
    S.linkDrag = { source: marker.ref, sourceLayer: marker.layer, sourceX: marker.x, sourceY: marker.y, x: marker.x, y: marker.y };
    linkSvg.setPointerCapture(e.pointerId);
    drawTimelineLinks();
  });
  linkSvg.addEventListener('pointermove', e => {
    if (!S.linkDrag) return;
    const rect = $('timelineStack').getBoundingClientRect();
    S.linkDrag.x = e.clientX - rect.left; S.linkDrag.y = e.clientY - rect.top;
    drawTimelineLinks();
  });
  linkSvg.addEventListener('pointerup', e => {
    if (!S.linkDrag) return;
    const drag = S.linkDrag, target = markerNear(e.clientX, e.clientY, drag.sourceLayer);
    S.linkDrag = null;
    if (target) connectTimelineBoundaries(drag.source, target.ref);
    drawTimelineLinks();
  });
  linkSvg.addEventListener('pointercancel', () => { S.linkDrag = null; drawTimelineLinks(); });
  linkSvg.addEventListener('keydown', e => {
    const action = e.target.closest('.timeline-action');
    if (action && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); performTimelineAction(action); }
  });
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    document.querySelectorAll('.tabpane').forEach(p => { p.hidden = p.dataset.pane !== b.dataset.tab; });
    if (b.dataset.tab === 'out') codecNote();
    loadThumbFonts();
  }));
  $('fxFlash').addEventListener('change', e => { S.project.fx.flash = e.target.checked; replan(); });
  $('techFilter').addEventListener('input', () => renderTech());
  const setSwitch = (cls, key, on, msgOn, msgOff) => document.querySelectorAll('.' + cls).forEach(el => el.addEventListener('change', e => {
    remember();
    S.project[key] = e.target.checked;
    document.querySelectorAll('.' + cls).forEach(x => { x.checked = e.target.checked; });
    renderTech(); drawStyleGrid(); replan(); commit(); flushSave();
    toast(e.target.checked ? msgOn : msgOff);
  }));
  setSwitch('extra-toggle', 'extra', true, '追加分の演出：使う', '追加分の演出：使わない（最初の公開版の演出だけ）');
  setSwitch('lib-toggle', 'lib', true, '配色・書体ライブラリ：使う', '配色・書体ライブラリ：使わない');
  setSwitch('wa-toggle', 'wa', true, '和風の演出：使う', '和風の演出：使わない（おまかせ・シャッフルで選ばれません）');
  $('fxKoma').addEventListener('change', e => { const k = +e.target.value; S.project.fx.koma = k; S.project.fx.onTwos = k > 0; S.project.mood = null; replan(); });
  $('fxHud').addEventListener('change', e => { S.project.fx.hud = e.target.value; replan(); });
  $('seed').addEventListener('change', e => { S.project.seed = parseInt(e.target.value, 10) || 0; replan(); });
  $('btnSeed').addEventListener('click', () => { S.project.seed = (Math.random() * 1e9) | 0; $('seed').value = S.project.seed; replan(); });
  const colorToggle = (flag, keys) => e => {
    remember();
    const c = S.project.colors; c[flag] = e.target.checked;
    if (c[flag]) { const sc0 = effScheme0(); keys.forEach(([k]) => { if (!c[k]) c[k] = sc0[k]; }); }
    renderColors(); replan(); commit();
  };
  $('colorOn').addEventListener('change', colorToggle('enabled', BASE_KEYS));
  $('accentOn').addEventListener('change', colorToggle('accentOn', ACCENT_KEYS));
  $('btnRandPalette').addEventListener('click', randomPalette);
  $('btnAddFont').addEventListener('click', () => {
    const name = $('localFont').value.trim(); if (!name) return;
    const key = 'local_' + name.replace(/\s+/g, '_');
    const weight = /bold|太|black|heavy|w[6-9]|[6-9]00/i.test(name) ? 700 : 400;
    J.addUserFont(key, name + '（PC）', name, weight);
    S.project.userFonts = (S.project.userFonts || []).filter(u => u.key !== key).concat([{ key, label: name + '（PC）', family: name, weight }]);
    S.project.fonts.display = key; $('localFont').value = '';
    fontKey = ''; renderFontRoles(); replan();
  });
  $('btnListFonts').addEventListener('click', async () => {
    if (typeof window.queryLocalFonts !== 'function') { toast('このブラウザではPCフォント一覧を取得できません'); return; }
    try {
      const fonts = await window.queryLocalFonts();
      const unique = new Map();
      for (const font of fonts) if (font.family) unique.set(`${font.family}\u0000${font.style}`, font);
      const selector = $('installedFonts'); selector.innerHTML = '';
      for (const font of [...unique.values()].sort((a, b) => (a.family + a.style).localeCompare(b.family + b.style))) {
        const option = document.createElement('option'); option.value = font.postscriptName || font.fullName; option.textContent = font.fullName || `${font.family} ${font.style}`;
        option.style.fontFamily = `"${font.family.replace(/"/g, '')}"`; option._font = font; selector.appendChild(option);
      }
      selector.hidden = !$('installedFonts').options.length; $('btnImportFont').hidden = selector.hidden;
      if (selector.hidden) toast('フォントが見つかりませんでした');
    } catch (error) { toast('PCフォント一覧の取得が許可されませんでした'); }
  });
  $('btnImportFont').addEventListener('click', () => {
    const selector = $('installedFonts'), font = selector.selectedOptions[0]?._font;
    if (!font) return;
    const family = font.family, weight = /bold|black|heavy|太|[6-9]00/i.test(font.style || '') ? 700 : 400;
    const key = 'local_' + Array.from(family + '_' + (font.style || '')).map(ch => ch.codePointAt(0).toString(16)).join('_');
    const label = font.fullName || `${family} ${font.style || ''}`;
    J.addUserFont(key, label, family, weight);
    S.project.userFonts = (S.project.userFonts || []).filter(item => item.key !== key).concat([{ key, label, family, weight }]);
    S.project.fonts.display = key; fontKey = ''; renderFontRoles(); replan();
  });
  $('btnSaveComposite').addEventListener('click', () => {
    const name = $('compositeName').value.trim(), base = $('compositeBase').value;
    if (!name || !J.FONTS[base] || J.FONTS[base].composite) { toast('設定名とベースフォントを指定してください'); return; }
    const parts = Object.fromEntries([...$('compositeParts').querySelectorAll('select')].filter(el => el.value && J.FONTS[el.value] && !J.FONTS[el.value].composite).map(el => [el.dataset.part, el.value]));
    const key = 'composite_' + Math.random().toString(36).slice(2, 11);
    S.project.compositeFonts.push({ key, name, base, parts }); J.setCompositeFonts(S.project.compositeFonts);
    S.project.fonts.display = key; $('compositeName').value = ''; fontKey = ''; renderFontRoles(); replan();
  });
  $('compositeList').addEventListener('click', e => {
    const button = e.target.closest('[data-key]'); if (!button) return;
    S.project.compositeFonts = S.project.compositeFonts.filter(def => def.key !== button.dataset.key);
    for (const role of Object.keys(S.project.fonts)) if (S.project.fonts[role] === button.dataset.key) delete S.project.fonts[role];
    J.setCompositeFonts(S.project.compositeFonts); fontKey = ''; renderFontRoles(); replan();
  });
  $('fontFile').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try {
      const key = await J.loadFontFile(f), face = J.FONTS[key];
      S.project.userFonts = (S.project.userFonts || []).filter(item => item.key !== key).concat([{ key, label: face.label, family: face.family.replace(/"/g, ''), weight: face.weight, file: true }]);
      S.project.fonts.display = key; fontKey = ''; renderFontRoles(); replan();
    }
    catch (err) { showMsg('フォントを読み込めませんでした'); setTimeout(() => showMsg(null), 2500); }
  });
  ['outAspect', 'eAspect'].forEach(id => $(id).addEventListener('change', e => { S.project.aspect = e.target.value; syncOut(); replan(); codecNote(); }));
  ['outRes', 'eRes'].forEach(id => $(id).addEventListener('change', e => { S.project.res = +e.target.value; syncOut(); autosave(); codecNote(); }));
  for (const id of ['out', 'e']) {
    $(`${id}VideoSize`).addEventListener('change', e => {
      const choice = e.target.value;
      S.project.videoSizeMode = choice === 'custom' ? 'custom' : 'preset';
      if (choice === 'legacy') S.project.videoSize = null;
      else if (choice === 'custom') {
        const [w, h] = J.outputSize(S.project); S.project.videoSize = { w, h };
      } else { const [w, h] = choice.split('x').map(Number); S.project.videoSize = { w, h }; }
      syncOut(); replan(); codecNote();
    });
    for (const dimension of ['Width', 'Height']) $(`${id}Video${dimension}`).addEventListener('change', e => {
      const n = Math.round(+e.target.value / 2) * 2;
      if (!Number.isFinite(n) || n < 16 || n > 8192) { syncOut(); return; }
      const [w, h] = J.outputSize(S.project);
      S.project.videoSize = { w: dimension === 'Width' ? n : w, h: dimension === 'Height' ? n : h };
      syncOut(); replan(); codecNote();
    });
  }
  ['outFps', 'eFps'].forEach(id => $(id).addEventListener('change', e => { S.project.fps = +e.target.value; syncOut(); replan(); codecNote(); }));
  $('outQuality').addEventListener('change', e => { S.project.quality = e.target.value; autosave(); });
  ['outKey', 'eKey'].forEach(id => $(id).addEventListener('change', e => {
    S.project.keyBg = e.target.value; syncOut(); replan(); flushSave();
    const k = J.keyMode(S.project);
    toast(k ? `背景：${k === 'green' ? 'グリーンバック' : 'ブラックバック'}（白い文字と演出だけ）` : '背景：通常（スタイルの配色）');
  }));
  $('outAudio').addEventListener('change', e => { S.project.includeAudio = e.target.checked; autosave(); });
  $('btnMP4').addEventListener('click', () => runExport('mp4'));
  $('btnPNG').addEventListener('click', () => runExport('png'));
  $('btnPNGA').addEventListener('click', () => runExport('pnga'));
  $('btnPNGL').addEventListener('click', () => runExport('pngl'));
  document.querySelectorAll('.exp-cancel').forEach(b => b.addEventListener('click', () => { if (S.exporting) S.exporting.abort(); }));
  $('eMP4').addEventListener('click', () => runExport('mp4'));
  ['btnBatchMP4', 'eBatchMP4'].forEach(id => $(id).addEventListener('click', runBatchExport));
  ['btnFav', 'favAdd', 'eFavAdd'].forEach(id => $(id).addEventListener('click', addFav));
  $('favExport').addEventListener('click', exportFavs);
  $('favImport').addEventListener('click', () => $('favFile').click());
  $('favFile').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) importFavs(f); e.target.value = ''; });
  // かんたんモード
  $('modeEasy').addEventListener('click', () => setMode('easy'));
  $('modePro').addEventListener('click', () => setMode('pro'));
  $('btnOmakase').addEventListener('click', omakase);
  $('btnOmakaseBig').addEventListener('click', omakase);
  $('btnJev').addEventListener('click', jevOmakase);
  $('btnJevBig').addEventListener('click', jevOmakase);
  ['btnPrev', 'btnPrev2'].forEach(id => $(id).addEventListener('click', () => histGo(-1)));
  ['btnNext', 'btnNext2'].forEach(id => $(id).addEventListener('click', () => histGo(1)));
  $('eStyle').addEventListener('click', () => rerollPart('style'));
  $('eMood').addEventListener('click', () => rerollPart('mood'));
  $('eCut').addEventListener('click', () => rerollPart('cut'));
  $('ePalette').addEventListener('click', () => { if (S.project.lib === true) pickLibPalette(); else randomPalette(); restartPreview(); });
  $('libPalSwap').addEventListener('click', () => { const v = S.project.colors.palette; if (v) setLibPalette(Object.assign({}, v, { v: (v.v | 0) + 1 }), `配色ライブラリ：${v.id}（背景を切り替え）`); });
  $('libPalClear').addEventListener('click', () => setLibPalette(null));
  $('safeMode').addEventListener('change', e => setSafeMode(e.target.value));
  $('libPalRandom').addEventListener('click', pickLibPalette);
  // 利用について（出力物の権利・ライセンス）
  const dlg = $('termsDlg');
  const openTerms = () => { if (dlg.showModal) { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', ''); };
  document.querySelectorAll('.terms-open').forEach(b => b.addEventListener('click', openTerms));
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close ? dlg.close() : dlg.removeAttribute('open'); });   // click on the backdrop
  $('btnSave').addEventListener('click', () => J.saveFile(baseName() + '.jizura.json', JSON.stringify(S.project, null, 1)));
  $('btnAE').addEventListener('click', () => J.saveFile(baseName() + '_ae.json', JSON.stringify(J.planForAE(S.plan, S.project), null, 1)));
  $('fileProject').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try { S.project = mergeProject(JSON.parse(await f.text())); loadBrands(); syncUI(); replan(); await Promise.all([restoreMediaAssets(), J.restoreFontFiles(S.project.userFonts)]); fontKey = ''; ensureFonts(); }
    catch (err) { showMsg('プロジェクトを読み込めませんでした'); setTimeout(() => showMsg(null), 2500); }
    e.target.value = '';
  });
  document.addEventListener('keydown', e => {
    const tag = (e.target && e.target.tagName) || '';
    const typing = (e.target && e.target.isContentEditable) || /INPUT|TEXTAREA|SELECT/.test(tag) && e.target.type !== 'range' && e.target.type !== 'checkbox';
    if (!typing && !e.altKey && (e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); undoMove(e.shiftKey ? 1 : -1); return; }
    if (!typing && !e.altKey && e.ctrlKey && e.code === 'KeyY') { e.preventDefault(); undoMove(1); return; }
    if (S.tap && (e.code === 'Space' || e.code === 'Enter') && !typing) { e.preventDefault(); tapNow(); return; }
    if (S.tap && e.code === 'Escape') { pause(); stopTap(); return; }
    if (typing || $('termsDlg').open) return;
    if (e.code === 'Space') { e.preventDefault(); S.playing ? pause() : play(); }
    else if (e.code === 'ArrowRight') seek(S.t + (e.shiftKey ? 1 : 1 / S.plan.fps));
    else if (e.code === 'ArrowLeft') seek(S.t - (e.shiftKey ? 1 : 1 / S.plan.fps));
    else if (e.code === 'KeyR' && !e.metaKey && !e.ctrlKey && !e.altKey && !S.exporting) { e.preventDefault(); omakase(); }
  });
  window.addEventListener('resize', () => { sizeViewport(); drawTimeline(); drawTimelineLinks(); });
  if (window.ResizeObserver) new ResizeObserver(() => { sizeViewport(); drawTimeline(); drawTimelineLinks(); }).observe($('viewport'));
  if (window.ResizeObserver) new ResizeObserver(drawTimelineLinks).observe($('timelineStack'));
}

/* song file -> beat analysis (file input, or a host such as the After Effects panel) */
async function loadAudioFile(f) {
  $('audioName').textContent = '解析中…';
  try {
    pause();
    S.audio = await J.analyzeAudio(f);
    $('audioName').textContent = `${f.name}（${J.fmtTime(S.audio.duration)}・約${S.audio.bpm}BPM）`;
    $('btnRemoveAudio').hidden = false;
    S.project.timing.snap = true;
    syncUI(); replan();
    return true;
  } catch (err) { $('audioName').textContent = '読み込めませんでした: ' + err.message; S.audio = null; $('btnRemoveAudio').hidden = true; return false; }
}

/* ---------------- boot ---------------- */
function boot() {
  S.project = loadLocal();
  cleanupDeletedMedia();
  initUndo();
  bind(); bindBrands(); initVolume(); loadFavs(); renderFavs(); loadBrands(); syncUI(); replan();
  restoreMediaAssets();
  J.restoreFontFiles(S.project.userFonts).then(() => { fontKey = ''; ensureFonts(); S.need = true; }).catch(() => {});
  let mode = 'easy'; try { mode = localStorage.getItem('jizura.mode') || 'easy'; } catch (e) {}
  setMode(mode); commit();
  // open on a representative frame (end of the first cut's entrance)
  const c0 = S.plan.cuts.find(c => c.line >= 0);
  if (c0) seek(c0.start + Math.min(c0.dur * 0.6, c0.inDur + 0.25));
  requestAnimationFrame(tick);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
J.ui = S;
// hooks for hosts that embed the app (the After Effects CEP panel)
J.uiApi = { toast, replan, syncUI, pause, seek, flushSave, loadAudioFile, restartPreview };
})();
