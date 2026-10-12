'use strict';

// Run with: node --test tests/core.test.cjs
// These tests exercise public data/assessment contracts; no DOM or camera is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../dist/core.js');

const clone = value => JSON.parse(JSON.stringify(value));
const when = '2026-10-12T09:00:00.000Z';
const later = '2026-10-12T09:01:00.000Z';
const marker = (id, answer) => ({id, answer});

function sampleDraft(count = 3) {
  return {...core.defaultDraft(), count, names: ['فاطمة', 'مريم', 'نورة'].slice(0, count)};
}

function sampleSession(id = 'sample-1', mode = 'live') {
  return {
    id, mode,
    question: core.question(sampleDraft()),
    roster: [{id: 1, name: 'فاطمة'}, {id: 2, name: 'مريم'}, {id: 3, name: 'نورة'}],
    responses: {1: {answer: 'B', at: later, source: mode === 'demo' ? 'demo' : 'camera'}},
    createdAt: when, finishedAt: later, lockedIds: [],
  };
}

function sampleBackup() {
  const current = sampleSession('current-1');
  current.finishedAt = null;
  return {version: 1, draft: sampleDraft(), history: [sampleSession()], current};
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// A small independent RFC-style reader lets assertions inspect actual CSV cells,
// including embedded quotes/newlines and malicious separators.
function parseCsv(csv) {
  let text = csv.replace(/^\ufeff/, '');
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {field += '"'; i++;}
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {row.push(field); field = '';}
    else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(field); rows.push(row); row = []; field = ''; i++;
    } else field += ch;
  }
  assert.equal(quoted, false, 'CSV must close every quoted field');
  row.push(field); rows.push(row);
  return rows;
}

test('a response needs multiple observations AND elapsed stability time', () => {
  const tracker = core.createTracker([1]);
  assert.deepEqual(tracker.push([marker(1, 'B')], 0).updates, []);
  assert.deepEqual(tracker.push([marker(1, 'B')], 60).updates, []);
  assert.deepEqual(tracker.push([marker(1, 'B')], 120).updates, []);
  assert.deepEqual(tracker.push([marker(1, 'B')], 240).updates, [{id: 1, answer: 'B'}]);
  assert.deepEqual(tracker.push([marker(1, 'B')], 360).updates, [], 'one pupil is not counted again');
});

test('elapsed time alone cannot turn only two observations into a response', () => {
  const tracker = core.createTracker([1]);
  tracker.push([marker(1, 'A')], 0);
  assert.deepEqual(tracker.push([marker(1, 'A')], 300).updates, []);
  assert.deepEqual(tracker.push([marker(1, 'A')], 420).updates, [{id: 1, answer: 'A'}]);
});

test('reprocessing an observation at the same timestamp is not a new frame', () => {
  const tracker = core.createTracker([1]);
  tracker.push([marker(1, 'A')], 0);
  tracker.push([marker(1, 'A')], 0);
  assert.deepEqual(tracker.push([marker(1, 'A')], 240).updates, []);
  assert.deepEqual(tracker.push([marker(1, 'A')], 360).updates, [{id: 1, answer: 'A'}]);
});

test('only a stable changed answer replaces a prior accepted answer', () => {
  const tracker = core.createTracker([1]);
  tracker.push([marker(1, 'A')], 0);
  tracker.push([marker(1, 'A')], 120);
  assert.deepEqual(tracker.push([marker(1, 'A')], 240).updates, [{id: 1, answer: 'A'}]);
  assert.deepEqual(tracker.push([marker(1, 'B')], 300).updates, []);
  assert.deepEqual(tracker.push([marker(1, 'A')], 360).updates, []);
  tracker.push([marker(1, 'C')], 400);
  tracker.push([marker(1, 'C')], 520);
  assert.deepEqual(tracker.push([marker(1, 'C')], 640).updates, [{id: 1, answer: 'C'}]);
});

test('a missing frame interrupts pending stability', () => {
  const tracker = core.createTracker([1]);
  tracker.push([marker(1, 'D')], 0);
  tracker.push([marker(1, 'D')], 120);
  tracker.push([], 240);
  assert.deepEqual(tracker.push([marker(1, 'D')], 300).updates, []);
  tracker.push([marker(1, 'D')], 420);
  assert.deepEqual(tracker.push([marker(1, 'D')], 540).updates, [{id: 1, answer: 'D'}]);
});

test('an expired gap and a backwards clock both restart pending stability', () => {
  for (const interruptedAt of [1000, 100]) {
    const tracker = core.createTracker([1]);
    tracker.push([marker(1, 'B')], 100);
    tracker.push([marker(1, 'B')], 200);
    assert.deepEqual(tracker.push([marker(1, 'B')], interruptedAt).updates, []);
    assert.deepEqual(tracker.push([marker(1, 'B')], interruptedAt + 120).updates, []);
    assert.deepEqual(tracker.push([marker(1, 'B')], interruptedAt + 240).updates, [{id: 1, answer: 'B'}]);
  }
});

test('conflicting or duplicate cards do not silently choose an answer', () => {
  for (const secondAnswer of ['A', 'B']) {
    const tracker = core.createTracker([1]);
    tracker.push([marker(1, 'A')], 0);
    tracker.push([marker(1, 'A')], 120);
    const conflict = tracker.push([marker(1, 'A'), marker(1, secondAnswer)], 240);
    assert.deepEqual(conflict.updates, []);
    assert.deepEqual(conflict.ambiguous, [1]);
    assert.deepEqual(tracker.push([marker(1, 'A')], 360).updates, []);
  }
});

test('unregistered IDs and invalid answer letters never produce results', () => {
  const tracker = core.createTracker([2, 7]);
  let result;
  for (const time of [0, 120, 240]) {
    result = tracker.push([marker(1, 'B'), marker(41, 'A'), marker(2, 'X'), marker('7', 'A'), marker(7, 'D')], time);
  }
  assert.deepEqual(result.updates, [{id: 7, answer: 'D'}]);
  assert.deepEqual(result.unknown, [1, 41]);
});

test('reset prevents old stability and previous accepted answers leaking to a new attempt', () => {
  const tracker = core.createTracker([1]);
  for (const time of [0, 120, 240]) tracker.push([marker(1, 'A')], time);
  tracker.reset();
  assert.deepEqual(tracker.push([marker(1, 'A')], 360).updates, []);
  tracker.push([marker(1, 'A')], 480);
  assert.deepEqual(tracker.push([marker(1, 'A')], 600).updates, [{id: 1, answer: 'A'}]);
});

test('scoring separates incorrect answers from unread pupils and ignores alien responses', () => {
  const session = sampleSession();
  session.responses[2] = {answer: 'A', at: later, source: 'image'};
  session.responses[40] = {answer: 'B', at: later, source: 'camera'};
  const result = core.summary(session);
  assert.deepEqual(result, {total: 3, answered: 2, correct: 1, incorrect: 1, unread: 1, distribution: {A: 1, B: 1, C: 0, D: 0}});
  assert.equal(result.correct / result.answered, 0.5, 'accuracy denominator is the two responses');
  assert.equal(result.answered / result.total, 2 / 3, 'coverage is reported separately');
  session.responses = {};
  assert.deepEqual(core.summary(session), {total: 3, answered: 0, correct: 0, incorrect: 0, unread: 3, distribution: {A: 0, B: 0, C: 0, D: 0}});
});

test('a session is an independent snapshot of question, choices and pupil/card mapping', () => {
  const draft = sampleDraft();
  const first = core.createSession(draft);
  const second = core.createSession(draft, 'demo');
  assert.notEqual(first.id, second.id);
  draft.options.B = 'إجابة معدلة';
  draft.correct = 'A';
  draft.names[0] = 'اسم جديد';
  assert.equal(first.question.options.B, '٢٠ تقريبًا');
  assert.equal(first.question.correct, 'B');
  assert.equal(first.roster[0].name, 'فاطمة');
  assert.deepEqual(first.roster.map(r => r.id), [1, 2, 3]);
  assert.equal(second.mode, 'demo');
  assert.deepEqual(second.responses, {});
});

test('a session cannot be created under an unsupported assessment mode', () => {
  assert.throws(() => core.createSession(sampleDraft(), 'practice-with-real-results'));
});

test('nonempty names cannot silently exceed the number of printed cards', () => {
  assert.throws(() => core.draft({...sampleDraft(2), names: ['فاطمة', 'مريم', 'نورة']}), /الأسماء أكبر/);
  assert.equal(core.draft({...sampleDraft(2), names: ['فاطمة', 'مريم', '', '   ']}).names.length, 2);
  assert.throws(() => core.draft({...sampleDraft(), names: Array(41).fill('')}));
  assert.throws(() => core.draft({...sampleDraft(), names: [12]}));
});

test('the draft accepts normal form values but rejects unrelated coercible count types', () => {
  assert.equal(core.draft({...sampleDraft(), count: '3'}).count, 3);
  for (const count of [true, [3]]) assert.throws(() => core.draft({...sampleDraft(), count, names: []}));
  for (const count of [0, 41, 2.5, NaN, Infinity, '', null]) assert.throws(() => core.draft({...sampleDraft(), count}));
});

test('four different choices and a valid answer key are required', () => {
  assert.throws(() => core.question({...sampleDraft(), options: {A: '١', B: ' ١ ', C: '٢', D: '٣'}}));
  assert.throws(() => core.question({...sampleDraft(), correct: 'E'}));
  assert.throws(() => core.question({...sampleDraft(), text: ' '}));
  assert.throws(() => core.question({...sampleDraft(), text: 'أ'.repeat(501)}));
});

test('valid backup import returns detached, sanitized data without mutating its input', () => {
  const source = sampleBackup();
  source.extra = 'ignored';
  source.current.question.options.extra = 'ignored';
  source.current.responses[1].extra = 'ignored';
  const original = clone(source);
  const result = core.validateBackup(deepFreeze(source));
  assert.deepEqual(source, original);
  assert.equal(result.extra, undefined);
  assert.equal(result.current.question.options.extra, undefined);
  assert.equal(result.current.responses[1].extra, undefined);
  result.current.question.options.A = 'new';
  result.current.roster[0].name = 'new';
  result.current.responses[1].answer = 'A';
  result.draft.names[0] = 'new';
  assert.deepEqual(source, original);
});

test('invalid backup structures and assessment inconsistencies are rejected', async t => {
  const cases = {
    'unknown version': v => {v.version = 2;},
    'missing current state': v => {delete v.current;},
    'history is not an array': v => {v.history = {};},
    'oversized history': v => {v.history = Array.from({length: 101}, (_, i) => sampleSession('h-' + i));},
    'duplicate attempt IDs': v => {v.history.push(clone(v.history[0]));},
    'duplicate roster IDs': v => {v.current.roster[1].id = 1;},
    'out of range roster ID': v => {v.current.roster[0].id = 41;},
    'numeric string roster ID': v => {v.current.roster[0].id = '1';},
    'unregistered response': v => {v.current.responses[40] = clone(v.current.responses[1]);},
    'noncanonical response ID': v => {v.current.responses['01'] = clone(v.current.responses[1]);},
    'unknown answer': v => {v.current.responses[1].answer = 'E';},
    'unknown source': v => {v.current.responses[1].source = 'manual';},
    'demo response in live session': v => {v.current.responses[1].source = 'demo';},
    'live response in demo session': v => {v.current.mode = 'demo';},
    'invalid response date': v => {v.current.responses[1].at = 'not a date';},
    'invalid finish date': v => {v.history[0].finishedAt = 'not a date';},
    'locked pupil without response': v => {v.current.lockedIds = [2];},
    'duplicated locked pupil': v => {v.current.lockedIds = [1, 1];},
    'more names than cards': v => {v.draft.count = 2;},
  };
  for (const [name, mutate] of Object.entries(cases)) {
    await t.test(name, () => {
      const data = sampleBackup();
      mutate(data);
      assert.throws(() => core.validateBackup(data));
    });
  }
});

test('failed import leaves previous application data intact under the validate-then-commit contract', () => {
  let active = deepFreeze(core.validateBackup(sampleBackup()));
  const before = clone(active);
  const bad = sampleBackup();
  // The failure is late: a valid history entry has already been read.
  bad.current.responses[1].answer = 'invalid';
  assert.throws(() => {
    const candidate = core.validateBackup(bad);
    active = candidate;
  });
  assert.deepEqual(active, before);
  assert.equal(Object.isFrozen(active), true);
});

test('prototype-shaped JSON fields do not escape the accepted backup schema', () => {
  const backup = sampleBackup();
  const fromJson = JSON.parse(JSON.stringify(backup).replace('"version":1', '"version":1,"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}'));
  const result = core.validateBackup(fromJson);
  assert.equal(Object.hasOwn(result, '__proto__'), false);
  assert.equal(Object.hasOwn(result, 'constructor'), false);
  assert.equal({}.polluted, undefined);
});

test('Arabic CSV preserves text, quote/comma/newline boundaries and unread state', () => {
  const session = sampleSession();
  session.question.title = 'بذور "الفاصوليا"، ٤٨ بذرة';
  session.question.text = 'السطر الأول, فيه فاصلة\nالسطر الثاني';
  session.roster[0].name = 'فاطمة "هزازي"';
  const encoded = core.csv(session);
  assert.equal(encoded[0], '\ufeff');
  const rows = parseCsv(Buffer.from(encoded, 'utf8').toString('utf8'));
  assert.equal(rows.length, 4);
  assert.ok(rows.every(r => r.length === 12));
  assert.equal(rows[1][2], session.question.title);
  assert.equal(rows[1][3], session.question.text);
  assert.equal(rows[1][4], '١');
  assert.equal(rows[1][5], session.roster[0].name);
  assert.equal(rows[1][6], 'ب');
  assert.equal(rows[1][8], 'صحيحة');
  assert.equal(rows[2][6], '');
  assert.equal(rows[2][8], 'لم تُقرأ');
});

test('CSV formula starters in teacher/imported text are exported as text cells', () => {
  for (const payload of ['=1+1', '+SUM(A1:A2)', '-2+3', '@SUM(A1)', '  =2+2', '\t=2+2', '\r\n=2+2', '\ufeff=2+2', '=HYPERLINK("https://example.test","نص")']) {
    const session = sampleSession();
    session.question.title = payload;
    session.question.text = payload;
    session.roster[0].name = payload;
    session.question.options.B = payload;
    const row = parseCsv(core.csv(session))[1];
    for (const index of [2, 3, 5, 7, 10]) assert.equal(row[index], "'" + payload);
  }
});
