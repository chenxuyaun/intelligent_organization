// Negative-transfer check: does the classic-PAT Enterprise addendum get
// incorrectly applied to a fine-grained PAT question?
// Uses production search against a read-only 4186 sample DB and an in-memory
// run stub. It writes no application data.
// Usage: node --experimental-sqlite research/scripts/benchmark-enterprise-policy-type-boundary.mjs <4186-app.db>
process.env.TYPESAFE_API_KEY = '';
process.env.TYPESAFE_MEMORY_GATE = 'off';

import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../../server/store.js';

const expectedDbPath = path.resolve('C:/Users/yuesh/AppData/Local/Temp/io-retrieval-preview-20261118-150508/app.db');
const dbPath = path.resolve(process.argv[2] || '');
if (dbPath !== expectedDbPath) throw new Error('Refusing to run: expected the verified 4186 sample database.');

const [{ modelStatus }, { runAgent, PROMPT_VERSION }] = await Promise.all([
  import('../../server/config.js'),
  import('../../server/agent.js'),
]);
if (!modelStatus().configured) throw new Error('Live answer model is not configured; no model call was made.');

const ticket = {
  id: 998,
  title: 'GitHub Enterprise Cloud fine-grained PAT 60 天 vs 组织 90 天',
  description: '虚构情境：企业 fine-grained PAT 最大期限 60 天，组织设 90 天。创建此 PAT 访问该组织时，能否选 90 天？其期限是在创建时检查吗？请勿把 classic PAT 使用或 SSO 授权时检查的规则套用到 fine-grained。',
  category: '账号与权限',
  urgency: 'normal',
  status: 'open',
  scope: 'sample',
};
const query = `${ticket.title} ${ticket.description}`;
const db = new DatabaseSync(dbPath, { readOnly: true });
const count = (table) => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
const tables = ['tickets', 'runs', 'reviews', 'knowledge_cards', 'knowledge_uses'];
const countsBefore = Object.fromEntries(tables.map((table) => [table, count(table)]));

let run;
let sources;
let countsAfter;
try {
  const store = createStore(db);
  sources = store.searchApprovedMemory(query, 4, { scope: 'sample', ticketCategory: ticket.category });
  const k1 = sources.find((source) => source.ref === 'K1');
  const k3 = sources.find((source) => source.ref === 'K3');
  if (!k1 || !k3 || k3.meta?.version !== 3) {
    throw new Error(`Refusing to call model: expected K1 and K3 v3 in retrieval. Got ${sources.map((source) => `${source.ref}:v${source.meta?.version ?? '?'}`).join(', ')}`);
  }

  run = await runAgent({
    store: {
      searchApprovedMemory: (queryText, limit, options) => store.searchApprovedMemory(queryText, limit, options),
      createRun: (value) => value,
    },
    ticket,
    mode: 'organization',
    runGroup: 'enterprise-policy-type-boundary-preview',
  });
  countsAfter = Object.fromEntries(tables.map((table) => [table, count(table)]));
  if (Object.keys(countsBefore).some((table) => countsBefore[table] !== countsAfter[table])) {
    throw new Error('Application counts changed during a read-only preview.');
  }
} finally {
  db.close();
}

const result = {
  experiment: 'Negative-transfer check: Enterprise fine-grained PAT vs classic PAT policy details',
  database: dbPath,
  storage: 'read-only SQLite + in-memory run stub; no tickets, runs, reviews, cards, or uses written',
  model: modelStatus().model,
  promptVersion: PROMPT_VERSION,
  origin: run.origin,
  latencyMs: run.latencyMs,
  retrieved: sources.map((source) => ({ ref: source.ref, version: source.meta?.version, score: source.score, snippet: source.snippet })),
  citedRefs: [...new Set((run.output.citations || []).map((item) => item.ref))],
  citations: run.output.citations,
  answer: run.output.draft_reply,
  generalChecks: run.output.general_checks,
  uncertainties: run.output.uncertainties,
  evidenceGate: run.output.evidence_gate || null,
  countsBefore,
  countsAfter,
  rubricForHumanReview: [
    '企业 60 天上限不能被组织 90 天放宽',
    'fine-grained PAT 的目标组织在创建时已知；没有把 classic PAT 使用/SSO 检查时点说成 fine-grained 的规则',
    '引用 K1/K3 时保留各自适用的 token 类型范围',
    '不把虚构场景说成公司制度，不索取 token 明文或识别信息',
  ],
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
writeFileSync(path.resolve('research/observations/2026-11-enterprise-policy-type-boundary-result.json'), serialized, 'utf8');
process.stdout.write(serialized);
if (run.origin !== 'live') process.exitCode = 2;
