import { completeJson } from './llm.js';
import { liveModelUnavailableOutput } from './live-fallback.js';
import { modelStatus, PRODUCT_MODE } from './config.js';
import { ticketQuery, firstSentence, demoGenerate, prepareHandoff } from './demo-brain.js';
import { isAuthoritative, hasInstitutionalClaim, SOURCE_KIND_LABEL } from './data-scope.js';
import { draftKnowledgeCard } from './knowledge-draft.js';
import { assessMemoryRelevance } from './typesafe-gate.js';

export const PROMPT_VERSION = 'support-agent-v4.0-matched';
export const AGENT_ROLE = '客服支持智能体';
export { prepareHandoff, draftKnowledgeCard };

const OUTPUT_KEYS = [
  'summary', 'category', 'priority', 'draft_reply', 'next_actions', 'general_checks',
  'escalation_needed', 'handoff_summary', 'citations', 'uncertainties',
];

const SYSTEM_PROMPT = `你是内部 IT 支持团队里的「客服支持智能体」。你的职责是读懂问题单，给出判断和可直接使用的草稿，但不代替人做决定。

硬性要求：
1. 只输出一个 JSON 对象，不要任何解释性文字、不要 Markdown 代码块。
2. JSON 必须且只能包含这些键：summary, category, priority, draft_reply, next_actions, general_checks, escalation_needed, handoff_summary, citations, uncertainties。
3. summary 一句话概括用户真实诉求；category 用「网络与 VPN / 账号与权限 / 邮箱与协作 / 打印与设备 / 软件与授权 / 其他」之一；priority 用 P1 / P2 / P3。
4. draft_reply 是给提问同事看的回复草稿，写清判断；需要补充的信息或核查步骤放入 general_checks，不要重复，也不要承诺你做不到的事。
5. next_actions 是字符串数组，2–5 条，按执行顺序。
6. escalation_needed 是布尔值；只有在影响多人、涉及权限变更或存在数据风险时才为 true。
7. handoff_summary 是给下一位处理者的交接摘要，说明已知、引用来源、待确认和建议后续；next_actions 是建议，不是已执行记录，不能写成已尝试。
8. citations 只能引用上下文中给出的来源，格式 [{"ref":"K3","quote":"原文片段"}]；没有上下文时必须是空数组。禁止编造来源编号。
9. uncertainties 是字符串数组，只列出会影响结论、需要人工核实的地方，避免泛泛罗列。
10. 信息不足时明确说不足，不要虚构报错码、系统名称或处理结果。
11. 证据分级：可引用来源带来源类型（policy 制度政策 / guide 操作指引 / resolved_case 已解决案例 / unknown 来源未核实）。「公司规定、必须审批、制度要求」这类制度性结论，只能来自 policy 或 guide 且上下文明确给出审批主体的知识；resolved_case 和 unknown 只能作为「相似案例参考」，绝不能单独支撑制度性结论。
12. 当没有任何 policy/guide 来源可用时，不得写出制度性结论，必须在 uncertainties 中写明「未找到可核实的制度依据，需人工核实现行制度」。
13. personal 和 organization 共用相同回答要求；两者唯一实验条件差异是 organization 额外收到检索到的团队记忆。general_checks 是字符串数组，最多两项，只放与当前问题直接相关、需要核实的一般检查；不需要时返回空数组。两种模式都不得把 general_checks 重复写进 draft_reply。
14. 问题涉及 token、密钥、密码或凭证时，所有字段都只能要求只读、非识别性状态；不要建议撤销、轮换、重新生成或用凭证调用 API，除非用户明确要求且给定来源支持。不要索取凭证明文、token 名称/ID、截图、scope 清单或组织名称；只问非识别性状态（例如是否仍列出、最近使用的大致时间、是否适用某项策略）。
15. 可以用通用知识解释公开规则，但不得把未由上下文证明的组织内部状态或公司规定说成事实。若缺少能支撑组织内部结论的依据，明确说明无法判断并指出需要核实的非识别性状态。`;

/* ------------------------------------------------------------------ *
 * 工具：search_approved_memory / prepare_handoff / draft_knowledge_card
 * 三个工具都是只读或生产草稿，发布与对客回复永远由人执行。
 * ------------------------------------------------------------------ */

export function searchApprovedMemory(store, ticket, limit = 4) {
  // 把当前工单 ID 与数据范围传给检索层：
  //  - 组织模式不得把「当前这张单」自身当作历史案例引用
  //  - pilot 工单走隔离检索，排除 sample 工单/案例，只认明确批准的卡
  return store.searchApprovedMemory(ticketQuery(ticket), limit, {
    excludeTicketId: ticket.id || null,
    scope: ticket.scope === 'pilot' ? 'pilot' : 'sample',
    ticketCategory: ticket.category || '',
  });
}

/* ------------------------------------------------------------------ *
 * 输出校验：挡住模型最常见的几种坏输出
 * ------------------------------------------------------------------ */

function toArray(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return v.split(/\n|;|；/).map((s) => s.replace(/^[-*\d.、\s]+/, '').trim()).filter(Boolean);
  return [];
}

function extractGeneralCheckSection(text) {
  const source = String(text || '');
  const marker = /(?:^|\n)\s*(?:通用核查项|通用检查项|一般核查建议)(?:\s*[（(][^）)]*[）)])?\s*[：:]\s*/m;
  const match = marker.exec(source);
  if (!match) return { reply: source.trim(), checks: [] };
  const sectionStart = match.index;
  const bodyStart = sectionStart + match[0].length;
  const checks = source.slice(bodyStart).split(/\r?\n/)
    .map((line) => line.trim().replace(/^(?:[-*•]\s*|\d+[.、)）]\s*)/, '').trim())
    .filter(Boolean);
  return { reply: source.slice(0, sectionStart).trim(), checks };
}

function clampText(v, max = 2400) {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function sanitize(raw, sources, mode) {
  const parsed = typeof raw === 'string' ? parseLoose(raw) : raw || {};
  const allowedRefs = new Set(sources.map((s) => s.ref));
  const citations = [];
  let dropped = 0;
  const rawCitations = Array.isArray(parsed.citations) ? parsed.citations : [];
  for (const c of rawCitations) {
    const ref = clampText(c?.ref || c?.id || '', 24).toUpperCase();
    if (!allowedRefs.has(ref)) {
      dropped += 1;
      continue;
    }
    const src = sources.find((s) => s.ref === ref);
    citations.push({
      ref,
      type: src.type,
      id: src.id,
      title: src.title,
      quote: clampText(c?.quote || src.snippet, 240),
    });
  }

  const genericSection = extractGeneralCheckSection(parsed.draft_reply);
  const generalChecks = [...toArray(parsed.general_checks), ...genericSection.checks]
    .filter(Boolean).filter((value, i, all) => all.indexOf(value) === i).slice(0, 2);
  const output = {
    summary: clampText(parsed.summary, 400),
    category: clampText(parsed.category, 40) || '其他',
    priority: /^p[123]$/i.test(String(parsed.priority || '').trim()) ? String(parsed.priority).trim().toUpperCase() : 'P2',
    draft_reply: clampText(genericSection.reply, 3000),
    next_actions: toArray(parsed.next_actions).slice(0, 6),
    general_checks: generalChecks,
    escalation_needed: Boolean(parsed.escalation_needed),
    handoff_summary: clampText(parsed.handoff_summary, 1200),
    citations: mode === 'organization' ? citations : [],
    uncertainties: toArray(parsed.uncertainties).slice(0, 6),
  };
  output.citation_audit = {
    returned: rawCitations.length,
    accepted: output.citations.length,
    dropped,
    note: dropped ? `模型返回了 ${dropped} 条不在检索结果内的引用，已丢弃` : '',
  };
  for (const key of OUTPUT_KEYS) if (output[key] === undefined) output[key] = key === 'citations' || key === 'next_actions' || key === 'general_checks' || key === 'uncertainties' ? [] : '';
  return output;
}

function parseLoose(text) {
  const stripped = String(text).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(stripped.slice(start, end + 1));
      } catch {
        return {};
      }
    }
    return {};
  }
}

function buildUserPrompt(ticket, mode, sources, reviewHint) {
  const lines = [
    `实验数据条件：${mode === 'organization' ? 'organization：下方可能附有检索到的团队记忆。' : 'personal：不提供团队记忆。'}`,
    '',
    `问题单 #${ticket.id}`,
    `标题：${ticket.title}`,
    `描述：${ticket.description}`,
    `类别（用户填写）：${ticket.category || '未填'}`,
    `紧急度（用户填写）：${ticket.urgency || '未填'}`,
  ];
  if (mode === 'organization' && sources.length) {
    lines.push('', '可引用的团队记忆（只能引用这些编号）：');
    for (const s of sources) {
      const kind = s.meta?.source_kind || (s.type === 'case' ? 'resolved_case' : 'unknown');
      const kindLabel = SOURCE_KIND_LABEL[kind] || SOURCE_KIND_LABEL.unknown;
      const scopeText = s.meta?.scope === 'pilot' ? '真实试点' : '模拟样本';
      lines.push(`[${s.ref}] ${s.type === 'card' ? '已发布知识' : '已解决案例'} · 来源类型 ${kind}（${kindLabel}） · 数据范围 ${scopeText} · ${s.title}`);
      if (s.meta?.applies_to) lines.push(`适用范围：${s.meta.applies_to}`);
      if (s.meta?.approval_body) lines.push(`审批主体：${s.meta.approval_body}`);
      lines.push(`片段：${s.snippet}`);
    }
  }
  lines.push(
    '',
    '个人与组织模式使用完全相同的回答规则；模式差异仅是是否附有下方团队记忆。',
    '1. 只能引用本次上下文中实际提供的团队记忆。每条由记忆支持的具体结论在对应句末标来源编号（如 [K3]），citations 给出直接支持它的原文摘录；不得用单条来源扩展它没有写明的结论。没有提供记忆时 citations 必须为空，且不得生成 [K#]。通用知识可作一般解释，但必须与未核实的组织内部状态区分。',
    '2. 需要但无法由上下文确认的一般核查建议放入 general_checks 数组，最多两条；不得加入无关的账号卫生建议。draft_reply 不重复这些建议。',
    '3. 涉及 token、密钥、密码或凭证时，所有字段都只能要求只读、非识别性状态；不要建议撤销、轮换、重新生成或用凭证调用 API，除非提问者明确要求且上下文来源支持。不要索取凭证明文、token 名称/ID、截图、scope 清单或组织名称。',
    '4. 如果时间点或范围的不同解释会改变结论，先提出一个简短澄清问题；不要列出相互冲突的条件分支。',
  );
  if (reviewHint) lines.push('', `上一位处理者的结论：${reviewHint}`);
  lines.push('', '请按系统要求输出 JSON。');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * 主入口
 * ------------------------------------------------------------------ */

export async function runAgent({ store, ticket, mode, runGroup, reviewHint = '', requestedByMemberId = null }) {
  const status = modelStatus();
  const started = Date.now();
  let sources = [];
  const toolCalls = [];

  if (mode === 'organization') {
    sources = searchApprovedMemory(store, ticket, 4);
    toolCalls.push({
      name: 'search_approved_memory',
      args: {
        query: firstSentence(ticketQuery(ticket), 60),
        exclude_ticket_id: ticket.id || null,
        scope: ticket.scope === 'pilot' ? 'pilot' : 'sample',
        ticket_category: ticket.category || '',
      },
      result_count: sources.length,
      refs: sources.map((s) => s.ref),
      sources: sources.map((s) => ({
        ref: s.ref,
        type: s.type,
        source_kind: s.meta?.source_kind || (s.type === 'case' ? 'resolved_case' : 'unknown'),
        scope: s.meta?.scope || 'sample',
      })),
    });
  }

  // Jev runs beside the answer model in shadow mode. It receives sample-only
  // data and cannot remove sources or change the model prompt in this prototype.
  const typesafePromise = status.configured && mode === 'organization' && ticket.scope === 'sample'
    ? assessMemoryRelevance(ticket, sources)
      .then((result) => result ? { status: 'ok', result } : null)
      .catch((error) => ({
        status: error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'unavailable',
        reason: /^TypeSafe returned HTTP \d+$/.test(String(error?.message || ''))
          ? String(error.message).replace('TypeSafe returned HTTP ', 'http_')
          : error?.name === 'TypeError' ? 'network_error' : 'invalid_response',
      }))
    : null;

  let output;
  let model = `demo:${PROMPT_VERSION}`;
  let origin = 'demo';
  let latencyMs;

  if (status.configured) {
    try {
      const res = await completeJson({ system: SYSTEM_PROMPT, user: buildUserPrompt(ticket, mode, sources, reviewHint) });
      output = sanitize(res.content, sources, mode);
      model = res.model;
      origin = 'live';
      latencyMs = res.latencyMs;
    } catch (err) {
      if (PRODUCT_MODE) throw new Error(`模型暂时不可用，未生成或保存建议：${err.message || '请求失败'}`);
      output = sanitize(liveModelUnavailableOutput(ticket.category), sources, mode);
      model = `fallback:${PROMPT_VERSION}`;
      origin = 'fallback';
      latencyMs = Date.now() - started;
    }
  } else {
    await new Promise((r) => setTimeout(r, 160 + Math.floor(Math.random() * 240)));
    output = sanitize(demoGenerate(ticket, sources, mode), sources, mode);
    latencyMs = Date.now() - started;
  }

  if (typesafePromise) {
    const sidecar = await Promise.race([
      typesafePromise,
      new Promise((resolve) => setTimeout(() => resolve({ status: 'timeout' }), 2500)),
    ]);
    if (sidecar) {
      if (sidecar.status === 'ok') {
        toolCalls.push({
          name: 'typesafe_memory_gate',
          status: 'shadow_only',
          model: sidecar.result.model,
          latency_ms: sidecar.result.latencyMs,
          input_tokens: sidecar.result.inputTokens,
          applied: false,
          decisions: sidecar.result.decisions,
        });
      } else {
        toolCalls.push({
          name: 'typesafe_memory_gate',
          status: sidecar.status,
          reason: sidecar.reason || '',
          applied: false,
          decisions: [],
        });
      }
    }
  }

  if (mode === 'organization') {
    // 证据闸门：缺少权威来源时不把回答视作可直接依赖的制度结论，并追加核实提示。
    // 真实试点没有 policy/guide 来源时总是要求人工核实；sample 维持原有触发口径。
    const authoritative = sources.some(isAuthoritative);
    const institutional = hasInstitutionalClaim(output);
    const pilotNeedsVerification = ticket.scope === 'pilot' && !authoritative;
    if (!authoritative && (institutional || pilotNeedsVerification)) {
      const notice = ticket.scope === 'pilot'
        ? '真实试点检索未命中已批准的制度/指引；涉及审批、授权或公司流程的内容必须由责任人核实现行制度，已解决案例仅作相似参考。'
        : '未找到可核实的制度依据，上述制度性表述需人工核实现行制度；已解决案例仅作相似参考。';
      if (!output.uncertainties.some((u) => u.includes('未找到可核实的制度依据') || u.includes('真实试点检索未命中'))) {
        output.uncertainties.unshift(notice);
      }
      output.evidence_gate = {
        blocked: true,
        reason: pilotNeedsVerification
          ? '真实试点没有命中 policy/guide 类权威来源，需人工核实后使用'
          : '制度性表述缺少 policy/guide 类权威来源',
        authoritative_sources: [],
        case_sources: sources.filter((s) => s.type === 'case').map((s) => s.ref),
      };
    }
    toolCalls.push({ name: 'prepare_handoff', args: { ticket_id: ticket.id }, result: 'ok' });
    toolCalls.push({
      name: 'evidence_gate',
      args: { scope: ticket.scope === 'pilot' ? 'pilot' : 'sample', ticket_category: ticket.category || '' },
      result: output.evidence_gate?.blocked ? 'blocked_institutional_claim' : 'ok',
      authoritative_refs: sources.filter(isAuthoritative).map((s) => s.ref),
    });
  }

  output.handoff_summary = prepareHandoff(ticket, output, mode === 'organization' ? sources : []);

  return store.createRun({
    runGroup,
    ticketId: ticket.id,
    mode,
    model,
    promptVersion: PROMPT_VERSION,
    contextSources: mode === 'organization' ? sources : [],
    toolCalls,
    output,
    latencyMs,
    origin,
    createdByMemberId: requestedByMemberId,
  });
}

export async function runPair({ store, ticket, requestedByMemberId = null }) {
  const runGroup = store.createRunGroup(ticket.id);
  if (PRODUCT_MODE) {
    const organization = await runAgent({ store, ticket, mode: 'organization', runGroup, requestedByMemberId });
    store.addEvent({
      ticketId: ticket.id,
      kind: 'agent_suggestion_ready',
      actor: 'agent:support',
      summary: 'AI 建议已生成，等待团队成员处理',
      payload: { runGroup, organizationRun: organization.id },
    });
    return { runGroup, personal: null, organization };
  }
  const [personal, organization] = await Promise.all([
    runAgent({ store, ticket, mode: 'personal', runGroup, requestedByMemberId }),
    runAgent({ store, ticket, mode: 'organization', runGroup, requestedByMemberId }),
  ]);
  store.addEvent({
    ticketId: ticket.id,
    kind: 'comparison_ready',
    actor: 'agent:support',
    summary: '个人模式与组织模式并排结果已生成，等待人工审核',
    payload: { runGroup, personalRun: personal.id, orgRun: organization.id },
  });
  return { runGroup, personal, organization };
}

