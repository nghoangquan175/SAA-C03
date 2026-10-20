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

// Local stand-in for the study data API (infras/api/index.mjs): same routes and rules,
// stored in .local/data.json as { kind: { id: item } }. Set API_DOWN=1 to simulate an outage.
const DATA_FILE = path.join(__dirname, '.local', 'data.json');
const rules = import('./infras/api/rules.mjs');
const readData = () => { try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (_) { return {}; } };
const writeData = d => { fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true }); fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 1)); };
function readJson(req) {
  return new Promise(resolve => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => { try { resolve(JSON.parse(raw)); } catch (_) { resolve(undefined); } });
  });
}
function put(data, kind, id, item) {
  const box = data[kind] || (data[kind] = {});
  if (box[id] && box[id].at > item.at) return 'stale';
  box[id] = item;
  return 'saved';
}
async function dataApi(req, res, url) {
  const reply = (status, body) => send(res, status, JSON.stringify(body), MIME['.json']);
  if (process.env.API_DOWN) return reply(503, { error: 'down' });
  const { KINDS, WIPEABLE, validId, cleanItem } = await rules;
  const data = readData();
  const list = kind => Object.entries(data[kind] || {}).map(([id, it]) => ({ id, ...it }));
  if (req.method === 'GET' && url === '/api/data') return reply(200, Object.fromEntries(KINDS.map(k => [k, list(k)])));
  if (req.method === 'POST' && url === '/api/data/batch') {
    const body = await readJson(req);
    const items = body && Array.isArray(body.items) ? body.items : null;
    if (!items || items.length > 100) return reply(400, { error: 'send 1-100 items' });
    const results = items.map(({ kind, id, item }) => {
      const clean = KINDS.includes(kind) && typeof id === 'string' && validId(kind, id) ? cleanItem(kind, item) : null;
      return { kind, id, result: clean ? put(data, kind, id, clean) : 'invalid' };
    });
    writeData(data);
    return reply(200, { results });
  }
  const wipe = url.match(/^\/api\/data\/([a-z]+)$/);
  if (req.method === 'DELETE' && wipe) {
    if (!WIPEABLE.includes(wipe[1])) return reply(400, { error: 'this kind cannot be wiped' });
    const n = Object.keys(data[wipe[1]] || {}).length;
    delete data[wipe[1]];
    writeData(data);
    return reply(200, { deleted: n });
  }
  return reply(404, { error: 'not found' });
}

http
  .createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (url.startsWith('/api/')) return dataApi(req, res, url);
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
