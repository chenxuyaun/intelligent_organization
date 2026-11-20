// One-call check: does the revised paragraph selector preserve K3's default rule in production prompts?
// Reads sample ticket/cards from 4182; uses an in-memory store stub; writes no application data.
// Sends only a synthetic GitHub question and public-rule card text to the configured answer model.
process.env.TYPESAFE_API_KEY = '';

const BASE = 'http://127.0.0.1:4182';
const { modelStatus } = await import('../../server/config.js');
const { runAgent } = await import('../../server/agent.js');
const { searchMemory } = await import('../../server/retrieval.js');
const { ticketQuery } = await import('../../server/demo-brain.js');

if (!modelStatus().configured) throw new Error('Live model is not configured; no comparison was run.');

async function get(path) {
  const response = await fetch(`${BASE}${path}`);
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${body.error || response.statusText}`);
  return body;
}

const [memory, ticketView] = await Promise.all([
  get('/api/memory?status=published'),
  get('/api/tickets/7'),
]);
const ticket = ticketView.ticket;
const k3 = memory.cards.find((card) => card.id === 3);
if (ticket.scope !== 'sample' || k3?.status !== 'published' || k3.scope !== 'sample') {
  throw new Error('Expected sample ticket #7 and published sample K3; no model call was made.');
}
const baseline = [...ticketView.runs]
  .filter((run) => run.mode === 'organization')
  .sort((a, b) => b.id - a.id)[0];
if (!baseline || baseline.origin !== 'live') throw new Error('Expected the persisted live baseline run; no model call was made.');

const corpus = memory.cards.map((card) => ({
  id: card.id,
  type: 'card',
  title: card.title,
  body: card.content,
  tags: card.tags,
  category: card.source_category || '',
  meta: {
    status: card.status,
    sourceTicketId: card.source_ticket_id,
    version: card.version,
    scope: card.scope || 'sample',
    source_kind: card.source_kind || 'unknown',
    source_kind_label: card.source_kind_label || '',
    source_ref: card.source_ref || '',
    applies_to: card.applies_to || '',
    approval_body: card.approval_body || '',
    knowledge_owner: card.knowledge_owner || '',
    valid_until: card.valid_until || null,
    pilot_approved: Boolean(card.pilot_approved),
  },
}));
const variant = process.env.SNIPPET_VARIANT === 'legacy' ? 'legacy' : 'revised';
const sources = variant === 'legacy'
  ? (baseline.context_sources || [])
  : searchMemory(ticketQuery(ticket), corpus, { limit: 4, category: ticket.category });
const excerpt = sources.find((source) => source.ref === 'K3')?.snippet || '';
if (!sources.some((source) => source.ref === 'K3')) throw new Error('Selected retrieval variant did not return K3; no model call was made.');

const repeat = Math.max(1, Number(process.env.SNIPPET_REPEAT || 1));
const runs = [];
for (let trial = 1; trial <= repeat; trial += 1) {
  runs.push(await runAgent({
    store: {
      searchApprovedMemory: () => sources,
      createRun: (value) => value,
    },
    ticket,
    mode: 'organization',
    runGroup: `classic-pat-snippet-repair-${Date.now()}-${trial}`,
  }));
}
const result = {
  experiment: 'Same synthetic ticket #7; production runAgent with persisted legacy excerpt or revised in-memory retrieval excerpt',
  storage: 'read-only 4182 API + in-memory store stub; no application database writes',
  snippetVariant: variant,
  baseline: {
    runGroup: baseline.run_group,
    refs: (baseline.context_sources || []).map((source) => source.ref),
    k3Snippet: (baseline.context_sources || []).find((source) => source.ref === 'K3')?.snippet || '',
    answeredNoMandatoryClassicExpiry: /classic PAT.{0,80}(没有|无).{0,25}(必须|强制).{0,25}(过期|期限)/i.test(baseline.output?.draft_reply || ''),
  },
  condition: {
    refs: sources.map((source) => source.ref),
    k3Snippet: excerpt,
    runs: runs.map((run, index) => {
      const answer = run.output.draft_reply || '';
      return {
        trial: index + 1,
        model: run.model,
        origin: run.origin,
        latencyMs: run.latencyMs,
        citations: (run.output.citations || []).map(({ ref, quote }) => ({ ref, quote })),
        answer,
        uncertainties: run.output.uncertainties,
        answeredNoMandatoryClassicExpiry: /classic PAT.{0,100}(没有|无).{0,25}(必须|强制).{0,25}(过期|期限)/i.test(answer),
      };
    }),
  },
  checks: {
    excerptContainsDefaultRule: excerpt.includes('没有必须设置过期时间的要求'),
    allRunsLive: runs.every((run) => run.origin === 'live'),
    explicitFactCount: runs.filter((run) => /classic PAT.{0,100}(没有|无).{0,25}(必须|强制).{0,25}(过期|期限)/i.test(run.output.draft_reply || '')).length,
    totalRuns: runs.length,
  },
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (runs.some((run) => run.origin !== 'live')) process.exitCode = 2;
