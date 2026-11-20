import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTeamLearning } from '../../server/team-learning.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PREVIEW_PORT || 4192);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const STAGES = [
  '空工作区',
  '两位成员',
  '记录任务结果',
  '另一人审核发布',
  '跨成员复用并记录结果',
];

function ticket(id, title, memberId, createdAt, resolvedAt = createdAt) {
  return {
    id,
    title,
    description: '纯虚构界面预览，不对应任何真实组织或实际问题。',
    category: '预览示例',
    urgency: '',
    status: 'resolved',
    assignee_id: memberId,
    assignee_name: memberId === 1 ? '预览成员甲' : '预览成员乙',
    outcome: 'resolved',
    outcome_note: '纯虚构预览：记录一条示例处理结果。',
    resolved_at: resolvedAt,
    created_at: createdAt,
    updated_at: createdAt,
    scope: 'pilot',
  };
}

function previewData(stage) {
  const members = [
    { id: 1, name: '预览成员甲', role: 'admin', status: 'active' },
    ...(stage >= 1 ? [{ id: 2, name: '预览成员乙', role: 'member', status: 'active' }] : []),
  ];
  const tickets = stage >= 2
    ? [ticket(101, '虚构示例任务 A', 1, '2026-11-19T09:00:00.000Z', '2026-11-19T09:30:00.000Z')]
    : [];
  if (stage >= 4) tickets.push(ticket(102, '虚构示例任务 B', 2, '2026-11-19T10:00:00.000Z', '2026-11-19T10:40:00.000Z'));

  const runsByTicket = new Map();
  if (stage >= 2) {
    runsByTicket.set(101, [{
      id: 1,
      ticket_id: 101,
      mode: 'organization',
      created_by_member_id: 1,
      created_at: '2026-11-19T09:10:00.000Z',
      context_sources: [],
      output: { citations: [] },
      reviews: [],
    }]);
  }

  const cards = [];
  if (stage >= 3) {
    cards.push({
      id: 1,
      title: '虚构共享经验 K1',
      content: '纯虚构示例内容。',
      source_ticket_id: 101,
      status: 'published',
      scope: 'pilot',
      valid_until: null,
      superseded_by_card_id: null,
      reviews: [{
        id: 1,
        action: 'publish',
        reviewer_member_id: 2,
        created_at: '2026-11-19T09:40:00.000Z',
      }],
    });
  }
  if (stage >= 4) {
    runsByTicket.set(102, [{
      id: 2,
      ticket_id: 102,
      mode: 'organization',
      created_by_member_id: 2,
      created_at: '2026-11-19T10:10:00.000Z',
      context_sources: [{
        id: 1,
        type: 'card',
        ref: 'K1',
        title: '虚构共享经验 K1',
        meta: { sourceTicketId: 101, scope: 'pilot' },
      }],
      output: { citations: [{ ref: 'K1' }] },
      reviews: [],
    }]);
  }

  const store = {
    raw: { prepare: () => ({ all: () => [] }) },
    listTickets: () => tickets,
    runsByTicket: (id) => runsByTicket.get(id) || [],
    listCards: () => cards,
    members: () => members,
  };

  const modelRuns = [...runsByTicket.values()].flat().length;
  const state = {
    org: { name: '虚构团队 · 首次使用预览', note: '只用于看界面' },
    agent: { role: '界面预览', promptVersion: 'support-agent-v4.0-matched' },
    model: {
      mode: 'live',
      modeLabel: '预览：产品模型已配置',
      model: 'preview-model（虚构）',
      baseUrl: 'https://model-preview.invalid/v1',
      configured: true,
      sampleShadowCheckEnabled: false,
      previewOnly: true,
      note: '此页面仅展示虚构配置下的界面，不会调用模型或发送工单内容。',
    },
    members,
    metrics: {
      tickets: {
        open: 0,
        reopened: 0,
        in_progress: 0,
        escalated: 0,
        resolved: tickets.length,
      },
      knowledge: {
        published: cards.length,
        totalUses: stage >= 4 ? 1 : 0,
        distinctCardsUsed: stage >= 4 ? 1 : 0,
      },
      humanModes: [{ mode: 'organization', runs: modelRuns, reviews: 0, adopted: 0, adoptRate: null, avgRating: null }],
      citations: { organization: stage >= 4 ? 1 : 0 },
      reviewsBySource: { human: stage >= 3 ? 1 : 0, assistant: 0, seed: 0, unknown: 0 },
    },
  };

  return { state, tickets, learning: buildTeamLearning(store) };
}

function modelGatePreview(consentRecorded, oldTarget = false) {
  const at = '2026-11-19T10:00:00.000Z';
  const ticket = {
    id: 901,
    title: '虚构示例：能否把已脱敏问题发给模型？',
    description: '纯虚构预览。用于展示模型发送确认记录缺失时的拦截效果，不对应真实组织或真实工单。',
    category: '预览示例',
    urgency: '低',
    status: 'open',
    assignee_id: 1,
    assignee_name: '预览管理员甲',
    outcome: null,
    outcome_note: null,
    resolved_at: null,
    scope: 'pilot',
    source_ref: '虚构准备卡 PREVIEW-901',
    desensitization: 'done',
    authorized_by: '虚构负责人甲',
    model_authorized_by: consentRecorded ? '虚构负责人甲' : '',
    model_authorized_base_url: consentRecorded
      ? oldTarget ? 'https://old-model-preview.invalid/v1' : 'https://model-preview.invalid/v1'
      : '',
    model_authorized_model: consentRecorded
      ? oldTarget ? 'preview-model-old（虚构）' : 'preview-model（虚构）'
      : '',
    created_at: at,
    updated_at: at,
  };
  const events = [{
    id: 901,
    ticket_id: 901,
    kind: 'ticket_created',
    actor: '预览管理员甲',
    summary: '新建虚构预览工单；工作区存储已确认，内容已脱敏。',
    payload: {},
    created_at: at,
  }];
  if (consentRecorded) events.unshift({
    id: 902,
    ticket_id: 901,
    kind: 'ticket_model_authorization_changed',
    actor: '预览管理员甲',
    summary: oldTarget ? '登记模型发送确认人（虚构旧目标）' : '登记模型发送确认人',
    payload: {
      fromRecorded: false,
      toRecorded: true,
      targetChanged: true,
      previousTarget: null,
      target: {
        baseUrl: oldTarget ? 'https://old-model-preview.invalid/v1' : 'https://model-preview.invalid/v1',
        model: oldTarget ? 'preview-model-old（虚构）' : 'preview-model（虚构）',
      },
    },
    created_at: '2026-11-19T10:05:00.000Z',
  });
  return {
    ticket,
    groups: [],
    cards: [],
    events,
    handoff: null,
    runGate: !consentRecorded
      ? '缺少“允许将必要内容发送给模型”的单独确认记录，暂不能调用模型。请由管理员在确认负责人已同意后登记；系统不会核实这项确认是否真实发生。'
      : oldTarget ? '当前模型服务或模型名称与确认记录不一致，之前的确认不能沿用。请先由负责人确认新目标，再由管理员更新记录。'
        : null,
    draftGate: null,
    modelTarget: { baseUrl: 'https://model-preview.invalid/v1', model: 'preview-model（虚构）' },
  };
}

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow',
  });
  res.end(JSON.stringify(body));
}

function stageFor(req) {
  const value = Number(req.headers['x-preview-stage'] || 0);
  return Number.isInteger(value) ? Math.min(4, Math.max(0, value)) : 0;
}

function loginView(req) {
  return req.headers['x-preview-view'] === 'login';
}

function modelGateView(req) {
  return req.headers['x-preview-view'] === 'model-gate';
}

function previewBanner(stage, view) {
  const links = STAGES.map((label, index) => (
    `<a href="/?stage=${index}#/"${stage === index ? ' aria-current="page"' : ''}>${index}/4 ${label}</a>`
  )).join('');
  const loginLink = `<a href="/?view=login#/"${view === 'login' ? ' aria-current="page"' : ''}>登录页</a>`;
  const gateBlockedLink = `<a href="/?view=model-gate#/t/901"${view === 'model-gate' ? ' aria-current="page"' : ''}>发送未确认</a>`;
  const gateAllowedLink = '<a href="/?view=model-gate&consent=recorded#/t/901">已确认（虚构）</a>';
  const gateChangedLink = '<a href="/?view=model-gate&consent=old-target#/t/901">模型已更换（旧确认失效）</a>';
  return `<style>
    .preview-banner{position:sticky;top:0;z-index:9999;background:#fff8df;border-bottom:1px solid #e5c96f;padding:10px 16px;color:#423718;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}
    .preview-banner strong{margin-right:10px}.preview-links{display:inline-flex;gap:8px;flex-wrap:wrap;margin-left:12px}
    .preview-links a{color:#2148b5;text-decoration:underline}.preview-links a[aria-current=page]{font-weight:700;color:#423718}
    @media(max-width:800px){.preview-links{display:flex;margin:7px 0 0}}
  </style>
  <div class="preview-banner"><strong>虚构界面预览</strong>仅展示页面与进度样例；无真实登录、数据库、模型调用或写入。登录按钮不会连接身份提供方。<nav class="preview-links" aria-label="切换预览页面">${loginLink}${gateBlockedLink}${gateAllowedLink}${gateChangedLink}${links}</nav></div>
  <script>
    (()=>{const original=window.fetch.bind(window);window.fetch=(input,init={})=>{const params=new URLSearchParams(location.search);const headers=new Headers(init.headers||{});headers.set('x-preview-stage',params.get('stage')||'0');headers.set('x-preview-view',params.get('view')||'workspace');headers.set('x-preview-consent',params.get('consent')||'');return original(input,{...init,headers})}})();
  </script>`;
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET') return json(res, 405, { error: '这是只读界面预览，不接受写入' });
    const stage = stageFor(req);
    const data = previewData(stage);
    const showLogin = loginView(req);
    const showModelGate = modelGateView(req);
    const consentValue = req.headers['x-preview-consent'];
    const consentRecorded = consentValue === 'recorded' || consentValue === 'old-target';
    const gateData = showModelGate ? modelGatePreview(consentRecorded, consentValue === 'old-target') : null;
    if (url.pathname === '/api/auth/status') {
      return json(res, 200, { mode: 'product', enabled: true, organization: data.state.org.name });
    }
    if (url.pathname === '/api/auth/me') {
      if (showLogin) return json(res, 200, { authenticated: false, user: null });
      return json(res, 200, {
        authenticated: true,
        user: { id: 1, name: '预览成员甲', email: 'member-a@example.invalid', role: 'admin' },
      });
    }
    if (url.pathname === '/api/state') return json(res, 200, data.state);
    if (url.pathname === '/api/tickets') return json(res, 200, { tickets: showModelGate ? [gateData.ticket] : data.tickets });
    const ticketMatch = url.pathname.match(/^\/api\/tickets\/(\d+)$/);
    if (ticketMatch && showModelGate && Number(ticketMatch[1]) === 901) return json(res, 200, gateData);
    if (url.pathname === '/api/events') return json(res, 200, { events: gateData?.events || [] });
    if (url.pathname === '/api/team-learning') return json(res, 200, data.learning);
    if (url.pathname === '/api/memory') return json(res, 200, { cards: [] });
    if (url.pathname === '/api/members') return json(res, 200, { members: data.state.members });
    if (url.pathname === '/api/feedback') return json(res, 200, { feedback: [] });
    if (url.pathname === '/api/admin/feedback') return json(res, 200, { feedback: [] });
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
      const stage = Math.min(4, Math.max(0, Number(url.searchParams.get('stage') || 0)));
      const requestedView = url.searchParams.get('view');
      const view = requestedView === 'login' || requestedView === 'model-gate' ? requestedView : 'workspace';
      body = Buffer.from(body.toString('utf8').replace('</head>', `${previewBanner(stage, view)}</head>`));
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

server.listen(PORT, '127.0.0.1', () => {
  console.log(`虚构界面预览： http://127.0.0.1:${PORT}/?stage=0#/`);
  console.log('只读、loopback、无数据库/模型/OIDC；Ctrl+C 可停止。');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
