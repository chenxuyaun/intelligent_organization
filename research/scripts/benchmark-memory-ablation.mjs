// Compare a human-reviewed case with published rule cards on a fresh synthetic
// question. Reads the isolated app for approved sources, then runs all answer
// conditions in memory; it does not write tickets, runs, reviews, or cards.
process.env.TYPESAFE_API_KEY = '';
process.env.TYPESAFE_MEMORY_GATE = 'off';

const BASE = (process.env.BENCHMARK_BASE || 'http://127.0.0.1:4186').replace(/\/$/, '');
const query = 'classic PAT 仍显示有效，就一定能访问组织吗？ token 400 天，组织最大有效期 180 天';

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

const [ticket10, ticket9, memory] = await Promise.all([
  get('/api/tickets/10'),
  get('/api/tickets/9'),
  get(`/api/memory?q=${encodeURIComponent(query)}`),
]);

const reviewedRun = ticket9.runs.find((run) => run.id === 11);
const adoptedResolvedCase = ticket9.ticket?.scope === 'sample'
  && ticket9.ticket?.status === 'resolved'
  && reviewedRun?.reviews?.some((review) => review.decision === 'adopt'
    && review.reviewer === '陈朋'
    && review.review_source_type === 'human');
if (!adoptedResolvedCase) throw new Error('C9 is not the expected resolved, human-adopted sample case; no model calls were made.');
if (ticket10.ticket?.scope !== 'sample' || ticket10.ticket?.status !== 'open') {
  throw new Error('Ticket #10 is not the expected open sample; no model calls were made.');
}

const candidates = memory.preview || [];
const byRef = new Map(candidates.map((source) => [source.ref, source]));
for (const ref of ['C9', 'K3', 'K2']) {
  if (!byRef.has(ref)) throw new Error(`Fresh search did not return ${ref} (got ${[...byRef.keys()].join(', ')}); no model calls were made.`);
}
if (byRef.has('C10')) throw new Error('Current open ticket C10 leaked into retrieval; no model calls were made.');
const pendingCards = (memory.cards || []).filter((card) => card.status === 'pending');
if (candidates.some((source) => source.type === 'card' && pendingCards.some((card) => card.id === source.id))) {
  throw new Error('A pending card leaked into retrieval; no model calls were made.');
}

const ticket = {
  id: 999,
  title: 'classic PAT 仍显示有效，就一定能访问组织吗？',
  description: '虚构情境：一张 GitHub personal access token (classic) 创建约 400 天，持有人没有设置个人过期日；它最近仍在使用，因此不是一年未使用的情形。token 仍显示在持有人的设置列表中。组织管理员近期把 classic PAT 最大有效期设为 180 天，持有人仍是组织成员。请判断“仍显示/仍有效”能否推出它还能访问该组织资源；区分 token 是否被撤销或停用、组织策略是否阻止访问、以及尚需核实的状态。不要假设重新生成必然，也不要要求 token 明文。',
  category: '账号与权限',
  urgency: 'normal',
  status: 'open',
  scope: 'sample',
};

const conditions = [
  { key: 'case_only', mode: 'organization', refs: ['C9'] },
  { key: 'cards_only', mode: 'organization', refs: ['K3', 'K2'] },
  { key: 'case_and_cards', mode: 'organization', refs: ['C9', 'K3', 'K2'] },
  { key: 'personal_no_memory', mode: 'personal', refs: [] },
];

const results = await Promise.all(conditions.map(async ({ key, mode, refs }) => {
  const sources = refs.map((ref) => byRef.get(ref));
  const store = {
    searchApprovedMemory: () => sources,
    createRun: (run) => run,
  };
  const run = await runAgent({ store, ticket, mode, runGroup: `memory-ablation-${key}-${Date.now()}` });
  return {
    condition: key,
    mode: run.mode,
    origin: run.origin,
    promptVersion: run.promptVersion,
    latencyMs: run.latencyMs,
    retrievedRefs: (run.contextSources || []).map((source) => source.ref),
    citedRefs: [...new Set((run.output.citations || []).map((citation) => citation.ref))],
    citations: run.output.citations || [],
    reply: run.output.draft_reply,
    uncertainties: run.output.uncertainties,
  };
}));

process.stdout.write(`${JSON.stringify({
  experiment: 'Memory-source ablation for an accepted answer on a fresh synthetic question',
  storage: 'GET-only app API + in-memory runAgent store; no application-data writes',
  ticketIsSynthetic: true,
  freshQuestionTicketId: 10,
  sourceCase: { ticketId: 9, runId: 11, status: ticket9.ticket.status, decision: 'human/adopt', reviewer: '陈朋' },
  retrievedCandidates: candidates.map(({ ref, id, type, title }) => ({ ref, id, type, title })),
  promptVersion: PROMPT_VERSION,
  model: modelStatus().model,
  results,
}, null, 2)}\n`);

if (results.some((result) => result.origin !== 'live')) process.exitCode = 2;
