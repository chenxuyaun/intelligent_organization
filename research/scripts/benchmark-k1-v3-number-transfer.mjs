// Holdout transfer check using new lifetime values absent from the K1 v3 draft.
// Compares current K1 v2 with candidate K1 v3, injected only in memory.
// Uses the production retrieval/agent path and a read-only 4186 sample DB.
// Usage: node --experimental-sqlite research/scripts/benchmark-k1-v3-number-transfer.mjs <4186-app.db>
process.env.TYPESAFE_API_KEY = '';
process.env.TYPESAFE_MEMORY_GATE = 'off';

import path from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../../server/store.js';

const expectedDbPath = path.resolve('C:/Users/yuesh/AppData/Local/Temp/io-retrieval-preview-20261118-150508/app.db');
const dbPath = path.resolve(process.argv[2] || '');
if (dbPath !== expectedDbPath) throw new Error('Refusing to run: expected the verified 4186 sample database.');

const draft = readFileSync('research/drafts/K1-fine-grained-PAT-enterprise-policy-boundary.md', 'utf8');
const body = draft.match(/^## 建议替换为以下正文\s*\n([\s\S]*?)(?=\n## )/m)?.[1]?.trim();
if (!body) throw new Error('Could not extract the reviewed K1 v3 candidate body.');
const candidateSnippet = body.split(/\n\n/)
  .filter((paragraph) => paragraph.startsWith('**组织/企业资源：**') || paragraph.startsWith('**类型边界：**'))
  .join('\n\n');
if (!candidateSnippet || candidateSnippet.length > 640) throw new Error(`Candidate retrieval snippet must be 1–640 characters; got ${candidateSnippet.length}.`);

const [{ modelStatus }, { runAgent, PROMPT_VERSION }] = await Promise.all([
  import('../../server/config.js'),
  import('../../server/agent.js'),
]);
if (!modelStatus().configured) throw new Error('Live answer model is not configured; no model call was made.');

const ticket = {
  id: 996,
  title: 'fine-grained PAT 过期规则：企业 45 天，组织 120 天，应该选多久？',
  description: 'GitHub 组织或企业资源默认最大有效期为 366 天。虚构情境：企业上限 45 天，组织设置 120 天，面向该组织创建 PAT 可否选 120 天？请说明上限与创建期限规则；不假设是真实公司制度。',
  category: '账号与权限',
  urgency: 'normal',
  status: 'open',
  scope: 'sample',
};
const query = `${ticket.title}\n${ticket.description}\n${ticket.category}`;
const db = new DatabaseSync(dbPath, { readOnly: true });
const tables = ['tickets', 'runs', 'reviews', 'knowledge_cards', 'knowledge_uses'];
const count = (table) => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
const countsBefore = Object.fromEntries(tables.map((table) => [table, count(table)]));
const store = createStore(db);
const originalSources = store.searchApprovedMemory(query, 4, { scope: 'sample', ticketCategory: ticket.category });
if (!originalSources.some((source) => source.ref === 'K1') || !originalSources.some((source) => source.ref === 'K3' && source.meta?.version === 3)) {
  db.close();
  throw new Error(`Refusing to call model: expected K1 and K3 v3 in retrieval. Got ${originalSources.map((source) => `${source.ref}:v${source.meta?.version ?? '?'}`).join(', ')}`);
}

const trials = [];
try {
  for (const condition of ['current-k1-v2', 'candidate-k1-v3']) {
    for (let trial = 1; trial <= 2; trial += 1) {
      const sources = originalSources.map((source) => condition === 'candidate-k1-v3' && source.ref === 'K1'
        ? {
            ...source,
            snippet: candidateSnippet,
            meta: {
              ...source.meta,
              version: 3,
              applies_to: 'GitHub.com fine-grained PAT；个人、组织和企业资源分别核实；组织上限不能超过企业上限。',
            },
          }
        : source);
      const run = await runAgent({
        store: {
          searchApprovedMemory: () => sources,
          createRun: (value) => value,
        },
        ticket,
        mode: 'organization',
        runGroup: `k1-number-transfer-${condition}-${trial}`,
      });
      trials.push({
        condition,
        trial,
        origin: run.origin,
        latencyMs: run.latencyMs,
        retrieved: sources.map((source) => ({ ref: source.ref, version: source.meta?.version, score: source.score })),
        citedRefs: [...new Set((run.output.citations || []).map((item) => item.ref))],
        citations: run.output.citations,
        answer: run.output.draft_reply,
        generalChecks: run.output.general_checks,
        uncertainties: run.output.uncertainties,
      });
    }
  }
  const countsAfter = Object.fromEntries(tables.map((table) => [table, count(table)]));
  if (Object.keys(countsBefore).some((table) => countsBefore[table] !== countsAfter[table])) {
    throw new Error('Application counts changed during a read-only preview.');
  }
  const result = {
    experiment: 'Transfer to new fine-grained PAT lifetime values (enterprise 45 days, organization 120 days)',
    database: dbPath,
    storage: 'read-only SQLite; candidate K1 text injected in memory; createRun stub; no application data written',
    model: modelStatus().model,
    promptVersion: PROMPT_VERSION,
    candidateSnippet,
    trials,
    countsBefore,
    countsAfter,
    scoringQuestions: [
      '是否将示例中的 60/90 正确迁移到新数值：企业 45 天、组织 120 天',
      '是否结论为组织 120 天不能超过企业 45 天',
      '是否清楚说明 fine-grained PAT 创建期限不超过实际企业/组织上限',
      '是否谨慎区分虚构参数与真实组织配置，不索要凭证明文',
    ],
  };
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  writeFileSync(path.resolve('research/observations/2026-11-k1-v3-number-transfer-result.json'), serialized, 'utf8');
  process.stdout.write(serialized);
} finally {
  db.close();
}
