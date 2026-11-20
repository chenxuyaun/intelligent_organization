// End-to-end retrieval-to-answer check after the user-approved K3 v3 update.
// Uses the production memory search + runAgent with a read-only DB and an
// in-memory createRun stub. It writes no application data.
// Usage: node --experimental-sqlite research/scripts/benchmark-enterprise-policy-postpublish.mjs <4186-app.db>
process.env.TYPESAFE_API_KEY = '';
process.env.TYPESAFE_MEMORY_GATE = 'off';

import path from 'node:path';
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
  id: 999,
  title: '企业上限和组织上限不一致，classic PAT 按哪个？',
  description: '虚构情境：某 GitHub Enterprise Cloud 企业所有者为 classic PAT 设置最大生命周期 60 天。该企业下的组织所有者随后为组织设置 90 天。一个组织成员的 classic PAT 生成时设置 120 天，距创建 70 天，仍显示在用户设置里，而且用户能用它访问个人仓库。请说明组织级 90 天能否覆盖企业级 60 天；能否据此认定它仍可访问该组织；设置策略是否等于撤销或停用；classic PAT 在什么时点检查，以及 GitHub 企业策略会提示怎样处理。只依据检索来源回答，指出还需核实的非敏感状态；不要索取 token 明文。',
  category: '账号与权限',
  urgency: 'normal',
  status: 'open',
  scope: 'sample',
};
const query = `${ticket.title} ${ticket.description}`;
const db = new DatabaseSync(dbPath, { readOnly: true });
const count = (table) => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
const countsBefore = Object.fromEntries(['tickets', 'runs', 'reviews', 'knowledge_cards', 'knowledge_uses'].map((table) => [table, count(table)]));

let run;
let sources;
let countsAfter;
try {
  const store = createStore(db);
  sources = store.searchApprovedMemory(query, 4, { scope: 'sample', ticketCategory: ticket.category });
  const k3 = sources.find((source) => source.ref === 'K3');
  if (!k3 || k3.meta?.version !== 3 || !k3.snippet.includes('企业级策略补充')) {
    throw new Error(`Refusing to call model: search did not return the new K3 v3 paragraph. Got ${sources.map((source) => source.ref).join(', ')}`);
  }

  run = await runAgent({
    store: {
      searchApprovedMemory: (queryText, limit, options) => store.searchApprovedMemory(queryText, limit, options),
      createRun: (value) => value,
    },
    ticket,
    mode: 'organization',
    runGroup: 'enterprise-policy-postpublish-preview',
  });
  countsAfter = Object.fromEntries(['tickets', 'runs', 'reviews', 'knowledge_cards', 'knowledge_uses'].map((table) => [table, count(table)]));
  if (Object.keys(countsBefore).some((table) => countsBefore[table] !== countsAfter[table])) {
    throw new Error('Application counts changed during a read-only preview.');
  }
} finally {
  db.close();
}

const result = {
  experiment: 'Actual sample retrieval -> live answer after K3 v3 publication',
  database: dbPath,
  storage: 'read-only SQLite + in-memory run stub; no tickets, runs, reviews, cards, or uses written',
  model: modelStatus().model,
  promptVersion: PROMPT_VERSION,
  origin: run.origin,
  latencyMs: run.latencyMs,
  retrieved: sources.map((source) => ({ ref: source.ref, version: source.meta?.version, score: source.score })),
  citedRefs: [...new Set((run.output.citations || []).map((item) => item.ref))],
  citations: run.output.citations,
  answer: run.output.draft_reply,
  generalChecks: run.output.general_checks,
  uncertainties: run.output.uncertainties,
  evidenceGate: run.output.evidence_gate || null,
  countsBefore,
  countsAfter,
  integrity: 'read-only database connection; mutation unavailable',
  rubricForHumanReview: [
    '企业 60 天上限优先，组织 90 天不能放宽',
    '不合规成员 token 的组织访问边界与 token 撤销/停用状态分开说明',
    'classic PAT 企业期限在使用/SSO 授权时检查，提示内容不过度泛化',
    '个人仓库可用不作为企业组织资源可用的证明',
    '结论引用 K3/K2，不索取 token 明文',
  ],
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (run.origin !== 'live') process.exitCode = 2;
