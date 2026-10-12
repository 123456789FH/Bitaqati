'use strict';

// Run: node --test tests/learning-app.test.cjs
// Requires linkedom (review environment has a temporary installation).
// These tests execute the real page scripts against a DOM. They do not open a
// browser or a server, assess visual layout, or claim physical camera accuracy.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHarness, enableRaster} = require('./learning-dom-harness.cjs');
const core = require('../dist/learning-core.js');
const DIST = path.resolve(__dirname, '../dist');
const STORAGE = 'bitaqati-learning-v2';
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');

function launch(initialStorage = {}, hash = '', raster = false) {
  const h = createHarness(html, initialStorage);
  if (raster) enableRaster(h);
  h.window.location = new URL('https://example.invalid/Bitaqati/' + hash);
  for (const script of h.document.querySelectorAll('script[src]')) h.runFile(path.join(DIST, script.getAttribute('src')));
  return h;
}
function state(h) {return JSON.parse(h.store.get(STORAGE));}
function current(h, mode = 'feelings') {return state(h).current[mode];}
function start(h, options = {}) {
  if (options.title) h.fill('#learn-topic', options.title);
  if (options.count) h.fill('#learn-count', options.count, 'change');
  if (options.names) h.fill('#learn-names', options.names.join('\n'));
  if (options.prompt) h.fill('#learn-prompt', options.prompt);
  h.click('#learn-start');
}
function record(h, id, key) {
  h.fill('#learn-manual-id', id, 'change');
  h.fill('#learn-manual-key', key, 'change');
  h.click('#learn-manual-save');
}
async function importFile(h, value, size) {
  const input = h.find('#learn-backup-file');
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  Object.defineProperty(input, 'files', {configurable: true, value: [{size: size ?? Buffer.byteLength(text), async text() {return text;}}]});
  input.dispatchEvent(new h.window.Event('change', {bubbles: true}));
  await h.flush();
}

test('the actual page opens on feelings and retains all three section controls', () => {
  const h = launch();
  assert.ok(h.window.BitaqatiLearning);
  assert.equal(h.find('#teacher-app').hidden, true);
  assert.equal(h.find('#learning-app').hidden, false);
  assert.equal(h.document.querySelectorAll('#learning-nav [data-mode]').length, 3);
  assert.equal(h.document.querySelectorAll('#learn-palette .signal-card').length, 6);
  assert.match(h.find('#learn-guidance').textContent, /يمكن للمتعلم عدم رفع بطاقة/);
  assert.equal(state(h).activeMode, 'feelings');
  assert.equal(h.calls.camera, 0);
  assert.equal(h.calls.consoleErrors.length, 0);
});

test('starting a live feelings round saves the chosen count, names and prompt', () => {
  const h = launch();
  start(h, {title: 'نشاط البذور', count: 2, names: ['ريم', 'هند'], prompt: 'كيف تشعر بعد النشاط؟'});
  const r = current(h);
  assert.equal(r.title, 'نشاط البذور');
  assert.equal(r.prompt, 'كيف تشعر بعد النشاط؟');
  assert.deepEqual(r.roster, [{id: 1, name: 'ريم'}, {id: 2, name: 'هند'}]);
  assert.equal(r.demo, false);
  assert.equal(h.find('#learn-session').hidden, false);
  assert.equal(h.find('#learn-setup').hidden, true);
  assert.equal(h.find('#learn-read').textContent, '٠');
  assert.equal(h.find('#learn-unread').textContent, '٢');
});

test('manual signal controls update a learner once and reopen changed follow-up', () => {
  const h = launch();
  start(h);
  record(h, 1, 'red');
  assert.equal(h.find('#learn-read').textContent, '١');
  assert.equal(h.find('#learn-unread').textContent, '٢');
  assert.equal(current(h).responses[1].source, 'manual');
  h.fill('#learn-note-1', 'سأراجع المثال مع المتعلم');
  h.click('[data-handle="1"]');
  assert.equal(h.find('#learn-handled').textContent, '١');
  record(h, 1, 'white');
  assert.equal(h.find('#learn-read').textContent, '١');
  assert.equal(h.find('#learn-handled').textContent, '٠');
  assert.equal(current(h).responses[1].key, 'white');
  assert.equal(current(h).notes[1].text, 'سأراجع المثال مع المتعلم');
  assert.equal(current(h).notes[1].handled, false);
});

test('finish freezes manual input; continue lets the teacher complete the round', () => {
  const h = launch();
  start(h); record(h, 1, 'red');
  h.click('#learn-finish');
  const finished = current(h);
  assert.ok(finished.finishedAt);
  assert.equal(h.find('#learn-camera-panel').hidden, true);
  assert.equal(h.find('#learn-continue').hidden, false);
  record(h, 1, 'green');
  assert.equal(current(h).responses[1].key, 'red');
  h.click('#learn-continue');
  record(h, 1, 'green');
  assert.equal(current(h).responses[1].key, 'green');
  assert.equal(current(h).finishedAt, null);
});

test('switching sections preserves separate feelings and hats rounds', () => {
  const h = launch();
  start(h); record(h, 1, 'white');
  const firstId = current(h).id;
  h.click('[data-mode="hats"]');
  assert.equal(state(h).activeMode, 'hats');
  h.click('[data-hat="red"]');
  h.fill('#learn-prompt', 'بماذا تشعر تجاه الفكرة؟');
  h.click('#learn-start');
  const hatsId = current(h, 'hats').id;
  record(h, 2, 'red');
  h.click('[data-mode="quiz"]');
  assert.equal(h.find('#learning-app').hidden, true);
  assert.equal(h.find('#teacher-app').hidden, false);
  h.click('[data-mode="feelings"]');
  assert.equal(current(h).id, firstId);
  assert.equal(current(h).responses[1].key, 'white');
  assert.equal(h.find('#learn-read').textContent, '١');
  assert.equal(current(h, 'hats').id, hatsId);
  assert.equal(current(h, 'hats').responses[2].key, 'red');
});

test('the active hat limits the manual choices and advances to the next common hat', () => {
  const h = launch();
  h.click('[data-mode="hats"]');
  h.click('[data-hat="white"]');
  h.fill('#learn-prompt', 'ما المعلومات التي نعرفها عن البذور؟');
  h.click('#learn-start');
  assert.equal(current(h, 'hats').hatKey, 'white');
  assert.equal(h.find('#learn-manual-key').querySelectorAll('option').length, 1);
  assert.equal(h.find('#learn-manual-key').value, 'white');
  assert.match(h.find('#learn-records-note').textContent, /طلب المشاركة/);
  record(h, 1, 'white');
  h.fill('#learn-note-1', 'لدينا ٤٨ بذرة');
  h.click('[data-handle="1"]');
  const firstId = current(h, 'hats').id;
  h.click('#learn-next-round');
  const next = current(h, 'hats');
  assert.equal(next.hatKey, 'green');
  assert.equal(next.parentId, firstId);
  assert.equal(next.roster.length, 3);
  assert.deepEqual(next.responses, {});
  assert.equal(h.find('#learn-manual-key').value, 'green');
  assert.equal(h.find('#learn-comparison').hidden, true, 'hats must not display a feelings comparison');
});

test('after-activity keeps the original meanings and learner identity despite later settings edits', () => {
  const h = launch();
  start(h, {title: 'النشاط الأصلي', names: ['ريم', 'هند', 'مها'], prompt: 'كيف تشعر الآن؟'});
  record(h, 1, 'red'); record(h, 2, 'blue');
  const before = current(h);
  h.click('#learn-back-settings');
  h.fill('#learn-topic', 'موضوع آخر');
  h.fill('#learn-count', 2, 'change');
  h.fill('#learn-names', 'سارة\nليان');
  h.fill('#learn-prompt', 'سؤال مختلف');
  h.fill('[data-label="red"]', 'أحتاج وقتًا');
  h.click('#learn-save-labels');
  h.click('[data-mode="hats"]');
  h.click('[data-mode="feelings"]');
  h.click('#learn-next-round');
  const after = current(h);
  assert.equal(after.parentId, before.id);
  assert.equal(after.groupId, before.groupId);
  assert.equal(after.title, before.title);
  assert.equal(after.prompt, before.prompt);
  assert.deepEqual(after.roster, before.roster);
  assert.deepEqual(after.choices, before.choices);
  assert.equal(after.stage, 'after');
  record(h, 1, 'green'); record(h, 3, 'white');
  assert.match(h.find('#learn-comparison').textContent, /قورنت إشارات ١/);
  assert.match(h.find('#learn-comparison').textContent, /تغيّرت البطاقة لدى ١/);
  assert.match(h.find('#learn-comparison').textContent, /لا يقيس الإتقان/);
});

test('opening the same history record after continuing retains the newest recorded signal', () => {
  const h = launch();
  start(h); record(h, 1, 'red');
  const id = current(h).id;
  h.click('#learn-finish');
  h.click('#learn-continue');
  record(h, 1, 'green');
  h.click('#learn-session-history');
  h.click('[data-open-round="' + id + '"]');
  assert.equal(current(h).responses[1].key, 'green');
  assert.equal(state(h).history.find(r => r.id === id).responses[1].key, 'green');
});

test('opening the oldest record remains possible when saving the active round reaches the history limit', () => {
  const s = core.defaults();
  s.history = Array.from({length: 100}, (_, i) => {
    const r = core.createRound('feelings', s.settings);
    r.id = 'archived-' + i;
    r.title = 'جولة محفوظة ' + core.ar(i + 1);
    r.finishedAt = '2026-10-12T17:40:00.000Z';
    return r;
  });
  s.current.feelings = core.createRound('feelings', s.settings);
  const activeId = s.current.feelings.id;
  core.commit(s.current.feelings, [{mode: 'feelings', id: 1, key: 'white'}], 'manual');
  const h = launch({[STORAGE]: JSON.stringify(s)});
  h.click('#learn-session-history');
  h.click('[data-open-round="archived-99"]');
  assert.equal(current(h).id, 'archived-99');
  assert.equal(h.find('#learn-session-title').textContent, 'جولة محفوظة ١٠٠');
  assert.equal(state(h).history.length, 100);
  assert.ok(state(h).history.some(r => r.id === activeId));
});

test('teacher action list includes an explanation action and stores the chosen action', () => {
  const h = launch();
  start(h);
  const action = 'قدمت توضيحًا أو مثالًا آخر';
  assert.ok([...h.find('#learn-action').querySelectorAll('option')].some(o => o.textContent === action));
  h.fill('#learn-action', action, 'change');
  h.click('#learn-action-save');
  assert.equal(current(h).actions.length, 1);
  assert.equal(current(h).actions[0].text, action);
  assert.match(h.find('#learn-actions-log').textContent, /قدمت توضيحًا/);
});

test('print controls prepare six cards per learner and reject an invalid requested range', () => {
  const h = launch();
  h.fill('#learn-count', 2, 'change');
  h.click('#learn-print');
  assert.equal(h.find('#learning-dialog').open, true);
  assert.equal(h.find('#learning-print-root').querySelectorAll('.learning-paper-card').length, 12);
  assert.equal(h.find('#learning-print-root').querySelectorAll('.learning-paper-sheet').length, 6);
  assert.equal(h.find('#learning-card-preview').querySelectorAll('.learning-paper-card').length, 6);
  assert.equal(h.find('#learning-print-root').querySelectorAll('svg').length >= 12, true);
  h.fill('#learning-print-from', 0);
  h.click('#learning-print-generate');
  assert.match(h.find('#learning-print-info').textContent, /نطاقًا صحيحًا/);
  h.fill('#learning-print-from', 40);
  h.fill('#learning-print-to', 40);
  h.click('#learning-print-generate');
  assert.equal(h.find('#learning-print-root').querySelectorAll('.learning-paper-card').length, 6);
  assert.match(h.find('#learning-print-info').textContent, /أرقام الطباعة أكبر من عدد الجولة/);
  assert.match(h.find('#learning-print-root').textContent, /المتعلم ٤٠/);
  h.click('#learning-print-now');
  assert.equal(h.calls.print, 1);
  assert.equal(h.find('#learning-dialog').open, false);
  assert.equal(h.document.body.classList.contains('printing-learning'), true);
  h.window.dispatchEvent(new h.window.Event('afterprint'));
  assert.equal(h.document.body.classList.contains('printing-learning'), false);
});

test('editable labels and teacher-entered text render as text in setup, session, notes, history and print', () => {
  const h = launch();
  const name = '<img id="pwn-name" src=x onerror="globalThis.pwned=1">';
  const title = '<img id="pwn-title" src=x>';
  const label = '<svg id="pwn-label" onload="alert(1)">';
  const note = '</textarea><script id="pwn-note">alert(1)</script>';
  h.fill('[data-label="red"]', label);
  h.click('#learn-save-labels');
  assert.equal(h.document.querySelector('#pwn-label'), null);
  assert.match(h.find('#learn-palette').textContent, /pwn-label/);
  start(h, {title, names: [name, 'هند', 'مها'], prompt: '<svg id="pwn-prompt">'});
  record(h, 1, 'red');
  h.fill('#learn-note-1', note);
  h.click('[data-handle="1"]');
  assert.equal(h.find('#learn-note-1').value, note);
  assert.equal(h.document.querySelector('[id^="pwn-"]'), null);
  assert.equal(h.window.pwned, undefined);
  h.click('#learn-finish'); h.click('#learn-session-history');
  assert.equal(h.document.querySelector('[id^="pwn-"]'), null);
  h.click('#learning-dialog-close');
  h.click('#learn-back-settings'); h.click('#learn-print');
  assert.equal(h.document.querySelector('[id^="pwn-"]'), null);
  assert.match(h.find('#learning-print-root').textContent, /pwn-name/);
  assert.match(h.find('#learning-print-root').textContent, /pwn-label/);
});

test('the copied learner link contains only lesson instructions, with no roster or individual signals', async () => {
  const h = launch();
  start(h, {names: ['اسم خاص سري', 'هند', 'مها']});
  record(h, 1, 'white');
  h.fill('#learn-note-1', 'ملاحظة خاصة لا تشارك');
  h.click('#learn-copy-display');
  await h.flush();
  assert.equal(h.calls.copied.length, 1);
  const url = new URL(h.calls.copied[0]);
  const encoded = decodeURIComponent(url.hash.slice('#learn='.length));
  const payload = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  assert.deepEqual(Object.keys(payload).sort(), ['choices', 'hatKey', 'mode', 'prompt', 'title', 'v']);
  assert.equal(payload.choices.length, 6);
  for (const c of payload.choices) assert.deepEqual(Object.keys(c).sort(), ['hint', 'key', 'label']);
  assert.equal(JSON.stringify(payload).includes('اسم خاص سري'), false);
  assert.equal(JSON.stringify(payload).includes('ملاحظة خاصة'), false);
  h.click('#learn-show-display');
  assert.equal(h.calls.opened.length, 1);
  assert.equal(h.calls.opened[0][0], url.href);
  assert.equal(h.calls.opened[0][2], 'noopener');

  const shown = launch(Object.fromEntries(h.store), url.hash);
  assert.equal(shown.find('#learning-display').hidden, false);
  assert.equal(shown.find('#learning-app').hidden, true);
  assert.equal(shown.find('#teacher-app').hidden, true);
  assert.equal(shown.find('#learning-nav').hidden, true);
  assert.equal(shown.document.body.textContent.includes('اسم خاص سري'), false);
  assert.equal(shown.document.body.textContent.includes('ملاحظة خاصة'), false);
  assert.equal(shown.find('#learning-display').querySelectorAll('.display-learning-card').length, 6);
});

test('a hats learner display presents the active hat only, and malicious link labels stay text', () => {
  const choices = core.choices('hats', core.defaults().settings).map(({key,label,hint}) => ({key,label,hint}));
  choices.find(c => c.key === 'green').label = '<svg id="pwn-display" onload="alert(1)">';
  const data = {v: 2, mode: 'hats', title: 'أفكارنا', prompt: 'ما البديل؟', hatKey: 'green', choices};
  const hash = '#learn=' + encodeURIComponent(Buffer.from(JSON.stringify(data), 'utf8').toString('base64'));
  const h = launch({}, hash);
  assert.equal(h.find('#learning-display').querySelectorAll('.display-learning-card').length, 1);
  assert.equal(h.document.querySelector('#pwn-display'), null);
  assert.match(h.find('#learning-display').textContent, /pwn-display/);
});

test('invalid learner links show an error without displaying teacher records', () => {
  const h = launch({}, '#learn=' + encodeURIComponent('invalidbase64'));
  assert.match(h.find('#learning-display').textContent, /تعذر فتح العرض/);
  assert.equal(h.find('#teacher-app').hidden, true);
  assert.equal(h.find('#learning-app').hidden, true);
  assert.equal(h.find('#learning-nav').hidden, true);
});

test('backup restoration waits for the confirmation and retains restored settings and rounds', async () => {
  const h = launch();
  start(h, {title: 'بيانات قديمة', names: ['قديم', 'هند', 'مها']});
  record(h, 1, 'red');
  const old = h.store.get(STORAGE);
  const proposed = core.defaults();
  proposed.settings.title = 'النسخة المستعادة';
  proposed.settings.count = 2;
  proposed.settings.names = ['اسم مستعاد', 'آخر'];
  proposed.settings.feelingsPrompt = 'سؤال النسخة المستعادة';
  proposed.settings.labels.blue = {label: 'لدي استفسار', hint: 'أود طرحه الآن'};
  proposed.activeMode = 'hats';
  proposed.current.hats = core.createRound('hats', proposed.settings, {hatKey: 'yellow', flowIndex: 3});
  core.commit(proposed.current.hats, [{mode: 'hats', id: 2, key: 'yellow'}], 'manual');
  await importFile(h, proposed);
  assert.equal(h.store.get(STORAGE), old, 'merely choosing the file must not overwrite data');
  assert.equal(h.find('#learning-dialog').open, true);
  h.click('#learn-restore-confirm');
  await h.flush();
  const restored = state(h);
  assert.equal(restored.settings.title, 'النسخة المستعادة');
  assert.equal(restored.settings.count, 2);
  assert.deepEqual(restored.settings.names, ['اسم مستعاد', 'آخر']);
  assert.equal(restored.settings.feelingsPrompt, 'سؤال النسخة المستعادة');
  assert.equal(restored.settings.labels.blue.label, 'لدي استفسار');
  assert.equal(restored.activeMode, 'hats');
  assert.equal(restored.current.hats.hatKey, 'yellow');
  assert.equal(restored.current.hats.responses[2].key, 'yellow');
  assert.equal(h.store.get(STORAGE + '-before-restore'), old);
  assert.ok(h.calls.downloads.length, 'the previous data is offered as a backup before replacement');
  assert.equal(h.find('#learn-topic').value, 'النسخة المستعادة');
  assert.equal(h.find('#learn-count').value, '2');
  assert.equal(h.find('#learn-session').hidden, false);
});

test('invalid or oversized backup files do not replace current data', async () => {
  const h = launch(); start(h); record(h, 1, 'white');
  const saved = h.store.get(STORAGE);
  const bad = state(h);
  bad.current.feelings.responses[1].key = 'black';
  await importFile(h, bad);
  assert.equal(h.store.get(STORAGE), saved);
  assert.equal(h.find('#learning-dialog').open, false);
  assert.equal(h.find('#learn-notice').hidden, false);
  await importFile(h, '{invalid');
  assert.equal(h.store.get(STORAGE), saved);
  await importFile(h, '{}', 9 * 1024 * 1024);
  assert.equal(h.store.get(STORAGE), saved);
  assert.match(h.find('#learn-notice').textContent, /٨ ميجابايت/);
});

test('unreadable saved data remains available without being silently overwritten', async () => {
  const damaged = '{not valid json, keep this for recovery';
  const h = launch({[STORAGE]: damaged});
  assert.equal(h.store.get(STORAGE), damaged);
  assert.match(h.find('#learn-notice').textContent, /بقيت محفوظة دون استبدال/);
  start(h);
  h.click('[data-mode="hats"]');
  assert.equal(h.store.get(STORAGE), damaged);
  h.click('#learn-backup');
  assert.equal(h.calls.downloads.length, 1);
  assert.equal(await h.calls.downloads[0].blob.text(), damaged, 'export keeps the raw recoverable data');
});

test('denied camera access shows a recoverable message without changing recorded signals', async () => {
  const h = launch(); start(h); record(h, 1, 'white');
  const id = current(h).id;
  h.click('#learn-camera-start');
  await h.flush();
  assert.equal(h.calls.camera, 1);
  assert.match(h.find('#learn-notice').textContent, /لم يُسمح بالكاميرا/);
  assert.equal(h.find('#learn-camera-start').disabled, false);
  assert.equal(current(h).id, id);
  assert.equal(current(h).responses[1].key, 'white');
});

test('a stored demo round cannot accept manual or camera data and starts a separate live round', async () => {
  const s = core.defaults();
  s.current.feelings = core.createRound('feelings', s.settings, {demo: true});
  core.commit(s.current.feelings, [{mode: 'feelings', id: 1, key: 'red'}], 'demo');
  core.finish(s, s.current.feelings);
  const h = launch({[STORAGE]: JSON.stringify(s)});
  const demoId = current(h).id;
  assert.match(h.find('#learn-session-meta').textContent, /ليست بيانات متعلمين/);
  assert.equal(h.find('#learn-camera-start').disabled, true);
  assert.equal(h.find('#learn-manual-panel').hidden, true);
  assert.equal(h.find('#learn-continue').hidden, true);
  h.click('#learn-camera-start');
  await h.flush();
  assert.equal(h.calls.camera, 0);
  record(h, 1, 'green');
  assert.equal(current(h).responses[1].key, 'red');
  h.click('#learn-next-round');
  assert.equal(h.find('#learn-setup').hidden, false);
  h.click('#learn-start');
  assert.equal(current(h).demo, false);
  assert.notEqual(current(h).id, demoId);
  assert.deepEqual(current(h).responses, {});
});

test('demo buttons render real marker pixels and decode three cards in each mode without a camera', async () => {
  for (const mode of ['feelings', 'hats']) {
    const h = launch({}, '', true);
    if (mode === 'hats') {
      h.click('[data-mode="hats"]');
      h.click('[data-hat="green"]');
    }
    h.click('#learn-demo');
    for (let i = 0; i < 30 && h.find('#learn-demo').disabled; i++) {
      await h.flush();
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(h.find('#learn-demo').disabled, false, 'demo must finish or report an error');
    const r = current(h, mode);
    assert.equal(r.demo, true);
    assert.ok(r.finishedAt, h.find('#learn-notice').textContent);
    assert.equal(Object.keys(r.responses).length, 3, h.find('#learn-notice').textContent);
    assert.deepEqual(Object.values(r.responses).map(v => v.key), mode === 'feelings' ? ['red', 'green', 'blue'] : ['green', 'green', 'green']);
    assert.ok(Object.values(r.responses).every(v => v.source === 'demo'));
    assert.equal(h.calls.camera, 0);
    assert.equal(h.find('#learn-read').textContent, '٣');
    assert.match(h.find('#learn-session-meta').textContent, /ليست بيانات متعلمين/);
  }
});
