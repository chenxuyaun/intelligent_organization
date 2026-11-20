import { nowIso } from './time.js';
import { REVIEW_SOURCES, REVIEW_SOURCE_LABEL } from './review-source.js';
import { DESENSITIZATION_STATES } from './data-scope.js';
import { searchMemory } from './retrieval.js';
import { createAnalytics } from './analytics.js';
import { assertEventPayload } from './event-kinds.js';
import { DEFAULT_WORK_ITEM_TYPE, isValidWorkItemType } from './work-items.js';

const j = (v, fallback) => {
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
};

/**
 * 任务域核心存储（ADR-008 E1 概念重命名：语义层用 workItem，物理层不变）。
 *
 * 概念映射（代码/注释读法 ↔ 物理层冻结名）：
 *   工作项 WorkItem          ↔ tickets 表 / ticket* 列 / /api/tickets 路由（E5 前不改名）
 *   场景适配 support_ticket  ↔ tickets.work_item_type 列（默认值，词表见 work-items.js）
 *   核心机制（权限阶梯、审核权威=最大 review id、交接验证、scope fail-closed、
 *   审计事件、采纳/有效跟踪）全部在本文件与 api.js 实现一次，不按类型分支。
 */
export function createStore(db) {
  const q = (sql) => db.prepare(sql);
  const analytics = createAnalytics(db);

  const stmt = {
    insertMember: q('INSERT INTO members (name, role) VALUES (?, ?)'),
    members: q(`SELECT id, name, role, status FROM members
                WHERE status IN ('active','sample') ORDER BY id`),
    memberById: q('SELECT * FROM members WHERE id = ?'),
    workspaceProfile: q('SELECT display_name, updated_by_member_id, updated_at FROM workspace_profile WHERE id = 1'),
    upsertWorkspaceProfile: q(`INSERT INTO workspace_profile (id, display_name, updated_by_member_id, updated_at)
                               VALUES (1, ?, ?, ?)
                               ON CONFLICT(id) DO UPDATE SET
                                 display_name = excluded.display_name,
                                 updated_by_member_id = excluded.updated_by_member_id,
                                 updated_at = excluded.updated_at`),

    insertTicket: q(`INSERT INTO tickets (title, description, category, urgency, status, assignee_id, work_item_type, parent_ticket_id, scope, source_ref, desensitization, authorized_by, model_authorized_by, model_authorized_base_url, model_authorized_model, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    ticketById: q('SELECT * FROM tickets WHERE id = ?'),
    ticketsAll: q(`SELECT t.*, m.name AS assignee_name FROM tickets t
                   LEFT JOIN members m ON m.id = t.assignee_id ORDER BY t.updated_at DESC`),
    ticketUpdate: q('UPDATE tickets SET status = ?, assignee_id = ?, outcome = ?, outcome_note = ?, resolved_at = ?, updated_at = ? WHERE id = ? AND updated_at = ?'),
    ticketModelAuthorizationUpdate: q(`UPDATE tickets SET model_authorized_by = ?, model_authorized_base_url = ?,
                                       model_authorized_model = ?, updated_at = ? WHERE id = ?`),

    insertGroup: q('INSERT INTO run_groups (id, ticket_id, created_at) VALUES (?, ?, ?)'),
    insertRun: q(`INSERT INTO runs (run_group, ticket_id, mode, model, prompt_version, context_sources, tool_calls, output, latency_ms, origin, scope, created_by_member_id, path, path_reason, gate_ms, retrieve_ms, model_ms, prompt_tokens, completion_tokens, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    runsByTicket: q(`SELECT r.*, (SELECT COUNT(*) FROM reviews v WHERE v.run_id = r.id) AS review_count
                     FROM runs r WHERE r.ticket_id = ? ORDER BY r.id DESC`),
    runById: q('SELECT * FROM runs WHERE id = ?'),
    // 运行去重的数据库级兜底（④§4.3）：事件时间序可能被演示数据回拨，直接查 runs 更可靠
    latestRunAtForTicket: q('SELECT created_at FROM runs WHERE ticket_id = ? ORDER BY id DESC LIMIT 1'),

    insertReview: q(`INSERT INTO reviews (run_id, decision, edited_text, rating, reason, reviewer, reviewer_member_id, review_source_type, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    reviewsByRun: q('SELECT * FROM reviews WHERE run_id = ? ORDER BY id DESC'),
    reviewsByTicket: q(`SELECT v.*, r.mode, r.ticket_id FROM reviews v JOIN runs r ON r.id = v.run_id
                        WHERE r.ticket_id = ? ORDER BY v.id DESC`),
    latestReviewByMode: q(`SELECT v.* FROM reviews v JOIN runs r ON r.id = v.run_id
                           WHERE r.ticket_id = ? AND r.mode = ? ORDER BY v.id DESC LIMIT 1`),

    insertCard: q(`INSERT INTO knowledge_cards (title, content, tags, source_ticket_id, status, version, scope, source_kind, source_ref, applies_to, approval_body, valid_until, pilot_approved, knowledge_owner, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    cardById: q('SELECT * FROM knowledge_cards WHERE id = ?'),
    cardsAll: q(`SELECT c.*, t.title AS source_title FROM knowledge_cards c
                 LEFT JOIN tickets t ON t.id = c.source_ticket_id ORDER BY c.updated_at DESC`),
    cardsPublished: q(`SELECT c.*, t.title AS source_title FROM knowledge_cards c
                       LEFT JOIN tickets t ON t.id = c.source_ticket_id
                       WHERE c.status = 'published' AND c.superseded_by_card_id IS NULL ORDER BY c.updated_at DESC`),
    cardUpdateStatus: q('UPDATE knowledge_cards SET status = ?, version = ?, updated_at = ? WHERE id = ?'),
    cardUpdateContent: q("UPDATE knowledge_cards SET content = ?, updated_at = ? WHERE id = ? AND status = 'pending'"),
    cardDraftExists: q(`SELECT * FROM knowledge_cards WHERE source_ticket_id = ? AND status IN ('draft','pending','published','retired') ORDER BY id DESC LIMIT 1`),
    cardRevisionPending: q(`SELECT * FROM knowledge_cards WHERE supersedes_card_id = ? AND status IN ('draft','pending') ORDER BY id DESC LIMIT 1`),
    insertCardRevision: q(`INSERT INTO knowledge_cards
      (title, content, tags, source_ticket_id, status, version, scope, source_kind, source_ref, applies_to,
       approval_body, valid_until, pilot_approved, knowledge_owner, supersedes_card_id, supersedes_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, 0, '', ?, ?, ?, ?)`),
    setSupersededBy: q(`UPDATE knowledge_cards SET superseded_by_card_id = ?, updated_at = ?
                        WHERE id = ? AND status = 'published' AND superseded_by_card_id IS NULL`),

    insertCardReview: q('INSERT INTO card_reviews (card_id, action, note, reviewer, reviewer_member_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    cardReviewsByCard: q('SELECT * FROM card_reviews WHERE card_id = ? ORDER BY id DESC'),

    insertUse: q('INSERT INTO knowledge_uses (card_id, run_id, ticket_id, snippet, created_at) VALUES (?, ?, ?, ?, ?)'),
    usesByCard: q('SELECT * FROM knowledge_uses WHERE card_id = ? ORDER BY id DESC'),
    usesByRun: q('SELECT * FROM knowledge_uses WHERE run_id = ?'),
    useById: q('SELECT * FROM knowledge_uses WHERE id = ?'),
    // P2 记忆闭环（④§6.1）：权威审核回写 + 成员有效性标注
    updateUsesAdoption: q('UPDATE knowledge_uses SET adopted = ?, adopted_review_id = ? WHERE run_id = ?'),
    markUseHelpfulness: q('UPDATE knowledge_uses SET helpful = ?, helpful_note = ?, helpful_by_member_id = ?, helpful_recorded_at = ? WHERE id = ?'),
    usesAll: q(`SELECT u.*, c.title AS card_title, t.title AS ticket_title FROM knowledge_uses u
                JOIN knowledge_cards c ON c.id = u.card_id
                JOIN tickets t ON t.id = u.ticket_id ORDER BY u.id DESC LIMIT 100`),

    insertEvent: q('INSERT INTO events (ticket_id, kind, actor, actor_member_id, summary, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    eventsAll: q(`SELECT e.*, t.title AS ticket_title FROM events e
                  LEFT JOIN tickets t ON t.id = e.ticket_id ORDER BY e.id DESC LIMIT ?`),
    eventsByTicket: q('SELECT * FROM events WHERE ticket_id = ? ORDER BY id DESC'),
    eventsRecent: q('SELECT e.*, t.title AS ticket_title FROM events e LEFT JOIN tickets t ON t.id = e.ticket_id ORDER BY e.id DESC LIMIT ?'),

    insertFeedback: q(`INSERT INTO feedback
      (category, message, page, reporter_member_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`),
    feedbackById: q(`SELECT f.*, reporter.name AS reporter_name, reporter.email AS reporter_email,
                            updater.name AS updated_by_name
                     FROM feedback f
                     JOIN members reporter ON reporter.id = f.reporter_member_id
                     LEFT JOIN members updater ON updater.id = f.updated_by_member_id
                     WHERE f.id = ?`),
    feedbackByReporter: q(`SELECT f.*, reporter.name AS reporter_name, reporter.email AS reporter_email,
                                  updater.name AS updated_by_name
                           FROM feedback f
                           JOIN members reporter ON reporter.id = f.reporter_member_id
                           LEFT JOIN members updater ON updater.id = f.updated_by_member_id
                           WHERE f.reporter_member_id = ? ORDER BY f.created_at DESC, f.id DESC LIMIT ?`),
    feedbackAll: q(`SELECT f.*, reporter.name AS reporter_name, reporter.email AS reporter_email,
                           updater.name AS updated_by_name
                    FROM feedback f
                    JOIN members reporter ON reporter.id = f.reporter_member_id
                    LEFT JOIN members updater ON updater.id = f.updated_by_member_id
                    ORDER BY CASE f.status WHEN 'open' THEN 0 WHEN 'reviewing' THEN 1 ELSE 2 END,
                             f.created_at DESC, f.id DESC LIMIT ?`),
    updateFeedbackStatus: q(`UPDATE feedback SET status = ?, updated_by_member_id = ?, updated_at = ?
                             WHERE id = ?`),
  };

  function addEvent({ ticketId = null, kind, actor = 'system', actorMemberId = null, summary, payload = {} }) {
    // 审计 payload 白名单（④§3.2，路线图 P1 工项 4）：契约漂移在写入点即报错，而不是静默落库。
    const violation = assertEventPayload(kind, payload);
    if (violation) throw new Error(violation);
    const info = stmt.insertEvent.run(ticketId, kind, actor, actorMemberId, summary, JSON.stringify(payload), nowIso());
    return Number(info.lastInsertRowid);
  }

  function workspaceName(fallback = '') {
    return stmt.workspaceProfile.get()?.display_name || fallback;
  }

  function updateWorkspaceName({ name, fallback = '', actor, actorMemberId }) {
    const previousName = workspaceName(fallback);
    if (previousName === name) return { name: previousName, changed: false };
    const updatedAt = nowIso();
    db.exec('BEGIN IMMEDIATE');
    try {
      stmt.upsertWorkspaceProfile.run(name, actorMemberId, updatedAt);
      addEvent({
        kind: 'workspace_name_changed',
        actor,
        actorMemberId,
        summary: '修改团队显示名称',
        payload: { previousName, displayName: name },
      });
      db.exec('COMMIT');
      return { name, changed: true };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function getTicket(id) {
    return stmt.ticketById.get(id) || null;
  }

  function listTickets() {
    return stmt.ticketsAll.all();
  }

  function createTicket({
    title, description, category = '', urgency = '', assigneeId = null, status = 'open', scope = 'sample',
    sourceRef = '', desensitization = 'unknown', authorizedBy = '', modelAuthorizedBy = '',
    modelAuthorizedBaseUrl = '', modelAuthorizedModel = '', actor = 'user', actorMemberId = null,
    workItemType = DEFAULT_WORK_ITEM_TYPE,
    parentTicketId = null,
  }) {
    if (!isValidWorkItemType(workItemType)) throw new Error(`未知的工作项类型：${workItemType}`);
    // 跨类型父子（E4 最小结构）：父必须存在；类型差异允许（子任务可在任意类型下建层级），
    // 父子都走同一条 insertTicket 路径——核心机制零分支。
    let parent = null;
    if (parentTicketId !== null && parentTicketId !== undefined && parentTicketId !== '') {
      parent = Number(parentTicketId);
      const parentRow = stmt.ticketById.get(parent);
      if (!parentRow) throw new Error('父工作项不存在');
    }
    const at = nowIso();
    const resolvedAt = status === 'resolved' ? at : null;
    // 数据范围默认 sample：真实试点必须显式传 pilot，避免新单误入/误出隔离区
    const ticketScope = scope === 'pilot' ? 'pilot' : 'sample';
    // sample 工单不携带试点元数据；pilot 工单保留操作人员声明的来源/脱敏/授权人
    const src = ticketScope === 'pilot' ? String(sourceRef || '').trim() : '';
    const desens = ticketScope === 'pilot' && DESENSITIZATION_STATES.includes(desensitization)
      ? desensitization : 'unknown';
    const auth = ticketScope === 'pilot' ? String(authorizedBy || '').trim() : '';
    const modelAuth = ticketScope === 'pilot' ? String(modelAuthorizedBy || '').trim() : '';
    const modelAuthBaseUrl = modelAuth ? String(modelAuthorizedBaseUrl || '').trim() : '';
    const modelAuthModel = modelAuth ? String(modelAuthorizedModel || '').trim() : '';
    const info = stmt.insertTicket.run(title, description, category, urgency, status, assigneeId, workItemType, parent, ticketScope, src, desens, auth, modelAuth, modelAuthBaseUrl, modelAuthModel, at, at);
    const id = Number(info.lastInsertRowid);
    if (resolvedAt) db.prepare('UPDATE tickets SET resolved_at = ? WHERE id = ?').run(resolvedAt, id);
    addEvent({ ticketId: id, kind: 'ticket_created', actor, actorMemberId, summary: `新建问题单「${title}」`, payload: {
      urgency, scope: ticketScope, source_ref: src, desensitization: desens,
      storage_authorization_recorded: Boolean(auth), model_authorization_recorded: Boolean(modelAuth),
      workItemType, parentTicketId: parent,
    } });
    if (modelAuth) {
      addEvent({
        ticketId: id,
        kind: 'ticket_model_authorization_changed',
        actor,
        actorMemberId,
        summary: `新建工单时登记模型发送确认：${modelAuthModel}`,
        payload: {
          fromRecorded: false,
          toRecorded: true,
          targetChanged: true,
          previousTarget: null,
          target: { baseUrl: modelAuthBaseUrl, model: modelAuthModel },
        },
      });
    }
    return getTicket(id);
  }

  function updateTicketModelAuthorization(id, modelAuthorizedBy, {
    modelAuthorizedBaseUrl = '', modelAuthorizedModel = '', actor = 'team-admin', actorMemberId = null,
  } = {}) {
    const initial = getTicket(id);
    if (!initial) return null;
    if (initial.scope !== 'pilot') return { error: '只有真实试点工单需要模型发送确认记录' };

    const next = String(modelAuthorizedBy || '').trim();
    const nextBaseUrl = next ? String(modelAuthorizedBaseUrl || '').trim() : '';
    const nextModel = next ? String(modelAuthorizedModel || '').trim() : '';
    if (next && (!nextBaseUrl || !nextModel)) return { error: '当前模型端点或名称缺失，无法登记发送确认' };
    const wasRecorded = Boolean(String(initial.model_authorized_by || '').trim());
    const targetChanged = String(initial.model_authorized_base_url || '') !== nextBaseUrl
      || String(initial.model_authorized_model || '') !== nextModel;
    if (String(initial.model_authorized_by || '').trim() === next && !targetChanged) {
      return { ticket: initial, changed: false };
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      const current = getTicket(id);
      if (!current || current.scope !== 'pilot') throw new Error('工单状态已变化，请刷新后重试');
      const currentState = [
        String(current.model_authorized_by || '').trim(),
        String(current.model_authorized_base_url || ''),
        String(current.model_authorized_model || ''),
      ];
      const initialState = [
        String(initial.model_authorized_by || '').trim(),
        String(initial.model_authorized_base_url || ''),
        String(initial.model_authorized_model || ''),
      ];
      if (currentState.some((value, index) => value !== initialState[index])) {
        throw new Error('模型发送确认记录已被其他操作更新，请刷新后重试');
      }
      const nextStateRecorded = Boolean(next);
      const previousTarget = wasRecorded ? {
        baseUrl: String(current.model_authorized_base_url || ''),
        model: String(current.model_authorized_model || ''),
      } : null;
      stmt.ticketModelAuthorizationUpdate.run(next, nextBaseUrl, nextModel, nowIso(), id);
      addEvent({
        ticketId: id,
        kind: 'ticket_model_authorization_changed',
        actor,
        actorMemberId,
        summary: !nextStateRecorded ? '撤销模型发送确认记录'
          : !wasRecorded ? `登记模型发送确认：${nextModel}`
            : targetChanged ? `更新模型发送确认目标为：${nextModel}` : '更新模型发送确认人',
        payload: {
          fromRecorded: wasRecorded,
          toRecorded: nextStateRecorded,
          targetChanged,
          previousTarget,
          target: nextStateRecorded ? { baseUrl: nextBaseUrl, model: nextModel } : null,
        },
      });
      db.exec('COMMIT');
      return { ticket: getTicket(id), changed: true };
    } catch (error) {
      db.exec('ROLLBACK');
      if (error instanceof Error && /工单状态已变化|模型发送确认记录已被其他操作更新/.test(error.message)) return { error: error.message };
      throw error;
    }
  }

  function updateTicket(id, patch, { expectedUpdatedAt = null } = {}) {
    const current = getTicket(id);
    if (!current) return null;
    // 乐观并发（④§4.3）：带 expectedUpdatedAt 时，updated_at 已被他人改动 → 返回 { conflict: true }，不覆盖。
    if (expectedUpdatedAt && String(current.updated_at) !== String(expectedUpdatedAt)) {
      return { conflict: true, latest: current };
    }
    const status = patch.status ?? current.status;
    const assigneeId = patch.assigneeId === undefined ? current.assignee_id : patch.assigneeId;
    const outcome = patch.outcome === undefined ? current.outcome : patch.outcome;
    const outcomeNote = patch.outcomeNote === undefined ? current.outcome_note : patch.outcomeNote;
    const resolvedAt = status === 'resolved' && current.status !== 'resolved' ? nowIso() : current.resolved_at;
    const updatedAt = nowIso();
    const result = stmt.ticketUpdate.run(status, assigneeId, outcome, outcomeNote, resolvedAt, updatedAt, id, expectedUpdatedAt || current.updated_at);
    if (Number(result.changes) !== 1) return { conflict: true, latest: getTicket(id) };

    if (status !== current.status) {
      addEvent({
        ticketId: id,
        kind: 'ticket_status',
        actor: patch.actor || 'user',
        actorMemberId: patch.actorMemberId || null,
        summary: `状态 ${current.status} → ${status}`,
        payload: { from: current.status, to: status, outcome },
      });
    }
    if (assigneeId !== current.assignee_id) {
      const m = assigneeId ? stmt.memberById.get(assigneeId) : null;
      addEvent({ ticketId: id, kind: 'assignee_changed', actor: patch.actor || 'user', actorMemberId: patch.actorMemberId || null, summary: `负责人改为 ${m ? m.name : '未分派'}`, payload: { assigneeId } });
    }
    const outcomeChanged = outcome !== current.outcome;
    const outcomeNoteChanged = outcomeNote !== current.outcome_note;
    if (outcomeChanged || outcomeNoteChanged) {
      const statusLabel = { open: '待处理', in_progress: '处理中', resolved: '已解决', reopened: '重开', escalated: '升级' }[status] || status;
      const noteText = String(outcomeNote || '').trim();
      const summary = outcomeNoteChanged
        ? noteText ? `更新处理记录（${statusLabel}）：${noteText}` : `清除处理记录（${statusLabel}）`
        : `记录结果：${outcome || statusLabel}`;
      addEvent({
        ticketId: id,
        kind: 'outcome_recorded',
        actor: patch.actor || 'user',
        actorMemberId: patch.actorMemberId || null,
        summary,
        payload: { outcome, note: outcomeNote, status },
      });
    }
    return getTicket(id);
  }

  function createRunGroup(ticketId) {
    const id = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    stmt.insertGroup.run(id, ticketId, nowIso());
    return id;
  }

  function createRun(run) {
    const at = nowIso();
    const info = stmt.insertRun.run(
      run.runGroup,
      run.ticketId,
      run.mode,
      run.model,
      run.promptVersion,
      JSON.stringify(run.contextSources || []),
      JSON.stringify(run.toolCalls || []),
      JSON.stringify(run.output),
      run.latencyMs || 0,
      run.origin || 'live',
      // 运行范围自动继承工单，调用方不能自带 scope
      (() => {
        const ticket = stmt.ticketById.get(run.ticketId);
        return ticket?.scope === 'pilot' ? 'pilot' : 'sample';
      })(),
      run.createdByMemberId || null,
      // 路径与延迟拆分（④§7、⑤§6）：v1 只有主路径；分层路由（routeRequest）属 P4，落库先行
      run.path || 'main',
      run.pathReason || '',
      run.gateMs || 0,
      run.retrieveMs || 0,
      run.modelMs || 0,
      Number.isFinite(run.promptTokens) ? run.promptTokens : null,
      Number.isFinite(run.completionTokens) ? run.completionTokens : null,
      at,
    );
    const id = Number(info.lastInsertRowid);
    addEvent({
      ticketId: run.ticketId,
      kind: 'agent_run',
      actor: run.mode === 'organization' ? 'agent:org-mode' : 'agent:personal-mode',
      actorMemberId: run.createdByMemberId || null,
      summary: `智能体运行（${run.mode === 'organization' ? '组织模式' : '个人模式'}），引用 ${(run.contextSources || []).length} 条`,
      payload: { runId: id, model: run.model, latencyMs: run.latencyMs, origin: run.origin },
    });
    for (const src of run.contextSources || []) {
      if (src.type !== 'card') continue;
      stmt.insertUse.run(src.id, id, run.ticketId, src.snippet || '', at);
      addEvent({
        ticketId: run.ticketId,
        kind: 'memory_cited',
        actor: 'agent:org-mode',
        summary: `引用知识 K${src.id}「${src.title}」`,
        payload: { cardId: src.id, runId: id, score: src.score },
      });
    }
    return getRun(id);
  }

  function getRun(id) {
    const row = stmt.runById.get(id);
    if (!row) return null;
    return {
      ...row,
      context_sources: j(row.context_sources, []),
      tool_calls: j(row.tool_calls, []),
      output: j(row.output, {}),
      reviews: stmt.reviewsByRun.all(id),
    };
  }

  function runsByTicket(ticketId) {
    return stmt.runsByTicket.all(ticketId).map((row) => ({
      ...row,
      context_sources: j(row.context_sources, []),
      tool_calls: j(row.tool_calls, []),
      output: j(row.output, {}),
      reviews: stmt.reviewsByRun.all(row.id),
    }));
  }

  function addReview({ runId, decision, editedText = null, rating = null, reason = '', reviewer, reviewerMemberId = null, sourceType = 'human' }) {
    const run = stmt.runById.get(runId);
    if (!run) return null;
    if (!REVIEW_SOURCES.includes(sourceType)) throw new Error('未知的审核来源类型');
    const reviewInfo = stmt.insertReview.run(runId, decision, editedText, rating, reason, reviewer, reviewerMemberId, sourceType, nowIso());
    const reviewId = Number(reviewInfo.lastInsertRowid);
    // P2 记忆闭环（④§6.1）：审核权威 = 最大 review id。每次新审核都按最新决定重写该运行全部 use 行——
    // adopt/edit → adopted=1；reject（含改判）→ adopted=0、回写引用清空。不与 helpful 标注互相推断。
    if (run.mode === 'organization') {
      stmt.updateUsesAdoption.run(decision === 'reject' ? 0 : 1, decision === 'reject' ? null : reviewId, runId);
    }
    const label = decision === 'adopt' ? '采纳' : decision === 'edit' ? '编辑后采纳' : '拒绝';
    addEvent({
      ticketId: run.ticket_id,
      kind: 'review_submitted',
      actor: reviewer,
      actorMemberId: reviewerMemberId,
      summary: `${REVIEW_SOURCE_LABEL[sourceType]}：${run.mode === 'organization' ? '组织模式' : '个人模式'}建议被${label}${rating ? `（评分 ${rating}/5）` : ''}`,
      payload: { runId, decision, rating, reason, sourceType },
    });
    return stmt.reviewsByRun.all(runId);
  }

  /** P2-3（④§6.1）：成员对单条记忆使用做三态有效性标注（有帮助 / 没帮助 / 清除）。
   *  这是人工判断记录，不是审核决定；标注互相覆盖（每 use 行保存最后一次标注）。 */
  function recordUseHelpfulness({ useId, helpful, note = '', byMemberId = null }) {
    const use = stmt.useById.get(useId);
    if (!use) return null;
    const helpfulValue = helpful === 'clear' || helpful === null ? null : helpful ? 1 : 0;
    stmt.markUseHelpfulness.run(
      helpfulValue,
      String(note || '').trim().slice(0, 500),
      helpfulValue === null ? null : byMemberId,
      helpfulValue === null ? null : nowIso(),
      useId,
    );
    addEvent({
      ticketId: use.ticket_id,
      kind: 'use_helpfulness_recorded',
      actor: byMemberId ? (stmt.memberById.get(byMemberId)?.name || 'team-member') : 'team-member',
      actorMemberId: helpfulValue === null ? null : byMemberId,
      summary: helpfulValue === null
        ? `清除记忆有效性标注（K${use.card_id} · 运行 #${use.run_id}）`
        : `记忆有效性标注：${helpfulValue === 1 ? '有帮助' : '没帮助'}（K${use.card_id} · 运行 #${use.run_id}）`,
      payload: { useId, runId: use.run_id, cardId: use.card_id, helpful: helpfulValue, hasNote: Boolean(String(note || '').trim()) },
    });
    return stmt.useById.get(useId);
  }

  function listCards({ status = null, q: query = '' } = {}) {
    const rows = status ? stmt.cardsAll.all().filter((c) => c.status === status) : stmt.cardsAll.all();
    const withStats = rows.map((c) => ({
      ...c,
      uses: stmt.usesByCard.all(c.id),
      reviews: stmt.cardReviewsByCard.all(c.id),
    }));
    if (!query) return withStats;
    const hits = searchMemory(query, withStats.map((c) => ({ id: c.id, type: 'card', title: c.title, body: c.content, tags: c.tags })), { limit: 50, minScore: 0.5 });
    const order = new Map(hits.map((h, i) => [h.id, i]));
    return withStats
      .filter((c) => order.has(c.id))
      .sort((a, b) => order.get(a.id) - order.get(b.id));
  }

  function getCard(id) {
    const card = stmt.cardById.get(id);
    if (!card) return null;
    return { ...card, uses: stmt.usesByCard.all(id), reviews: stmt.cardReviewsByCard.all(id) };
  }

  function createCardRevision({ cardId, content, sourceRef, appliesTo, note, actorMemberId = null }) {
    const parent = stmt.cardById.get(cardId);
    if (!parent) return null;
    if (parent.status !== 'published' || parent.superseded_by_card_id) {
      return { error: '只有当前生效的已发布卡片可以创建修订稿' };
    }
    if (parent.scope !== 'sample') {
      return { error: '当前修订流程仅开放给模拟样本卡片；真实试点卡片仍需走专门审批流程' };
    }
    if (stmt.cardRevisionPending.get(cardId)) {
      return { error: '这张卡已有待审核修订稿，请先处理现有修订稿' };
    }
    const nextContent = String(content || '').trim();
    if (!nextContent) return { error: '知识卡片正文不能为空' };
    if (nextContent.length > 12000) return { error: '知识卡片正文不能超过 12000 个字符' };
    const revisionNote = String(note || '').trim();
    if (!revisionNote) return { error: '请填写修订说明' };

    db.exec('BEGIN IMMEDIATE');
    try {
      // Recheck inside the write transaction so two concurrent submissions cannot create competing revisions.
      const current = stmt.cardById.get(cardId);
      if (!current || current.status !== 'published' || current.superseded_by_card_id) {
        throw new Error('原知识卡状态已变化，请刷新后重试');
      }
      if (stmt.cardRevisionPending.get(cardId)) throw new Error('这张卡已有待审核修订稿，请先处理现有修订稿');
      const at = nowIso();
      const version = Number(current.version || 1) + 1;
      const info = stmt.insertCardRevision.run(
        current.title,
        nextContent,
        current.tags,
        current.source_ticket_id,
        version,
        current.scope,
        current.source_kind,
        String(sourceRef ?? current.source_ref ?? '').trim(),
        String(appliesTo ?? current.applies_to ?? '').trim(),
        current.approval_body,
        current.valid_until,
        current.id,
        current.version,
        at,
        at,
      );
      const revisionId = Number(info.lastInsertRowid);
      addEvent({
        ticketId: current.source_ticket_id,
        kind: 'card_revision_drafted',
        actor: actorMemberId ? (stmt.memberById.get(actorMemberId)?.name || 'team-member') : 'agent:knowledge-revision',
        actorMemberId,
        summary: `为 K${current.id} v${current.version} 创建待审核修订 K${revisionId} v${version}：${revisionNote}`,
        payload: {
          cardId: revisionId,
          supersedesCardId: current.id,
          supersedesVersion: current.version,
          candidateVersion: version,
          scope: current.scope,
          note: revisionNote,
          publishDecision: 'not_made',
        },
      });
      db.exec('COMMIT');
      return { card: getCard(revisionId), created: true };
    } catch (error) {
      db.exec('ROLLBACK');
      if (error instanceof Error && /原知识卡状态|已有待审核修订稿/.test(error.message)) return { error: error.message };
      throw error;
    }
  }

  function createCard({
    title, content, tags = '', sourceTicketId = null, status = 'pending',
    sourceKind = 'unknown', sourceRef = '', appliesTo = '',
    approvalBody = '', validUntil = null, actorMemberId = null,
  }) {
    const at = nowIso();
    // 卡片范围只继承来源工单；无来源工单时保守取 sample。
    // 不允许调用方把 sample 工单的草稿通过 scope 参数升级为 pilot。
    const ticket = sourceTicketId ? stmt.ticketById.get(sourceTicketId) : null;
    const cardScope = ticket?.scope === 'pilot' ? 'pilot' : 'sample';
    const info = stmt.insertCard.run(
      title, content, tags, sourceTicketId, status, 1,
      cardScope, sourceKind, sourceRef, appliesTo, approvalBody, validUntil,
      0, // 只能通过 approveCardForPilot 明确批准，创建卡片时不得自动进入检索
      '', // 知识负责人由人工在批准/发布时填写，草稿阶段不预设
      at, at,
    );
    const id = Number(info.lastInsertRowid);
    addEvent({
      ticketId: sourceTicketId,
      kind: 'card_drafted',
      actor: actorMemberId ? (stmt.memberById.get(actorMemberId)?.name || 'team-member') : 'agent:support',
      actorMemberId,
      summary: `生成知识卡片草稿 K${id}「${title}」，等待人工审批`,
      payload: { cardId: id, status, scope: cardScope, sourceKind },
    });
    return getCard(id);
  }

  function reviewCard({ cardId, action, note = '', reviewer, reviewerMemberId = null }) {
    const card = stmt.cardById.get(cardId);
    if (!card) return null;
    if (['publish', 'reject'].includes(action) && card.status !== 'pending') {
      return { error: '只有待审核的知识卡片可以发布或驳回' };
    }
    const nextStatus = action === 'publish' ? 'published' : action === 'reject' ? 'rejected' : 'pending';
    const isRevision = Boolean(card.supersedes_card_id);
    const nextVersion = action === 'publish' && !isRevision ? card.version + 1 : card.version;
    db.exec('BEGIN IMMEDIATE');
    try {
      if (action === 'publish' && isRevision) {
        const parent = stmt.cardById.get(card.supersedes_card_id);
        if (!parent || parent.status !== 'published' || parent.superseded_by_card_id) {
          throw new Error('原版本已变化或已被替代；请检查修订历史后再决定');
        }
        const marked = stmt.setSupersededBy.run(cardId, nowIso(), parent.id);
        if (Number(marked.changes) !== 1) throw new Error('原版本状态已变化；请刷新后重试');
      }
      const updated = stmt.cardUpdateStatus.run(nextStatus, nextVersion, nowIso(), cardId);
      if (Number(updated.changes) !== 1) throw new Error('待审核卡片状态已变化，请刷新后重试');
      stmt.insertCardReview.run(cardId, action, note, reviewer, reviewerMemberId, nowIso());
      addEvent({
        ticketId: card.source_ticket_id,
        kind: action === 'publish' ? 'card_published' : 'card_rejected',
        actor: reviewer,
        actorMemberId: reviewerMemberId,
        summary: `${action === 'publish' ? '发布' : '驳回'}知识卡片 K${cardId}「${card.title}」${note ? `：${note}` : ''}`,
        payload: { cardId, note, ...(isRevision ? { supersedesCardId: card.supersedes_card_id, version: nextVersion } : {}) },
      });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      if (error instanceof Error && /原版本|状态已变化/.test(error.message)) return { error: error.message };
      throw error;
    }
    return getCard(cardId);
  }

  function retireCard({ cardId, note = '', reviewer, reviewerMemberId = null }) {
    const card = stmt.cardById.get(cardId);
    if (!card) return null;
    if (card.status !== 'published' || card.superseded_by_card_id) {
      return { error: '只有当前生效的已发布知识卡片可以停用' };
    }
    const reason = String(note || '').trim();
    const actor = String(reviewer || '').trim();
    if (!reason) return { error: '请填写停用原因' };
    if (!actor) return { error: '停用人必须由操作者明确记录' };

    db.exec('BEGIN IMMEDIATE');
    try {
      const current = stmt.cardById.get(cardId);
      if (!current || current.status !== 'published' || current.superseded_by_card_id) {
        throw new Error('知识卡状态已变化，请刷新后重试');
      }
      const updated = db.prepare(`UPDATE knowledge_cards SET status = 'retired', updated_at = ?
                                  WHERE id = ? AND status = 'published' AND superseded_by_card_id IS NULL`)
        .run(nowIso(), cardId);
      if (Number(updated.changes) !== 1) throw new Error('知识卡状态已变化，请刷新后重试');
      stmt.insertCardReview.run(cardId, 'retire', reason, actor, reviewerMemberId, nowIso());
      addEvent({
        ticketId: card.source_ticket_id,
        kind: 'card_retired',
        actor,
        actorMemberId: reviewerMemberId,
        summary: `停用知识卡片 K${cardId}「${card.title}」：${reason}`,
        payload: {
          cardId,
          reason,
          previousStatus: 'published',
          scope: card.scope,
          wasPilotApproved: Boolean(card.pilot_approved),
        },
      });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      if (error instanceof Error && /状态已变化/.test(error.message)) return { error: error.message };
      throw error;
    }
    return getCard(cardId);
  }

  function editPendingCard({ cardId, content, note = '', editor, editorMemberId = null }) {
    const card = stmt.cardById.get(cardId);
    if (!card) return null;
    if (card.status !== 'pending') return { error: '只有待审核的知识卡片可以编辑' };
    const nextContent = String(content || '').trim();
    if (!nextContent) return { error: '知识卡片正文不能为空' };
    if (nextContent.length > 12000) return { error: '知识卡片正文不能超过 12000 个字符' };
    if (!String(editor || '').trim()) return { error: '请填写编辑者姓名' };
    if (!String(note || '').trim()) return { error: '请填写修改说明' };

    db.exec('BEGIN IMMEDIATE');
    try {
      const updated = stmt.cardUpdateContent.run(nextContent, nowIso(), cardId);
      if (Number(updated.changes) !== 1) throw new Error('知识卡状态已变化，请刷新后重试');
      addEvent({
        ticketId: card.source_ticket_id,
        kind: 'card_draft_edited',
        actor: String(editor).trim(),
        actorMemberId: editorMemberId,
        summary: `编辑待审核知识卡 K${cardId}「${card.title}」：${String(note).trim()}`,
        payload: {
          cardId,
          status: 'pending',
          note: String(note).trim(),
          previousContent: card.content,
          revisedContent: nextContent,
          publishDecision: 'not_made',
        },
      });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return getCard(cardId);
  }

  /** 人工把一张卡明确批准用于 pilot 检索：必须给出可核实的来源元数据。
   *  只写 pilot 相关字段 + 审批记录，不改卡片正文/版本/审核决定。 */
  function approveCardForPilot({
    cardId, sourceKind, sourceRef, appliesTo, approvalBody,
    knowledgeOwner = '', validUntil = null, reviewer, reviewerMemberId = null, note = '',
  }) {
    const card = stmt.cardById.get(cardId);
    if (!card) return null;
    if (card.status !== 'published') return { error: '只有已发布的卡片才能批准用于试点检索' };
    if (card.scope !== 'pilot') return { error: '模拟样本卡片不能升级用于真实试点；请基于真实试点工单或经核验来源新建卡片' };
    if (card.source_ticket_id) {
      const sourceTicket = stmt.ticketById.get(card.source_ticket_id);
      if (!sourceTicket || sourceTicket.scope !== 'pilot') {
        return { error: '来源工单不是 pilot 范围，不能批准该卡片用于真实试点' };
      }
    }
    if (!['policy', 'guide'].includes(sourceKind)) return { error: '来源类型必须是 policy 或 guide' };
    if (!sourceRef || !appliesTo || !approvalBody || !knowledgeOwner) {
      return { error: '必须填写来源、适用范围、审批主体和知识负责人' };
    }
    db.prepare(`UPDATE knowledge_cards
                SET scope = 'pilot', source_kind = ?, source_ref = ?, applies_to = ?,
                    approval_body = ?, knowledge_owner = ?, valid_until = ?, pilot_approved = 1, updated_at = ?
                WHERE id = ?`).run(sourceKind, sourceRef, appliesTo, approvalBody, knowledgeOwner, validUntil, nowIso(), cardId);
    stmt.insertCardReview.run(cardId, 'pilot_approve', note, reviewer, reviewerMemberId, nowIso());
    addEvent({
      ticketId: card.source_ticket_id,
      kind: 'card_pilot_approved',
      actor: reviewer,
      actorMemberId: reviewerMemberId,
      summary: `批准 K${cardId}「${card.title}」用于真实试点检索（${sourceKind}）`,
      payload: { cardId, sourceKind, sourceRef, appliesTo, approvalBody, knowledgeOwner, validUntil },
    });
    return getCard(cardId);
  }

  function draftExistsForTicket(ticketId) {
    return stmt.cardDraftExists.get(ticketId) || null;
  }

  /** 组织模式检索与观察指标委托给 analytics 层（只读聚合）。
   *  opts.excludeTicketId 会一路传给 analytics：排除当前工单自身的已解决案例。 */
  const searchApprovedMemory = (query, limit = 4, opts) => analytics.searchApprovedMemory(query, limit, opts);
  const metrics = () => analytics.metrics();

  function listEvents({ limit = 40, ticketId = null } = {}) {
    return (ticketId ? stmt.eventsByTicket.all(ticketId) : stmt.eventsRecent.all(limit)).map((e) => ({
      ...e,
      payload: j(e.payload, {}),
    }));
  }

  function createFeedback({ category, message, page = '', reporterMemberId }) {
    const at = nowIso();
    db.exec('BEGIN IMMEDIATE');
    try {
      const info = stmt.insertFeedback.run(category, message, page, reporterMemberId, at, at);
      const feedback = stmt.feedbackById.get(Number(info.lastInsertRowid));
      addEvent({
        kind: 'feedback_submitted',
        actor: feedback.reporter_name || feedback.reporter_email || 'team-member',
        actorMemberId: reporterMemberId,
        summary: `提交了产品反馈（${category === 'bug' ? '问题' : category === 'idea' ? '建议' : '其他'}）`,
        payload: { feedbackId: feedback.id, category, page },
      });
      db.exec('COMMIT');
      return feedback;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function feedbackByReporter(reporterMemberId, limit = 50) {
    return stmt.feedbackByReporter.all(reporterMemberId, limit);
  }

  function listFeedback(limit = 100) {
    return stmt.feedbackAll.all(limit);
  }

  function setFeedbackStatus(id, status, updatedByMemberId) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const current = stmt.feedbackById.get(id);
      if (!current) {
        db.exec('COMMIT');
        return null;
      }
      if (current.status === status) {
        db.exec('COMMIT');
        return current;
      }
      const result = stmt.updateFeedbackStatus.run(status, updatedByMemberId, nowIso(), id);
      if (result.changes !== 1) {
        db.exec('COMMIT');
        return null;
      }
      const updated = stmt.feedbackById.get(id);
      const labels = { open: '待处理', reviewing: '处理中', resolved: '已处理' };
      addEvent({
        kind: 'feedback_status_changed',
        actor: updated.updated_by_name || 'team-admin',
        actorMemberId: updatedByMemberId,
        summary: `将产品反馈 #${id} 从「${labels[current.status] || current.status}」改为「${labels[status] || status}」`,
        payload: { feedbackId: id, from: current.status, to: status },
      });
      db.exec('COMMIT');
      return updated;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function exportWorkspaceData() {
    const decodeRows = (sql, jsonColumns = []) => db.prepare(sql).all().map((row) => {
      const result = { ...row };
      for (const column of jsonColumns) result[column] = j(result[column], {});
      return result;
    });
    return {
      format: 'intelligent-organization-workspace',
      formatVersion: 1,
      exportedAt: nowIso(),
      data: {
        // OIDC subjects, session token hashes and in-progress login state are deliberately excluded.
        workspace_profile: decodeRows('SELECT id, display_name, updated_by_member_id, updated_at FROM workspace_profile'),
        members: decodeRows(`SELECT id, name, role, email, status, invited_at, invite_expires_at, activated_at
                             FROM members WHERE status <> 'sample' ORDER BY id`),
        tickets: decodeRows('SELECT * FROM tickets ORDER BY id'),
        run_groups: decodeRows('SELECT * FROM run_groups ORDER BY created_at, id'),
        runs: decodeRows('SELECT * FROM runs ORDER BY id', ['context_sources', 'tool_calls', 'output']),
        reviews: decodeRows('SELECT * FROM reviews ORDER BY id'),
        knowledge_cards: decodeRows('SELECT * FROM knowledge_cards ORDER BY id'),
        card_reviews: decodeRows('SELECT * FROM card_reviews ORDER BY id'),
        knowledge_uses: decodeRows('SELECT * FROM knowledge_uses ORDER BY id'),
        events: decodeRows('SELECT * FROM events ORDER BY id', ['payload']),
        feedback: decodeRows(`SELECT id, category, message, page, status, reporter_member_id,
                                     updated_by_member_id, created_at, updated_at
                              FROM feedback ORDER BY id`),
      },
    };
  }

  return {
    raw: db,
    members: () => stmt.members.all(),
    workspaceName,
    updateWorkspaceName,
    memberById: (id) => stmt.memberById.get(id) || null,
    addMember: (name, role) => Number(stmt.insertMember.run(name, role).lastInsertRowid),
    getTicket,
    listTickets,
    createTicket,
    updateTicket,
    updateTicketModelAuthorization,
    createRunGroup,
    createRun,
    getRun,
    usesByRun: (runId) => stmt.usesByRun.all(runId),
    runsByTicket,
    latestRunAtForTicket: (ticketId) => stmt.latestRunAtForTicket.get(ticketId) || null,
    addReview,
    recordUseHelpfulness,
    reviewsByTicket: (ticketId) => stmt.reviewsByTicket.all(ticketId),
    latestReviewByMode: (ticketId, mode) => stmt.latestReviewByMode.get(ticketId, mode) || null,
    listCards,
    getCard,
    createCard,
    createCardRevision,
    editPendingCard,
    reviewCard,
    retireCard,
    approveCardForPilot,
    draftExistsForTicket,
    searchApprovedMemory,
    recordUseHelpfulness,
    metrics,
    listEvents,
    createFeedback,
    feedbackByReporter,
    listFeedback,
    setFeedbackStatus,
    exportWorkspaceData,
    addEvent,
  };
}
