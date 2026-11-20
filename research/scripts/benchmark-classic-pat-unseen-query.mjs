// Unseen-wording transfer check for the pending classic PAT memory candidate.
// Uses the production runAgent path and an in-memory store; it never opens or writes an app DB.

process.env.TYPESAFE_API_KEY = '';

const { modelStatus } = await import('../../server/config.js');
const { runAgent } = await import('../../server/agent.js');

if (!modelStatus().configured) {
  throw new Error('Live model is not configured; no comparison was run.');
}

const ticket = {
  id: 7,
  title: '旧 classic PAT 超过组织上限后会怎样？',
  description: '我是某 GitHub 组织的成员，使用 classic PAT。组织现在把最大有效期设成 180 天，我手上的旧 token 页面显示两年后才过期。GitHub 默认要求 classic PAT 多久过期？这个旧 token 会自动被撤销，还是会被阻止访问组织资源？fine-grained PAT 的 366 天规则适用于它吗？请区分 GitHub 通用默认规则与组织设置。',
  category: '账号与权限',
  urgency: 'normal',
  scope: 'sample',
};

const k2 = {
  ref: 'K2', id: 2, type: 'card',
  title: 'GitHub 组织 PAT 上限收紧后的存量 token 影响（补充说明）',
  snippet: '适用范围：GitHub.com 组织的 Personal access token 最大有效期策略。来源事实：当组织设定的最大有效期策略使某成员 token 不合规时，该 token 会被阻止访问该组织；仅设置策略不会撤销或停用 token。用户会在调用该组织 API 遭拒时发现 token 不合规。边界：是否属于该情形，以目标组织当前策略、token 类型和 token 所有者关系为准。本卡总结 GitHub 公开规则，不代表任何公司的内部制度。后续处理：先请组织/企业管理员核实当前策略和具体 token 情况。若需恢复访问，GitHub 该页面未规定唯一恢复步骤。不要要求用户提供 token 明文。',
  meta: { source_kind: 'guide', scope: 'sample', applies_to: 'GitHub.com 组织成员的 personal access token；仅在 token 生命周期超过该组织当前最大有效期策略时适用。' },
};
const k1 = {
  ref: 'K1', id: 1, type: 'card',
  title: 'GitHub fine-grained PAT 过期规则：个人与组织资源',
  snippet: 'GitHub.com fine-grained PAT 过期规则：个人项目可以创建无过期时间的 fine-grained PAT；组织或企业资源默认最大有效期为 366 天，管理员可以放宽或收紧策略。2022 public beta 阶段要求 token 必须过期，属于历史规则，不应套到当前版本。',
  meta: { source_kind: 'guide', scope: 'sample', applies_to: 'GitHub.com fine-grained PAT；组织策略可调整。' },
};
const k3 = {
  ref: 'K3', id: 3, type: 'card',
  title: 'GitHub classic PAT 默认过期与组织上限',
  snippet: '适用范围：GitHub.com personal access tokens (classic)。来源事实：GitHub 官方文档说明，classic PAT 默认没有强制过期要求；组织 owner 仍可为 classic PAT 设置最大有效期策略。边界：classic PAT 默认无强制过期，不等于所有组织都允许无过期 token；必须核实目标组织的当前策略。不要把 fine-grained PAT 的组织/企业资源默认 366 天规则套用到 classic PAT。若目标组织已设置有效期上限，存量不合规 token 的组织访问影响见 K2；具体 token 是否受限取决于当前组织策略、token 类型和所有者关系。该公开规则不代表任何公司的内部制度。',
  meta: { source_kind: 'guide', scope: 'sample', applies_to: 'GitHub.com classic personal access tokens；默认过期要求与目标组织自定义最大有效期策略需分开判断。' },
};

async function oneRun(variant, trial) {
  const sources = variant === 'organization-memory' ? [k3, k2, k1] : [];
  const store = {
    searchApprovedMemory: () => sources,
    createRun: (run) => run,
  };
  const run = await runAgent({
    store,
    ticket,
    mode: variant === 'organization-memory' ? 'organization' : 'personal',
    runGroup: `classic-pat-unseen-${trial}-${variant}`,
  });
  return {
    trial,
    variant,
    origin: run.origin,
    model: run.model,
    latencyMs: run.latencyMs,
    contextRefs: sources.map((source) => source.ref),
    citations: run.output.citations.map(({ ref, quote }) => ({ ref, quote })),
    draft_reply: run.output.draft_reply,
    uncertainties: run.output.uncertainties,
  };
}

const results = [];
for (let trial = 1; trial <= 3; trial += 1) {
  const order = trial % 2 ? ['personal-no-memory', 'organization-memory'] : ['organization-memory', 'personal-no-memory'];
  for (const variant of order) results.push(await oneRun(variant, trial));
}

process.stdout.write(`${JSON.stringify({
  experiment: 'Unseen rewording; personal mode vs. organization mode with K3/K2/K1',
  storage: 'in-memory store stub; no application database writes',
  data: 'synthetic ticket and GitHub public-source text only',
  sidecar: 'TypeSafe disabled for this comparison',
  runs: results,
}, null, 2)}\n`);

if (results.some((result) => result.origin !== 'live')) process.exitCode = 2;
