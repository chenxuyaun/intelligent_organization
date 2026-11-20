// Does unpublished K1 v3 become retrievable for the actual application ticket
// #11? Compare production search on the current UI copy with a disposable SQLite
// copy where only K1 content/metadata are replaced in memory-like test data.
// Any optional live run uses an in-memory createRun stub; source DB is read-only.
// Usage: node --experimental-sqlite research/scripts/benchmark-k1-candidate-actual-ticket-retrieval.mjs
process.env.TYPESAFE_API_KEY = '';
process.env.TYPESAFE_MEMORY_GATE = 'off';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../../server/store.js';

const sourcePath = path.resolve('C:/Users/yuesh/AppData/Local/Temp/io-visible-k1-review-Rpf2nx/app.db');
if (!fs.existsSync(sourcePath)) throw new Error('Refusing to run: expected the verified disposable UI copy.');
const draft = fs.readFileSync('research/drafts/K1-fine-grained-PAT-enterprise-policy-boundary.md', 'utf8');
const candidateContent = draft.match(/^## 建议替换为以下正文\s*\n([\s\S]*?)(?=\n## )/m)?.[1]?.trim();
if (!candidateContent) throw new Error('Could not extract K1 v3 candidate body.');

const source = new DatabaseSync(sourcePath, { readOnly: true });
const sourceStore = createStore(source);
const ticket = sourceStore.getTicket(11);
if (!ticket || ticket.scope !== 'sample' || ticket.status !== 'open') {
  source.close();
  throw new Error('Refusing to run: expected the open synthetic sample ticket #11.');
}
const query = `${ticket.title}\n${ticket.description}\n${ticket.category || ''}`;
const currentRetrieved = sourceStore.searchApprovedMemory(query, 4, {
  scope: 'sample', ticketCategory: ticket.category, excludeTicketId: ticket.id,
});
const persistedRuns = sourceStore.runsByTicket(11).map((run) => ({
  id: run.id,
  mode: run.mode,
  origin: run.origin,
  retrievedRefs: run.context_sources.map((item) => item.ref),
  citedRefs: [...new Set((run.output.citations || []).map((item) => item.ref))],
}));
const tables = ['tickets', 'runs', 'reviews', 'knowledge_cards', 'knowledge_uses'];
const count = (db, table) => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
const sourceCountsBefore = Object.fromEntries(tables.map((table) => [table, count(source, table)]));

const candidateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'io-k1-actual-query-'));
const candidateDbPath = path.join(candidateDir, 'app.db');
source.exec(`VACUUM INTO '${candidateDbPath.replaceAll("'", "''")}'`);
const candidateDb = new DatabaseSync(candidateDbPath);
const candidateSourceRef = [
  'https://docs.github.com/en/enterprise-cloud@latest/admin/enforcing-policies/enforcing-policies-for-your-enterprise/enforcing-policies-for-personal-access-tokens-in-your-enterprise',
  'https://docs.github.com/en/enterprise-cloud@latest/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization',
  'https://docs.github.com/en/enterprise-cloud@latest/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens',
  'https://github.blog/changelog/2024-10-18-new-pat-rotation-policies-preview-and-optional-expiration-for-fine-grained-pats/',
].join('\n');
const candidateAppliesTo = 'GitHub.com fine-grained PAT；个人、组织和企业资源分开核实；组织上限不能超过企业上限。';
candidateDb.prepare(`UPDATE knowledge_cards
  SET content=?, version=3, source_ref=?, applies_to=?, updated_at=?
  WHERE id=1 AND status='published' AND scope='sample' AND version=2`)
  .run(candidateContent, candidateSourceRef, candidateAppliesTo, new Date().toISOString());
const candidateStore = createStore(candidateDb);
const candidateRetrieved = candidateStore.searchApprovedMemory(query, 4, {
  scope: 'sample', ticketCategory: ticket.category, excludeTicketId: ticket.id,
});

let candidateRun = null;
if (candidateRetrieved.some((item) => item.ref === 'K1')) {
  const [{ modelStatus }, { runAgent, PROMPT_VERSION }] = await Promise.all([
    import('../../server/config.js'),
    import('../../server/agent.js'),
  ]);
  if (modelStatus().configured) {
    candidateRun = await runAgent({
      store: {
        searchApprovedMemory: (queryText, limit, options) => candidateStore.searchApprovedMemory(queryText, limit, options),
        createRun: (value) => value,
      },
      ticket,
      mode: 'organization',
      runGroup: 'k1-candidate-actual-ticket-retrieval-preview',
    });
    candidateRun = {
      model: modelStatus().model,
      promptVersion: PROMPT_VERSION,
      origin: candidateRun.origin,
      latencyMs: candidateRun.latencyMs,
      retrievedRefs: candidateRun.contextSources.map((item) => item.ref),
      citedRefs: [...new Set((candidateRun.output.citations || []).map((item) => item.ref))],
      answer: candidateRun.output.draft_reply,
      uncertainties: candidateRun.output.uncertainties,
    };
  }
}

const sourceCountsAfter = Object.fromEntries(tables.map((table) => [table, count(source, table)]));
const candidateCountsAfterRun = Object.fromEntries(tables.map((table) => [table, count(candidateDb, table)]));
const result = {
  experiment: 'Actual UI ticket #11: current K1 v2 retrieval vs unpublished K1 v3 candidate in disposable DB copy',
  sourceDb: sourcePath,
  candidateDb: candidateDbPath,
  ticket: { id: ticket.id, title: ticket.title, category: ticket.category, status: ticket.status, scope: ticket.scope },
  storage: 'source DB read-only; candidate DB is a disposable VACUUM INTO copy; no source run/review/card/use written',
  persistedRuns,
  currentRetrieval: currentRetrieved.map((item) => ({ ref: item.ref, version: item.meta?.version, score: item.score })),
  candidateRetrieval: candidateRetrieved.map((item) => ({ ref: item.ref, version: item.meta?.version, score: item.score })),
  candidateRun,
  sourceCountsBefore,
  sourceCountsAfter,
  candidateCountsAfterRun,
  sourceUnchanged: JSON.stringify(sourceCountsBefore) === JSON.stringify(sourceCountsAfter),
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
fs.writeFileSync(path.resolve('research/observations/2026-11-k1-candidate-actual-ticket-retrieval-result.json'), serialized, 'utf8');
process.stdout.write(serialized);
candidateDb.close();
source.close();
