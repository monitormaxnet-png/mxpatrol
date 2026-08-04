const { JSDOM } = require('jsdom');

const dom = new JSDOM(
  '<!doctype html><html><body><div id="root"></div></body></html>',
  { url: 'https://localhost/' }
);

global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.localStorage = dom.window.localStorage;
global.sessionStorage = dom.window.sessionStorage;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.MutationObserver = dom.window.MutationObserver;

global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);

global.matchMedia = global.window.matchMedia = (query) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});

global.ResizeObserver = global.window.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

global.IntersectionObserver = global.window.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

import('./dist/assets/index-Do8qn87l.js')
  .then(() => {
    console.log('Module loaded without throwing.');
  })
  .catch((e) => {
    console.error('CAUGHT ERROR:');
    console.error(e);
    process.exit(1);
  });