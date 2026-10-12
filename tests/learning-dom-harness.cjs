'use strict';

// Temporary DOM harness for this review; not a browser and not part of the app.
// It can test event handling, state persistence and safe DOM construction.
// It cannot validate rendering, camera performance or real browser permissions.
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
let linkedom;
try {linkedom = require('linkedom');}
catch {linkedom = require('../../qa-deps/node_modules/linkedom');}

function createHarness(html, initialStorage = {}) {
  const domWindow = linkedom.parseHTML(html).window;
  // linkedom.defaultView is a proxy over Node's globalThis. A separate sandbox
  // avoids replacing Node globals when supplying our mocks.
  const window = Object.assign(Object.create(null), linkedom);
  window.document = domWindow.document;
  window.addEventListener = domWindow.addEventListener;
  window.removeEventListener = domWindow.removeEventListener;
  window.dispatchEvent = domWindow.dispatchEvent;
  window.MutationObserver = domWindow.MutationObserver;
  Object.defineProperty(window.document, 'defaultView', {value: window});
  const store = new Map(Object.entries(initialStorage));
  const calls = {alerts: [], confirms: [], consoleErrors: [], downloads: [], camera: 0, print: 0, copied: [], opened: []};
  const timers = new Map();
  let timerId = 0;

  window.window = window;
  window.self = window;
  window.globalThis = window;
  window.crypto = crypto.webcrypto;
  window.performance = performance;
  window.TextEncoder = TextEncoder;
  window.TextDecoder = TextDecoder;
  window.btoa = btoa;
  window.atob = atob;
  window.console = {
    log() {}, warn() {}, info() {}, debug() {},
    error(...args) { calls.consoleErrors.push(args.map(String).join(' ')); }
  };
  window.localStorage = {
    getItem: key => store.has(String(key)) ? store.get(String(key)) : null,
    setItem: (key, value) => store.set(String(key), String(value)),
    removeItem: key => store.delete(String(key)),
    clear: () => store.clear(),
    key: i => [...store.keys()][i] ?? null,
    get length() { return store.size; }
  };
  window.confirm = message => {calls.confirms.push(String(message)); return true;};
  window.alert = message => calls.alerts.push(String(message));
  window.print = () => { calls.print++; };
  window.open = (...args) => {calls.opened.push(args); return {closed: false};};
  window.isSecureContext = true;
  window.location = new URL('https://example.invalid/Bitaqati/?qa=dom');
  window.history = {replaceState() {}, pushState() {}};
  window.Blob = Blob;
  window.URL = class HarnessURL extends URL {
    static createObjectURL(blob) {
      const url = 'blob:dom-test-' + calls.downloads.length;
      calls.downloads.push({blob, url});
      return url;
    }
    static revokeObjectURL() {}
  };
  window.fetch = async () => { throw new Error('Network is disabled in DOM tests'); };
  window.navigator = {userAgent: 'Bitaqati DOM-only review'};
  window.navigator.mediaDevices = {
    async getUserMedia() {
      calls.camera++;
      throw Object.assign(new Error('Camera permission denied by DOM test'), {name: 'NotAllowedError'});
    },
    async enumerateDevices() {return [];}
  };
  window.navigator.clipboard = {async writeText(text) {calls.copied.push(String(text));}};
  window.setTimeout = (fn, ms) => {const id = ++timerId; timers.set(id, {fn, ms}); return id;};
  window.clearTimeout = id => timers.delete(id);
  window.setInterval = (fn, ms) => {const id = ++timerId; timers.set(id, {fn, ms, interval: true}); return id;};
  window.clearInterval = id => timers.delete(id);
  window.requestAnimationFrame = fn => {const id = ++timerId; timers.set(id, {fn, frame: true}); return id;};
  window.cancelAnimationFrame = id => timers.delete(id);

  // linkedom's select setter and validation methods are intentionally small;
  // use browser-equivalent state for the ordinary single-select controls tested.
  Object.defineProperty(window.HTMLSelectElement.prototype, 'value', {
    configurable: true,
    get() {
      const options = [...this.querySelectorAll('option')];
      const selected = options.find(o => o.hasAttribute('selected')) || options[0];
      return selected ? (selected.getAttribute('value') ?? selected.textContent) : '';
    },
    set(value) {
      for (const option of this.querySelectorAll('option')) {
        const matches = (option.getAttribute('value') ?? option.textContent) === String(value);
        if (matches) option.setAttribute('selected', '');
        else option.removeAttribute('selected');
      }
    }
  });
  for (const constructor of [window.HTMLInputElement, window.HTMLTextAreaElement, window.HTMLSelectElement]) {
    if (constructor) {
      constructor.prototype.setCustomValidity = function (message) {this._validationMessage = message;};
      constructor.prototype.reportValidity = function () {return !this._validationMessage;};
      constructor.prototype.checkValidity = function () {return !this._validationMessage;};
    }
  }
  // linkedom keeps entity escapes inside parsed textarea RCDATA. Browsers decode
  // these once. Match the five encodings emitted by the application's esc().
  Object.defineProperty(window.HTMLTextAreaElement.prototype, 'value', {
    configurable: true,
    get() {
      if (Object.hasOwn(this, '_domTypedValue')) return this._domTypedValue;
      return this.textContent.replace(/&(lt|gt|amp|quot|#39);/g, (all, key) => ({lt:'<',gt:'>',amp:'&',quot:'"','#39':"'"}[key]));
    },
    set(value) {this._domTypedValue = String(value); this.textContent = String(value);}
  });
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.HTMLElement.prototype.focus = function () {};
  window.HTMLElement.prototype.requestFullscreen = async function () {};
  window.HTMLElement.prototype.showModal = function () {this.setAttribute('open', '');};
  window.HTMLElement.prototype.close = function () {this.removeAttribute('open');};
  Object.defineProperty(window.HTMLElement.prototype, 'open', {
    configurable: true,
    get() {return this.hasAttribute('open');},
    set(value) {if (value) this.setAttribute('open', ''); else this.removeAttribute('open');}
  });
  window.document.exitFullscreen = async () => {};

  // No pixels are generated here; camera/image algorithms are separately tested.
  window.HTMLCanvasElement.prototype.getContext = function () {
    return {
      clearRect() {}, drawImage() {}, strokeRect() {}, fillRect() {}, fillText() {},
      save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
      stroke() {}, fill() {}, translate() {}, scale() {}, rotate() {},
      measureText(text) {return {width: String(text).length * 8};},
      getImageData() {throw new Error('Pixels are not available in this DOM-only test');}
    };
  };
  for (const dialog of window.document.querySelectorAll('dialog')) {
    dialog.showModal = () => dialog.setAttribute('open', '');
    dialog.close = () => dialog.removeAttribute('open');
  }

  const context = vm.createContext(window);
  function runSource(source, filename = 'app.js') {
    return vm.runInContext(source, context, {filename, timeout: 10000});
  }
  function runFile(path) {return runSource(fs.readFileSync(path, 'utf8'), path);}
  function find(selector) {
    const node = window.document.querySelector(selector);
    if (!node) throw new Error('DOM control is missing: ' + selector);
    return node;
  }
  function click(selector) {find(selector).click();}
  function fill(selector, value, event = 'input') {
    const node = find(selector);
    node.value = String(value);
    node.dispatchEvent(new window.Event(event, {bubbles: true}));
  }
  async function flush() {for (let i = 0; i < 4; i++) await Promise.resolve();}
  function runTimers() {
    for (const [id, timer] of [...timers]) if (!timer.frame && !timer.interval) {timers.delete(id); timer.fn();}
  }
  return {window, document: window.document, context, calls, store, timers, runSource, runFile, find, click, fill, flush, runTimers};
}

function enableRaster(h) {
  let raster;
  try {raster = require('@napi-rs/canvas');}
  catch {
    const modules = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
    if (!modules) throw new Error('Raster DOM tests require @napi-rs/canvas');
    raster = require(modules + '/@napi-rs/canvas');
  }
  const {window, calls} = h;
  for (const [attribute, fallback] of [['width', 300], ['height', 150]]) {
    Object.defineProperty(window.HTMLCanvasElement.prototype, attribute, {
      configurable: true,
      get() {return Number(this.getAttribute(attribute)) || fallback;},
      set(value) {
        this.setAttribute(attribute, String(value));
        if (this._rasterCanvas) this._rasterCanvas[attribute] = Math.max(1, Number(value) || fallback);
      }
    });
  }
  window.HTMLCanvasElement.prototype.getContext = function () {
    if (!this._rasterCanvas) this._rasterCanvas = raster.createCanvas(this.width, this.height);
    if (!this._rasterContext) {
      const native = this._rasterCanvas.getContext('2d');
      this._rasterContext = new Proxy(native, {
        get(target, property) {
          if (property === 'drawImage') return (image, ...args) => target.drawImage(image?._rasterCanvas || image, ...args);
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
        set(target, property, value) {Reflect.set(target, property, value, target); return true;}
      });
    }
    return this._rasterContext;
  };
  const src = Object.getOwnPropertyDescriptor(raster.Image.prototype, 'src');
  window.Image = function RasterImage() {
    const image = new raster.Image();
    Object.defineProperty(image, 'src', {
      configurable: true,
      get() {return src.get.call(image);},
      set(value) {
        const objectUrl = calls.downloads.find(item => item.url === value);
        if (!objectUrl) throw new Error('Only local object URLs are supported in raster DOM tests');
        objectUrl.blob.arrayBuffer().then(buffer => {
          try {src.set.call(image, Buffer.from(buffer));}
          catch (error) {if (image.onerror) image.onerror(error); else throw error;}
        });
      }
    });
    return image;
  };
  return h;
}

module.exports = {createHarness, enableRaster};
