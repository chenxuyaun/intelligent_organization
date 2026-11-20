// Create a disposable SQLite copy of the 4186 sample database for a local UI
// preview. The verified 4186 source is opened read-only and is never modified.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const sourcePath = path.resolve('C:/Users/yuesh/AppData/Local/Temp/io-retrieval-preview-20261118-150508/app.db');
if (!fs.existsSync(sourcePath)) throw new Error('The verified 4186 sample database is missing.');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'io-visible-k1-review-'));
const targetPath = path.join(dataDir, 'app.db');
const quoteSql = (value) => `'${String(value).replaceAll("'", "''")}'`;

const source = new DatabaseSync(sourcePath, { readOnly: true });
try {
  source.exec(`VACUUM INTO ${quoteSql(targetPath)}`);
} finally {
  source.close();
}

const db = new DatabaseSync(targetPath, { readOnly: true });
try {
  const counts = Object.fromEntries(['tickets', 'runs', 'reviews', 'knowledge_cards', 'knowledge_uses']
    .map((table) => [table, Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n)]));
  const cards = db.prepare('SELECT id, version, status, scope, pilot_approved FROM knowledge_cards WHERE id IN (1,3) ORDER BY id').all();
  const integrity = db.prepare('PRAGMA integrity_check').get()?.integrity_check;
  if (integrity !== 'ok') throw new Error(`Visible copy failed integrity check: ${integrity}`);
  if (counts.tickets !== 10 || counts.runs !== 14 || counts.reviews !== 4 || counts.knowledge_cards !== 4 || counts.knowledge_uses !== 20) {
    throw new Error(`Unexpected 4186 sample counts: ${JSON.stringify(counts)}`);
  }
  if (!cards.some((card) => card.id === 1 && card.version === 2 && card.scope === 'sample' && card.pilot_approved === 0)
    || !cards.some((card) => card.id === 3 && card.version === 3 && card.scope === 'sample' && card.pilot_approved === 0)) {
    throw new Error(`Unexpected K1/K3 state in visible copy: ${JSON.stringify(cards)}`);
  }
  process.stdout.write(`${JSON.stringify({ dataDir, targetPath, counts, cards, integrity }, null, 2)}\n`);
} finally {
  db.close();
}
