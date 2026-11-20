// Controlled prompt ablation for the K1 PAT lifetime-policy boundary.
// This calls the production runAgent prompt path with an in-memory store stub.
// It never opens or writes the application database, and TypeSafe is disabled.

process.env.TYPESAFE_API_KEY = '';

const { modelStatus } = await import('../../server/config.js');
const { runAgent } = await import('../../server/agent.js');

if (!modelStatus().configured) {
  throw new Error('Live model is not configured; no comparison was run.');
}

const ticket = {
  id: 4,
  title: 'PAT 上限收紧后旧 token 会怎样？',
  description: '假设某 GitHub 组织把 fine-grained PAT 最大有效期从 366 天收紧到 90 天。成员以前创建的 180 天 token 会立刻被撤销吗？下次调用该组织 API 会发生什么？是否需要重新生成？请区分 GitHub 通用规则与该组织当前设置。',
  category: '账号与权限',
  urgency: 'normal',
  scope: 'sample',
};

const baseline = 'GitHub.com fine-grained PAT 过期规则\n\n- 个人项目：可以创建无过期时间的 fine-grained PAT。\n- 组织或企业资源：默认最大有效期为 366 天；管理员可以放宽或收紧策略。策略可能在创建、重新生成或使用 token 时生效。\n- 2022 public beta 阶段要求 token 必须过期，属于历史规则，不应直接套用到当前版本。\n- 具体组织或企业是否允许无过期，以其当前 PAT lifetime policy 为准。';

const supplement = '若组织设置的 fine-grained PAT 有效期上限使成员现有 token 不符合要求，该 token 不会仅因设置策略而自动撤销或停用，但会被阻止访问该组织；用户会在调用组织 API 被拒绝时发现不符合要求。具体影响以该组织当前策略为准。';
const treatment = `${baseline}\n- ${supplement}`;

const card = (snippet) => ({
  ref: 'K1',
  id: 1,
  type: 'card',
  title: 'GitHub fine-grained PAT 过期规则：个人与组织资源',
  snippet,
  meta: {
    source_kind: 'guide',
    scope: 'sample',
    applies_to: 'GitHub.com fine-grained PAT；适用自 2024-10-18 的过期策略。个人项目与组织/企业资源分开判断；组织策略可调整。2022 beta 规则仅作历史参考。',
  },
});

async function oneRun(variant, trial) {
  const context = card(variant === 'treatment' ? treatment : baseline);
  const store = {
    searchApprovedMemory: () => [context],
    createRun: (run) => run,
  };
  const run = await runAgent({
    store,
    ticket,
    mode: 'organization',
    runGroup: `k1-boundary-${trial}-${variant}`,
  });
  return {
    trial,
    variant,
    origin: run.origin,
    model: run.model,
    latencyMs: run.latencyMs,
    citations: run.output.citations,
    draft_reply: run.output.draft_reply,
    next_actions: run.output.next_actions,
    uncertainties: run.output.uncertainties,
  };
}

const results = [];
for (let trial = 1; trial <= 3; trial += 1) {
  // Alternate call order to reduce time/order effects across the two variants.
  const order = trial % 2 ? ['baseline', 'treatment'] : ['treatment', 'baseline'];
  for (const variant of order) results.push(await oneRun(variant, trial));
}

const summary = {
  experiment: 'K1 existing text vs. same text plus GitHub old-token policy boundary',
  storage: 'in-memory store stub; no application DB writes',
  user_data: 'synthetic ticket and public-source text only',
  sidecar: 'TypeSafe disabled for this comparison',
  runs: results,
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

if (results.some((result) => result.origin !== 'live')) {
  process.exitCode = 2;
}
