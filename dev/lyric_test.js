const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const context = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', '01_util.js'), 'utf8'), context);
for (const key of ['LAYOUT_ORDER', 'ENTER_ORDER', 'EXIT_ORDER', 'HOLD_ORDER', 'DECOR_ORDER']) context.window.J[key] = [];
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', '08_planner.js'), 'utf8'), context);
const J = context.window.J;
const mixed = J.parseLyrics('[00:02]First\nInserted\n[00:05]Last').lines;
assert.deepEqual(Array.from(mixed, line => line.text), ['First', 'Inserted', 'Last'], 'mixed LRC and plain lyrics keep the written order');
const timed = J.parseLyrics('[00:05]Last\n[00:02]First').lines;
assert.deepEqual(Array.from(timed, line => line.text), ['First', 'Last'], 'fully timed LRC lyrics still sort by timestamp');
assert.deepEqual(Array.from(J.parseLyrics('\\#literal\n\\[00:02]literal').lines, line => line.text), ['#literal', '[00:02]literal']);
console.log('Lyric parsing tests passed');
