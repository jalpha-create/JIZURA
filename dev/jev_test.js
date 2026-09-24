const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const names = ['layout', 'enter', 'exit'];
const registries = Object.fromEntries(names.map(g => [g, {}]));
for (const g of names) for (const key of ({
  layout: ['center', 'huge'], enter: ['blur', 'pop'], exit: ['drift', 'fall'],
})[g]) registries[g][key] = { name: key };
const J = {
  MOODS: { calm: { name: 'Calm' }, pop: { name: 'Pop' }, chaos: { name: 'Chaos' } },
  STYLE_ORDER: ['noir', 'paper', 'sakura'],
  STYLES: { noir: { name: 'Noir', desc: 'dark' }, paper: { name: 'Paper', desc: 'soft' }, sakura: { name: 'Sakura', desc: 'extra' } },
  randomOk: (project, group, key) => !(group === 'style' && key === 'sakura' && project.extra !== true),
  registry: g => registries[g],
  parseLyrics: lyrics => ({ lines: lyrics.split('\n').map(text => ({ text })) }),
  omakase: (project, rnd, choices) => ({ mood: choices.mood, style: choices.style, overrides: { 0: { area: project.overrides[0].area }, 1: { lock: true, layout: 'huge' } } }),
};
const requests = [];
const context = { J, location: { origin: 'https://hirazisora.github.io' }, fetch: async (url, options) => {
  const payload = JSON.parse(options.body);
  requests.push({ url, payload });
  const answers = {};
  for (const [key, q] of Object.entries(payload.questions)) {
    const pick = ({ mood: 'calm', style: 'paper' })[key] || Object.keys(q.criteria)[0];
    answers[key] = { type: 'choice', choice: pick };
  }
  return { ok: true, json: async () => ({ answers }) };
} };
vm.createContext(context);
vm.runInContext(fs.readFileSync('src/08c_jev.js', 'utf8'), context);

(async () => {
  const project = { lyrics: Array.from({ length: 13 }, (_, i) => `line ${i}`).join('\n'), jevPrompt: 'サビは大胆に', overrides: { 0: { area: { x: 0.2, y: 0.1, w: 0.5, h: 0.6 } } } };
  const selected = await J.jevSuggest(project);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, 'http://127.0.0.1:8765/api/jev');
  assert.equal(Object.keys(requests[0].payload.questions).length, 38);
  assert.equal(Object.keys(requests[1].payload.questions).length, 3);
  assert.equal(Object.hasOwn(requests[0].payload.questions.style.criteria, 'sakura'), false);
  assert.equal(requests[0].payload.state.userDirection, 'サビは大胆に');
  assert.equal(requests[1].payload.state.userDirection, 'サビは大胆に');
  assert.match(requests[0].payload.questions.mood.instructions, /追加指示/);
  assert.equal(selected.mood, 'calm');
  assert.equal(selected.style, 'paper');
  assert.equal(Object.keys(selected.lines).length, 13);
  const look = J.applyJev(project, selected);
  assert.equal(look.overrides[0].layout, 'center');
  assert.equal(look.overrides[0].area.x, 0.2);
  assert.equal(look.overrides[1].layout, 'huge');
  assert.equal(look.overrides[1].lock, true);
  context.location.origin = 'http://127.0.0.1:8765';
  await J.jevSuggest({ lyrics: 'one line' });
  assert.equal(requests.at(-1).url, '/api/jev');
  assert.equal(Object.hasOwn(requests.at(-1).payload.state, 'userDirection'), false);
  await J.jevSuggest({ lyrics: 'one line', extra: true });
  assert.equal(Object.hasOwn(requests.at(-1).payload.questions.style.criteria, 'sakura'), true);
  console.log('Jev selection and locked-line tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
