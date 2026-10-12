'use strict';

// Run: node --test tests/learning-core.test.cjs
// Behavioural tests for learner signals, parallel thinking, persistence and CSV.
// No browser, camera or network is used by this test file.
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../dist/learning-core.js');

const WHEN = '2026-10-12T17:30:00.000Z';
const LATER = '2026-10-12T17:35:00.000Z';
const clone = value => JSON.parse(JSON.stringify(value));
const signal = (id, key, mode = 'feelings') => ({id, key, mode});
const settings = () => ({...core.defaults().settings, count: 3, names: ['ريم', 'هند', 'مها']});
const round = (mode = 'feelings', options = {}) => core.createRound(mode, settings(), options);

function withSignals(mode = 'feelings', demo = false) {
  const r = round(mode, {demo, hatKey: mode === 'hats' ? 'white' : undefined});
  r.createdAt = WHEN;
  core.commit(r, [signal(1, mode === 'hats' ? 'white' : 'red', mode)], demo ? 'demo' : 'camera', LATER);
  r.notes[1] = {text: 'متابعة قصيرة على انفراد', handled: false};
  r.actions.push({text: 'أتح وقتًا للحديث', at: LATER});
  return r;
}

function assertNoGrades(value) {
  for (const key of ['correct', 'incorrect', 'correctness', 'isCorrect', 'score', 'grade', 'accuracy', 'mastery', 'improved', 'declined']) {
    assert.equal(Object.hasOwn(value, key), false, 'self-reports and hats must not become grades: ' + key);
  }
}

// Independent quoted-CSV reader to inspect the exported cells, including quotes,
// commas and newlines. Checking string substrings alone can miss CSV injection.
function parseCsv(input) {
  const csv = input.replace(/^\ufeff/, '');
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (quoted) {
      if (ch === '"' && csv[i + 1] === '"') {cell += '"'; i++;}
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {row.push(cell); cell = '';}
    else if (ch === '\r' && csv[i + 1] === '\n') {
      row.push(cell); rows.push(row); row = []; cell = ''; i++;
    } else cell += ch;
  }
  assert.equal(quoted, false, 'CSV must not leave an open quoted cell');
  row.push(cell); rows.push(row);
  return rows;
}

test('each mode has six distinguishable signals without any correctness or score', () => {
  for (const mode of ['feelings', 'hats']) {
    const r = round(mode);
    assert.equal(r.choices.length, 6);
    assert.equal(new Set(r.choices.map(c => c.key)).size, 6);
    assertNoGrades(r);
    assertNoGrades(core.summary(r));
    assert.deepEqual(core.summary(r), {
      total: 3, answered: 0, unread: 3, handled: 0, pending: 0,
      distribution: Object.fromEntries(core.getKeys(mode).map(key => [key, 0]))
    });
  }
});

test('an unrecorded card remains unread and does not become any emotion or hat', () => {
  const r = round();
  core.commit(r, [signal(2, 'white')], 'camera', WHEN);
  const s = core.summary(r);
  assert.equal(s.answered, 1);
  assert.equal(s.unread, 2);
  assert.equal(s.distribution.white, 1, 'only an explicit white card requests a private conversation');
  assert.equal(Object.keys(r.responses).length, 1);
});

test('feelings labels can be customized and each round keeps its own snapshot', () => {
  const config = settings();
  config.labels.yellow = {label: 'أحتاج وقتًا', hint: 'أريد إكمال محاولتي'};
  const r = core.createRound('feelings', config);
  config.labels.yellow.label = 'عبارة تغيرت لاحقًا';
  assert.equal(r.choices.find(c => c.key === 'yellow').label, 'أحتاج وقتًا');
  assert.equal(r.choices.find(c => c.key === 'yellow').hint, 'أريد إكمال محاولتي');
  assert.equal(core.validateRound(r).choices.find(c => c.key === 'yellow').label, 'أحتاج وقتًا');
});

test('changing feelings labels does not replace the six-hats meanings', () => {
  const config = settings();
  config.labels.red = {label: 'أحتاج مراجعة', hint: 'للمثال السابق'};
  const r = core.createRound('hats', config, {hatKey: 'red'});
  assert.equal(r.choices.find(c => c.key === 'red').label, core.hats.find(c => c.key === 'red').label);
  assert.equal(r.prompt, config.hatPrompts.red);
});

test('each learner has one latest signal and is never counted twice', () => {
  const r = round();
  assert.equal(core.commit(r, [signal(1, 'red'), signal(2, 'blue')], 'camera', WHEN), 2);
  assert.equal(core.commit(r, [signal(1, 'green')], 'image', LATER), 1);
  assert.deepEqual(r.responses[1], {key: 'green', source: 'image', at: LATER});
  const s = core.summary(r);
  assert.equal(s.answered, 2);
  assert.equal(s.distribution.red, 0);
  assert.equal(s.distribution.green, 1);
  assert.equal(s.distribution.blue, 1);
  assert.equal(s.unread, 1);
});

test('repeated observations do not reopen completed follow-up or duplicate the signal', () => {
  const r = withSignals();
  r.notes[1].handled = true;
  assert.equal(core.commit(r, [signal(1, 'red')], 'camera', LATER), 0);
  assert.equal(r.notes[1].handled, true);
  assert.equal(core.summary(r).handled, 1);
});

test('a changed signal preserves a teacher note and reopens its follow-up', () => {
  const r = withSignals();
  const note = r.notes[1].text;
  r.notes[1].handled = true;
  core.commit(r, [signal(1, 'white')], 'manual', LATER);
  assert.equal(r.notes[1].text, note);
  assert.equal(r.notes[1].handled, false);
  assert.equal(core.summary(r).handled, 0);
  assert.equal(core.summary(r).pending, 1);
  assert.equal(core.validateRound(r).notes[1].text, note);
});

test('cards outside the roster, the wrong mode and unknown colors are ignored', () => {
  const r = round();
  const changed = core.commit(r, [
    signal(0, 'red'), signal(4, 'red'), signal(41, 'green'), signal('1', 'green'),
    signal(1, 'black'), signal(1, 'orange'), signal(1, '__proto__'),
    signal(1, 'red', 'hats'), signal(2, 'green')
  ], 'camera', WHEN);
  assert.equal(changed, 1);
  assert.deepEqual(Object.keys(r.responses), ['2']);
});

test('a roster of forty accepts card forty; a roster of three does not', () => {
  const large = core.createRound('feelings', {...settings(), count: 40});
  const small = round();
  assert.equal(core.commit(large, [signal(40, 'blue')], 'camera', WHEN), 1);
  assert.equal(core.commit(small, [signal(40, 'blue')], 'camera', WHEN), 0);
  assert.equal(core.summary(large).unread, 39);
});

test('each of the six active hats only records matching cards', () => {
  for (const hatKey of core.getKeys('hats')) {
    const r = round('hats', {hatKey});
    for (const key of core.getKeys('hats')) {
      const result = core.commit(r, [signal(1, key, 'hats')], 'camera', WHEN);
      assert.equal(result, key === hatKey ? 1 : 0, `${hatKey}: ${key}`);
    }
    assert.equal(r.responses[1].key, hatKey);
    assert.equal(core.summary(r).answered, 1);
    assertNoGrades(core.summary(r));
  }
});

test('demo input and live input cannot be mixed in either direction', () => {
  for (const mode of ['feelings', 'hats']) {
    const key = mode === 'feelings' ? 'red' : 'blue';
    for (const demo of [false, true]) {
      for (const source of ['camera', 'image', 'manual', 'demo', 'unknown']) {
        const r = round(mode, {demo});
        const allowed = demo ? source === 'demo' : ['camera', 'image', 'manual'].includes(source);
        assert.equal(core.commit(r, [signal(1, key, mode)], source, WHEN), allowed ? 1 : 0, `${mode}/${demo}/${source}`);
        assert.equal(core.summary(r).answered, allowed ? 1 : 0);
        assert.doesNotThrow(() => core.validateRound(r));
      }
    }
  }
});

test('finishing a round freezes signals and stores a separate history snapshot', () => {
  const state = core.defaults();
  const r = withSignals();
  core.finish(state, r);
  assert.ok(r.finishedAt);
  assert.equal(state.history.length, 1);
  assert.equal(core.commit(r, [signal(1, 'green')], 'camera', LATER), 0);
  r.notes[1].text = 'ملاحظة جديدة';
  assert.notEqual(state.history[0].notes[1].text, r.notes[1].text);
  core.updateHistory(state, r);
  assert.equal(state.history[0].notes[1].text, 'ملاحظة جديدة');
  core.finish(state, r);
  assert.equal(state.history.length, 1, 'finishing again must not duplicate the round');
});

test('the history retains only the latest hundred distinct completed rounds', () => {
  const state = core.defaults();
  for (let i = 0; i < 103; i++) {
    const r = round();
    r.id = 'history-' + i;
    core.finish(state, r);
  }
  assert.equal(state.history.length, 100);
  assert.equal(state.history[0].id, 'history-102');
  assert.equal(state.history.at(-1).id, 'history-3');
});

test('before/after comparison counts only learners whose two explicit signals exist', () => {
  const before = round('feelings', {stage: 'before'});
  core.commit(before, [signal(1, 'red'), signal(2, 'blue')], 'camera', WHEN);
  const after = round('feelings', {stage: 'after', parentId: before.id, groupId: before.groupId});
  core.commit(after, [signal(1, 'green'), signal(3, 'white')], 'camera', LATER);
  const c = core.comparison(before, after);
  assert.deepEqual(c, {paired: 1, changed: 1, rows: [{id: 1, name: 'ريم', before: 'red', after: 'green'}]});
  assertNoGrades(c);
  assert.equal(core.summary(before).unread, 1);
  assert.equal(core.summary(after).unread, 1);
});

test('missing after readings do not count as a positive change, failure or unchanged response', () => {
  const before = round('feelings', {stage: 'before'});
  core.commit(before, [signal(1, 'green')], 'camera', WHEN);
  const after = round('feelings', {stage: 'after', parentId: before.id, groupId: before.groupId});
  assert.deepEqual(core.comparison(before, after), {paired: 0, changed: 0, rows: []});
});

test('comparison refuses hats, unrelated rounds, and demo/live pairs', () => {
  const before = round();
  const after = round('feelings', {parentId: before.id});
  const unrelated = clone(after); unrelated.parentId = 'another-round';
  const demo = clone(after); demo.demo = true;
  assert.equal(core.comparison(before, unrelated), null);
  assert.equal(core.comparison(before, demo), null);
  assert.equal(core.comparison(null, after), null);
  assert.equal(core.comparison(before, null), null);
  const hat = round('hats', {parentId: before.id});
  assert.equal(core.comparison(before, hat), null);
});

test('comparison refuses changed color meanings or reassigned learner identities', () => {
  const before = round('feelings', {stage: 'before'});
  const after = round('feelings', {stage: 'after', parentId: before.id, groupId: before.groupId});
  assert.ok(core.comparison(before, after));
  const relabeled = clone(after);
  relabeled.choices[0].label = 'أريد وقتًا';
  assert.equal(core.comparison(before, relabeled), null);
  const redefined = clone(after);
  redefined.choices[0].hint = 'تغير معنى الرسالة';
  assert.equal(core.comparison(before, redefined), null);
  const renamed = clone(after);
  renamed.roster[0].name = 'متعلم آخر';
  assert.equal(core.comparison(before, renamed), null);
  const smaller = clone(after);
  smaller.roster.pop();
  assert.equal(core.comparison(before, smaller), null);
});

test('a backup round-trip retains live and demo rounds, notes, follow-up and teaching actions', () => {
  const state = core.defaults();
  state.current.feelings = withSignals();
  state.current.feelings.notes[1].handled = true;
  state.current.hats = withSignals('hats', true);
  const done = withSignals();
  core.finish(state, done);
  const restored = core.validateState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored, state);
  restored.current.feelings.notes[1].text = 'محلي بعد الاستعادة';
  assert.notEqual(state.current.feelings.notes[1].text, restored.current.feelings.notes[1].text);
});

test('backup import sanitizes structural metadata without treating a string as HTML or code', () => {
  const state = core.defaults();
  const r = withSignals();
  r.roster[0].name = '<img src=x onerror="alert(1)">';
  r.notes[1].text = '<script>globalThis.pwned = true</script>';
  r.choices[0].color = 'url(javascript:alert(1))';
  r.choices[0].action = '<img src=x onerror=alert(1)>';
  r.score = 100;
  state.current.feelings = r;
  state.settings.labels.red.onclick = 'alert(1)';
  const imported = JSON.parse(JSON.stringify(state));
  imported.__proto__ = {polluted: true};
  const restored = core.validateState(imported);
  assert.equal(Object.hasOwn(restored, '__proto__'), false);
  assert.equal(Object.hasOwn(restored, 'polluted'), false);
  assert.equal({}.polluted, undefined);
  assert.equal(globalThis.pwned, undefined);
  assert.equal(restored.current.feelings.roster[0].name, r.roster[0].name, 'text is retained as text; DOM rendering must escape it');
  assert.equal(restored.current.feelings.notes[1].text, r.notes[1].text);
  assert.equal(restored.current.feelings.choices[0].color, core.COLORS.red);
  assert.equal(restored.current.feelings.choices[0].action, core.feelings[0].action);
  assertNoGrades(restored.current.feelings);
  assert.deepEqual(Object.keys(restored.settings.labels.red).sort(), ['hint', 'label']);
});

test('round validation rejects malformed IDs, colors, source types and follow-up structures', async t => {
  const mutations = [
    ['round identifier injection', r => {r.id = '<img>';}],
    ['zero learner id', r => {r.roster[0].id = 0;}],
    ['learner id above forty', r => {r.roster[0].id = 41;}],
    ['string learner id', r => {r.roster[0].id = '1';}],
    ['duplicate learner id', r => {r.roster[1].id = 1;}],
    ['missing learner name', r => {delete r.roster[0].name;}],
    ['response outside roster', r => {r.responses[40] = r.responses[1];}],
    ['noncanonical response id', r => {r.responses['01'] = r.responses[1];}],
    ['prototype response key', r => {Object.defineProperty(r.responses, '__proto__', {value: r.responses[1], enumerable: true});}],
    ['wrong color for feelings', r => {r.responses[1].key = 'black';}],
    ['unknown color', r => {r.responses[1].key = '#ff0000';}],
    ['missing color', r => {delete r.responses[1].key;}],
    ['unknown source', r => {r.responses[1].source = 'remote';}],
    ['demo data in live round', r => {r.responses[1].source = 'demo';}],
    ['invalid response date', r => {r.responses[1].at = 'not-a-date';}],
    ['responses array', r => {r.responses = [];}],
    ['missing response for note', r => {r.notes[2] = {text: 'test', handled: false};}],
    ['note outside roster', r => {r.notes[41] = {text: '', handled: false};}],
    ['nonboolean follow-up', r => {r.notes[1].handled = 'false';}],
    ['overlong note', r => {r.notes[1].text = 'x'.repeat(601);}],
    ['excess actions', r => {r.actions = Array.from({length: 31}, () => ({text: 'a', at: WHEN}));}],
    ['invalid action date', r => {r.actions[0].at = 'invalid';}],
    ['empty action', r => {r.actions[0].text = ' ';}],
    ['extra choice', r => {r.choices.push(r.choices[0]);}],
    ['duplicate choice', r => {r.choices[1] = r.choices[0];}],
    ['unknown choice key', r => {r.choices[0].key = '__proto__';}],
    ['empty choice label', r => {r.choices[0].label = ' ';}],
    ['object choice label', r => {r.choices[0].label = {text: 'red'};}],
    ['invalid stage', r => {r.stage = 'improved';}],
    ['invalid creation date', r => {r.createdAt = ''; }],
    ['invalid end date', r => {r.finishedAt = 'invalid';}]
  ];
  for (const [name, mutate] of mutations) await t.test(name, () => {
    const r = withSignals();
    mutate(r);
    assert.throws(() => core.validateRound(r));
  });
});

test('hats backup import rejects an inactive hat response and invalid flow state', async t => {
  for (const [name, mutate] of [
    ['inactive hat', r => {r.responses[1].key = 'red';}],
    ['unknown active hat', r => {r.hatKey = 'purple';}],
    ['negative flow position', r => {r.flowIndex = -1;}],
    ['flow position beyond sequence', r => {r.flowIndex = core.FLOW.length;}],
    ['string flow position', r => {r.flowIndex = '0';}],
    ['live source in demo', r => {r.demo = true;}]
  ]) await t.test(name, () => {
    const r = withSignals('hats');
    mutate(r);
    assert.throws(() => core.validateRound(r));
  });
});

test('settings reject ambiguous labels, invalid counts and incomplete definitions', async t => {
  for (const [name, mutate] of [
    ['zero count', s => {s.count = 0;}],
    ['more than forty', s => {s.count = 41;}],
    ['fraction count', s => {s.count = 2.5;}],
    ['nonnumeric count', s => {s.count = 'abc';}],
    ['too many named learners', s => {s.names.push('رابع');}],
    ['nonstring name', s => {s.names[0] = 123;}],
    ['duplicate labels', s => {s.labels.green.label = s.labels.red.label;}],
    ['missing label', s => {delete s.labels.white;}],
    ['overlong label', s => {s.labels.blue.label = 'a'.repeat(56);}],
    ['overlong prompt', s => {s.feelingsPrompt = 'a'.repeat(501);}],
    ['missing hat prompt', s => {delete s.hatPrompts.blue;}]
  ]) await t.test(name, () => {
    const s = settings();
    mutate(s);
    assert.throws(() => core.settings(s));
  });
});

test('backup validation rejects unrelated formats and inconsistent current sections', async t => {
  for (const [name, mutate] of [
    ['wrong product', s => {s.product = 'another-product';}],
    ['old version', s => {s.version = 1;}],
    ['unknown section', s => {s.activeMode = 'quiz';}],
    ['missing current round', s => {delete s.current.feelings;}],
    ['feelings round in hats section', s => {s.current.hats = withSignals();}],
    ['duplicate history rounds', s => {const r = withSignals(); s.history = [r, clone(r)];}],
    ['history beyond limit', s => {s.history = new Array(101).fill(null);}],
    ['history is not an array', s => {s.history = {};}]
  ]) await t.test(name, () => {
    const s = core.defaults();
    mutate(s);
    assert.throws(() => core.validateState(s));
  });
});

test('CSV neutralizes spreadsheet formulas in all editable cells', () => {
  for (const attack of ['=1+1', '+SUM(1,2)', '-1+2', '@SUM(1,2)', '\t=1+1', '  +1', '\r\n@SUM(1,2)']) {
    const r = withSignals();
    r.title = attack;
    r.prompt = attack;
    r.roster[0].name = attack;
    r.choices.find(c => c.key === 'red').label = attack;
    r.choices.find(c => c.key === 'red').hint = attack;
    r.notes[1].text = attack;
    const output = core.csv(r);
    const rows = parseCsv(output);
    assert.equal(rows.length, 4);
    assert.equal(rows[1].length, 15);
    for (const i of [3, 4, 7, 8, 9, 12]) assert.equal(rows[1][i], "'" + attack, `cell ${i}: ${JSON.stringify(attack)}`);
  }
});

test('CSV keeps quotes, commas and embedded newlines in one cell', () => {
  const r = withSignals();
  const text = 'قال: "لدي سؤال", ثم كتب\nمثالًا آخر';
  r.notes[1].text = text;
  r.roster[0].name = 'اسم, "مركب"';
  const rows = parseCsv(core.csv(r));
  assert.equal(rows.length, 4);
  for (const row of rows) assert.equal(row.length, 15);
  assert.equal(rows[1][12], text);
  assert.equal(rows[1][7], 'اسم, "مركب"');
  assert.equal(rows[2][8], 'لم تسجل إشارة');
  assert.equal(rows[2][11], '', 'unread is not awaiting teacher follow-up');
  assert.equal(rows[1][6], '١');
  assert.ok(!rows[0].some(cell => /درجة|صحيحة|خاطئة|إتقان/.test(cell)));
});

test('CSV includes activity stage and dated teaching actions as one safe cell', () => {
  const r = withSignals();
  r.stage = 'after';
  r.actions = [{text: 'ناقشت "سؤالًا", ثم قدمت\nمثالًا', at: WHEN}, {text: '=HYPERLINK("https://invalid")', at: LATER}];
  const rows = parseCsv(core.csv(r));
  assert.equal(rows[0][13], 'توقيت الجولة');
  assert.equal(rows[0][14], 'إجراءات المعلم وتوقيتها');
  assert.equal(rows[1][13], 'بعد النشاط');
  assert.equal(rows[1][14], WHEN + ' — ' + r.actions[0].text + ' | ' + LATER + ' — ' + r.actions[1].text);
  assert.equal(rows[1].length, 15);
  assert.equal(rows.length, 4);
  assert.equal(rows[1][14].startsWith('='), false);
});
