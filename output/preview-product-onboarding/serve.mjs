import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const HOST = '127.0.0.1';
const PORT = Number(process.env.IO_PREVIEW_PORT || 4190);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const fixture = {
  '/api/auth/status': { mode: 'product', enabled: true, organization: '青穗工作组（虚构预览）' },
  '/api/auth/me': {
    authenticated: true,
    user: { id: 1, name: '周岚（示例管理员）', email: 'admin@example.test', role: 'admin' },
  },
  '/api/state': {
    org: { name: '青穗工作组（虚构预览）', note: '隔离界面预览' },
    model: { mode: 'demo', modeLabel: '隔离预览', model: '未调用', configured: false },
    members: [],
    metrics: {
      tickets: { open: 0, in_progress: 0, resolved: 0, reopened: 0, escalated: 0, total: 0 },
      modes: [],
      citations: {},
      scope: { tickets: {}, runs: {}, cards: {}, pilotApprovedCards: 0 },
      reviewsBySource: { assistant: 0, human: 0, seed: 0, unknown: 0 },
      humanModes: [],
      knowledge: { totalUses: 0, distinctCardsUsed: 0, published: 0 },
    },
  },
  '/api/tickets': { tickets: [] },
  '/api/events': { events: [] },
  '/api/memory': { cards: [], cases: [] },
};

// A fictional published card lets the product owner preview its retire flow.
// Changes exist only in this process's memory and disappear on restart.
const memoryCards = [
  {
    id: 9001,
    title: 'VPN 权限申请步骤（虚构演示）',
    content: '虚构演示内容：先确认申请人、所需系统和使用期限，再由团队负责人核对权限范围。此卡只用于查看知识停用界面，不代表任何组织制度。',
    tags: 'VPN 权限 演示',
    source_ticket_id: 9001,
    source_title: '虚构问题单：VPN 访问申请',
    status: 'published',
    version: 1,
    scope: 'sample',
    source_kind: 'guide',
    source_ref: 'https://example.invalid/demo-vpn-guide',
    applies_to: '虚构演示',
    approval_body: '虚构演示负责人',
    valid_until: '2099-12-31',
    pilot_approved: 0,
    knowledge_owner: '虚构知识负责人',
    superseded_by_card_id: null,
    uses: [{}, {}],
    reviews: [{ id: 1, action: 'publish', reviewer: '周岚（示例管理员）', note: '虚构审批记录', created_at: '2026-11-19T08:00:00.000Z' }],
    created_at: '2026-11-19T08:00:00.000Z',
    updated_at: '2026-11-19T08:00:00.000Z',
  },
  {
    id: 9002,
    title: 'VPN 旧版访问排查流程（过期虚构演示）',
    content: '虚构过期知识：旧客户端的连接检查步骤。此卡用于演示有效期到期后退出试点检索、等待负责人复核。',
    tags: 'VPN 旧版 演示',
    source_ticket_id: 9002,
    source_title: '虚构问题单：旧版 VPN 访问',
    status: 'published',
    version: 1,
    scope: 'pilot',
    source_kind: 'guide',
    source_ref: 'https://example.invalid/old-vpn-guide',
    applies_to: '虚构演示',
    approval_body: '虚构演示负责人',
    valid_until: '2026-11-18',
    pilot_approved: 1,
    knowledge_owner: '虚构知识负责人',
    superseded_by_card_id: null,
    uses: [{}],
    reviews: [{ id: 3, action: 'pilot_approve', reviewer: '周岚（示例管理员）', note: '虚构试点批准记录', created_at: '2026-11-17T08:00:00.000Z' }],
    created_at: '2026-11-17T08:00:00.000Z',
    updated_at: '2026-11-17T08:00:00.000Z',
  },
];
const previewEvents = [];

function json(res, status, data) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (url.pathname.startsWith('/api/')) {
    const retireMatch = url.pathname.match(/^\/api\/cards\/(\d+)\/retire$/);
    if (req.method === 'POST' && retireMatch) {
      let text = '';
      for await (const chunk of req) text += chunk;
      let body;
      try { body = JSON.parse(text || '{}'); } catch { return json(res, 400, { error: '请求体不是合法 JSON' }); }
      const cardId = Number(retireMatch[1]);
      const card = memoryCards.find((item) => item.id === cardId);
      if (!card) return json(res, 404, { error: '虚构预览中没有这张知识卡' });
      if (card.status !== 'published') return json(res, 409, { error: '只有已发布卡片可以停用' });
      const note = String(body.note || '').trim();
      if (!note) return json(res, 400, { error: '请填写停用原因' });
      const reviewer = '周岚（示例管理员）';
      card.status = 'retired';
      card.updated_at = new Date().toISOString();
      card.reviews.unshift({ id: 2, action: 'retire', reviewer, note, created_at: card.updated_at });
      previewEvents.unshift({
        id: 1,
        kind: 'card_retired',
        actor: reviewer,
        summary: `停用虚构知识卡 K${cardId}：${note}`,
        created_at: card.updated_at,
        payload: { cardId, reason: note },
      });
      return json(res, 200, { card });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      json(res, 403, { error: '这个预览只模拟知识卡停用；其它写操作均关闭，且所有变更只留在内存中。' });
      return;
    }
    if (url.pathname === '/api/events') return json(res, 200, { events: previewEvents });
    if (url.pathname === '/api/memory') {
      const status = url.searchParams.get('status') || '';
      const query = (url.searchParams.get('q') || '').trim().toLowerCase();
      const cards = memoryCards.filter((card) => (!status || card.status === status)
        && (!query || `${card.title} ${card.content} ${card.tags}`.toLowerCase().includes(query)));
      return json(res, 200, { cards, cases: [] });
    }
    if (!fixture[url.pathname]) return json(res, 404, { error: '此只读预览未模拟该接口。' });
    return json(res, 200, fixture[url.pathname]);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end('Method not allowed');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end('Bad path');
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  const target = path.resolve(PUBLIC_DIR, `.${pathname}`);
  const relative = path.relative(PUBLIC_DIR, target);
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(target, (error, buffer) => {
    if (error) {
      res.writeHead(404).end('Not found');
      return;
    }
    let body = buffer;
    if (pathname === '/index.html') {
      const html = buffer.toString('utf8').replace('<body>', `<body>
<div style="padding:8px 16px;background:#fff5d6;color:#513f00;text-align:center;font:13px/1.4 system-ui,sans-serif">交互界面预览 · 身份与知识卡均为虚构 · 仅模拟停用并保存在当前预览内存中，重启即还原 · 未连接数据库或模型</div>`);
      body = Buffer.from(html);
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(target)] || 'application/octet-stream',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'",
    });
    if (req.method === 'HEAD') res.end();
    else res.end(body);
  });
}).listen(PORT, HOST, () => {
  console.log(`交互产品界面预览：http://${HOST}:${PORT}`);
  console.log('仅使用内存中的虚构响应；停用状态仅在当前进程有效，不连接数据库、模型服务或原有应用服务。');
});
