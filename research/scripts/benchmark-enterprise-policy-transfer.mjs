// Held-out transfer check for an enterprise-level PAT policy boundary.
// Reads K2/K3 from a read-only SQLite snapshot and calls runAgent with an
// in-memory store stub. It writes no application data and publishes no card.
// Usage: node --experimental-sqlite research/scripts/benchmark-enterprise-policy-transfer.mjs <snapshot-app.db>
process.env.TYPESAFE_API_KEY = '';
process.env.TYPESAFE_MEMORY_GATE = 'off';

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const dbPath = process.argv[2];
if (!dbPath) throw new Error('Pass the isolated sample SQLite snapshot path; no model calls were made.');

const [{ modelStatus }, { runAgent, PROMPT_VERSION }, { tokenize, snippet }] = await Promise.all([
  import('../../server/config.js'),
  import('../../server/agent.js'),
  import('../../server/retrieval.js'),
]);
if (!modelStatus().configured) throw new Error('Live answer model is not configured; no model calls were made.');

const db = new DatabaseSync(path.resolve(dbPath), { readOnly: true });
let cards;
try {
  cards = db.prepare(`
    SELECT id, title, content, status, scope, source_kind, source_ref, applies_to
    FROM knowledge_cards
    WHERE id IN (2, 3) AND status = 'published' AND scope = 'sample'
    ORDER BY id
  `).all();
} finally {
  db.close();
}
if (cards.length !== 2 || !cards.some((card) => card.id === 2) || !cards.some((card) => card.id === 3)) {
  throw new Error('Snapshot must contain published sample K2 and K3; no model calls were made.');
}

const ticket = {
  id: 999,
  title: '企业上限和组织上限不一致，classic PAT 按哪个？',
  description: '虚构情境：某 GitHub Enterprise Cloud 企业所有者为 classic PAT 设置最大生命周期 60 天。该企业下的组织所有者随后为组织设置 90 天。一个组织成员的 classic PAT 生成时设置 120 天，距创建 70 天，仍显示在用户设置里，而且用户能用它访问个人仓库。请说明组织级 90 天能否覆盖企业级 60 天；能否据此认定它仍可访问该组织；设置策略是否等于撤销或停用；classic PAT 在什么时点检查，以及 GitHub 企业策略会提示怎样处理。只依据给出的来源，指出还需核实的非敏感状态；不要索取 token 明文。',
  category: '账号与权限',
  urgency: 'normal',
  status: 'open',
  scope: 'sample',
};

const enterpriseAddition = `\n\n企业级策略补充（GitHub Enterprise Cloud）：企业 owner 可以给 classic PAT 设置最大有效期；企业级最大值是上限，企业下的组织 owner 可以进一步收紧，但组织设置不能高于企业上限。token 必须以不超过该天数的生命周期创建。对 classic PAT，企业策略在使用 token 或尝试 SSO 凭据授权时检查；不符合期限策略的成员 token 会被阻止访问组织资源，但策略本身不会撤销或停用 token。GitHub Enterprise Cloud 文档说明，错误会提示用户调整期限，并提示重新生成符合期限要求的 token。\n来源：https://docs.github.com/en/enterprise-cloud@latest/admin/enforcing-policies/enforcing-policies-for-your-enterprise/enforcing-policies-for-personal-access-tokens-in-your-enterprise`;

const queryTokens = tokenize(`${ticket.title} ${ticket.description}`);
const mapSource = (card, content, treatment) => ({
  rank: card.id === 3 ? 1 : 2,
  ref: `K${card.id}`,
  id: card.id,
  type: 'card',
  title: card.title,
  snippet: snippet(content, queryTokens, 1200),
  score: 1,
  category_match: true,
  meta: {
    status: 'published',
    scope: 'sample',
    source_kind: card.source_kind || 'guide',
    source_ref: treatment && card.id === 3
      ? `${card.source_ref}\nhttps://docs.github.com/en/enterprise-cloud@latest/admin/enforcing-policies/enforcing-policies-for-your-enterprise/enforcing-policies-for-personal-access-tokens-in-your-enterprise`
      : card.source_ref,
    applies_to: card.applies_to,
  },
});

const conditions = [
  {
    key: 'existing_K2_K3',
    treatment: false,
    sources: cards.map((card) => mapSource(card, card.content, false)),
  },
  {
    key: 'K2_plus_enterprise_addendum_to_K3',
    treatment: true,
    sources: cards.map((card) => mapSource(
      card,
      card.id === 3 ? `${card.content}${enterpriseAddition}` : card.content,
      true,
    )),
  },
];

if (!conditions[1].sources.find((source) => source.ref === 'K3')?.snippet.includes('企业级策略补充')) {
  throw new Error('Candidate K3 excerpt did not retain the new enterprise policy paragraph; no model calls were made.');
}

const runs = [];
for (let trial = 1; trial <= 3; trial += 1) {
  for (const condition of conditions) {
    const run = await runAgent({
      store: {
        searchApprovedMemory: () => condition.sources,
        createRun: (value) => value,
      },
      ticket,
      mode: 'organization',
      runGroup: `enterprise-policy-transfer-${condition.key}-${trial}`,
    });
    runs.push({
      trial,
      condition: condition.key,
      model: run.model,
      origin: run.origin,
      promptVersion: run.promptVersion,
      latencyMs: run.latencyMs,
      retrievedRefs: (run.contextSources || []).map((source) => source.ref),
      citedRefs: [...new Set((run.output.citations || []).map((citation) => citation.ref))],
      answer: run.output.draft_reply,
      generalChecks: run.output.general_checks,
      uncertainties: run.output.uncertainties,
    });
  }
}

process.stdout.write(`${JSON.stringify({
  experiment: 'Held-out enterprise-level policy transfer: existing published sample K2/K3 vs K3 with a documented Enterprise Cloud addendum',
  storage: 'read-only SQLite snapshot + in-memory runAgent store; no application writes',
  candidateStatus: 'counterfactual draft context only; not published or persisted',
  ticketIsSynthetic: true,
  promptVersion: PROMPT_VERSION,
  model: modelStatus().model,
  rubricForHumanReview: [
    '企业 60 天上限优先于组织 90 天上限',
    '120 天生命周期不合规时，区分组织访问被阻止与 token 被撤销/停用',
    '指出 classic PAT 企业策略会在使用或 SSO 授权时检查，并准确表述错误提示',
    '不把个人仓库可用推断为企业组织资源可用',
    '引用只支持对应结论的 K2/K3 来源，不索取 token 明文',
  ],
  candidateExcerpt: conditions[1].sources.find((source) => source.ref === 'K3')?.snippet,
  runs,
}, null, 2)}\n`);
if (runs.some((run) => run.origin !== 'live')) process.exitCode = 2;
