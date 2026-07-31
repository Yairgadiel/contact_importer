const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'i18n.js');
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const ts =
  pad(now.getDate()) + '.' + pad(now.getMonth() + 1) + '.' + now.getFullYear() +
  ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes());
const label = 'גרסה ' + ts;

const s = fs.readFileSync(file, 'utf8');
const re = /(version:\s*["'])([^"']*)(["'])/;
if (re.test(s)) {
  const next = s.replace(re, '$1' + label + '$3');
  if (next !== s) fs.writeFileSync(file, next);
}
