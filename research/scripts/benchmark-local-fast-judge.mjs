// Local-only relevance gate benchmark using synthetic sample knowledge.
// This exercises LM Studio's OpenAI-compatible chat endpoint, not System One.
const BASE = (process.env.LOCAL_LLM_BASE || 'http://127.0.0.1:1234/v1').replace(/\/$/, '');
const MODEL = process.env.LOCAL_LLM_MODEL || 'qwen2-vl-2b-instruct';
const source = {
  ref: 'K19',
  title: '软件与授权：[效果演示] 设计软件 7 天试用授权申请',
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

const system = '你是组织记忆检索闸门，只判断候选来源是否含有能帮助回答具体问题的信息（支持、反驳或限定都算）。主题相似不够。不要判断来源权威性。只输出 JSON，不要输出 Markdown。';
const responseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'relevance_judgement',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, answerable: { type: 'boolean' } },
            required: ['id', 'answerable'],
            additionalProperties: false,
          },
        },
      },
      required: ['results'],
      additionalProperties: false,
    },
  },
};
const request = async (user, maxTokens = 120) => {
  const started = performance.now();
  const response = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      max_tokens: maxTokens,
      response_format: responseFormat,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(60000),
  });
  const elapsedMs = Math.round(performance.now() - started);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Local chat returned HTTP ${response.status}: ${JSON.stringify(body)}`);
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error(`Missing message content: ${JSON.stringify(body)}`);
  return { elapsedMs, content, usage: body.usage };
};

const parseAnswer = (content) => {
  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed.results)) throw new Error(`Expected results array: ${content}`);
  return parsed.results;
};
const sourceJson = JSON.stringify(source);
const warmup = await request('只输出 JSON：{"results":[{"id":"warmup","answerable":true}]}', 16);

const batchUser = JSON.stringify({
  task: '逐项判断 source 是否能帮助回答 case 的具体问题。只要主题相似但内容不能用于回答，就判 false。',
  source,
  cases: cases.map(({ id, title, description }) => ({ id, title, description })),
  output_schema: { results: [{ id: '原 id', answerable: true }] },
});
const batch = await request(batchUser, 180);
const batchAnswers = parseAnswer(batch.content);

const sequential = [];
for (const item of cases) {
  const result = await request(JSON.stringify({
    task: '判断唯一候选来源能否帮助回答此问题。只要主题相似但内容不能用于回答，就判 false。',
    source: JSON.parse(sourceJson),
    case: { id: item.id, title: item.title, description: item.description },
    output_schema: { results: [{ id: item.id, answerable: true }] },
  }), 48);
  const parsed = parseAnswer(result.content);
  sequential.push({ id: item.id, expected_answerable: item.expected, predicted_answerable: parsed[0]?.answerable, latency_ms: result.elapsedMs });
}

const batchById = new Map(batchAnswers.map((row) => [row.id, row.answerable]));
const batchResults = cases.map((item) => ({
  id: item.id,
  expected_answerable: item.expected,
  predicted_answerable: batchById.get(item.id),
  match: batchById.get(item.id) === item.expected,
}));
const sequentialMatches = sequential.filter((row) => row.predicted_answerable === row.expected_answerable).length;
const times = sequential.map((row) => row.latency_ms).sort((a, b) => a - b);
process.stdout.write(`${JSON.stringify({
  model: MODEL,
  endpoint: `${BASE}/chat/completions`,
  local_only: true,
  dataset: '10 synthetic relevance checks over fictional K19 content; labels are hand-authored test expectations, not business outcomes',
  warmup_ms: warmup.elapsedMs,
  batch: { request_count: 1, elapsed_ms: batch.elapsedMs, matches: batchResults.filter((row) => row.match).length, cases: batchResults.length, results: batchResults },
  sequential: {
    request_count: sequential.length,
    total_elapsed_ms: sequential.reduce((sum, row) => sum + row.latency_ms, 0),
    median_elapsed_ms: times[Math.floor(times.length / 2)],
    matches: sequentialMatches,
    cases: sequential.length,
    results: sequential,
  },
}, null, 2)}\n`);
