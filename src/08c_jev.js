/* Jev chooses from JIZURA's existing expression vocabulary. The API key stays on the local server. */
(() => {
'use strict';

const CORE = {
  layout: ['center', 'condensed', 'huge', 'tile', 'marquee', 'vcols', 'scatter', 'stack', 'gloss', 'circle', 'type', 'mixed', 'wave', 'labels', 'pill', 'ring', 'diag'],
  enter: ['slice', 'scramble', 'assemble', 'flicker', 'zoom', 'stretch', 'blur', 'type', 'wipe', 'pop', 'drop', 'spin'],
  exit: ['glitch', 'slice', 'explode', 'fall', 'blur', 'drift', 'wipe', 'shrink', 'scatter', 'stretch'],
};
const criteria = (keys, table) => Object.fromEntries(keys.filter(k => table[k]).map(k => [k, `${table[k].name}${table[k].tags ? ' / ' + table[k].tags.join(', ') : ''}`]));
const choice = (instructions, options) => ({ type: 'choice', instructions, criteria: options });
const valid = (answer, options) => answer && answer.type === 'choice' && Object.hasOwn(options, answer.choice) ? answer.choice : null;
const endpoint = () => location.origin === 'https://hirazisora.github.io'
  ? 'http://127.0.0.1:8765/api/jev' : '/api/jev';

J.jevSuggest = async (project, signal) => {
  const lines = J.parseLyrics(project.lyrics).lines;
  if (!lines.length) throw new Error('歌詞を入力してください');
  const userDirection = String(project.jevPrompt || '').trim().slice(0, 1000);
  const directionRule = userDirection ? '歌詞とユーザーの追加指示の両方を考慮する。' : '歌詞を考慮する。';
  const moodOptions = criteria(Object.keys(J.MOODS).filter(k => k !== 'chaos'), J.MOODS);
  const allowed = (g, k) => !J.randomOk || J.randomOk(project, g, k);
  const styleOptions = Object.fromEntries(J.STYLE_ORDER.filter(k => allowed('style', k)).map(k => [k, `${J.STYLES[k].name}：${J.STYLES[k].desc}`]));
  const options = Object.fromEntries(Object.entries(CORE).map(([g, keys]) => [g, criteria(keys.filter(k => allowed(g, k)), J.registry(g))]));
  const selections = { lines: {} };
  // Keep each request bounded; later batches use the globally chosen look as context.
  for (let start = 0; start < lines.length; start += 12) {
    const batch = lines.slice(start, start + 12);
    const questions = {};
    if (start === 0) {
      questions.mood = choice(`${directionRule} 歌詞全体に最も合う映像の雰囲気を選ぶ。`, moodOptions);
      questions.style = choice(`${directionRule} 歌詞全体に最も合う文字PVの配色と書体のスタイルを選ぶ。`, styleOptions);
    }
    batch.forEach((line, i) => {
      const n = start + i;
      for (const g of Object.keys(CORE)) questions[`${g}_${n}`] = choice(`${directionRule} 行 ${n + 1} に合う${{ layout: '文字レイアウト', enter: '登場の動き', exit: '退場の動き' }[g]}を選ぶ。`, options[g]);
    });
    const state = {
      title: (project.title || '').slice(0, 120),
      artist: (project.artist || '').slice(0, 120),
      lyrics: lines.map(l => l.text).join('\n').slice(0, 6000),
      ...(userDirection ? { userDirection } : {}),
      selectedMood: selections.mood || null,
      selectedStyle: selections.style || null,
      targetLines: batch.map((line, i) => ({ index: start + i + 1, text: line.text, impact: !!line.impact })),
    };
    let response;
    try {
      response = await fetch(endpoint(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, questions }), signal });
    } catch (error) {
      throw new Error('Jev ローカルサーバーに接続できません。起動状態とブラウザのローカルネットワーク許可を確認してください');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Jev API: HTTP ${response.status}`);
    const answers = data.answers || {};
    if (start === 0) {
      selections.mood = valid(answers.mood, moodOptions);
      selections.style = valid(answers.style, styleOptions);
      if (!selections.mood || !selections.style) throw new Error('Jev のスタイル選定結果を確認できませんでした');
    }
    batch.forEach((line, i) => {
      const n = start + i, picked = {};
      for (const g of Object.keys(CORE)) {
        const key = valid(answers[`${g}_${n}`], options[g]);
        if (key) picked[g] = key;
      }
      if (Object.keys(picked).length) selections.lines[n] = picked;
    });
  }
  return selections;
};

J.applyJev = (project, selections, rnd = Math.random) => {
  const look = J.omakase(project, rnd, selections);
  const overrides = look.overrides;
  for (const [index, picks] of Object.entries(selections.lines || {})) {
    if (overrides[index] && overrides[index].lock) continue;
    overrides[index] = Object.assign({}, overrides[index] && overrides[index].area ? { area: overrides[index].area } : {},
      Object.fromEntries(Object.entries(picks).filter(([g, key]) => CORE[g] && CORE[g].includes(key) && J.registry(g)[key] && (!J.randomOk || J.randomOk(project, g, key)))));
  }
  return look;
};
})();
