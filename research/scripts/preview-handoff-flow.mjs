import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareHandoff } from '../../server/demo-brain.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const HOST = '127.0.0.1';
const PORT = 4195;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
const memorySources = [{
  ref: 'K1',
  id: 1,
  title: 'VPN 网络切换排查卡（来自虚构工单 #901）',
  type: 'card',
  status: 'published',
  version: 1,
  snippet: '先核对 VPN 客户端版本并重连；仍复现时，记录故障时间和网络环境后切换网络复测。',
  score: 0.92,
  meta: { source_kind: 'guide', scope: 'sample', source_ticket_id: 901 },
}];

const ticket = {
  id: 902,
  title: '虚构示例：VPN 断线后再次发生',
  description: '纯虚构预览。接手前需要知道已检查哪些项目、发现了什么，以及还有哪些步骤没有执行。',
  category: '网络与 VPN',
  urgency: '普通',
  status: 'in_progress',
  assignee_id: 2,
  assignee_name: '预览成员乙',
  outcome: null,
  outcome_note: '已核对客户端版本并重连；故障仍复现。其他同事目前正常，尚未确认是否与该设备网络有关。',
  resolved_at: null,
  created_at: minutesAgo(45),
  updated_at: minutesAgo(10),
  scope: 'sample',
};

const sourceTicket = {
  id: 901,
  title: '虚构示例：VPN 换网络后恢复',
  description: '纯虚构的上一件问题单。成员记录了实际采用的处理办法，团队据此整理并发布模拟知识卡 K1。',
  category: '网络与 VPN',
  urgency: '普通',
  status: 'resolved',
  assignee_id: 1,
  assignee_name: '预览成员甲',
  outcome: 'VPN 已恢复',
  outcome_note: '切换到手机热点后 VPN 恢复；团队记录为该虚构样例的处理结果。',
  resolved_at: minutesAgo(90),
  created_at: minutesAgo(120),
  updated_at: minutesAgo(90),
  scope: 'sample',
};

const generatedAt = minutesAgo(5);
const output = {
  summary: '参考模拟知识卡 K1 检查客户端版本并重连后，VPN 断线仍在复现；原因未确认。',
  category: '网络与 VPN',
  priority: 'P2',
  escalation_needed: false,
  draft_reply: '参考模拟知识卡 K1，先核对客户端版本并重连；如仍复现，请补充故障时间和当前网络，再用同一设备切换网络复测；若仍有问题，再交网络支持进一步检查。',
  general_checks: ['先确认故障出现时间、当前网络，以及同一设备切换网络后的表现。'],
  next_actions: [
    '补记故障出现时间和所用网络',
    '用同一设备切换网络复测',
    '若仍复现，再交给网络支持成员检查',
  ],
  citations: [{
    ref: 'K1',
    title: memorySources[0].title,
    type: 'card',
    quote: '先核对 VPN 客户端版本并重连；仍复现时，记录故障时间和网络环境后切换网络复测。',
  }],
  uncertainties: ['尚未确认问题是否只发生在该设备上'],
};
const review = {
  id: 1,
  decision: 'edit',
  edited_text: '已确认客户端版本并重连，故障仍会复现。请先补充故障出现时间和当前网络，再用同一设备切换网络复测；若仍复现，交网络支持进一步检查。',
  rating: 4,
  reason: '先确认故障是否与设备或网络有关',
  reviewer: '预览成员甲',
  review_source_type: 'human',
  created_at: minutesAgo(25),
};
const handoffText = prepareHandoff(ticket, output, memorySources, review);
const run = {
  id: 1,
  run_group: 'preview-handoff',
  ticket_id: ticket.id,
  mode: 'organization',
  model: '虚构规则预览（未连接模型）',
  prompt_version: 'preview-v1',
  context_sources: memorySources,
  tool_calls: [{ name: 'search_approved_memory', result_count: 1, refs: ['K1'], exclude_ticket_id: ticket.id }],
  output: { ...output, handoff_summary: handoffText },
  latency_ms: 0,
  origin: 'demo',
  scope: 'sample',
  created_by_member_id: 1,
  created_at: minutesAgo(28),
  reviews: [review],
};
const memoryCard = {
  id: 1,
  title: memorySources[0].title,
  content: '当 VPN 断线时，先核对客户端版本并重连；若仍复现，记录故障时间和网络环境，再用同一设备切换网络复测。',
  scope: 'sample',
  source_kind: 'guide',
  status: 'published',
  source_ref: '虚构工单 #901 的模拟处理记录',
  applies_to: '虚构 VPN 断线排查',
  approval_body: '虚构团队 · 模拟审核',
  knowledge_owner: '预览成员甲',
  tags: 'VPN,网络',
  source_title: sourceTicket.title,
  source_ticket_id: sourceTicket.id,
  uses: [{ id: 1, run_id: run.id, ticket_id: ticket.id, snippet: memorySources[0].snippet, created_at: run.created_at }],
  version: 1,
  updated_at: minutesAgo(70),
  created_at: minutesAgo(70),
  reviews: [{ action: 'publish', reviewer: '预览成员甲', note: '虚构样本，仅演示审核发布。' }],
  valid_until: null,
  pilot_approved: false,
  superseded_by_card_id: null,
  supersedes_card_id: null,
};

const members = [
  { id: 1, name: '预览成员甲', role: 'admin', status: 'active' },
  { id: 2, name: '预览成员乙', role: 'member', status: 'active' },
];
const sourceEvents = [
  {
    id: 1,
    ticket_id: sourceTicket.id,
    kind: 'ticket_created',
    actor: '预览成员甲',
    actor_member_id: 1,
    summary: '创建虚构示例工单',
    payload: {},
    created_at: sourceTicket.created_at,
  },
  {
    id: 2,
    ticket_id: sourceTicket.id,
    kind: 'outcome_recorded',
    actor: '预览成员甲',
    actor_member_id: 1,
    summary: `记录模拟处理结果：${sourceTicket.outcome_note}`,
    payload: { outcome: sourceTicket.outcome, note: sourceTicket.outcome_note, status: sourceTicket.status },
    created_at: sourceTicket.resolved_at,
  },
  {
    id: 3,
    ticket_id: sourceTicket.id,
    kind: 'card_drafted',
    actor: '预览成员甲',
    actor_member_id: 1,
    summary: '从模拟处理结果整理知识卡 K1',
    payload: { cardId: memoryCard.id },
    created_at: minutesAgo(80),
  },
  {
    id: 4,
    ticket_id: sourceTicket.id,
    kind: 'card_published',
    actor: '预览成员甲',
    actor_member_id: 1,
    summary: '发布模拟样本知识卡 K1',
    payload: { cardId: memoryCard.id },
    created_at: memoryCard.created_at,
  },
];
const events = [
  {
    id: 5,
    ticket_id: ticket.id,
    kind: 'ticket_created',
    actor: '预览成员甲',
    actor_member_id: 1,
    summary: '创建虚构示例工单',
    payload: {},
    created_at: minutesAgo(45),
  },
  {
    id: 6,
    ticket_id: ticket.id,
    kind: 'outcome_recorded',
    actor: '预览成员甲',
    actor_member_id: 1,
    summary: `更新处理记录（处理中）：${ticket.outcome_note}`,
    payload: { outcome: null, note: ticket.outcome_note, status: 'in_progress' },
    created_at: minutesAgo(30),
  },
  {
    id: 7,
    ticket_id: ticket.id,
    kind: 'agent_run',
    actor: '组织智能体（虚构演示）',
    actor_member_id: null,
    summary: '生成一条组织模式建议（演示数据，未调用模型）',
    payload: { runId: run.id, runGroup: run.run_group, mode: run.mode, origin: run.origin },
    created_at: run.created_at,
  },
  {
    id: 8,
    ticket_id: ticket.id,
    kind: 'memory_cited',
    actor: '组织智能体（虚构演示）',
    actor_member_id: 1,
    summary: `引用知识 K1「${memorySources[0].title}」`,
    payload: { cardId: 1, runId: run.id, score: memorySources[0].score },
    created_at: run.created_at,
  },
  {
    id: 9,
    ticket_id: ticket.id,
    kind: 'review_submitted',
    actor: '预览成员甲',
    actor_member_id: 1,
    summary: '编辑后采纳 AI 建议（虚构预览）',
    payload: { runId: run.id, decision: review.decision, editedText: review.edited_text },
    created_at: review.created_at,
  },
  {
    id: 10,
    ticket_id: ticket.id,
    kind: 'assignee_changed',
    actor: '预览成员甲',
    actor_member_id: 1,
    summary: '负责人改为 预览成员乙',
    payload: { assigneeId: 2 },
    created_at: minutesAgo(15),
  },
  {
    id: 11,
    ticket_id: ticket.id,
    kind: 'handoff_prepared',
    actor: '预览成员甲',
    actor_member_id: 1,
    summary: '为 预览成员乙 准备交接摘要',
    payload: { recipientMemberId: 2, recipientName: '预览成员乙', handoffText },
    created_at: generatedAt,
  },
];

const state = {
  org: { name: '虚构团队 · 交接预览', note: '只用于查看界面' },
  agent: { role: '界面预览', promptVersion: 'support-agent-v4.0-matched' },
  model: {
    mode: 'live',
    modeLabel: '只读界面预览',
    model: 'preview-model（虚构）',
    baseUrl: 'https://model-preview.invalid/v1',
    configured: true,
    previewOnly: true,
    note: '没有模型连接；所有内容都是虚构示例。',
  },
  members,
  metrics: {
    tickets: { open: 0, reopened: 0, in_progress: 1, escalated: 0, resolved: 1 },
    knowledge: { published: 1, pending: 0, totalUses: 1, distinctCardsUsed: 1 },
    humanModes: [],
    citations: { organization: 1 },
    reviewsBySource: { human: 0, assistant: 0, seed: 0, unknown: 0 },
  },
};

const detail = {
  ticket,
  runs: [run],
  groups: [{ runGroup: run.run_group, createdAt: run.created_at, runs: [run] }],
  cards: [],
  events,
  handoff: {
    id: 11,
    preparedAt: generatedAt,
    recipientMemberId: 2,
    recipientName: '预览成员乙',
    text: handoffText,
    pending: true,
    acceptedAt: null,
    waitMs: null,
  },
  latest: { personal: null, organization: null },
  draftGate: null,
  runGate: null,
  modelTarget: { baseUrl: state.model.baseUrl, model: state.model.model },
};
const sourceDetail = {
  ticket: sourceTicket,
  runs: [],
  groups: [],
  cards: [memoryCard],
  events: sourceEvents,
  handoff: null,
  latest: { personal: null, organization: null },
  draftGate: null,
  runGate: null,
  modelTarget: { baseUrl: state.model.baseUrl, model: state.model.model },
};
const allEvents = [...sourceEvents, ...events];

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow',
  });
  res.end(JSON.stringify(body));
}

function previewBanner() {
  return `<style>
    .preview-banner{position:sticky;top:0;z-index:9999;background:#fff8df;border-bottom:1px solid #e5c96f;padding:10px 16px;color:#423718;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}
    .preview-banner strong{margin-right:8px}
    html[data-preview-readonly="true"] button:disabled,html[data-preview-readonly="true"] select:disabled,html[data-preview-readonly="true"] input:disabled,html[data-preview-readonly="true"] textarea:disabled{opacity:.5;cursor:not-allowed}
  </style>
  <script>
    document.documentElement.dataset.previewReadonly = 'true';
    const freezePreviewActions = () => {
      document.querySelectorAll('button:not(#view-handoff):not([data-close]),select,input,textarea').forEach((control) => {
        control.disabled = true;
        control.title = '虚构只读预览：此操作不可提交';
      });
      const viewHandoff = document.getElementById('view-handoff');
      if (viewHandoff && !window.__handoffPreviewOpened) {
        window.__handoffPreviewOpened = true;
        viewHandoff.click();
      }
    };
    new MutationObserver(freezePreviewActions).observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', freezePreviewActions);
  </script>
  <div class="preview-banner"><strong>虚构只读预览</strong>打开后会展开交接摘要；不连接数据库、模型或身份提供方，所有写入请求都会被拒绝。</div>`;
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${HOST}:${PORT}`);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET') return json(res, 405, { error: '这是只读界面预览，不接受写入' });
    if (url.pathname === '/api/auth/status') {
      return json(res, 200, { mode: 'product', enabled: true, organization: state.org.name });
    }
    if (url.pathname === '/api/auth/me') {
      return json(res, 200, {
        authenticated: true,
        user: { id: 2, name: '预览成员乙', email: 'member-b@example.invalid', role: 'member' },
      });
    }
    if (url.pathname === '/api/state') return json(res, 200, state);
    if (url.pathname === '/api/tickets') return json(res, 200, { tickets: [ticket, sourceTicket] });
    if (url.pathname === `/api/tickets/${ticket.id}`) return json(res, 200, detail);
    if (url.pathname === `/api/tickets/${sourceTicket.id}`) return json(res, 200, sourceDetail);
    if (url.pathname === '/api/memory') {
      const status = url.searchParams.get('status') || '';
      const query = (url.searchParams.get('q') || '').trim().toLocaleLowerCase();
      const cards = (!status || status === memoryCard.status) && (!query || `${memoryCard.title} ${memoryCard.content} ${memoryCard.tags}`.toLocaleLowerCase().includes(query))
        ? [memoryCard]
        : [];
      const cases = !status && (!query || `${sourceTicket.title} ${sourceTicket.category} ${sourceTicket.outcome_note}`.toLocaleLowerCase().includes(query))
        ? [{
            id: sourceTicket.id,
            title: sourceTicket.title,
            category: sourceTicket.category,
            outcome: sourceTicket.outcome,
            note: sourceTicket.outcome_note,
            resolvedAt: sourceTicket.resolved_at,
          }]
        : [];
      return json(res, 200, { cards, cases, preview: [] });
    }
    if (url.pathname === '/api/members') return json(res, 200, { members });
    if (url.pathname === '/api/events') return json(res, 200, { events: allEvents });
    return json(res, 404, { error: '预览没有这个接口' });
  }

  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405).end('Method not allowed');
    return;
  }
  let decoded;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end('Bad path');
    return;
  }
  const rel = decoded === '/' ? 'index.html' : decoded.replace(/^[/\\]+/, '');
  const filePath = path.resolve(PUBLIC_DIR, rel);
  const relative = path.relative(PUBLIC_DIR, filePath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    let body = await fs.promises.readFile(filePath);
    if (path.basename(filePath) === 'index.html') {
      body = Buffer.from(body.toString('utf8').replace('</head>', `${previewBanner()}</head>`));
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex, nofollow',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`虚构交接预览：http://${HOST}:${PORT}/#/t/${ticket.id}`);
  console.log('只读、loopback、无数据库/模型/OIDC；Ctrl+C 可停止。');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
