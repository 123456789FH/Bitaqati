'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let canvasApi;
try { canvasApi = require('@napi-rs/canvas'); }
catch (error) { canvasApi = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, '@napi-rs/canvas')); }
const C = require('../dist/core.js');
const CardVision = require('../dist/vision.js');

test('actual app demo canvas reads 1=A, 2=B, 3=C and scores one correct answer', async () => {
  const app = fs.readFileSync(path.join(__dirname, '../dist/app.js'), 'utf8');
  const section = (start, end) => {
    const first = app.indexOf(start);
    const last = app.indexOf(end, first + start.length);
    assert(first >= 0 && last > first, 'Application function boundaries must exist.');
    return app.slice(first, last);
  };
  const singleLine = name => {
    const line = app.split('\n').find(value => value.startsWith('  function ' + name + '('));
    assert(line, 'Application function must exist: ' + name);
    return line;
  };

  const work = canvasApi.createCanvas(1, 1);
  const state = { current: null };
  const demoButton = { disabled: false };
  const notices = [];
  const blobs = new Map();
  let nextBlob = 0;
  const context = vm.createContext({
    C, state, work, ctx: work.getContext('2d'), Blob,
    window: { CardVision },
    document: {
      createElement(tag) {
        assert.equal(tag, 'canvas');
        return canvasApi.createCanvas(1, 1);
      }
    },
    $(id) { assert.equal(id, 'demo-btn'); return demoButton; },
    URL: {
      createObjectURL(blob) {
        assert.equal(blob.type, 'image/svg+xml');
        const url = 'test-blob:' + (++nextBlob);
        blobs.set(url, blob);
        return url;
      },
      revokeObjectURL(url) { blobs.delete(url); }
    },
    // Native SVG decoding replaces browser Image/blob-URL plumbing only.
    // Drawing, demo(), readImage(), committing and scoring use real code.
    async decodeImage(url) {
      const blob = blobs.get(url);
      assert(blob);
      return canvasApi.loadImage(Buffer.from(await blob.arrayBuffer()));
    },
    stopCamera() {}, persist() {}, showScan() {}, renderProgress() {}, showResults() {},
    archive() { state.current.finishedAt = new Date().toISOString(); },
    notice(message, level = 'info') { notices.push({ message, level }); }
  });

  vm.runInContext([
    singleLine('begin'), singleLine('currentIds'), singleLine('finish'),
    section('  function commitUpdates(', '  function showResults('),
    section('  async function readImage(', '  async function demo('),
    section('  async function demo(', '  function displayUrl('),
    'globalThis.runDemo = demo;'
  ].join('\n'), context, { filename: 'actual-app-demo-functions.js' });

  await context.runDemo();

  assert.equal(work.width, 960);
  assert.equal(work.height, 320);
  assert.equal(nextBlob, 3);
  assert.equal(blobs.size, 0);
  assert.equal(state.current.mode, 'demo');
  const answers = Object.entries(state.current.responses).map(([id, response]) => ({ id: Number(id), answer: response.answer }));
  assert.deepEqual(answers, [{ id: 1, answer: 'A' }, { id: 2, answer: 'B' }, { id: 3, answer: 'C' }]);
  assert.deepEqual(C.summary(state.current), {
    total: 3, answered: 3, correct: 1, incorrect: 2, unread: 0,
    distribution: { A: 1, B: 1, C: 1, D: 0 }
  });
  assert.equal(demoButton.disabled, false);
  assert(notices.every(notice => notice.level !== 'error'), JSON.stringify(notices));
  assert(notices.at(-1).message.includes('قُرئت البطاقات الثلاث.'));
});
