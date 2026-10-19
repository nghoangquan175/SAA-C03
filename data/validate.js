// Validates question bank files against QUESTION_SPEC.md
// Usage: node validate.js <file.json> [more files...]   (no args = all files in ./questions)
const fs = require('fs');
const path = require('path');

const DOMAINS = ['secure', 'resilient', 'performance', 'cost'];
let files = process.argv.slice(2);
if (!files.length) {
  const dir = path.join(__dirname, 'questions');
  files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => path.join(dir, f));
}

let totalErrors = 0;
const allIds = new Set();
for (const file of files) {
  const errors = [];
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.log(`${file}: INVALID JSON - ${e.message}`);
    totalErrors++;
    continue;
  }
  if (!Array.isArray(data)) errors.push('root is not an array');
  const stats = { single: 0, multi: 0, domain: {}, pos: [0, 0, 0, 0, 0, 0], diff: {} };
  const seenQ = new Set();
  (data || []).forEach((q, i) => {
    const where = q.id || `#${i}`;
    const err = m => errors.push(`${where}: ${m}`);
    for (const k of ['id', 'topic', 'domain', 'type', 'question', 'options', 'answer', 'explanation']) {
      if (q[k] === undefined) err(`missing ${k}`);
    }
    if (allIds.has(q.id)) err('duplicate id');
    allIds.add(q.id);
    if (!DOMAINS.includes(q.domain)) err(`bad domain ${q.domain}`);
    if (q.source !== undefined && !/^https:\/\/(docs\.aws\.amazon\.com|aws\.amazon\.com)\/\S+$/.test(q.source)) {
      err('source must be a https://docs.aws.amazon.com/ or https://aws.amazon.com/ URL');
    }
    if (!Array.isArray(q.options) || !Array.isArray(q.answer)) return;
    if (q.answer.some(a => !Number.isInteger(a) || a < 0 || a >= q.options.length)) err('answer index out of range');
    if (new Set(q.answer).size !== q.answer.length) err('duplicate answer index');
    if (q.type === 'single') {
      if (q.options.length !== 4) err(`single must have 4 options (has ${q.options.length})`);
      if (q.answer.length !== 1) err('single must have exactly 1 answer');
    } else if (q.type === 'multi') {
      const m = /\(Select (TWO|THREE)\.\)\s*$/.exec(q.question);
      if (!m) err('multi question must end with "(Select TWO.)" or "(Select THREE.)"');
      else {
        const n = m[1] === 'TWO' ? 2 : 3;
        if (q.answer.length !== n) err(`says Select ${m[1]} but has ${q.answer.length} answers`);
        if (q.options.length < n + 3) err(`multi Select ${m[1]} needs >= ${n + 3} options`);
      }
    } else err(`bad type ${q.type}`);
    if (new Set(q.options.map(o => o.trim().toLowerCase())).size !== q.options.length) err('duplicate options');
    const key = q.question.trim().toLowerCase();
    if (seenQ.has(key)) err('duplicate question text');
    seenQ.add(key);
    stats[q.type] = (stats[q.type] || 0) + 1;
    stats.domain[q.domain] = (stats.domain[q.domain] || 0) + 1;
    stats.diff[q.difficulty] = (stats.diff[q.difficulty] || 0) + 1;
    q.answer.forEach(a => stats.pos[a]++);
  });
  console.log(`${path.basename(file)}: ${data.length} questions | single ${stats.single} multi ${stats.multi} | domains ${JSON.stringify(stats.domain)} | difficulty ${JSON.stringify(stats.diff)} | answer positions ${stats.pos.join('/')}`);
  errors.forEach(e => console.log('  ERROR ' + e));
  totalErrors += errors.length;
}
console.log(totalErrors ? `\n${totalErrors} error(s)` : '\nOK');
process.exit(totalErrors ? 1 : 0);
