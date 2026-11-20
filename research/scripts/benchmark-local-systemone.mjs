// Compare one batched local System One request with 10 concurrent one-question
// requests over the same fictional K19 cases. LM Studio is called on localhost.
const BASE = (process.env.LOCAL_SYSTEMONE_BASE || 'http://127.0.0.1:1234').replace(/\/$/, '');
const MODEL = process.env.LOCAL_DECISION_MODEL || 'kev-local-fast';

const source = {
  ref: 'K19',
  title: '软件与授权：[效果演示] 设计软件 7 天试用授权申请',
  source_kind: 'unknown',
  text: '仅作虚构演示，不代表真实制度：申请时说明软件用途与试用期限，经项目负责人确认后安排 7 天试用，到期前复核是否续用。',
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

const state = {
  source,
  evaluation_rule: '仅评估来源是否含有帮助回答当前问题的信息（包括支持、反驳或限制）；主题相似不够；不要评估来源权威性。',
};

const questions = Object.fromEntries(cases.map((item) => [`case_${item.id}`, {
  type: 'noul',
  instructions: `只评估案例 ${item.id}。工单标题：${item.title}。工单描述：${item.description}。候选来源是否包含能帮助回答此工单具体问题的信息？`,
  criteria: {
    true: '来源包含与当前具体问题直接相关、能支持或反驳答案的信息。',
    false: '来源只有主题相似，或没有能用于回答当前具体问题的内容。',
  },
}]));

const request = async (questionSet) => {
  const started = performance.now();
  const response = await fetch(`${BASE}/v1/systemone`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, state, questions: questionSet }),
    signal: AbortSignal.timeout(60000),
  });
  const elapsedMs = Math.round(performance.now() - started);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Local System One returned HTTP ${response.status}: ${JSON.stringify(body)}`);
  return { elapsedMs, body };
};

const batch = await request(questions);

const toResult = (item, answer) => {
  const probability = Number(answer?.noul);
  if (answer?.type !== 'noul' || !Number.isFinite(probability) || probability < 0 || probability > 1) {
    return { id: item.id, expected_answerable: item.expected, error: 'invalid_structured_answer', answer };
  }
  return {
    id: item.id,
    expected_answerable: item.expected,
    answerability_probability: probability,
    recommendation: probability >= 0.8 ? 'likely_answerable' : probability <= 0.2 ? 'likely_not_answerable' : 'uncertain',
    binary_match_at_0_5: (probability >= 0.5) === item.expected,
  };
};
const batchResults = cases.map((item) => toResult(item, batch.body.answers?.[`case_${item.id}`]));

const concurrentStarted = performance.now();
const concurrentResults = await Promise.all(cases.map(async (item) => {
  try {
    const call = await request({ [`case_${item.id}`]: questions[`case_${item.id}`] });
    const result = toResult(item, call.body.answers?.[`case_${item.id}`]);
    return { ...result, latency_ms: call.elapsedMs };
  } catch (error) {
    return { id: item.id, expected_answerable: item.expected, error: error?.message || 'request_failed' };
  }
}));
const concurrentElapsedMs = Math.round(performance.now() - concurrentStarted);
const batchValid = batchResults.filter((item) => Number.isFinite(item.answerability_probability));
const concurrentValid = concurrentResults.filter((item) => Number.isFinite(item.answerability_probability));
const concurrentTimes = concurrentResults.map((item) => item.latency_ms).filter(Number.isFinite).sort((a, b) => a - b);

process.stdout.write(`${JSON.stringify({
  model: batch.body.model || MODEL,
  endpoint: `${BASE}/v1/systemone`,
  local_only: true,
  dataset: 'same 10 fictional K19 checks as benchmark-typesafe-memory-gate.mjs',
  batch: {
    request_count: 1,
    cases: batchResults.length,
    binary_matches_at_0_5: batchValid.filter((item) => item.binary_match_at_0_5).length,
    elapsed_ms: batch.elapsedMs,
    answers: batchResults,
  },
  concurrent_single_question_requests: {
    request_count: concurrentResults.length,
    cases: concurrentResults.length,
    wall_elapsed_ms: concurrentElapsedMs,
    request_latency_median_ms: concurrentTimes.length ? concurrentTimes[Math.floor(concurrentTimes.length / 2)] : null,
    binary_matches_at_0_5: concurrentValid.filter((item) => item.binary_match_at_0_5).length,
    answers: concurrentResults,
  },
}, null, 2)}\n`);

if (batchValid.length !== cases.length || concurrentValid.length !== cases.length) process.exitCode = 2;
