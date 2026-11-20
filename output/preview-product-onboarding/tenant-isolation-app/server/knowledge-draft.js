import { pilotDraftGate } from './draft-gate.js';
import { buildDraftLineage } from './draft-lineage.js';

/** Build a pending knowledge card from a reviewed answer; publication stays manual. */
export function draftKnowledgeCard({ store, ticket, requestedByMemberId = null }) {
  const gate = pilotDraftGate(store, ticket);
  if (gate?.error) return { error: gate.error };

  const existing = store.draftExistsForTicket(ticket.id);
  if (existing) return { card: store.getCard(existing.id), created: false };

  const runs = store.runsByTicket(ticket.id);
  const orgRun = gate
    ? gate.orgRun
    : runs.find((r) => r.mode === 'organization' && r.reviews.length) || runs.find((r) => r.mode === 'organization') || runs[0];
  const review = gate ? gate.review : (orgRun?.reviews?.[0] || null);
  const adopted = review && review.decision !== 'reject' ? review : null;
  // 试点：edit 用 edited_text，adopt 用该组织模式运行的建议；sample 保持旧口径。
  const editedText = gate
    ? (review.decision === 'edit' ? String(review.edited_text || '') : null)
    : (adopted?.edited_text || null);
  const lineage = buildDraftLineage({ store, ticket, orgRun });

  const body = [
    `适用场景：${ticket.category || orgRun?.output?.category || '其他'} · ${ticket.title}`,
    '',
    `问题特征：${ticket.description.replace(/\s+/g, ' ').slice(0, 220)}`,
    '',
    '处理步骤：',
    ...(editedText
      ? [editedText]
      : (orgRun?.output?.next_actions || []).map((s, i) => `${i + 1}. ${s}`)),
    ...(lineage.reviewNotes ? ['', lineage.reviewNotes] : []),
    '',
    `最终结果：${ticket.outcome || '已解决'}${ticket.outcome_note ? `，${ticket.outcome_note}` : ''}`,
    '',
    `人工结论：${review ? (review.decision === 'adopt' ? '直接采纳' : review.decision === 'edit' ? '编辑后采纳' : '拒绝智能体建议') : '未记录'}${review?.reason ? `（${review.reason}）` : ''}`,
    '',
    '注意：本条由智能体根据处理过程起草，发布前请人工确认步骤是否仍适用于当前环境。',
  ].join('\n');

  const card = store.createCard({
    title: `${orgRun?.output?.category || ticket.category || '通用'}：${ticket.title}`,
    content: body,
    tags: [ticket.category, orgRun?.output?.category, ticket.urgency].filter(Boolean).join(','),
    sourceTicketId: ticket.id,
    status: 'pending',
    sourceKind: lineage.sourceKind,
    sourceRef: lineage.sourceRef,
    appliesTo: lineage.appliesTo,
    actorMemberId: requestedByMemberId,
  });
  store.addEvent({
    ticketId: ticket.id,
    kind: 'tool_call',
    actor: requestedByMemberId ? (store.memberById(requestedByMemberId)?.name || 'team-member') : 'agent:support',
    actorMemberId: requestedByMemberId,
    summary: '调用 draft_knowledge_card，生成待审批知识卡片',
    payload: { cardId: card.id },
  });
  return { card, created: true };
}
