// Merges data/topics.json and every data/questions/*.json into one bank object
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function loadBank() {
  const topics = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'topics.json'), 'utf8'));
  const qDir = path.join(DATA_DIR, 'questions');
  const questions = [];
  const errors = [];
  for (const file of fs.readdirSync(qDir).filter(f => f.endsWith('.json')).sort()) {
    try {
      const arr = JSON.parse(fs.readFileSync(path.join(qDir, file), 'utf8'));
      if (Array.isArray(arr)) questions.push(...arr);
    } catch (e) {
      errors.push(`${file}: ${e.message}`);
    }
  }
  return { topics, questions, errors };
}

module.exports = { loadBank };
