// Does the human-adopted answer on resolved case C12 help when added to the
// case snippet? Compare the existing case text with the same text plus R18's
// approved answer. All runs use an in-memory store and GET-only app reads.
process.env.TYPESAFE_API_KEY = '';
process.env.TYPESAFE_MEMORY_GATE = 'off';
if (process.env.BENCHMARK_MODEL_TIMEOUT_MS) {
  const timeoutMs = Number(process.env.BENCHMARK_MODEL_TIMEOUT_MS);
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) process.env.MODEL_TIMEOUT_MS = String(timeoutMs);
}

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.BENCHMARK_BASE || 'http://127.0.0.1:4186').replace(/\/$/, '');
const modelHttpDiagnostics = [];
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const url = String(input);
  try {
    const response = await nativeFetch(input, init);
    if (url.endsWith('/chat/completions')) {
      const raw = await response.clone().text();
      let payload;
      try { payload = JSON.parse(raw); } catch { payload = null; }
      modelHttpDiagnostics.push(payload ? {
        status: response.status,
        ok: response.ok,
        model: payload.model || null,
        choiceCount: Array.isArray(payload.choices) ? payload.choices.length : 0,
        finishReason: payload.choices?.[0]?.finish_reason || null,
        contentLength: typeof payload.choices?.[0]?.message?.content === 'string'
          ? payload.choices[0].message.content.length : null,
      } : {
        status: response.status,
        ok: response.ok,
        invalidEnvelope: true,
        contentType: response.headers.get('content-type') || '',
        bodyPrefix: raw.slice(0, 200),
      });
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
const [ticket12, ticket13] = await Promise.all([get('/api/tickets/12'), get('/api/tickets/13')]);
const reviewedRun = ticket12.runs.find((run) => run.id === 18);
const review = reviewedRun?.reviews?.find((item) => item.decision === 'adopt'
  && item.review_source_type === 'human'
  && item.reviewer === '陈朋');
const baselineRun = ticket13.runs.find((run) => run.id === 20);
if (ticket12.ticket?.status !== 'resolved' || !review || !reviewedRun?.output?.draft_reply) {
  throw new Error('C12 is not the expected resolved, human-adopted sample case; no model calls were made.');
}
if (ticket13.ticket?.status !== 'open' || baselineRun?.mode !== 'organization') {
  throw new Error('#13 is not the expected open sample ticket; no model calls were made.');
}

const sources = baselineRun.context_sources || [];
const caseSource = sources.find((source) => source.ref === 'C12' && source.type === 'case');
for (const ref of ['C12', 'K3', 'K2', 'C9']) {
  if (!sources.some((source) => source.ref === ref)) {
    throw new Error(`R20 did not retrieve ${ref}; no model calls were made.`);
  }
}
const approvedAnswer = review.edited_text || reviewedRun.output.draft_reply;
const augmentedSources = sources.map((source) => source.ref === 'C12'
  ? {
    ...source,
    snippet: `${source.snippet}\n人工采纳后的组织答复（仅作相似案例参考，不是制度依据）：${approvedAnswer}`,
  }
  : source);
const ticket = { ...ticket13.ticket };
const allConditions = [
  { key: 'current_case_snippet', context: sources },
  { key: 'case_plus_approved_answer', context: augmentedSources },
  { key: 'case_plus_approved_answer_2', context: augmentedSources },
  { key: 'current_case_snippet_2', context: sources },
];
const outputPath = fileURLToPath(new URL('../observations/2026-11-case-13-reviewed-answer-ablation-result.json', import.meta.url));
const resume = process.argv.includes('--resume');
const previousArtifact = resume ? JSON.parse(await readFile(outputPath, 'utf8')) : null;
const results = previousArtifact?.results || [];
const completed = new Set(results.map((result) => result.condition));
const conditions = allConditions.filter((condition) => !completed.has(condition.key));

for (const condition of conditions) {
  const store = {
    searchApprovedMemory: () => condition.context,
    createRun: (run) => run,
  };
  const run = await runAgent({
    store,
    ticket,
    mode: 'organization',
    runGroup: `case-13-reviewed-answer-${condition.key}-${Date.now()}`,
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
}

const artifact = {
  experiment: 'Does C12 human-approved answer text change the exact synthetic ticket #13 answer?',
  createdAt: previousArtifact?.createdAt || new Date().toISOString(),
  storage: 'GET-only app reads + in-memory createRun stub; no application-data writes',
  model: modelStatus().model,
  promptVersion: PROMPT_VERSION,
  sourceCase: { ticketId: 12, runId: 18, status: ticket12.ticket.status, decision: review.decision, source: review.review_source_type, reviewer: review.reviewer },
  targetTicket: { ticketId: 13, status: ticket13.ticket.status, runId: 20 },
  controls: 'Same #13 question, model, prompt and C12/K3/K2/C9 sources. Only C12 snippet changes: current question/status text vs that text plus the human-adopted R18 answer, explicitly labeled as reference-only. Two repetitions per condition, order reversed in the second pair.',
  approvedAnswer,
  results,
};
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ outputPath, model: artifact.model, promptVersion: artifact.promptVersion, results: results.map(({ condition, origin, model, latencyMs, retrievedRefs, citedRefs, modelHttp }) => ({ condition, origin, model, latencyMs, retrievedRefs, citedRefs, modelHttp })) }, null, 2)}\n`);
if (results.some((result) => result.origin !== 'live')) process.exitCode = 2;
