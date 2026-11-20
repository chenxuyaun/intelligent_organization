import { TYPESAFE } from './config.js';

const SYSTEM_ONE_URL = 'https://api.typesafe.ai/v1/systemone';
const REQUEST_TIMEOUT_MS = 2500;
const ANSWERABLE_THRESHOLD = 0.8;
const NOT_ANSWERABLE_THRESHOLD = 0.2;

function short(value, limit) {
  const text = String(value || '').trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/**
 * Shadow-only, sample-only semantic relevance check. It never changes the
 * candidates sent to the answer model; its probabilities are recorded for
 * comparison before any filtering behavior is considered.
 */
export async function assessMemoryRelevance(ticket, sources) {
  if (TYPESAFE.memoryGateMode !== 'shadow' || !TYPESAFE.apiKey) return null;
  if (ticket.scope !== 'sample' || !Array.isArray(sources) || !sources.length) return null;

  const questions = {};
  sources.forEach((source, index) => {
    questions[`source_${index}`] = {
      type: 'noul',
      instructions: `仅评估回答性：候选来源 ${source.ref} 是否包含能帮助回答工单具体问题的信息？信息可以支持，也可以反驳或限制工单中的主张；不要假设工单主张为真。仅主题相似不够；不要判断来源是否权威或是否获准进入试点。`,
      criteria: {
        true: '来源包含与工单具体问题直接相关、能支持或反驳答案的信息。',
        false: '来源只有主题相似，或没有能用于回答具体问题的内容。',
      },
    };
  });

  const state = {
    ticket: {
      title: short(ticket.title, 240),
      description: short(ticket.description, 1200),
      category: short(ticket.category, 80),
    },
    retrieved_sources: sources.map((source) => ({
      ref: source.ref,
      title: short(source.title, 240),
      text: short(source.snippet, 600),
      source_kind: source.meta?.source_kind || 'unknown',
      scope: source.meta?.scope || 'sample',
    })),
  };

  const started = Date.now();
  const response = await fetch(SYSTEM_ONE_URL, {
    method: 'POST',
    redirect: 'error',
    headers: {
      authorization: `Bearer ${TYPESAFE.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: TYPESAFE.model, state, questions }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`TypeSafe returned HTTP ${response.status}`);

  const body = await response.json();
  const decisions = sources.map((source, index) => {
    const answer = body.answers?.[`source_${index}`];
    const probability = Number(answer?.noul);
    if (answer?.type !== 'noul' || !Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new Error('TypeSafe returned an invalid structured answer');
    }
    return {
      ref: source.ref,
      title: source.title,
      answerability_probability: probability,
      recommendation: probability >= ANSWERABLE_THRESHOLD
        ? 'likely_answerable'
        : probability <= NOT_ANSWERABLE_THRESHOLD
          ? 'likely_not_answerable'
          : 'uncertain',
    };
  });

  return {
    model: body.model || TYPESAFE.model,
    latencyMs: Date.now() - started,
    inputTokens: Number(body.usage?.input_tokens) || 0,
    decisions,
    applied: false,
  };
}
