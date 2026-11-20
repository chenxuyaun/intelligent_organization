// Repeat a real sample ticket's paired generation while keeping its retrieved
// evidence fixed. Reads the sample service API and writes no application data.
process.env.TYPESAFE_API_KEY = '';
process.env.TYPESAFE_MEMORY_GATE = 'off';

const BASE = (process.env.BENCHMARK_BASE || 'http://127.0.0.1:4186').replace(/\/$/, '');
const TICKET_ID = Number(process.env.BENCHMARK_TICKET_ID || 8);
const REPEATS = Math.max(1, Math.min(5, Number(process.env.BENCHMARK_REPEATS || 2)));

const { modelStatus } = await import('../../server/config.js');
const { runAgent, PROMPT_VERSION } = await import('../../server/agent.js');
if (!modelStatus().configured) throw new Error('Live answer model is not configured; no calls were made.');

async function get(path) {
  const response = await fetch(`${BASE}${path}`);
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${body.error || response.statusText}`);
  return body;
}

const view = await get(`/api/tickets/${TICKET_ID}`);
if (view.ticket?.scope !== 'sample' || !['open', 'in_progress'].includes(view.ticket.status)) {
  throw new Error('Expected an open sample ticket; no model calls were made.');
}
const baseline = [...view.runs]
  .filter((run) => run.mode === 'organization')
  .sort((a, b) => b.id - a.id)[0];
const sources = baseline?.context_sources || [];
if (!baseline || baseline.origin !== 'live' || !sources.length) {
  throw new Error('Expected a persisted live organization run with retrieved sources; no model calls were made.');
}

const results = [];
for (let trial = 1; trial <= REPEATS; trial += 1) {
  const runGroup = `published-memory-repeat-${Date.now()}-${trial}`;
  const store = {
    searchApprovedMemory: () => sources,
    createRun: (run) => run,
  };
  const [personal, organization] = await Promise.all([
    runAgent({ store, ticket: view.ticket, mode: 'personal', runGroup }),
    runAgent({ store, ticket: view.ticket, mode: 'organization', runGroup }),
  ]);
  results.push({
    trial,
    baselineRunGroup: baseline.run_group,
    promptVersion: PROMPT_VERSION,
    originPersonal: personal.origin,
    originOrganization: organization.origin,
    latencyMsPersonal: personal.latencyMs,
    latencyMsOrganization: organization.latencyMs,
    personalRefs: (personal.contextSources || []).map((source) => source.ref),
    organizationRefs: (organization.contextSources || []).map((source) => source.ref),
    organizationCitations: organization.output.citations,
    organizationGeneralChecks: organization.output.general_checks || [],
    organizationDraftContainsGenericSection: /(?:^|\n)\s*(?:通用核查项|通用检查项|一般核查建议)(?:\s*[（(][^）)]*[）)])?\s*[：:]/m.test(organization.output.draft_reply || ''),
    personalReply: personal.output.draft_reply,
    organizationReply: organization.output.draft_reply,
    organizationUncertainties: organization.output.uncertainties,
  });
}

process.stdout.write(`${JSON.stringify({
  experiment: 'Repeated paired generation for an existing synthetic sample ticket',
  ticketId: TICKET_ID,
  storage: 'GET-only application API + in-memory runAgent store stub; no database writes',
  model: modelStatus().model,
  promptVersion: PROMPT_VERSION,
  sourceRunGroup: baseline.run_group,
  fixedSources: sources.map(({ ref, type, title, snippet }) => ({ ref, type, title, snippet })),
  repeats: results,
}, null, 2)}\n`);

if (results.some((result) => result.originPersonal !== 'live' || result.originOrganization !== 'live')) {
  process.exitCode = 2;
}
