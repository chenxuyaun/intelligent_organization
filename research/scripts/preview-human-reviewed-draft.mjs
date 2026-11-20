// Create a disposable SQLite snapshot of the 4186 sample clone, then exercise
// the config-free reviewed-answer -> pending-card path. No .env or model calls.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../../server/store.js';
import { draftKnowledgeCard } from '../../server/knowledge-draft.js';

const sourceDir = 'C:/Users/yuesh/AppData/Local/Temp/io-retrieval-preview-20261118-150508';
const sourceDbPath = path.join(sourceDir, 'app.db');
const previewDir = await fs.mkdtemp(path.join(os.tmpdir(), 'io-draft-lineage-preview-'));
const previewDbPath = path.join(previewDir, 'app.db');
const quoteSql = (value) => `'${String(value).replaceAll("'", "''")}'`;

const sourceDb = new DatabaseSync(sourceDbPath, { readOnly: true });
try {
  sourceDb.exec(`VACUUM INTO ${quoteSql(previewDbPath)}`);
} finally {
  sourceDb.close();
}

const db = new DatabaseSync(previewDbPath);
try {
  const store = createStore(db);
  const ticket = store.getTicket(8);
  const reviewedRun = store.runsByTicket(8).find((run) => run.id === 7);
  assert.equal(ticket?.scope, 'sample');
  assert.equal(ticket?.status, 'open');
  assert.equal(reviewedRun?.mode, 'organization');
  assert.equal(reviewedRun?.run_group, 'gmwltvzvtl65d');
  assert.equal(reviewedRun?.reviews?.[0]?.decision, 'adopt');
  assert.equal(reviewedRun?.reviews?.[0]?.review_source_type, 'human');
  assert.equal(reviewedRun?.reviews?.[0]?.reviewer, '陈朋');
  assert.equal(store.draftExistsForTicket(8), null);

  store.updateTicket(8, {
    status: 'resolved',
    outcome: 'answered',
    outcomeNote: '仅为模拟规则问答：答复已采纳；未处理真实 token 或组织状态。',
    actor: '陈朋',
  });
  const result = draftKnowledgeCard({ store, ticket: store.getTicket(8) });
  assert.equal(result.created, true);
  assert.equal(result.card.status, 'pending');
  assert.equal(result.card.scope, 'sample');
  assert.equal(result.card.source_kind, 'guide');
  assert.match(result.card.source_ref, /docs\.github\.com/);
  assert.match(result.card.applies_to, /K3《/);
  assert.match(result.card.applies_to, /K2《/);
  assert.doesNotMatch(result.card.applies_to, /K1《/);
  assert.match(result.card.content, /来源组织运行：R7/);
  assert.match(result.card.content, /与以上已发布知识重复/);

  const query = {
    id: 999,
    title: '14 个月未使用的 classic PAT 与组织 180 天上限',
    description: '如何判断 token 状态？',
    category: '账号与权限',
  };
  const retrieved = store.searchApprovedMemory(query, 8, {
    scope: 'sample',
    ticketCategory: query.category,
  });
  assert.equal(retrieved.some((item) => item.type === 'card' && item.id === result.card.id), false);

  process.stdout.write(`${JSON.stringify({
    storage: 'disposable SQLite snapshot; source 4186 database unchanged',
    envRead: false,
    modelCalls: 0,
    ticketId: 8,
    simulatedOutcome: store.getTicket(8).outcome,
    draft: {
      id: result.card.id,
      status: result.card.status,
      scope: result.card.scope,
      sourceKind: result.card.source_kind,
      sourceRefs: result.card.source_ref,
      appliesTo: result.card.applies_to,
    },
    retrievedRefs: retrieved.map((item) => item.ref),
    pendingDraftExcluded: true,
    previewDbPath,
  }, null, 2)}\n`);
} finally {
  db.close();
}
