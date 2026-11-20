import { ORG_NAME, PRODUCT_MODE, modelStatus } from './config.js';
import { draftKnowledgeCard, runPair, prepareHandoff, searchApprovedMemory, PROMPT_VERSION, AGENT_ROLE } from './agent.js';
import { pilotDraftGate } from './draft-gate.js';
import { DESENSITIZATION_LABEL, isValidKnowledgeDate } from './data-scope.js';
import { seedIfEmpty } from './seed.js';
import { OBSERVATION_BATCHES, buildBatchView } from './batches.js';
import { buildPilotLoop } from './pilot-loop.js';
import { buildTeamLearning } from './team-learning.js';

const json = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(payload);
};

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('请求体不是合法 JSON');
  }
}

const str = (v, max = 4000) => String(v ?? '').trim().slice(0, max);
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
// 审核者姓名必须由操作者在界面显式填写；它不是登录身份认证，服务端不再代填默认值。
const REVIEWER_REQUIRED = '人工审核必须由操作者显式填写审核者姓名（这是手工填写的审核者记录，不是登录身份认证）';
const CARD_EDITOR_REQUIRED = '编辑待审核知识卡必须填写编辑者姓名（手工归属记录，不是登录身份认证）';

function latestReviewForRun(run) {
  return (run.reviews || []).reduce((latest, review) => (
    !latest || Number(review.id) > Number(latest.id) ? review : latest
  ), null);
}

function handoffView(ticket, events) {
  const prepared = events
    .filter((event) => event.kind === 'handoff_prepared')
    .reduce((latest, event) => (!latest || Number(event.id) > Number(latest.id) ? event : latest), null);
  if (!prepared) return null;

  const payload = prepared.payload || {};
  const recipientMemberId = Number(payload.recipientMemberId || 0);
  if (!recipientMemberId) return null;
  const assignmentChangedAfter = events.some((event) => (
    event.kind === 'assignee_changed' && Number(event.id) > Number(prepared.id)
  ));
  const statusChangedAfter = events.some((event) => (
    event.kind === 'ticket_status' && Number(event.id) > Number(prepared.id)
  ));
  const accepted = events.find((event) => (
    event.kind === 'handoff_accepted'
    && Number(event.payload?.preparedEventId) === Number(prepared.id)
    && Number(event.actor_member_id) === recipientMemberId
    && Number(event.payload?.recipientMemberId) === recipientMemberId
  ));
  if (!accepted && (
    assignmentChangedAfter || statusChangedAfter
    || Number(ticket.assignee_id) !== recipientMemberId
    || ticket.status === 'resolved'
  )) return null;
  const waitMs = accepted ? Date.parse(accepted.created_at) - Date.parse(prepared.created_at) : null;
  return {
    id: prepared.id,
    preparedAt: prepared.created_at,
    recipientMemberId,
    recipientName: payload.recipientName || ticket.assignee_name || '',
    text: payload.handoffText || '',
    pending: !accepted,
    acceptedAt: accepted?.created_at || null,
    waitMs: accepted && Number.isFinite(waitMs) && waitMs >= 0 ? waitMs : null,
  };
}

function ticketView(store, ticket) {
  const runs = store.runsByTicket(ticket.id).map((run) => ({
    ...run,
    // 交接摘要是只读派生视图：避免历史模型文案把建议写成已执行，也不改写运行原始记录。
    output: {
      ...run.output,
      handoff_summary: prepareHandoff(
        ticket,
        run.output,
        run.mode === 'organization' ? run.context_sources : [],
        latestReviewForRun(run),
      ),
    },
  }));
  const reviews = store.reviewsByTicket(ticket.id);
  const events = store.listEvents({ ticketId: ticket.id });
  const groups = new Map();
  for (const run of runs) {
    if (!groups.has(run.run_group)) groups.set(run.run_group, { runGroup: run.run_group, createdAt: run.created_at, runs: [] });
    groups.get(run.run_group).runs.push(run);
  }
  const cards = store.listCards().filter((c) => c.source_ticket_id === ticket.id);
  return {
    ticket,
    runs,
    reviews,
    groups: [...groups.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    cards,
    events,
    handoff: PRODUCT_MODE ? handoffView(ticket, events) : null,
    latest: {
      personal: store.latestReviewByMode(ticket.id, 'personal'),
      organization: store.latestReviewByMode(ticket.id, 'organization'),
    },
    // 试点草稿闸门原因（只读）：前端据此说明为何暂时不能生成草稿；sample 为 null。
    draftGate: pilotDraftGate(store, ticket)?.error || null,
    // 试点运行闸门原因（只读）：脱敏未完成时不允许调用模型。
    runGate: ticket.scope === 'pilot' && !['done', 'not_needed'].includes(ticket.desensitization)
      ? `真实试点工单脱敏状态为「${DESENSITIZATION_LABEL[ticket.desensitization] || ticket.desensitization || '未声明'}」，未完成脱敏，不能调用模型生成建议。`
      : null,
  };
}

export function createApi(store, auth) {
  const routes = [];
  const on = (method, pattern, handler, options = {}) => routes.push({ method, pattern, handler, ...options });

  on('GET', /^\/api\/health$/, async (_req, res) => json(res, 200, { ok: true, uptime: process.uptime() }), { public: true });
  on('GET', /^\/api\/ready$/, async (_req, res) => {
    let databaseReady = false;
    try {
      databaseReady = store.raw.prepare('SELECT 1 AS ready').get()?.ready === 1;
    } catch {
      databaseReady = false;
    }
    const configured = modelStatus().configured;
    const modelReady = PRODUCT_MODE ? configured : true;
    const ready = databaseReady && modelReady;
    json(res, ready ? 200 : 503, {
      ok: ready,
      ready,
      mode: PRODUCT_MODE ? 'product' : 'demo',
      uptime: process.uptime(),
      checks: {
        database: databaseReady ? 'ok' : 'unavailable',
        modelConfiguration: configured ? 'configured' : PRODUCT_MODE ? 'missing' : 'demo',
      },
      note: '模型配置状态不代表模型服务端点当前可达。',
    });
  }, { public: true });

  on('GET', /^\/api\/state$/, async (_req, res) => json(res, 200, {
    org: { name: PRODUCT_MODE ? ORG_NAME : '示例团队 · IT 支持组', note: PRODUCT_MODE ? '单客户团队工作区' : '单组织、单智能体、单条处理流程' },
    agent: { role: AGENT_ROLE, promptVersion: PROMPT_VERSION },
    cardRevisionWorkflow: 1,
    model: modelStatus(),
    members: store.members(),
    metrics: store.metrics(),
  }));

  on('GET', /^\/api\/members$/, async (_req, res) => json(res, 200, { members: auth.listMembers() }), { adminOnly: true });
  on('POST', /^\/api\/members\/invites$/, async (req, res) => {
    const body = await readBody(req);
    const result = auth.inviteMember({ email: str(body.email, 200), role: str(body.role, 20) || 'member', inviterId: req.authUser.id });
    if (result.error) return json(res, 400, { error: result.error });
    json(res, 201, result);
  }, { adminOnly: true });
  on('PATCH', /^\/api\/members\/(\d+)$/, async (req, res, m) => {
    const body = await readBody(req);
    const patch = {};
    if (body.role !== undefined) patch.role = str(body.role, 20);
    if (body.status !== undefined) patch.status = str(body.status, 20);
    const result = auth.updateMember(Number(m[1]), patch, req.authUser.name, req.authUser.id);
    if (result.error) return json(res, 400, { error: result.error });
    json(res, 200, result);
  }, { adminOnly: true });

  on('POST', /^\/api\/admin\/export$/, async (req, res) => {
    if (!PRODUCT_MODE) return json(res, 404, { error: '团队数据导出只在产品模式开放' });
    await readBody(req);
    store.addEvent({
      kind: 'workspace_exported',
      actor: req.authUser.name,
      actorMemberId: req.authUser.id,
      summary: '管理员导出团队工作区数据',
      payload: { formatVersion: 1 },
    });
    const bundle = { ...store.exportWorkspaceData(), organization: ORG_NAME };
    const date = new Date().toISOString().slice(0, 10);
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="team-workspace-${date}.json"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(JSON.stringify(bundle));
  }, { adminOnly: true });

  on('POST', /^\/api\/feedback$/, async (req, res) => {
    if (!PRODUCT_MODE) return json(res, 404, { error: '使用反馈只在产品模式开放' });
    const body = await readBody(req);
    const category = str(body.category, 20);
    const message = str(body.message, 2000);
    if (!['bug', 'idea', 'other'].includes(category)) {
      return json(res, 400, { error: '请选择问题、建议或其他反馈类型' });
    }
    if (message.length < 10) return json(res, 400, { error: '请至少写 10 个字，方便团队管理员理解问题' });
    const feedback = store.createFeedback({
      category,
      message,
      page: str(body.page, 180),
      reporterMemberId: req.authUser.id,
    });
    json(res, 201, { feedback });
  }, { allowViewer: true });

  on('GET', /^\/api\/feedback$/, async (req, res) => {
    if (!PRODUCT_MODE) return json(res, 404, { error: '使用反馈只在产品模式开放' });
    json(res, 200, { feedback: store.feedbackByReporter(req.authUser.id) });
  });

  on('GET', /^\/api\/admin\/feedback$/, async (_req, res) => {
    if (!PRODUCT_MODE) return json(res, 404, { error: '使用反馈只在产品模式开放' });
    json(res, 200, { feedback: store.listFeedback() });
  }, { adminOnly: true });

  on('PATCH', /^\/api\/admin\/feedback\/(\d+)$/, async (req, res, m) => {
    if (!PRODUCT_MODE) return json(res, 404, { error: '使用反馈只在产品模式开放' });
    const body = await readBody(req);
    const status = str(body.status, 20);
    if (!['open', 'reviewing', 'resolved'].includes(status)) {
      return json(res, 400, { error: '反馈状态无效' });
    }
    const feedback = store.setFeedbackStatus(Number(m[1]), status, req.authUser.id);
    if (!feedback) return json(res, 404, { error: '没有这条反馈' });
    json(res, 200, { feedback });
  }, { adminOnly: true });

  on('GET', /^\/api\/tickets$/, async (_req, res, _m, url) => {
    const status = url.searchParams.get('status');
    const all = store.listTickets();
    const tickets = status ? all.filter((t) => t.status === status) : all;
    json(res, 200, { tickets });
  });

  on('POST', /^\/api\/tickets$/, async (req, res) => {
    const body = await readBody(req);
    const title = str(body.title, 160);
    const description = str(body.description, 4000);
    if (!title) return json(res, 400, { error: '标题不能为空' });
    if (description.length < 8) return json(res, 400, { error: '描述太短，至少写清现象和影响' });
    const scope = PRODUCT_MODE ? 'pilot' : body.scope === 'pilot' ? 'pilot' : 'sample';
    const sourceRef = str(body.sourceRef, 300);
    const authorizedBy = str(body.authorizedBy, 80);
    const desensitization = str(body.desensitization, 20) || 'unknown';
    const desensAllowed = ['unknown', 'done', 'partial', 'not_needed'];
    // 真实试点工单必须声明数据来源、授权人和脱敏状态；未声明不得进入 pilot 隔离区。
    // sample 演示单不校验这些字段，避免影响既有演示流程。
    if (scope === 'pilot') {
      if (!sourceRef) return json(res, 400, { error: '真实试点工单必须填写数据来源（授权依据）' });
      if (!authorizedBy) return json(res, 400, { error: '真实试点工单必须填写授权人' });
      if (!desensAllowed.includes(desensitization) || desensitization === 'unknown') {
        return json(res, 400, { error: '真实试点工单必须声明脱敏状态（已脱敏 / 部分脱敏 / 无需脱敏）' });
      }
    }
    const assigneeId = body.assigneeId ? Number(body.assigneeId) : null;
    if (assigneeId !== null) {
      const assignee = Number.isInteger(assigneeId) ? store.memberById(assigneeId) : null;
      if (!assignee || (PRODUCT_MODE && (assignee.status !== 'active' || assignee.role === 'viewer'))) {
        return json(res, 400, { error: '负责人必须是有任务处理权限的启用成员' });
      }
    }
    const ticket = store.createTicket({
      title,
      description,
      category: str(body.category, 40),
      urgency: str(body.urgency, 20),
      assigneeId,
      status: PRODUCT_MODE ? 'open' : body.status || 'open',
      scope,
      sourceRef,
      authorizedBy,
      desensitization: scope === 'pilot' ? desensitization : 'unknown',
      actor: req.authUser?.name || 'user',
      actorMemberId: req.authUser?.id || null,
    });
    json(res, 201, { ticket });
  });

  on('GET', /^\/api\/tickets\/(\d+)$/, async (_req, res, m) => {
    const ticket = store.getTicket(Number(m[1]));
    if (!ticket) return json(res, 404, { error: '问题单不存在' });
    json(res, 200, ticketView(store, ticket));
  });

  on('PATCH', /^\/api\/tickets\/(\d+)$/, async (req, res, m) => {
    const id = Number(m[1]);
    const body = await readBody(req);
    const patch = {};
    if (body.status !== undefined) {
      if (!['open', 'in_progress', 'resolved', 'reopened', 'escalated'].includes(body.status)) {
        return json(res, 400, { error: '未知状态' });
      }
      if (PRODUCT_MODE && body.status === 'resolved' && !str(body.outcomeNote, 1000)) {
        return json(res, 400, { error: '结案时必须填写实际处理结果，不能只把状态改成“已解决”' });
      }
      patch.status = body.status;
    }
    if (body.assigneeId !== undefined) {
      patch.assigneeId = body.assigneeId ? Number(body.assigneeId) : null;
      if (patch.assigneeId !== null) {
        const assignee = Number.isInteger(patch.assigneeId) ? store.memberById(patch.assigneeId) : null;
        if (!assignee || (PRODUCT_MODE && (assignee.status !== 'active' || assignee.role === 'viewer'))) {
          return json(res, 400, { error: '负责人必须是有任务处理权限的启用成员' });
        }
      }
    }
    if (body.outcome !== undefined) patch.outcome = str(body.outcome, 40) || null;
    if (body.outcomeNote !== undefined) patch.outcomeNote = str(body.outcomeNote, 1000) || null;
    patch.actor = req.authUser?.name || str(body.actor, 60) || 'user';
    patch.actorMemberId = req.authUser?.id || null;
    const ticket = store.updateTicket(id, patch);
    if (!ticket) return json(res, 404, { error: '问题单不存在' });
    json(res, 200, { ticket, events: store.listEvents({ ticketId: id }) });
  });

  on('POST', /^\/api\/tickets\/(\d+)\/run$/, async (req, res, m) => {
    const ticket = store.getTicket(Number(m[1]));
    if (!ticket) return json(res, 404, { error: '问题单不存在' });
    // 数据闸门在服务端强制：试点工单只有已脱敏或无需脱敏才允许调用模型。
    // 前端禁用只是提示，不能作为唯一防线；sample 演示流程不受影响。
    if (ticket.scope === 'pilot' && !['done', 'not_needed'].includes(ticket.desensitization)) {
      const state = DESENSITIZATION_LABEL[ticket.desensitization] || ticket.desensitization || '未声明';
      return json(res, 409, { error: `真实试点工单脱敏状态为「${state}」，未完成脱敏，不能调用模型生成建议；请先确认脱敏状态，不要直接提交个人信息。` });
    }
    const pair = await runPair({ store, ticket, requestedByMemberId: req.authUser?.id || null });
    json(res, 200, ticketView(store, ticket));
  });

  on('POST', /^\/api\/runs\/(\d+)\/review$/, async (req, res, m) => {
    const runId = Number(m[1]);
    const body = await readBody(req);
    if (!['adopt', 'edit', 'reject'].includes(body.decision)) return json(res, 400, { error: 'decision 必须是 adopt / edit / reject' });
    const rating = num(body.rating);
    if (rating !== null && (rating < 1 || rating > 5)) return json(res, 400, { error: '评分需在 1–5 之间' });
    const run = store.getRun(runId);
    if (!run) return json(res, 404, { error: '运行记录不存在' });
    // 写入只能显式指定 human / assistant；seed / unknown 仅供历史迁移使用。
    // 助手代审必须显式传 sourceType='assistant' 且给出审核者，不能靠名字推断。
    const sourceType = PRODUCT_MODE ? 'human' : body.sourceType === undefined ? 'human' : str(body.sourceType, 20);
    if (!['human', 'assistant'].includes(sourceType)) {
      return json(res, 400, { error: 'sourceType 只能是 human 或 assistant' });
    }
    const reviewer = req.authUser?.name || str(body.reviewer, 60);
    // assistant 规则不变：仍须显式传审核者；human 不再有默认姓名，缺失一律 400。
    if (!reviewer) {
      return json(res, 400, {
        error: sourceType === 'assistant' ? '助手代审必须显式填写审核者' : REVIEWER_REQUIRED,
      });
    }
    const reviews = store.addReview({
      runId,
      decision: body.decision,
      editedText: str(body.editedText, 3000) || null,
      rating,
      reason: str(body.reason, 500),
      reviewer,
      reviewerMemberId: req.authUser?.id || null,
      sourceType,
    });
    json(res, 200, { reviews, ticket: store.getTicket(run.ticket_id) });
  });

  on('POST', /^\/api\/tickets\/(\d+)\/knowledge-draft$/, async (req, res, m) => {
    const ticket = store.getTicket(Number(m[1]));
    if (!ticket) return json(res, 404, { error: '问题单不存在' });
    if (ticket.status !== 'resolved') return json(res, 409, { error: '只有已解决的问题才能沉淀知识' });
    const result = draftKnowledgeCard({ store, ticket, requestedByMemberId: req.authUser?.id || null });
    // 试点草稿必须由组织成员人工认可触发；拦截时不创建、不修改任何知识卡。
    if (result.error) return json(res, 409, { error: result.error });
    json(res, result.created ? 201 : 200, { card: result.card, created: result.created });
  });

  on('POST', /^\/api\/tickets\/(\d+)\/handoff$/, async (req, res, m) => {
    const ticket = store.getTicket(Number(m[1]));
    if (!ticket) return json(res, 404, { error: '问题单不存在' });
    const events = store.listEvents({ ticketId: ticket.id });
    if (PRODUCT_MODE) {
      if (ticket.status === 'resolved') return json(res, 409, { error: '已解决工单不能再发起交接' });
      if (!ticket.assignee_id) return json(res, 409, { error: '请先把负责人改为接手的团队成员，再准备交接' });
      if (Number(ticket.assignee_id) === Number(req.authUser.id)) {
        return json(res, 409, { error: '负责人是你自己；请先改派给接手人，再准备交接' });
      }
      const recipient = store.memberById(ticket.assignee_id);
      if (!recipient || recipient.status !== 'active' || recipient.role === 'viewer') {
        return json(res, 409, { error: '接手人必须是有任务处理权限的启用成员' });
      }
      if (handoffView(ticket, events)?.pending) return json(res, 409, { error: '当前交接仍在等待接手人确认' });
    }
    const runs = store.runsByTicket(ticket.id);
    const orgRun = runs
      .filter((run) => run.mode === 'organization')
      .reduce((latest, run) => (!latest || Number(run.id) > Number(latest.id) ? run : latest), null);
    if (!orgRun) return json(res, 409, { error: '还没有组织模式的运行记录，先跑一次对比' });
    const sources = orgRun.context_sources || [];
    const text = prepareHandoff(ticket, orgRun.output, sources, latestReviewForRun(orgRun));
    const recipient = PRODUCT_MODE ? store.memberById(ticket.assignee_id) : null;
    store.addEvent({
      ticketId: ticket.id,
      kind: PRODUCT_MODE ? 'handoff_prepared' : 'tool_call',
      actor: PRODUCT_MODE ? (req.authUser?.name || 'team-member') : 'agent:support',
      actorMemberId: req.authUser?.id || null,
      summary: PRODUCT_MODE ? `为 ${recipient.name} 准备交接摘要` : '调用 prepare_handoff，生成交接摘要',
      payload: PRODUCT_MODE
        ? { runId: orgRun.id, recipientMemberId: recipient.id, recipientName: recipient.name, handoffText: text }
        : { runId: orgRun.id },
    });
    json(res, 200, { handoff: text, runId: orgRun.id, recipient: recipient?.name || null });
  });

  on('POST', /^\/api\/tickets\/(\d+)\/handoff\/accept$/, async (req, res, m) => {
    if (!PRODUCT_MODE) return json(res, 404, { error: '交接确认只在产品模式开放' });
    const ticket = store.getTicket(Number(m[1]));
    if (!ticket) return json(res, 404, { error: '问题单不存在' });
    const handoff = handoffView(ticket, store.listEvents({ ticketId: ticket.id }));
    if (!handoff?.pending) return json(res, 409, { error: '没有等待确认的交接，或工单负责人已变更' });
    if (Number(ticket.assignee_id) !== Number(req.authUser.id) || handoff.recipientMemberId !== Number(req.authUser.id)) {
      return json(res, 403, { error: '只有当前被指派的接手人可以确认交接' });
    }
    const waitMs = Date.now() - Date.parse(handoff.preparedAt);
    if (!Number.isFinite(waitMs) || waitMs < 0) return json(res, 409, { error: '交接时间记录无效，请重新准备交接' });
    store.addEvent({
      ticketId: ticket.id,
      kind: 'handoff_accepted',
      actor: req.authUser.name,
      actorMemberId: req.authUser.id,
      summary: `${req.authUser.name} 确认接收交接`,
      payload: { preparedEventId: handoff.id, recipientMemberId: req.authUser.id, waitMs },
    });
    json(res, 200, { ok: true, waitMs });
  });

  on('GET', /^\/api\/memory$/, async (_req, res, _m, url) => {
    const q = str(url.searchParams.get('q'), 200);
    const status = url.searchParams.get('status');
    const cards = store.listCards({ status: status || null, q });
    const cases = store.listTickets()
      .filter((t) => t.status === 'resolved')
      .map((t) => ({ id: t.id, title: t.title, category: t.category, outcome: t.outcome, note: t.outcome_note, resolvedAt: t.resolved_at }));
    const preview = q ? searchApprovedMemory(store, { id: 0, title: q, description: q, category: '' }, 6) : [];
    json(res, 200, { cards, cases: q ? cases.filter((c) => preview.some((p) => p.type === 'case' && p.id === c.id)) : cases, preview });
  });

  on('POST', /^\/api\/cards\/(\d+)\/revision-draft$/, async (req, res, m) => {
    const cardId = Number(m[1]);
    const body = await readBody(req);
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) return json(res, 400, { error: '知识卡片正文不能为空' });
    if (content.length > 12000) return json(res, 413, { error: '知识卡片正文不能超过 12000 个字符' });
    const note = str(body.note, 500);
    if (!note) return json(res, 400, { error: '请填写修订说明' });
    const sourceRef = typeof body.sourceRef === 'string' ? body.sourceRef.trim().slice(0, 3000) : undefined;
    const appliesTo = typeof body.appliesTo === 'string' ? body.appliesTo.trim().slice(0, 1000) : undefined;
    const result = store.createCardRevision({ cardId, content, sourceRef, appliesTo, note, actorMemberId: req.authUser?.id || null });
    if (!result) return json(res, 404, { error: '知识卡片不存在' });
    if (result.error) return json(res, 409, { error: result.error });
    json(res, 201, { card: result.card, created: result.created });
  });

  on('POST', /^\/api\/cards\/(\d+)\/draft-edit$/, async (req, res, m) => {
    const cardId = Number(m[1]);
    const body = await readBody(req);
    const editor = req.authUser?.name || str(body.editor, 60);
    if (!editor) return json(res, 400, { error: CARD_EDITOR_REQUIRED });
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) return json(res, 400, { error: '知识卡片正文不能为空' });
    if (content.length > 12000) return json(res, 413, { error: '知识卡片正文不能超过 12000 个字符' });
    const note = str(body.note, 500);
    if (!note) return json(res, 400, { error: '请填写修改说明' });
    const card = store.editPendingCard({ cardId, content, note, editor, editorMemberId: req.authUser?.id || null });
    if (!card) return json(res, 404, { error: '知识卡片不存在' });
    if (card.error) return json(res, 409, { error: card.error });
    json(res, 200, { card });
  });

  on('POST', /^\/api\/cards\/(\d+)\/review$/, async (req, res, m) => {
    const cardId = Number(m[1]);
    const body = await readBody(req);
    if (!['publish', 'reject', 'pending'].includes(body.action)) return json(res, 400, { error: 'action 必须是 publish / reject / pending' });
    const reviewer = req.authUser?.name || str(body.reviewer, 60);
    if (!reviewer) return json(res, 400, { error: REVIEWER_REQUIRED });
    const card = store.reviewCard({
      cardId,
      action: body.action,
      note: str(body.note, 500),
      reviewer,
      reviewerMemberId: req.authUser?.id || null,
    });
    if (!card) return json(res, 404, { error: '知识卡片不存在' });
    if (card.error) return json(res, 409, { error: card.error });
    json(res, 200, { card });
  });

  on('POST', /^\/api\/cards\/(\d+)\/retire$/, async (req, res, m) => {
    const cardId = Number(m[1]);
    const body = await readBody(req);
    const reviewer = req.authUser?.name || str(body.reviewer, 60);
    if (!reviewer) return json(res, 400, { error: REVIEWER_REQUIRED });
    const note = str(body.note, 400);
    if (!note) return json(res, 400, { error: '请填写停用原因' });
    const card = store.retireCard({
      cardId,
      note,
      reviewer,
      reviewerMemberId: req.authUser?.id || null,
    });
    if (!card) return json(res, 404, { error: '知识卡片不存在' });
    if (card.error) return json(res, 409, { error: card.error });
    json(res, 200, { card });
  });

  /* 人工明确批准某张已发布卡片进入真实试点检索：必须带可核实的来源元数据 */
  on('POST', /^\/api\/cards\/(\d+)\/pilot-approve$/, async (req, res, m) => {
    const cardId = Number(m[1]);
    const body = await readBody(req);
    const reviewer = req.authUser?.name || str(body.reviewer, 60);
    if (!reviewer) return json(res, 400, { error: REVIEWER_REQUIRED });
    const validUntil = str(body.validUntil, 40);
    if (!isValidKnowledgeDate(validUntil)) return json(res, 400, { error: '有效期必须是有效的 YYYY-MM-DD 日期' });
    const result = store.approveCardForPilot({
      cardId,
      sourceKind: str(body.sourceKind, 20),
      sourceRef: str(body.sourceRef, 300),
      appliesTo: str(body.appliesTo, 300),
      approvalBody: str(body.approvalBody, 200),
      knowledgeOwner: str(body.knowledgeOwner, 80),
      validUntil: validUntil || null,
      reviewer,
      reviewerMemberId: req.authUser?.id || null,
      note: str(body.note, 500),
    });
    if (!result) return json(res, 404, { error: '知识卡片不存在' });
    if (result.error) return json(res, 400, { error: result.error });
    json(res, 200, { card: result });
  });

  on('POST', /^\/api\/memory\/search$/, async (req, res) => {
    const body = await readBody(req);
    const q = str(body.query, 600);
    if (!q) return json(res, 400, { error: '查询不能为空' });
    json(res, 200, { results: searchApprovedMemory(store, { id: 0, title: q, description: q, category: '' }, 6) });
  });

  on('GET', /^\/api\/metrics$/, async (_req, res) => json(res, 200, store.metrics()));

  on('GET', /^\/api\/events$/, async (_req, res, _m, url) => {
    const limit = Math.min(Number(url.searchParams.get('limit') || 40), 200);
    json(res, 200, { events: store.listEvents({ limit }) });
  });

  /* 观察批次：按 run_group 白名单读取首轮 10 组模拟运行（只读，不含模型调用） */
  on('GET', /^\/api\/observation$/, async (_req, res) => json(res, 200, {
    batches: OBSERVATION_BATCHES.map((b) => ({
      id: b.id, label: b.label, source: b.source, groupCount: b.pairs.length,
    })),
  }));
  on('GET', /^\/api\/observation\/([a-z0-9-]+)$/, async (_req, res, m) => {
    const def = OBSERVATION_BATCHES.find((b) => b.id === m[1]);
    if (!def) return json(res, 404, { error: '观察批次不存在' });
    json(res, 200, buildBatchView(store, def));
  });

  /* 真实试点闭环：只读聚合，仅 scope=pilot；不含模型调用、不写任何数据 */
  on('GET', /^\/api\/pilot-loop$/, async (_req, res) => json(res, 200, buildPilotLoop(store)));
  on('GET', /^\/api\/team-learning$/, async (_req, res) => {
    if (!PRODUCT_MODE) return json(res, 404, { error: '团队复盘只在产品模式开放' });
    json(res, 200, buildTeamLearning(store));
  });

  on('POST', /^\/api\/admin\/reset$/, async (_req, res) => {
    if (PRODUCT_MODE) return json(res, 404, { error: '产品模式不开放演示数据重置接口' });
    for (const table of ['knowledge_uses', 'card_reviews', 'knowledge_cards', 'reviews', 'runs', 'run_groups', 'events', 'tickets', 'members']) {
      store.raw.exec(`DELETE FROM ${table}`);
    }
    await seedIfEmpty(store);
    json(res, 200, { ok: true, metrics: store.metrics() });
  }, { adminOnly: true });

  return async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (!url.pathname.startsWith('/api/')) return false;
    try {
      if (await auth.handlePublic(req, res, url)) return true;
      if (PRODUCT_MODE && (url.pathname.startsWith('/api/observation') || url.pathname === '/api/pilot-loop')) {
        json(res, 404, { error: '演示观察接口不在产品模式开放' });
        return true;
      }
      for (const route of routes) {
        if (route.method !== req.method) continue;
        const m = url.pathname.match(route.pattern);
        if (!m) continue;
        if (PRODUCT_MODE && !route.public) {
          const user = auth.currentUser(req);
          if (!user) {
            json(res, 401, { error: '请先登录团队工作区', code: 'AUTH_REQUIRED' });
            return true;
          }
          req.authUser = user;
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            if (!auth.csrfAllowed(req)) {
              json(res, 403, { error: '请求来源无法验证' });
              return true;
            }
            if (user.role === 'viewer' && !route.allowViewer) {
              json(res, 403, { error: '只读成员不能执行此操作' });
              return true;
            }
          }
          if (route.adminOnly && user.role !== 'admin') {
            json(res, 403, { error: '此操作需要团队管理员权限' });
            return true;
          }
        }
        await route.handler(req, res, m, url);
        return true;
      }
      json(res, 404, { error: `没有这个接口：${req.method} ${url.pathname}` });
      return true;
    } catch (err) {
      console.error('[api]', err);
      json(res, 500, { error: err.message || '服务器内部错误' });
      return true;
    }
  };
}
