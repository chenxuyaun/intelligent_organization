// In-memory A/B check of K1 v2 versus the unpublished K1 v3 candidate.
// Uses a read-only 4186 sample DB and the production retrieval/agent path;
// candidate text is injected only into the returned source snippet. No app data
// is changed. Two live attempts per condition provide a small repeat check.
// Usage: node --experimental-sqlite research/scripts/benchmark-k1-v3-boundary-compare.mjs <4186-app.db>
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
  id: 997,
  title: 'GitHub Enterprise Cloud fine-grained PAT 60 天 vs 组织 90 天',
  description: '虚构情境：企业 fine-grained PAT 最大期限 60 天，组织设 90 天。创建此 PAT 访问该组织时，能否选 90 天？其期限是在创建时检查吗？请勿把 classic PAT 使用或 SSO 授权时检查的规则套用到 fine-grained。',
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
const realSources = store.searchApprovedMemory(query, 4, { scope: 'sample', ticketCategory: ticket.category });
if (!realSources.some((source) => source.ref === 'K1') || !realSources.some((source) => source.ref === 'K3' && source.meta?.version === 3)) {
  db.close();
  throw new Error(`Refusing to call model: expected K1 and K3 v3 in retrieval. Got ${realSources.map((source) => `${source.ref}:v${source.meta?.version ?? '?'}`).join(', ')}`);
}

const trials = [];
try {
  for (const condition of ['current-k1-v2', 'candidate-k1-v3']) {
    for (let trial = 1; trial <= 2; trial += 1) {
      const sources = realSources.map((source) => {
        if (condition !== 'candidate-k1-v3' || source.ref !== 'K1') return source;
        return {
          ...source,
          snippet: candidateSnippet,
          meta: {
            ...source.meta,
            version: 3,
            applies_to: 'GitHub.com fine-grained PAT；个人、组织和企业资源分别核实；组织上限不能超过企业上限。',
          },
        };
      });
      const run = await runAgent({
        store: {
          searchApprovedMemory: () => sources,
          createRun: (value) => value,
        },
        ticket,
        mode: 'organization',
        runGroup: `k1-v3-compare-${condition}-${trial}`,
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
    experiment: 'In-memory K1 v2 vs candidate K1 v3 comparison on fine-grained PAT policy boundary',
    database: dbPath,
    storage: 'read-only SQLite; candidate K1 text injected in memory; createRun stub; no application data written',
    model: modelStatus().model,
    promptVersion: PROMPT_VERSION,
    candidateSnippet,
    trials,
    countsBefore,
    countsAfter,
    rubricForHumanReview: [
      '清楚说明企业 60 天上限不能被组织 90 天放宽',
      '明确 fine-grained PAT 的创建期限需遵守上限，不含混写成 classic PAT 的使用/SSO 检查时点',
      '能区分新 token 创建规则与策略变化后既有 token 的访问拦截',
      '引用 K1/K3 时保留 token 类型范围，不把虚构情境说成内部制度',
    ],
  };
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  writeFileSync(path.resolve('research/observations/2026-11-k1-v3-boundary-compare-result.json'), serialized, 'utf8');
  process.stdout.write(serialized);
} finally {
  db.close();
}
