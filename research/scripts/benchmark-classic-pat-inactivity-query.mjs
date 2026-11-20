// Check whether the refined pending K3 separates inactivity removal from an org lifetime block.
// Uses the production runAgent path with an in-memory store; no app DB is opened or written.

process.env.TYPESAFE_API_KEY = '';

const { modelStatus } = await import('../../server/config.js');
const { runAgent } = await import('../../server/agent.js');

if (!modelStatus().configured) throw new Error('Live model is not configured; no comparison was run.');

const ticket = {
  id: 8,
  title: '一年未使用的 classic PAT 与组织上限如何区分？',
  description: '我是某 GitHub 组织的成员，手上有一枚 classic PAT：token 页面显示 2027 年到期，但它已经 14 个月没有使用。组织现在把 classic PAT 最大有效期设为 180 天；这枚 token 创建于两年前。GitHub 会因一年未使用而移除 token 吗？它也会因超过组织上限而被阻止访问组织吗？请区分 token 本身的移除与组织资源访问限制，不要把 fine-grained PAT 的 366 天规则套给 classic，并告诉我先核实什么。不要要求我提供 token 明文。',
  category: '账号与权限',
  urgency: 'normal',
  scope: 'sample',
};

const k3 = {
  ref: 'K3', id: 3, type: 'card',
  title: 'GitHub classic PAT 默认过期与组织上限',
  snippet: '默认规则：GitHub 组织 PAT 政策文档说明，classic PAT 没有必须设置过期时间的要求；创建者仍可为单张 token 选择过期日期，因此“没有强制过期要求”不等于“每张 token 都永不过期”。组织 owner 可以为 classic PAT 设置最大有效期。若 token 属于该组织成员且生命周期超过当前上限，它会被阻止访问该组织；设置策略本身不会撤销或停用 token。组织资源下 fine-grained PAT 的默认最大有效期为 366 天；此规则不适用于 classic PAT。GitHub 会自动移除一年未使用的 personal access token，这是独立于强制过期要求的清理规则；应核实 token 最近使用时间。',
  meta: { source_kind: 'guide', scope: 'sample', applies_to: 'GitHub.com classic personal access tokens；默认过期要求与目标组织最大生命周期策略分别判断。' },
};
const k2 = {
  ref: 'K2', id: 2, type: 'card',
  title: 'GitHub 组织 PAT 上限收紧后的存量 token 影响（补充说明）',
  snippet: '当组织设定的最大有效期策略使某成员 token 不合规时，该 token 会被阻止访问该组织；仅设置策略不会撤销或停用 token。用户会在调用该组织 API 遭拒时发现 token 不合规。具体 token 是否受限，以组织当前策略、token 类型和 token 所有者关系为准。恢复访问的具体步骤由组织/企业管理员核实；GitHub 页面没有规定唯一恢复步骤，因此不要断言必须重新生成 token。不要索取 token 明文。',
  meta: { source_kind: 'guide', scope: 'sample', applies_to: 'GitHub.com 组织成员的 personal access token；限于超过当前组织最大有效期策略的情形。' },
};
const k1 = {
  ref: 'K1', id: 1, type: 'card',
  title: 'GitHub fine-grained PAT 过期规则：个人与组织资源',
  snippet: 'GitHub.com fine-grained PAT：个人项目可以创建无过期时间的 fine-grained PAT；组织或企业资源默认最大有效期为 366 天，管理员可以放宽或收紧。2022 public beta 的必须过期是历史规则，不应套到当前版本。',
  meta: { source_kind: 'guide', scope: 'sample', applies_to: 'GitHub.com fine-grained PAT；组织或企业策略可能调整。' },
};

async function oneRun(variant, trial) {
  const sources = variant === 'organization-memory' ? [k3, k2, k1] : [];
  const store = { searchApprovedMemory: () => sources, createRun: (run) => run };
  const run = await runAgent({
    store,
    ticket,
    mode: variant === 'organization-memory' ? 'organization' : 'personal',
    runGroup: `classic-pat-inactivity-${trial}-${variant}`,
  });
  return {
    trial,
    variant,
    origin: run.origin,
    model: run.model,
    latencyMs: run.latencyMs,
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
  experiment: 'Inactivity rule vs. organization lifetime policy; refined pending K3',
  storage: 'in-memory store stub; no application database writes',
  data: 'synthetic ticket and GitHub public-source text only',
  sidecar: 'TypeSafe disabled for this comparison',
  runs: results,
}, null, 2)}\n`);

if (results.some((result) => result.origin !== 'live')) process.exitCode = 2;
