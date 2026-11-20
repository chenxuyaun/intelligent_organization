/*
 * Live TypeSafe benchmark using only fictional K19 content.
 * This script makes 10 billable API calls and writes no database data.
 * The expected labels are hand-authored synthetic checks, not business policy.
 */

process.env.TYPESAFE_MEMORY_GATE = 'shadow';
const { assessMemoryRelevance } = await import('../../server/typesafe-gate.js');

const source = {
  ref: 'K19',
  title: '软件与授权：[效果演示] 设计软件 7 天试用授权申请',
  snippet: '仅作虚构演示，不代表真实制度：申请时说明软件用途与试用期限，经项目负责人确认后安排 7 天试用，到期前复核是否续用。',
  type: 'card',
  meta: { scope: 'sample', source_kind: 'unknown' },
};

const cases = [
  { id: 'trial_application', expected: true, title: '申请设计软件 7 天试用', description: '试用申请前应说明什么，到期前何时复核续用？' },
  { id: 'purpose_and_term', expected: true, title: '试用申请信息', description: '申请时是否要说明软件用途和试用期限？' },
  { id: 'renewal_timing', expected: true, title: '试用到期处理', description: '7 天试用到期前要做什么？' },
  { id: 'single_user_sharing', expected: false, title: '单人许可证共享', description: '单人版账号可以给同事轮流登录使用吗？' },
  { id: 'thirty_day_trial', expected: true, title: '试用期限对照', description: '这条记忆写的试用期限是 7 天还是 30 天？' },
  { id: 'automatic_renewal', expected: true, title: '自动续期反证', description: '这条记忆对“试用到期后可不复核自动续期”提供了什么相关信息？' },
  { id: 'concurrent_seats', expected: false, title: '并发席位条款', description: '合同允许多少人同时使用许可证？' },
  { id: 'printer_offline', expected: false, title: '打印机离线', description: '楼层打印机显示离线，怎样恢复？' },
  { id: 'vpn_certificate', expected: false, title: 'VPN 证书', description: 'VPN 证书过期后应如何续期？' },
  { id: 'project_lead_confirmation', expected: true, title: '负责人确认', description: '试用申请是否需要项目负责人确认？' },
];

const results = [];
for (const item of cases) {
  try {
    const result = await assessMemoryRelevance({
      title: item.title,
      description: item.description,
      category: '软件与授权',
      scope: 'sample',
    }, [source]);
    const decision = result.decisions[0];
    const predicted = decision.answerability_probability >= 0.5;
    results.push({
      id: item.id,
      model: result.model,
      expected_answerable: item.expected,
      answerability_probability: decision.answerability_probability,
      recommendation: decision.recommendation,
      binary_match: predicted === item.expected,
      latency_ms: result.latencyMs,
    });
  } catch (error) {
    results.push({ id: item.id, expected_answerable: item.expected, error: error?.name || 'error' });
  }
}

const valid = results.filter((row) => Number.isFinite(row.answerability_probability));
const decisive = valid.filter((row) => row.recommendation !== 'uncertain');
const models = [...new Set(valid.map((row) => row.model))];
console.log(JSON.stringify({
  models,
  cases: results.length,
  binary_matches_at_0_5: valid.filter((row) => row.binary_match).length,
  decisive_matches: decisive.filter((row) => row.binary_match).length,
  decisive_count: decisive.length,
  results,
}, null, 2));
