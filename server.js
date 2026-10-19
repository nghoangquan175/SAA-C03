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

http
  .createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
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
