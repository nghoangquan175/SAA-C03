// Local dev server: static files + the question bank built on the fly (no dependencies)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadBank } = require('./scripts/bank');

const PORT = Number(process.env.PORT) || 6699;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function send(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  res.end(body);
}

// Local stand-in for the book API (infras/api/index.mjs): same routes and rules, stored in .local/book.json
const BOOK_FILE = path.join(__dirname, '.local', 'book.json');
const readBook = () => { try { return JSON.parse(fs.readFileSync(BOOK_FILE, 'utf8')); } catch (_) { return {}; } };
function cleanPage(p) {
  const at = Number(p && p.at);
  if (!p || typeof p !== 'object' || !Number.isFinite(at) || at <= 0) return null;
  return {
    done: p.done === true,
    ok: typeof p.ok === 'boolean' ? p.ok : null,
    choice: Array.isArray(p.choice) ? p.choice.filter(n => Number.isInteger(n) && n >= 0 && n < 8).slice(0, 8) : [],
    later: p.later === true,
    note: typeof p.note === 'string' ? p.note.slice(0, 20000) : '',
    at,
  };
}
function bookApi(req, res, url) {
  const reply = (status, body) => send(res, status, JSON.stringify(body), MIME['.json']);
  if (req.method === 'GET' && url === '/api/book') {
    const book = readBook();
    return reply(200, { items: Object.entries(book).map(([qid, p]) => ({ qid, ...p })) });
  }
  const m = url.match(/^\/api\/book\/([a-z0-9-]{1,40})$/);
  if (req.method !== 'PUT' || !m) return reply(404, { error: 'not found' });
  let raw = '';
  req.on('data', c => (raw += c));
  req.on('end', () => {
    let page;
    try { page = cleanPage(JSON.parse(raw)); } catch (_) { page = null; }
    if (!page) return reply(400, { error: 'bad page body' });
    const book = readBook();
    if (book[m[1]] && book[m[1]].at > page.at) return reply(200, { saved: false, stale: true });
    book[m[1]] = page;
    fs.mkdirSync(path.dirname(BOOK_FILE), { recursive: true });
    fs.writeFileSync(BOOK_FILE, JSON.stringify(book, null, 1));
    reply(200, { saved: true });
  });
}

http
  .createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (url.startsWith('/api/')) return bookApi(req, res, url);
    // Re-read on every request so newly added question files show up without a restart.
    // In production the same JSON is a static file built by scripts/build.js.
    if (url === '/bank.json') {
      try {
        return send(res, 200, JSON.stringify(loadBank()), MIME['.json']);
      } catch (e) {
        return send(res, 500, JSON.stringify({ error: e.message }), MIME['.json']);
      }
    }
    const file = path.normalize(path.join(PUBLIC_DIR, url === '/' ? 'index.html' : url));
    if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden', 'text/plain');
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, 'Not found', 'text/plain');
      send(res, 200, buf, MIME[path.extname(file)] || 'application/octet-stream');
    });
  })
  .listen(PORT, () => console.log(`SAA-C03 practice running at http://localhost:${PORT}`));
