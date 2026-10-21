// Validation shared by the Lambda (index.mjs) and the local dev server (server.js).
// Every stored item has an "at" timestamp; a write never replaces a newer one.

export const KINDS = ['book', 'qstat', 'attempt', 'meta'];
export const WIPEABLE = ['qstat', 'attempt']; // "Reset all progress" clears these
const QID = /^[a-z0-9-]{1,40}$/;
const ATTEMPT_ID = /^[a-z0-9]{1,24}$/;
// bookmarks: { list }; reset: { list: [] } whose "at" tells other devices to drop history/stats older than it
const META_IDS = ['bookmarks', 'reset'];
const MAX_ATTEMPT_JSON = 300000; // DynamoDB items are capped at 400 KB

const stamp = v => {
  const at = Number(v);
  return Number.isFinite(at) && at > 0 ? at : null;
};
const count = v => (Number.isInteger(v) && v >= 0 ? v : 0);

export function validId(kind, id) {
  if (kind === 'book' || kind === 'qstat') return QID.test(id);
  if (kind === 'attempt') return ATTEMPT_ID.test(id);
  if (kind === 'meta') return META_IDS.includes(id);
  return false;
}

// Highlights on a book page: { part: [[start, end], ...] } where part is q (question),
// o0-o7 (options) or x (explanation) and start/end are character offsets in that text.
function cleanHighlights(v) {
  const out = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [part, list] of Object.entries(v)) {
    if (!/^(q|x|o[0-7])$/.test(part) || !Array.isArray(list)) continue;
    const ranges = list.filter(r => Array.isArray(r) && r.length === 2 && Number.isInteger(r[0]) && Number.isInteger(r[1]) && r[0] >= 0 && r[0] < r[1] && r[1] <= 20000).slice(0, 100);
    if (ranges.length) out[part] = ranges;
  }
  return out;
}

// Returns the cleaned item (only known fields) or null when the body is unusable.
export function cleanItem(kind, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const at = stamp(body.at);
  if (!at) return null;
  if (kind === 'book') {
    return {
      done: body.done === true,
      ok: typeof body.ok === 'boolean' ? body.ok : null,
      choice: Array.isArray(body.choice) ? body.choice.filter(n => Number.isInteger(n) && n >= 0 && n < 8).slice(0, 8) : [],
      later: body.later === true,
      note: typeof body.note === 'string' ? body.note.slice(0, 20000) : '',
      hl: cleanHighlights(body.hl),
      at,
    };
  }
  if (kind === 'qstat') {
    const seen = count(body.seen);
    return { seen, correct: Math.min(count(body.correct), seen), last: body.last === true, at };
  }
  if (kind === 'attempt') {
    // Attempts are stored whole as JSON text; the client owns their shape.
    if (typeof body.json !== 'string' || !body.json.length || body.json.length > MAX_ATTEMPT_JSON) return null;
    try { if (typeof JSON.parse(body.json) !== 'object') return null; } catch (_) { return null; }
    return { json: body.json, at };
  }
  if (kind === 'meta') {
    const list = Array.isArray(body.list) ? body.list.filter(x => typeof x === 'string' && QID.test(x)).slice(0, 5000) : [];
    return { list: [...new Set(list)], at };
  }
  return null;
}
