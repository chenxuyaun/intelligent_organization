// In-memory ablation for sample ticket #13: does retrieved case C12 change the
// answer when the same published cards and question are held constant?
// Reads the isolated 4186 app via GET and never writes application data.
process.env.TYPESAFE_API_KEY = '';
process.env.TYPESAFE_MEMORY_GATE = 'off';
if (process.env.BENCHMARK_MODEL_TIMEOUT_MS) {
  const timeoutMs = Number(process.env.BENCHMARK_MODEL_TIMEOUT_MS);
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) process.env.MODEL_TIMEOUT_MS = String(timeoutMs);
}

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.BENCHMARK_BASE || 'http://127.0.0.1:4186').replace(/\/$/, '');
const ticketId = 13;
const runId = 20;
const modelHttpDiagnostics = [];
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const url = String(input);
  try {
    const response = await nativeFetch(input, init);
    if (url.endsWith('/chat/completions')) {
      const diagnostic = { status: response.status, ok: response.ok };
      const rawBody = await response.clone().text();
      const payload = (() => { try { return JSON.parse(rawBody); } catch { return null; } })();
      if (payload && typeof payload === 'object') {
        diagnostic.model = payload.model || null;
        diagnostic.choiceCount = Array.isArray(payload.choices) ? payload.choices.length : 0;
        const choice = payload.choices?.[0];
        diagnostic.finishReason = choice?.finish_reason || null;
        diagnostic.messageKeys = choice?.message ? Object.keys(choice.message) : [];
        diagnostic.contentType = typeof choice?.message?.content;
        diagnostic.contentLength = typeof choice?.message?.content === 'string' ? choice.message.content.length : null;
        if (!response.ok) diagnostic.error = payload.error?.message || payload.error || null;
      } else if (!response.ok) {
        diagnostic.error = rawBody.slice(0, 300);
      } else {
        diagnostic.invalidEnvelope = true;
        diagnostic.contentTypeHeader = response.headers.get('content-type') || '';
        diagnostic.bodyPrefix = rawBody.slice(0, 300);
      }
      modelHttpDiagnostics.push(diagnostic);
    }
    return response;
  } catch (error) {
    if (url.endsWith('/chat/completions')) {
      modelHttpDiagnostics.push({ errorName: error?.name || 'Error', error: String(error?.message || error) });
    }
    throw error;
  }
};

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

const caseRecord = await get(`/api/tickets/${ticketId}`);
const baseline = caseRecord.runs.find((run) => run.id === runId);
const reviewed = baseline?.reviews?.some((review) => review.decision === 'adopt'
  && review.reviewer === '陈朋'
  && review.review_source_type === 'human');
if (caseRecord.ticket?.scope !== 'sample' || caseRecord.ticket?.status !== 'open' || !reviewed) {
  throw new Error('Ticket #13 is not the expected open, human-adopted sample; no model calls were made.');
}
if (baseline?.mode !== 'organization' || baseline?.origin !== 'live') {
  throw new Error('R20 is not the expected live organization run; no model calls were made.');
}

const retrieved = baseline.context_sources || baseline.contextSources || [];
const byRef = new Map(retrieved.map((source) => [source.ref, source]));
for (const ref of ['C12', 'K3', 'K2', 'C9']) {
  if (!byRef.has(ref)) throw new Error(`R20 did not retrieve ${ref}; no model calls were made.`);
}

const ticket = {
  ...caseRecord.ticket,
  id: ticketId,
};
const allConditions = [
  { key: 'with_C12_1', refs: ['C12', 'K3', 'K2', 'C9'] },
  { key: 'without_C12_1', refs: ['K3', 'K2', 'C9'] },
  { key: 'without_C12_2', refs: ['K3', 'K2', 'C9'] },
  { key: 'with_C12_2', refs: ['C12', 'K3', 'K2', 'C9'] },
  { key: 'with_C12_3', refs: ['C12', 'K3', 'K2', 'C9'] },
  { key: 'without_C12_3', refs: ['K3', 'K2', 'C9'] },
  { key: 'with_C12_4', refs: ['C12', 'K3', 'K2', 'C9'] },
  { key: 'without_C12_4', refs: ['K3', 'K2', 'C9'] },
];
const outputPath = fileURLToPath(new URL('../observations/2026-11-case-13-ablation-result.json', import.meta.url));
const diagnosticOnly = process.argv.includes('--diagnostic-only');
const resume = process.argv.includes('--resume');
const previousArtifact = resume ? JSON.parse(await readFile(outputPath, 'utf8')) : null;
const results = previousArtifact?.results || [];
const completed = new Set(results.map((result) => result.condition));
const conditions = diagnosticOnly
  ? allConditions.slice(0, 1)
  : allConditions.filter((condition) => !completed.has(condition.key));

for (const condition of conditions) {
  const sources = condition.refs.map((ref) => byRef.get(ref));
  const store = {
    searchApprovedMemory: () => sources,
    createRun: (run) => run,
  };
  const run = await runAgent({
    store,
    ticket,
    mode: 'organization',
    runGroup: `case-13-ablation-${condition.key}-${Date.now()}`,
  });
  results.push({
    condition: condition.key,
    origin: run.origin,
    model: run.model,
    latencyMs: run.latencyMs,
    retrievedRefs: (run.contextSources || []).map((source) => source.ref),
    citedRefs: [...new Set((run.output.citations || []).map((citation) => citation.ref))],
    reply: run.output.draft_reply,
    uncertainties: run.output.uncertainties,
    modelHttp: modelHttpDiagnostics.at(-1) || null,
  });
  const artifact = {
    experiment: 'Case C12 ablation on the exact synthetic ticket #13 question',
    createdAt: previousArtifact?.createdAt || new Date().toISOString(),
    storage: 'GET-only app read + in-memory createRun stub; no application-data writes',
    model: modelStatus().model,
    promptVersion: PROMPT_VERSION,
    sourceTicket: { id: ticketId, status: caseRecord.ticket.status, scope: caseRecord.ticket.scope },
    sourceRun: { id: runId, runGroup: baseline.run_group, retrievedRefs: retrieved.map((source) => source.ref) },
    controls: diagnosticOnly
      ? 'Diagnostic repeat of the with-C12 condition; one model call only. Not an ablation result.'
      : 'Same ticket text, live model, prompt version and K3/K2/C9 sources; C12 is the only changed source. Up to four attempts per condition; invalid model responses are retained but excluded from effect comparison.',
    results,
  };
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ condition: condition.key, origin: run.origin, model: run.model, latencyMs: run.latencyMs, modelHttp: modelHttpDiagnostics.at(-1) || null, outputPath })}\n`);
}

if (results.some((result) => result.origin !== 'live')) process.exitCode = 2;
