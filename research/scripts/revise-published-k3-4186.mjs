// Apply the user-approved Enterprise Cloud addendum as K3 v3 in the isolated
// 4186 sample database. This keeps the old content in the revision event and
// records the publish decision. It refuses other databases or changed cards.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../../server/store.js';

const expectedDbPath = path.resolve('C:/Users/yuesh/AppData/Local/Temp/io-retrieval-preview-20261118-150508/app.db');
const dbPath = path.resolve(process.argv[2] || '');
if (dbPath !== expectedDbPath) throw new Error('Refusing to write: expected the verified 4186 sample database path.');
if (!fs.existsSync(dbPath)) throw new Error('Refusing to write: the verified 4186 database is missing.');

const draftPath = path.resolve('research/drafts/K3-classic-PAT-enterprise-policy-addendum.md');
const draft = fs.readFileSync(draftPath, 'utf8');
const candidateContent = draft.match(/## 正文\s*([\s\S]*?)\s*## 官方来源/)?.[1]?.trim();
if (!candidateContent || !candidateContent.includes('GitHub Enterprise Cloud') || !candidateContent.includes('尝试 SSO')) {
  throw new Error('Refusing to write: candidate K3 text is missing the verified enterprise details.');
}

const sourceRef = [
  'https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization',
  'https://docs.github.com/en/enterprise-cloud@latest/admin/enforcing-policies/enforcing-policies-for-your-enterprise/enforcing-policies-for-personal-access-tokens-in-your-enterprise',
  'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens',
  'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation',
].join('\n');
const appliesTo = 'GitHub.com classic personal access tokens；分别核实组织级与 GitHub Enterprise Cloud 企业级最大生命周期策略。fine-grained PAT 仅作为类型边界对照。';
const reviewer = '陈朋';
const revisionNote = '经用户批准，将已核对的 GitHub Enterprise Cloud 期限规则加入 sample K3；保留旧版内容于事件记录，不代表内部制度，不进入 pilot。';
const quoteSql = (value) => `'${String(value).replaceAll("'", "''")}'`;
const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'io-k3-enterprise-preupdate-'));
const backupPath = path.join(backupDir, 'app.db');

const backupDb = new DatabaseSync(dbPath, { readOnly: true });
try {
  backupDb.exec(`VACUUM INTO ${quoteSql(backupPath)}`);
} finally {
  backupDb.close();
}

const db = new DatabaseSync(dbPath);
const store = createStore(db);
const count = (table) => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
const countsBefore = Object.fromEntries(['tickets', 'runs', 'reviews', 'knowledge_cards', 'knowledge_uses'].map((table) => [table, count(table)]));
const card = store.getCard(3);
if (!card) throw new Error('Refusing to write: K3 was not found.');

if (card.status === 'published' && card.version === 3 && card.scope === 'sample'
  && card.content === candidateContent && card.source_ref === sourceRef && card.applies_to === appliesTo
  && card.reviews.some((item) => item.action === 'publish' && item.reviewer === reviewer && item.note === revisionNote)) {
  process.stdout.write(`${JSON.stringify({ changed: false, reason: 'K3 v3 is already present', cardId: card.id, version: card.version, backupPath }, null, 2)}\n`);
  db.close();
  process.exit(0);
}

if (card.title !== 'GitHub classic PAT 默认过期与组织上限' || card.status !== 'published'
  || card.version !== 2 || card.scope !== 'sample' || card.source_ticket_id !== 1
  || card.pilot_approved || card.reviews.length !== 1 || card.uses.length !== 7) {
  db.close();
  throw new Error('Refusing to write: K3 identity, version, sample boundary, review history, or use count changed.');
}
if (card.content === candidateContent) {
  db.close();
  throw new Error('Refusing to write: candidate content is already present under an unexpected version/history.');
}

const at = new Date().toISOString();
try {
  db.exec('BEGIN IMMEDIATE');
  const demote = db.prepare(`UPDATE knowledge_cards SET status = 'pending', updated_at = ?
                             WHERE id = 3 AND status = 'published' AND version = 2 AND scope = 'sample'`).run(at);
  if (Number(demote.changes) !== 1) throw new Error('K3 changed during the revision; no update was committed.');

  const update = db.prepare(`UPDATE knowledge_cards
    SET content = ?, source_ref = ?, applies_to = ?, updated_at = ?
    WHERE id = 3 AND status = 'pending' AND version = 2 AND scope = 'sample'`).run(candidateContent, sourceRef, appliesTo, at);
  if (Number(update.changes) !== 1) throw new Error('K3 candidate update did not affect exactly one row.');

  store.addEvent({
    ticketId: card.source_ticket_id,
    kind: 'card_draft_edited',
    actor: reviewer,
    summary: '修订 sample K3：补充 GitHub Enterprise Cloud PAT 期限策略',
    payload: {
      cardId: card.id,
      status: 'pending',
      note: revisionNote,
      previousContent: card.content,
      revisedContent: candidateContent,
      previousSourceRef: card.source_ref,
      revisedSourceRef: sourceRef,
      previousAppliesTo: card.applies_to,
      revisedAppliesTo: appliesTo,
      publishDecision: 'user_approved',
    },
  });

  const reviewed = store.reviewCard({ cardId: card.id, action: 'publish', note: revisionNote, reviewer });
  if (!reviewed || reviewed.status !== 'published' || reviewed.version !== 3) {
    throw new Error('K3 v3 did not publish at the expected version.');
  }
  db.exec('COMMIT');
} catch (error) {
  try { db.exec('ROLLBACK'); } catch {}
  db.close();
  throw error;
}

const verified = store.getCard(3);
const countsAfter = Object.fromEntries(['tickets', 'runs', 'reviews', 'knowledge_cards', 'knowledge_uses'].map((table) => [table, count(table)]));
const newReview = verified.reviews.find((item) => item.action === 'publish' && item.reviewer === reviewer && item.note === revisionNote);
const revisionEvent = db.prepare(`SELECT payload FROM events WHERE kind = 'card_draft_edited' AND json_extract(payload, '$.cardId') = 3 ORDER BY id DESC LIMIT 1`).get();
const eventPayload = revisionEvent ? JSON.parse(revisionEvent.payload) : null;
const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;

if (verified.status !== 'published' || verified.version !== 3 || verified.scope !== 'sample'
  || verified.pilot_approved || verified.content !== candidateContent || verified.source_ref !== sourceRef
  || verified.applies_to !== appliesTo || !newReview || eventPayload?.previousContent !== card.content
  || eventPayload?.revisedContent !== candidateContent || integrity !== 'ok'
  || ['tickets', 'runs', 'reviews', 'knowledge_cards', 'knowledge_uses'].some((table) => countsBefore[table] !== countsAfter[table])) {
  db.close();
  throw new Error('Post-update verification failed; inspect the backup and audit event.');
}

process.stdout.write(`${JSON.stringify({
  changed: true,
  database: dbPath,
  backupPath,
  card: { id: verified.id, title: verified.title, status: verified.status, version: verified.version, scope: verified.scope, source_kind: verified.source_kind, pilot_approved: verified.pilot_approved, source_ref: verified.source_ref, applies_to: verified.applies_to },
  priorContentPreservedInEvent: eventPayload.previousContent === card.content,
  newContentMatchesReviewedDraft: verified.content === candidateContent,
  reviewer: newReview.reviewer,
  reviewAction: newReview.action,
  usesPreserved: verified.uses.length === card.uses.length,
  countsBefore,
  countsAfter,
  integrity,
}, null, 2)}\n`);
db.close();
