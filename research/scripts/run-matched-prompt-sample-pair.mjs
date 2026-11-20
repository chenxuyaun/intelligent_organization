// Persist one matched-prompt live pair for the synthetic #8 ticket in the
// disposable 4186 clone only. This script refuses any other DATA_DIR.
import path from 'node:path';

const expectedDataDir = path.resolve('C:/Users/yuesh/AppData/Local/Temp/io-retrieval-preview-20261118-150508');
const configuredDataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : '';
const ticketId = Number(process.env.BENCHMARK_TICKET_ID || 8);
if (configuredDataDir !== expectedDataDir) {
  throw new Error('Refusing to write: DATA_DIR must point to the known disposable 4186 clone.');
}
if (![7, 8].includes(ticketId)) throw new Error('Refusing to write: only synthetic classic PAT tickets #7 and #8 are allowed.');

process.env.DATA_DIR = expectedDataDir;
process.env.TYPESAFE_API_KEY = '';
process.env.TYPESAFE_MEMORY_GATE = 'off';

const [{ modelStatus }, { openDb }, { createStore }, { runPair, PROMPT_VERSION }] = await Promise.all([
  import('../../server/config.js'),
  import('../../server/db.js'),
  import('../../server/store.js'),
  import('../../server/agent.js'),
]);

if (!modelStatus().configured) throw new Error('Live answer model is not configured; no model calls were made.');

const db = openDb();
try {
  const store = createStore(db);
  const ticket = store.getTicket(ticketId);
  if (!ticket || ticket.scope !== 'sample' || ticket.status !== 'open' || !/classic PAT/i.test(ticket.title)) {
    throw new Error(`Refusing to write: expected an open synthetic classic PAT ticket #${ticketId}.`);
  }
  const previousRuns = store.runsByTicket(ticket.id);
  if (previousRuns.some((run) => run.prompt_version === PROMPT_VERSION)) {
    throw new Error(`Refusing to duplicate: ticket #${ticketId} already has a ${PROMPT_VERSION} run.`);
  }
  if (store.reviewsByTicket(ticket.id).length) {
    throw new Error(`Refusing to write: ticket #${ticketId} already has a human review.`);
  }
  const publishedMemory = store.listCards().some((card) => card.id === 3 && card.scope === 'sample' && card.status === 'published');
  if (!publishedMemory) throw new Error('Refusing to write: expected published sample card K3.');

  const pair = await runPair({ store, ticket });
  const compact = (run) => ({
    id: run.id,
    mode: run.mode,
    origin: run.origin,
    promptVersion: run.promptVersion,
    latencyMs: run.latencyMs,
    retrievedRefs: (run.contextSources || run.context_sources || []).map((source) => source.ref),
    citedRefs: [...new Set((run.output.citations || []).map((citation) => citation.ref))],
    generalChecks: run.output.general_checks || [],
    draftReply: run.output.draft_reply,
  });
  const report = {
    experiment: 'matched system prompt and shared answer rules; organization condition receives retrieved team memory',
    ticketId: ticket.id,
    ticketScope: ticket.scope,
    beforeRunCount: previousRuns.length,
    runGroup: pair.runGroup,
    model: modelStatus().model,
    personal: compact(pair.personal),
    organization: compact(pair.organization),
    reviewCount: store.reviewsByTicket(ticket.id).length,
    afterRunCount: store.runsByTicket(ticket.id).length,
    storage: expectedDataDir,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (pair.personal.origin !== 'live' || pair.organization.origin !== 'live') process.exitCode = 2;
} finally {
  db.close();
}
