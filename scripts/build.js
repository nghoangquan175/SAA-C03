// Builds the static site into dist/: public/* plus bank.json (all question files merged)
const fs = require('fs');
const path = require('path');
const { loadBank } = require('./bank');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist');

const bank = loadBank();
if (bank.errors.length) {
  console.error('Question files with errors:\n' + bank.errors.join('\n'));
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'public'), OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'bank.json'), JSON.stringify({ topics: bank.topics, questions: bank.questions }));

console.log(`Built dist/ with ${bank.questions.length} questions in ${bank.topics.length} topics`);
