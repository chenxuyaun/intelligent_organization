// Controlled prompt ablation for classic PAT default-expiration guidance.
// Reuses the production runAgent path with an in-memory store; no app DB is opened.
// The treatment adds only the source-checked classic PAT default rule (candidate K3).

process.env.TYPESAFE_API_KEY = '';

const { modelStatus } = await import('../../server/config.js');
const { runAgent } = await import('../../server/agent.js');

if (!modelStatus().configured) {
  throw new Error('Live model is not configured; no comparison was run.');
}

const ticket = {
  id: 6,
  title: '组织调整 classic PAT 时限，旧令牌怎样？',
  description: '模拟问题：某 GitHub 组织将 classic personal access token（classic PAT）的最长有效期设为 180 天。一名成员已有的 classic PAT 生命周期超过该上限，但 token 页面仍显示尚未到期。它会因为策略变更当场被撤销或停用吗？下次访问该组织资源会怎样？GitHub 对 classic PAT 是否有默认过期要求？请勿把 fine-grained PAT 的默认规则套到 classic PAT；区分 GitHub 通用规则和该组织设置。',
  category: '账号与权限',
  urgency: 'normal',
  scope: 'sample',
};

const metaK2 = {
  source_kind: 'guide',
  scope: 'sample',
  applies_to: 'GitHub.com 组织成员的 personal access token；仅在 token 生命周期超过该组织当前最大有效期策略时适用。',
};
const metaK1 = {
  source_kind: 'guide',
  scope: 'sample',
  applies_to: 'GitHub.com fine-grained PAT；适用自 2024-10-18 的过期策略。个人项目与组织/企业资源分开判断；组织策略可调整。2022 beta 规则仅作历史参考。',
};
const metaK3 = {
  source_kind: 'guide',
  scope: 'sample',
  applies_to: 'GitHub.com classic personal access tokens；默认过期要求与目标组织自定义最大有效期策略需分开判断。',
};

const k2 = {
  ref: 'K2', id: 2, type: 'card',
  title: 'GitHub 组织 PAT 上限收紧后的存量 token 影响（补充说明）',
  snippet: '适用范围：GitHub.com 组织的 Personal access token 最大有效期策略。来源事实：当组织设定的最大有效期策略使某成员 token 不合规时，该 token 会被阻止访问该组织；仅设置策略不会撤销或停用 token。用户会在调用该组织 API 遭拒时发现 token 不合规。边界：是否属于该情形，以目标组织当前策略、token 类型和 token 所有者关系为准。本卡总结 GitHub 公开规则，不代表任何公司的内部制度。后续处理：先请组织/企业管理员核实当前策略和具体 token 情况。若需恢复访问，按管理员指引处理；GitHub 该页面未规定唯一恢复步骤，因此不要断言必须重新生成 token。不要要求用户提供 token 明文。',
  meta: metaK2,
};
const k1 = {
  ref: 'K1', id: 1, type: 'card',
  title: 'GitHub fine-grained PAT 过期规则：个人与组织资源',
  snippet: 'GitHub.com fine-grained PAT 过期规则 - 个人项目：可以创建无过期时间的 fine-grained PAT。 - 组织或企业资源：默认最大有效期为 366 天；管理员可以放宽或收紧策略。策略可能在创建、重新生成或使用 token 时生效。 - 2022 public beta 阶段要求 token 必须过期，属于历史规则，不应直接套用到当前版本。 - 具体组织或企业是否允许无过期，以其当前 PAT lifetime policy 为准。',
  meta: metaK1,
};
const k3 = {
  ref: 'K3', id: 3, type: 'card',
  title: 'GitHub classic PAT 默认过期与组织上限',
  snippet: '适用范围：GitHub.com personal access tokens (classic)。来源事实：GitHub 官方文档说明，classic PAT 默认没有强制过期要求；组织 owner 仍可为 classic PAT 设置最大有效期策略。边界：classic PAT 默认无强制过期，不等于所有组织都允许无过期 token；必须核实目标组织的当前策略。不要把 fine-grained PAT 的组织/企业资源默认 366 天规则套用到 classic PAT。若目标组织已设置有效期上限，存量不合规 token 的组织访问影响见 K2「GitHub 组织 PAT 上限收紧后的存量 token 影响（补充说明）」；具体 token 是否受限取决于当前组织策略、token 类型和所有者关系。该公开规则不代表任何公司的内部制度。',
  meta: metaK3,
};

async function oneRun(variant, trial) {
  const sources = variant === 'treatment' ? [k3, k2, k1] : [k2, k1];
  const store = {
    searchApprovedMemory: () => sources,
    createRun: (run) => run,
  };
  const run = await runAgent({
    store,
    ticket,
    mode: 'organization',
    runGroup: `classic-pat-default-${trial}-${variant}`,
  });
  return {
    trial,
    variant,
    origin: run.origin,
    model: run.model,
    latencyMs: run.latencyMs,
    contextRefs: sources.map((source) => source.ref),
    citations: run.output.citations,
    draft_reply: run.output.draft_reply,
    uncertainties: run.output.uncertainties,
  };
}

const results = [];
for (let trial = 1; trial <= 3; trial += 1) {
  const order = trial % 2 ? ['baseline', 'treatment'] : ['treatment', 'baseline'];
  for (const variant of order) results.push(await oneRun(variant, trial));
}

process.stdout.write(`${JSON.stringify({
  experiment: 'Actual #6 context (K2 + K1) vs. same context plus candidate K3',
  storage: 'in-memory store stub; no application database writes',
  data: 'synthetic ticket and GitHub public-source text only',
  sidecar: 'TypeSafe disabled for this comparison',
  runs: results,
}, null, 2)}\n`);

if (results.some((result) => result.origin !== 'live')) process.exitCode = 2;
