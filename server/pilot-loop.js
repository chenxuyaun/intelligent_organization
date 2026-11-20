/* ------------------------------------------------------------------ *
 * 真实试点闭环：只读聚合视图。
 *
 * 把一条试点工单的完整链路串起来供人工核对：
 *   授权工单（来源/范围/脱敏/授权人）
 *     → 同组双模式运行（模型 / 提示词版本 / 运行组 / 检索来源 / 是否自我排除）
 *     → 组织成员人工审核（采纳 / 编辑后采纳 / 拒绝 / 未审核，分母写清；助手代审单列）
 *     → 人工认可后形成的待审知识卡（不自动发布）
 *     → 知识审核（来源 / 适用范围 / 审批主体 / 知识负责人 / 有效状态 / 试点批准）
 *     → 另一条不同试点工单的检索命中与引用（可复核，且排除自身）
 *
 * 本文件只读数据库，不写任何数据，不调用模型，不导入任何真实工单。
 * 只处理 scope=pilot 的数据；sample 模拟样本被完全排除。
 * ------------------------------------------------------------------ */

import { DESENSITIZATION_LABEL, SOURCE_KIND_LABEL } from './data-scope.js';
import { REVIEW_SOURCE_LABEL } from './review-source.js';

const blank = () => ({ adopt: 0, edit: 0, reject: 0, unreviewed: 0, total: 0 });
const REVIEW_SOURCES = ['human', 'assistant', 'seed', 'unknown'];

/** 最新一条审核决定当前状态；显式按 id 取最大，不依赖数组顺序。 */
function latestReview(run) {
  const reviews = run?.reviews || [];
  return reviews.reduce((a, b) => (!a || Number(b.id) > Number(a.id) ? b : a), null);
}

function reviewStateOf(run) {
  const r = latestReview(run);
  if (!r) return { decision: null, source: null, review: null };
  return {
    decision: r.decision,
    source: r.review_source_type || 'unknown',
    review: {
      id: r.id, decision: r.decision, sourceType: r.review_source_type || 'unknown',
      reviewer: r.reviewer, rating: r.rating, reason: r.reason,
      editedText: r.edited_text, createdAt: r.created_at,
    },
  };
}

/** 运行级审核分母：每条运行按最新审核计入，未审核不摊进采纳/拒绝。 */
function accumulate(cell, state) {
  cell.total += 1;
  if (!state.decision) { cell.unreviewed += 1; return; }
  cell[state.decision] = (cell[state.decision] || 0) + 1;
}

export function buildPilotLoop(store) {
  const allTickets = store.listTickets();
  const pilotTickets = allTickets.filter((t) => t.scope === 'pilot');
  const pilotIds = new Set(pilotTickets.map((t) => t.id));
  const allCards = store.listCards();
  const pilotCards = allCards.filter((c) => c.scope === 'pilot' || pilotIds.has(c.source_ticket_id));
  const cardById = new Map(allCards.map((c) => [c.id, c]));
  const ticketById = new Map(allTickets.map((t) => [t.id, t]));

  // ---- 1. 试点工单（含授权/脱敏元数据） ----
  const tickets = pilotTickets.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    category: t.category,
    scope: t.scope,
    sourceRef: t.source_ref || '',
    desensitization: t.desensitization || 'unknown',
    desensitizationLabel: DESENSITIZATION_LABEL[t.desensitization] || DESENSITIZATION_LABEL.unknown,
    authorizedBy: t.authorized_by || '',
    modelAuthorizedBy: t.model_authorized_by || '',
    modelAuthorizationTarget: t.model_authorized_by ? {
      baseUrl: t.model_authorized_base_url || '',
      model: t.model_authorized_model || '',
    } : null,
    createdAt: t.created_at,
  }));

  // ---- 2. 双模式运行 + 检索来源 + 自我排除 + 审核状态 ----
  const runs = [];
  const reviewStats = {
    byMode: { personal: blank(), organization: blank() },
    total: blank(),
    bySource: Object.fromEntries(REVIEW_SOURCES.map((s) => [s, blank()])),
  };
  for (const t of pilotTickets) {
    for (const run of store.runsByTicket(t.id)) {
      const state = reviewStateOf(run);
      const selfExcludeCall = (run.tool_calls || []).find((c) => c.name === 'search_approved_memory');
      runs.push({
        id: run.id,
        ticketId: run.ticket_id,
        runGroup: run.run_group,
        mode: run.mode,
        scope: run.scope,
        origin: run.origin,
        model: run.model,
        promptVersion: run.prompt_version,
        createdAt: run.created_at,
        retrieval: selfExcludeCall ? {
          name: 'search_approved_memory',
          query: selfExcludeCall.args?.query || '',
          excludeTicketId: selfExcludeCall.args?.exclude_ticket_id ?? null,
          scope: selfExcludeCall.args?.scope || null,
          resultCount: selfExcludeCall.result_count ?? 0,
          sources: selfExcludeCall.sources || [],
        } : null,
        // 组织模式必须排除自身；个人模式必须没有任何检索来源/引用
        selfRetrieval: run.mode === 'organization'
          ? (selfExcludeCall?.args?.exclude_ticket_id !== undefined
              ? selfExcludeCall.args.exclude_ticket_id === run.ticket_id
              : null)
          : null,
        contextRefs: (run.context_sources || []).map((s) => ({ ref: s.ref, type: s.type, id: s.id, sourceKind: s.meta?.source_kind })),
        citationRefs: (run.output?.citations || []).map((c) => c.ref),
        evidenceGate: run.output?.evidence_gate || null,
        reviewState: state,
      });
      accumulate(reviewStats.byMode[run.mode], state);
      accumulate(reviewStats.total, state);
      if (state.source) accumulate(reviewStats.bySource[state.source], state);
    }
  }

  // ---- 3. 知识链：来源工单为试点的卡（草稿→待审→发布→批准） ----
  const knowledge = pilotCards.map((c) => {
    const src = c.source_ticket_id ? ticketById.get(c.source_ticket_id) : null;
    return {
      id: c.id,
      title: c.title,
      status: c.status,
      scope: c.scope,
      sourceTicketId: c.source_ticket_id || null,
      sourceTicketTitle: src?.title || null,
      sourceKind: c.source_kind || 'unknown',
      sourceKindLabel: SOURCE_KIND_LABEL[c.source_kind] || SOURCE_KIND_LABEL.unknown,
      sourceRef: c.source_ref || '',
      appliesTo: c.applies_to || '',
      approvalBody: c.approval_body || '',
      knowledgeOwner: c.knowledge_owner || '',
      validUntil: c.valid_until || null,
      pilotApproved: Boolean(c.pilot_approved),
      cardReviews: c.reviews || [],
      useCount: (c.uses || []).length,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    };
  });

  // ---- 4. 复用证据：不同试点工单命中并引用了来自另一张工单的卡 ----
  const uses = store.raw.prepare(`SELECT * FROM knowledge_uses ORDER BY id DESC`).all();
  const reuse = [];
  for (const u of uses) {
    const usingTicket = ticketById.get(u.ticket_id);
    const usedCard = cardById.get(u.card_id);
    if (!usingTicket || !usedCard) continue;
    if (usingTicket.scope !== 'pilot') continue; // 只用试点工单的复用
    if (usedCard.scope !== 'pilot') continue;
    const sourceTicketId = usedCard.source_ticket_id;
    // 复用必须发生在「另一条不同的工单」上；同单命中不算跨单复用
    const isDifferentTicket = !sourceTicketId || sourceTicketId !== u.ticket_id;
    // 找到使用该卡的那一轮运行，核对引用与自我排除
    const run = store.getRun(u.run_id);
    const cited = Boolean(run && (run.output?.citations || []).some((c) => c.id === usedCard.id || c.ref === `K${usedCard.id}`));
    reuse.push({
      cardId: usedCard.id,
      cardTitle: usedCard.title,
      sourceTicketId: sourceTicketId || null,
      usedInTicketId: u.ticket_id,
      usedInTicketTitle: usingTicket.title,
      usedInRunId: u.run_id,
      usedInRunGroup: run?.run_group || null,
      usedInMode: run?.mode || null,
      isDifferentTicket,
      cited,
      snippet: u.snippet || '',
      createdAt: u.created_at,
    });
  }
  // 口径分离：跨单命中 ≠ 实际引用复用。
  //  - crossTicketHits ：另一条不同试点工单检索命中（含命中但未引用）
  //  - crossTicketReuse：其中被该轮输出真正引用的记录，才算复用
  // 工单自身命中在 isDifferentTicket 处已排除，两个口径都不计入。
  const crossTicketHits = reuse.filter((r) => r.isDifferentTicket);
  const crossTicketReuse = crossTicketHits.filter((r) => r.cited);

  return {
    scopeNotice: '只读视图，仅含 scope=pilot 的授权工单及其派生数据；模拟样本已排除。这里的数字反映机制是否跑通，不构成试点成效结论。',
    summary: {
      pilotTickets: pilotTickets.length,
      pilotRuns: runs.length,
      runGroups: new Set(runs.map((r) => r.runGroup)).size,
      pilotCards: pilotCards.length,
      pilotApprovedCards: pilotCards.filter((c) => c.pilot_approved && c.status === 'published').length,
      humanReviewedRuns: runs.filter((r) => r.reviewState.source === 'human').length,
      crossTicketHitCount: crossTicketHits.length,
      crossTicketReuseCount: crossTicketReuse.length,
    },
    reviewStats,
    reviewSourceLabel: REVIEW_SOURCE_LABEL,
    tickets,
    runs,
    knowledge,
    reuse,
    crossTicketHits,
    crossTicketReuse,
  };
}
