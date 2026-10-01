const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
function load(relative, overrides = {}) {
  const filename = path.resolve(__dirname, '..', relative);
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports,
    require: id => Object.hasOwn(overrides, id) ? overrides[id] : nativeRequire(id),
    console, process, Date, Buffer, setTimeout, clearTimeout
  }, { filename });
  return module.exports;
}
function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; return this; } };
}
module.exports = { load, response };
