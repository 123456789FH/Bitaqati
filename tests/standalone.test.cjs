'use strict';

// Run only after building the standalone index.html in the package root:
// node --test tests/standalone.test.cjs
// The bundle is executed with inline JavaScript only; text/plain license notices
// and other non-executable script blocks are never evaluated.
// This is a DOM/pixel integration test, not a browser or physical camera test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHarness, enableRaster} = require('./learning-dom-harness.cjs');
const STORAGE = 'bitaqati-learning-v2';

function launchStandalone(raster = false) {
  const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
  const h = createHarness(html);
  if (raster) enableRaster(h);
  const scripts = [...h.document.querySelectorAll('script')];
  assert.equal(scripts.filter(s => s.hasAttribute('src')).length, 0, 'standalone bundle must not depend on external runtime scripts');
  let executable = 0;
  let notices = 0;
  for (const script of scripts) {
    const type = (script.getAttribute('type') || '').trim().toLowerCase();
    if (type === 'text/plain') notices++;
    if (type && type !== 'text/javascript' && type !== 'application/javascript') continue;
    executable++;
    h.runSource(script.textContent, 'standalone-inline-' + executable + '.js');
  }
  assert.ok(executable > 0, 'no executable inline scripts were found');
  assert.ok(notices > 0, 'the standalone bundle must retain its third-party notices');
  return h;
}

function state(h) {return JSON.parse(h.store.get(STORAGE));}

test('standalone starts on feelings and keeps hats and assessment usable', () => {
  const h = launchStandalone();
  assert.ok(h.window.LearningCore);
  assert.ok(h.window.SignalVision);
  assert.ok(h.window.BitaqatiLearning);
  assert.ok(h.window.Bitaqati);
  assert.equal(h.find('#learning-app').hidden, false);
  assert.equal(h.find('#teacher-app').hidden, true);
  assert.equal(h.document.querySelectorAll('#learn-palette .signal-card').length, 6);
  assert.equal(state(h).activeMode, 'feelings');

  h.click('#learn-start');
  h.fill('#learn-manual-id', 1, 'change');
  h.fill('#learn-manual-key', 'white', 'change');
  h.click('#learn-manual-save');
  assert.equal(state(h).current.feelings.responses[1].key, 'white');
  assert.equal(h.find('#learn-read').textContent, '١');

  h.click('[data-mode="hats"]');
  h.click('[data-hat="red"]');
  h.click('#learn-start');
  assert.equal(state(h).current.hats.hatKey, 'red');
  assert.equal(h.find('#learn-manual-key').querySelectorAll('option').length, 1);
  assert.equal(h.find('#learn-manual-key').value, 'red');

  h.click('[data-mode="quiz"]');
  assert.equal(h.find('#teacher-app').hidden, false);
  assert.equal(h.find('#learning-app').hidden, true);
  assert.ok(h.find('#question-text').value.trim());
  assert.ok(h.find('#option-A').value.trim());
  assert.ok(h.find('#option-D').value.trim());
  h.find('#question-form').dispatchEvent(new h.window.Event('submit', {bubbles: true, cancelable: true}));
  assert.equal(h.find('#scan-view').hidden, false, 'the original question flow must still start');

  h.click('[data-mode="feelings"]');
  assert.equal(h.find('#teacher-app').hidden, true);
  assert.equal(h.find('#learn-read').textContent, '١');
  assert.equal(state(h).current.feelings.responses[1].key, 'white');
  assert.equal(h.calls.consoleErrors.length, 0);
  assert.equal(h.calls.camera, 0);
});

test('standalone demo buttons decode real card pixels in feelings and hats', async () => {
  for (const mode of ['feelings', 'hats']) {
    const h = launchStandalone(true);
    if (mode === 'hats') {
      h.click('[data-mode="hats"]');
      h.click('[data-hat="green"]');
    }
    h.click('#learn-demo');
    for (let i = 0; i < 30 && h.find('#learn-demo').disabled; i++) {
      await h.flush();
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(h.find('#learn-demo').disabled, false);
    const r = state(h).current[mode];
    assert.equal(r.demo, true);
    assert.ok(r.finishedAt, h.find('#learn-notice').textContent);
    assert.equal(Object.keys(r.responses).length, 3, h.find('#learn-notice').textContent);
    assert.deepEqual(Object.values(r.responses).map(r => r.key), mode === 'feelings' ? ['red', 'green', 'blue'] : ['green', 'green', 'green']);
    assert.ok(Object.values(r.responses).every(r => r.source === 'demo'));
    assert.equal(h.find('#learn-read').textContent, '٣');
    assert.equal(h.calls.camera, 0);
  }
});
