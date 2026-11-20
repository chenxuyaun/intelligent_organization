// Run one in-memory matched pair against freshly retrieved, human-reviewed
// sample memory from the disposable 4186 service. Performs GETs only against
// the app and does not write runs, reviews, cards, or tickets.
process.env.TYPESAFE_API_KEY = '';
process.env.TYPESAFE_MEMORY_GATE = 'off';

const BASE = (process.env.BENCHMARK_BASE || 'http://127.0.0.1:4186').replace(/\/$/, '');
const query = 'classic PAT 已 14 个月未使用，个人到期日还在 8 个月后，组织最大有效期 180 天，怎样判断是否还能用？';

const [{ modelStatus }, { runAgent, PROMPT_VERSION }] = await Promise.all([
  import('../../server/config.js'),
  import('../../server/agent.js'),
]);

async function get(path) {
  const response = await fetch(`${BASE}${path}`);
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${body.error || response.statusText}`);
  return body;
}

if (!modelStatus().configured) throw new Error('Live answer model is not configured; no model calls were made.');
const [reviewedCase, memory] = await Promise.all([
  get('/api/tickets/7'),
  get(`/api/memory?q=${encodeURIComponent(query)}`),
]);

const reviewedRun = reviewedCase.runs.find((run) => run.id === 10);
const humanAdopted = reviewedCase.ticket?.scope === 'sample'
  && reviewedCase.ticket?.status === 'resolved'
  && reviewedRun?.mode === 'organization'
  && reviewedRun?.reviews?.some((review) => review.decision === 'adopt'
    && review.reviewer === '陈朋'
    && review.review_source_type === 'human');
if (!humanAdopted) throw new Error('C7 is not the expected resolved, human-adopted sample case; no model calls were made.');

const sources = memory.preview || [];
const refs = sources.map((source) => source.ref);
if (!refs.includes('C7') || !refs.includes('K3')) {
  throw new Error(`Fresh search did not return both C7 and K3 (got ${refs.join(', ')}); no model calls were made.`);
}
const pendingCards = (memory.cards || []).filter((card) => card.status === 'pending');
if (sources.some((source) => source.type === 'card' && pendingCards.some((card) => card.id === source.id))) {
  throw new Error('A pending card leaked into retrieval; no model calls were made.');
}

const ticket = {
  id: 999,
  title: '未使用 14 个月的 classic PAT 是否还能访问组织？',
  description: '虚构样本：classic PAT 个人页面显示 8 个月后到期；约 14 个月未使用；目标组织设置了 180 天最大有效期。请区分 token 是否仍存在、个人过期日、一年未使用清理和组织访问限制，说明只读核实步骤。不要断言必须重新生成 token。',
  category: '账号与权限',
  urgency: 'normal',
  status: 'open',
  scope: 'sample',
};
const runGroup = `human-reviewed-case-reuse-${Date.now()}`;
const store = {
  searchApprovedMemory: () => sources,
  createRun: (run) => run,
};
const [personal, organization] = await Promise.all([
  runAgent({ store, ticket, mode: 'personal', runGroup }),
  runAgent({ store, ticket, mode: 'organization', runGroup }),
]);

const summarize = (run) => ({
  mode: run.mode,
  origin: run.origin,
  promptVersion: run.promptVersion,
  latencyMs: run.latencyMs,
  retrievedRefs: (run.contextSources || []).map((source) => source.ref),
  citedRefs: [...new Set((run.output.citations || []).map((citation) => citation.ref))],
  reply: run.output.draft_reply,
  uncertainties: run.output.uncertainties,
});
process.stdout.write(`${JSON.stringify({
  experiment: 'Fresh retrieval of a resolved, human-adopted sample case plus published memory',
  storage: 'GET-only app API + in-memory runAgent store; no application-data writes',
  ticketIsSynthetic: true,
  sourceCase: { ticketId: 7, runId: 10, status: reviewedCase.ticket.status, decision: 'human/adopt', reviewer: '陈朋' },
  retrievedSources: sources.map(({ ref, id, type, title, score, snippet }) => ({ ref, id, type, title, score, snippet })),
  pendingCardIdsExcluded: pendingCards.map((card) => card.id),
  model: modelStatus().model,
  promptVersion: PROMPT_VERSION,
  personal: summarize(personal),
  organization: summarize(organization),
}, null, 2)}\n`);

if (personal.origin !== 'live' || organization.origin !== 'live') process.exitCode = 2;
