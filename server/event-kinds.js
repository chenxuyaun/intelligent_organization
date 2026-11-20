/**
 * 事件 kind 常量 + 审计载荷白名单（单一事实来源）。
 *
 * 依据：ADR-004（普通表 + 审计事件，非事件溯源）；路线图 P1 工项 4/5（④§3.2）。
 * 规则：
 *  1. 所有 addEvent 调用点的 kind 必须来自本表；新增 kind 先在这里登记。
 *  2. payload 字段是白名单成文契约：只允许记录 ID、状态枚举、计数与固定摘要——
 *     永远不写入工单正文、模型输出原文、用户消息或任何密钥（⑥§4 日志规范）。
 *  3. UI（public/app.js KIND_LABEL）按本表同步标签；/api/state 暴露本表用于启动期一致性提示。
 */

export const EVENT_KINDS = Object.freeze({
  /* —— 工单生命周期（store.js createTicket / updateTicket）—— */
  ticket_created: {
    label: '新建问题单',
    payload: ['urgency', 'scope', 'source_ref', 'desensitization', 'storage_authorization_recorded', 'model_authorization_recorded', 'workItemType', 'parentTicketId'],
  },
  ticket_status: { label: '状态变更', payload: ['from', 'to', 'outcome'] },
  assignee_changed: { label: '负责人变更', payload: ['assigneeId'] },
  outcome_recorded: { label: '处理进展 / 结果', payload: ['outcome', 'note', 'status'] },
  ticket_model_authorization_changed: {
    label: '模型发送确认变更',
    payload: ['fromRecorded', 'toRecorded', 'targetChanged', 'previousTarget', 'target'],
  },

  /* —— 智能体运行（agent.js runPair / api.js reserveModelCall）—— */
  agent_run: { label: '智能体运行', payload: ['runId', 'model', 'latencyMs', 'origin'] },
  agent_suggestion_ready: { label: 'AI 建议就绪', payload: ['runGroup', 'organizationRun'] },
  comparison_ready: { label: '对比就绪', payload: ['runGroup', 'personalRun', 'orgRun'] },
  model_call_requested: { label: '模型请求', payload: ['purpose'] },

  /* —— 审核与记忆（store.js addReview / createRun / recordUseHelpfulness）—— */
  review_submitted: { label: '审核提交（含来源）', payload: ['runId', 'decision', 'rating', 'reason', 'sourceType'] },
  memory_cited: { label: '引用知识', payload: ['cardId', 'runId', 'score'] },
  use_helpfulness_recorded: {
    label: '记忆有效性标注',
    payload: ['useId', 'runId', 'cardId', 'helpful', 'hasNote'],
  },

  /* —— 知识卡（store.js / knowledge-draft.js）—— */
  card_drafted: { label: '知识草稿', payload: ['cardId', 'status', 'scope', 'sourceKind'] },
  card_draft_edited: {
    label: '知识草稿修订',
    payload: ['cardId', 'status', 'note', 'previousContent', 'revisedContent', 'publishDecision'],
  },
  card_revision_drafted: {
    label: '知识版本修订草稿',
    payload: ['cardId', 'supersedesCardId', 'supersedesVersion', 'candidateVersion', 'scope', 'note', 'publishDecision'],
  },
  card_published: { label: '知识发布', payload: ['cardId', 'note', 'supersedesCardId', 'version'] },
  card_rejected: { label: '知识驳回', payload: ['cardId', 'note', 'supersedesCardId', 'version'] },
  card_retired: {
    label: '知识停用',
    payload: ['cardId', 'reason', 'previousStatus', 'scope', 'wasPilotApproved'],
  },
  card_pilot_approved: {
    label: '批准用于试点',
    payload: ['cardId', 'sourceKind', 'sourceRef', 'appliesTo', 'approvalBody', 'knowledgeOwner', 'validUntil'],
  },

  /* —— 交接（api.js handoff / handoff/accept）—— */
  handoff_prepared: {
    label: '交接已准备',
    payload: ['runId', 'recipientMemberId', 'recipientName', 'handoffText'],
  },
  handoff_accepted: { label: '交接已接收', payload: ['preparedEventId', 'recipientMemberId', 'waitMs'] },

  /* —— 工作区与反馈 —— */
  workspace_exported: { label: '团队数据导出', payload: ['formatVersion'] },
  workspace_name_changed: { label: '团队名称变更', payload: ['previousName', 'displayName'] },
  feedback_submitted: { label: '提交产品反馈', payload: ['feedbackId', 'category', 'page'] },
  feedback_status_changed: { label: '更新反馈状态', payload: ['feedbackId', 'from', 'to'] },

  /* —— 演示与工具（demo 模式专用，产品模式不产生）—— */
  tool_call: { label: '工具调用', payload: ['cardId', 'runId'] },
  seed_loaded: { label: '演示数据', payload: [] },

  /* —— 安全断言（api.js 分发层；路线图 P1 工项 2）—— */
  agent_write_rejected: { label: 'AI 写请求被拒绝', payload: ['actorName', 'method', 'path'] },
});

export const EVENT_KIND_LABEL = Object.freeze(
  Object.fromEntries(Object.entries(EVENT_KINDS).map(([kind, spec]) => [kind, spec.label])),
);

/** 返回违规说明字符串；合规返回 null。只提示，不阻断（契约漂移靠启动期与审查发现）。 */
export function assertEventPayload(kind, payload) {
  const spec = EVENT_KINDS[kind];
  if (!spec) return `未登记的事件 kind：${kind}（请先在 server/event-kinds.js 登记）`;
  const extra = Object.keys(payload || {}).filter((key) => !spec.payload.includes(key));
  if (extra.length) return `事件 ${kind} 的 payload 含白名单外字段：${extra.join(', ')}`;
  return null;
}
