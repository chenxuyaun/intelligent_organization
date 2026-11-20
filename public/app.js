const view = document.getElementById('view');
const toastEl = document.getElementById('toast');
// 提示词版本单一事实来源：与 server/index.js 启动断言共读 public/app-version.js（路线图 P1 工项 3）。
import { UI_PROMPT_VERSION } from './app-version.js';

const STATUS_LABEL = {
  open: '待处理',
  in_progress: '处理中',
  resolved: '已解决',
  reopened: '重开',
  escalated: '已升级',
};

const KIND_LABEL = {
  ticket_created: '新建问题单',
  ticket_status: '状态变更',
  assignee_changed: '负责人变更',
  outcome_recorded: '处理进展 / 结果',
  agent_run: '智能体运行',
  agent_suggestion_ready: 'AI 建议就绪',
  comparison_ready: '对比就绪',
  model_call_requested: '模型请求',
  handoff_prepared: '交接已准备',
  handoff_accepted: '交接已接收',
  review_submitted: '审核提交（含来源）',
  memory_cited: '引用知识',
  use_helpfulness_recorded: '记忆有效性标注',
  card_drafted: '知识草稿',
  card_draft_edited: '知识草稿修订',
  card_revision_drafted: '知识版本修订草稿',
  card_published: '知识发布',
  card_retired: '知识停用',
  card_rejected: '知识驳回',
  card_pilot_approved: '批准用于试点',
  workspace_exported: '团队数据导出',
  workspace_name_changed: '团队名称变更',
  ticket_model_authorization_changed: '模型发送确认变更',
  feedback_submitted: '提交产品反馈',
  feedback_status_changed: '更新反馈状态',
  tool_call: '工具调用',
  seed_loaded: '演示数据',
  agent_write_rejected: 'AI 写请求被拒绝',
};

/** 标签同步断言（P1 工项 5）：运行期与服务端 event-kinds 单点表对账，不一致即上报不静默。 */
function assertKindLabelsSynced(serverKinds) {
  if (!serverKinds || typeof serverKinds !== 'object') return;
  const issues = [];
  for (const kind of Object.keys(serverKinds)) {
    if (!(kind in KIND_LABEL)) issues.push(`UI 缺少 kind 标签：${kind}`);
    else if (KIND_LABEL[kind] !== serverKinds[kind]) issues.push(`kind ${kind} 标签不一致：UI「${KIND_LABEL[kind]}」/ 服务端「${serverKinds[kind]}」`);
  }
  for (const kind of Object.keys(KIND_LABEL)) {
    if (!(kind in serverKinds)) issues.push(`UI 多出未登记 kind：${kind}`);
  }
  if (issues.length) console.warn('[事件标签同步检查]', issues.join('；'));
}

function eventSummary(event) {
  if (event.kind !== 'ticket_model_authorization_changed') return event.summary;
  const previous = event.payload?.previousTarget;
  const current = event.payload?.target;
  const targetLabel = (target) => `${target?.model || '未登记模型'} · ${target?.baseUrl || '未登记端点'}`;
  if (previous && current) return `${event.summary}（${targetLabel(previous)} → ${targetLabel(current)}）`;
  if (current) return `${event.summary}（${targetLabel(current)}）`;
  if (previous) return `${event.summary}（撤销：${targetLabel(previous)}）`;
  return event.summary;
}

const CARD_STATUS_LABEL = {
  draft: '草稿',
  pending: '待审核',
  published: '已发布',
  rejected: '已驳回',
  superseded: '已被新版替代',
  retired: '已停用',
};
const CARD_REVIEW_ACTION_LABEL = {
  publish: '发布',
  reject: '驳回',
  pilot_approve: '批准用于试点',
  retire: '停用',
};

const SCOPE_LABEL = { sample: '模拟样本', pilot: '真实试点' };
const FEEDBACK_CATEGORY_LABEL = { bug: '问题', idea: '建议', other: '其他' };
const FEEDBACK_STATUS_LABEL = { open: '待处理', reviewing: '处理中', resolved: '已处理' };
const SOURCE_KIND_LABEL = {
  policy: '制度政策', guide: '操作指引', resolved_case: '已解决案例（仅参考）', unknown: '来源未核实',
};
function scopeChip(scope) {
  const key = scope === 'pilot' ? 'pilot' : 'sample';
  return `<span class="chip scope-${key}" title="数据范围：${SCOPE_LABEL[key]}">${SCOPE_LABEL[key]}</span>`;
}
function kindChip(kind) {
  const key = ['policy', 'guide', 'resolved_case', 'unknown'].includes(kind) ? kind : 'unknown';
  return `<span class="chip kind-${key}" title="记忆来源类型：${key}">${SOURCE_KIND_LABEL[key]}</span>`;
}

const REVIEW_SOURCE_LABEL = {
  human: '人工审核', assistant: '助手代审', seed: '种子演示', unknown: '来源未知',
};
function reviewSourceChip(source) {
  const key = ['human', 'assistant', 'seed', 'unknown'].includes(source) ? source : 'unknown';
  return `<span class="chip source-${key}" title="审核来源类型：${key}">${esc(REVIEW_SOURCE_LABEL[key])}</span>`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

function renderSourceRefs(value) {
  const refs = String(value || '').split(/\r?\n/).map((ref) => ref.trim()).filter(Boolean);
  if (!refs.length) return esc('未填');
  return refs.map((ref) => {
    try {
      const url = new URL(ref);
      if (url.protocol !== 'https:' || !url.hostname) return esc(ref);
      const label = `${url.hostname}${url.pathname}`;
      return `<a class="source-ref-link" href="${esc(url.href)}" target="_blank" rel="noopener noreferrer" title="${esc(url.href)}">${esc(label)}</a>`;
    } catch {
      return esc(ref);
    }
  }).join('<br>');
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isKnowledgeExpired(validUntil, now = Date.now()) {
  const value = String(validUntil || '').trim();
  if (!value) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    const start = Date.UTC(year, month - 1, day);
    if (!Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== value) return true;
    return now >= Date.UTC(year, month - 1, day + 1);
  }
  const timestamp = Date.parse(value);
  return !Number.isFinite(timestamp) || now >= timestamp;
}

function isExpiredPilotCard(card) {
  return card.status === 'published'
    && card.scope === 'pilot'
    && Boolean(card.pilot_approved)
    && !card.superseded_by_card_id
    && isKnowledgeExpired(card.valid_until);
}

function relTime(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.round(h / 24)} 天前`;
}

function fmtElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)} 小时`;
  return `${(hours / 24).toFixed(1)} 天`;
}

function toast(msg, kind = 'ok') {
  toastEl.textContent = msg;
  toastEl.className = `toast show${kind === 'error' ? ' error' : ''}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toastEl.className = 'toast'; }, 3200);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && data.code === 'AUTH_REQUIRED' && productMode) {
      currentUser = null;
      loginRequired = true;
      renderLogin();
    }
    const error = new Error(data.error || `请求失败（${res.status}）`);
    error.status = res.status;
    throw error;
  }
  return data;
}

const statusChip = (status) => `<span class="chip status-${esc(status)}">${esc(STATUS_LABEL[status] || status)}</span>`;
const urgencyChip = (u) => (u ? `<span class="chip ${/紧急|高/.test(u) ? 'urgent' : ''}">${esc(u)}</span>` : '<span class="muted small">—</span>');

/* ---------------- 导航与全局状态 ---------------- */

let lastState = null;
let appMode = 'demo';
let productMode = false;
let currentUser = null;
let loginRequired = false;

function renderLogin(errorMessage = '') {
  document.querySelector('.app')?.classList.add('auth-only');
  const rail = document.querySelector('.rail');
  if (rail) rail.hidden = true;
  const error = errorMessage || (location.hash.includes('authError=not-invited')
    ? '这个邮箱还没有团队邀请，或身份提供方没有确认邮箱。请联系团队管理员。'
    : location.hash.includes('authError=provider') ? '团队账号未完成登录，请重新尝试。' : '');
  view.innerHTML = `
    <section class="panel login-panel" aria-labelledby="login-title">
      <div class="panel-body">
        <div class="login-mark" aria-hidden="true"><i class="ri-team-line"></i></div>
        <p class="page-context">${esc(authStatus?.organization || '团队工作区')}</p>
        <h1 id="login-title">登录团队工作区</h1>
        <p class="lead" style="margin-top:12px">用团队已有的账号登录。工作记录会自动记到你的身份下，成员权限由团队管理员管理。</p>
        ${error ? `<div class="notice" style="margin-top:20px"><div>${esc(error)}</div></div>` : ''}
        <div style="margin-top:24px"><a class="btn btn-primary" href="/api/auth/login">使用团队账号登录</a></div>
        <div class="notice" style="margin-top:20px"><div><strong>还进不去？</strong>本工作区只允许受邀成员登录，没有自助注册。请联系团队管理员，确认邀请邮箱和你登录时使用的邮箱一致。系统不会自动发送邀请邮件，也不会把演示样本带入这个团队工作区。</div></div>
        <p class="small muted">团队负责人准备第一次试用？先看<a href="/first-session.html">团队准备卡</a>，不用先下载制度文件。</p>
        <section class="section tight" aria-labelledby="login-first-steps-title" style="margin-top:24px">
          <h2 id="login-first-steps-title">进入后怎么开始</h2>
          <ol class="onboarding-steps">
            <li class="onboarding-step"><div class="onboarding-step-head"><strong>先确认哪些问题可以交给 AI 协助</strong></div><span>团队负责人决定可发送的信息、脱敏方式和保留期限。没确认前，不要录入真实客户信息、密码或访问令牌。</span></li>
            <li class="onboarding-step"><div class="onboarding-step-head"><strong>和同事一起处理问题</strong></div><span>AI 给出带依据的建议，成员负责核对、修改或拒绝，并记录实际采取的步骤和结果。</span></li>
            <li class="onboarding-step"><div class="onboarding-step-head"><strong>让确认有效的经验帮助下一次</strong></div><span>经验经过团队成员审核后，后续问题才会检索它；是否真的有帮助，还要看后续处理结果。</span></li>
          </ol>
        </section>
      </div>
    </section>`;
}

let authStatus = null;

function configureProductShell(user) {
  currentUser = user;
  loginRequired = false;
  const app = document.querySelector('.app');
  app?.classList.remove('auth-only');
  const rail = document.querySelector('.rail');
  if (rail) rail.hidden = false;
  const brandName = document.getElementById('brand-name');
  const brandSub = document.getElementById('brand-sub');
  const note = document.getElementById('rail-data-note');
  if (brandName) {
    brandName.textContent = authStatus?.organization || '组织智能工作台';
    brandName.title = authStatus?.organization || '';
  }
  if (brandSub) brandSub.textContent = '团队协作 · 经验闭环';
  if (note) note.textContent = '此实例专属当前团队；AI 使用前需确认授权与脱敏。';
  document.querySelector('[data-nav="batch"]')?.setAttribute('hidden', '');
  const learningNav = document.querySelector('[data-nav="pilot"]');
  if (learningNav) {
    learningNav.href = '#/learning';
    learningNav.dataset.nav = 'learning';
    const label = learningNav.querySelector('span');
    if (label) label.textContent = '团队复盘';
  }
  const userBox = document.getElementById('auth-user-box');
  const userName = document.getElementById('auth-user-name');
  const userRole = document.getElementById('auth-user-role');
  if (userBox) userBox.hidden = false;
  if (userName) userName.textContent = user.name || user.email;
  if (userRole) userRole.textContent = `${user.email} · ${{ admin: '管理员', member: '成员', viewer: '只读成员' }[user.role] || user.role}`;
  document.getElementById('auth-logout')?.addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
      location.reload();
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

async function initializeApp() {
  try {
    try {
      authStatus = await api('/api/auth/status');
    } catch (error) {
      // Keep an already-running demo server usable while its backend awaits restart.
      // Product mode always implements this endpoint and never falls back on network/server errors.
      if (error.status !== 404) throw error;
      authStatus = { mode: 'demo', enabled: false };
    }
    appMode = authStatus.mode || 'demo';
    productMode = appMode === 'product';
    if (productMode) {
      const session = await api('/api/auth/me');
      if (!session.authenticated || !session.user) {
        renderLogin();
        return;
      }
      configureProductShell(session.user);
    }
    await loadState();
    await route();
  } catch (error) {
    if (loginRequired) return;
    view.innerHTML = `<div class="empty"><h3>工作台暂时无法载入</h3><p>${esc(error.message)}</p></div>`;
  }
}

async function loadState() {
  try {
    const state = await api('/api/state');
    lastState = state;
    const chip = document.getElementById('model-chip');
    const previewOnly = state.model.previewOnly === true;
    const live = state.model.mode === 'live' && !previewOnly;
    const modelLabel = previewOnly ? '无模型连接' : live ? state.model.model : '未配置 MODEL_API_KEY';
    chip.innerHTML = `<strong><span class="dot ${live ? 'live' : 'demo'}"></span>${esc(state.model.modeLabel)}</strong>
      <span class="muted">${esc(modelLabel)}</span>`;
    const openCount = state.metrics.tickets.open + state.metrics.tickets.reopened;
    const openEl = document.querySelector('[data-count="open"]');
    if (openEl) openEl.textContent = openCount;
    // P4-5：模型连续失败提示（进程内计数，成功一次即清零；只提示不阻断）
    const failures = state.modelHealth?.consecutiveFailures || 0;
    if (failures > 0) toast(`模型服务异常：已连续 ${failures} 次失败，可改用人工处理或稍后重试`, 'error');
    // P1 工项 5：UI 事件标签与服务端单点表对账（不一致只在控制台告警，不阻断使用）
    assertKindLabelsSynced(state.eventKinds);
    return state;
  } catch (err) {
    toast(err.message, 'error');
    return null;
  }
}

async function loadPendingCount() {
  try {
    const data = await api('/api/memory?status=pending');
    const el = document.querySelector('[data-count="pending"]');
    if (el) el.textContent = data.cards.length;
  } catch { /* 计数失败不影响主流程 */ }
}

function setNav(key) {
  document.querySelectorAll('.nav-item').forEach((a) => {
    if (a.dataset.nav === key) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

function pageHead({ pageContext, title, lead, actions = '' }) {
  return `<header class="page-head">
    <div>
      <p class="page-context">${esc(pageContext)}</p>
      <h1>${esc(title)}</h1>
      <p class="lead">${lead}</p>
    </div>
    ${actions ? `<div class="page-actions">${actions}</div>` : ''}
  </header>`;
}

/* ---------------- 首页 ---------------- */

async function renderHome() {
  setNav('home');
  const [state, ticketsRes, eventsRes, learning] = await Promise.all([
    loadState(),
    api('/api/tickets'),
    api('/api/events?limit=9'),
    productMode ? api('/api/team-learning').catch(() => null) : Promise.resolve(null),
  ]);
  if (!state) return;
  const m = state.metrics;
  const tickets = ticketsRes.tickets;
  const onboarding = learning?.onboarding || null;
  const onboardingSteps = [
    {
      key: 'secondActiveMember',
      title: '工作区有两位已启用的处理成员账号',
      detail: onboarding?.milestones?.secondActiveMember
        ? '当前有至少两位已启用的管理员或成员；此项只看账号状态，不代表两人已实际参与任务。'
        : currentUser?.role === 'admin'
          ? '到团队成员设置里邀请同事；系统不会代发邀请邮件。'
          : '请管理员邀请另一位成员，之后各自用自己的账号处理任务。',
    },
    {
      key: 'firstOutcomeRecorded',
      title: '处理一条任务并记录实际结果',
      detail: '建议由成员核对、修改或拒绝；任务解决后写下实际采取的步骤和结果。',
    },
    {
      key: 'sharedKnowledgePublished',
      title: '另一位成员审核并发布这条任务沉淀的经验',
      detail: '系统以来源工单中发起过 AI 建议的账号为基准；来源工单已记录结果，且另一位登录成员发布知识，才计入这一步。',
    },
    {
      key: 'crossMemberReuseWithOutcome',
      title: '另一位登录成员在新任务中引用经验，工单也记录了结果',
      detail: '系统核对来源工单与新工单、不同建议发起成员、实际引用和结果记录；引用本身不代表效果变好。',
    },
  ];
  const onboardingDoneCount = onboarding
    ? Object.values(onboarding.milestones).filter(Boolean).length
    : null;
  const queue = tickets.filter((t) => t.status !== 'resolved');
  const myQueue = productMode
    ? queue.filter((ticket) => Number(ticket.assignee_id) === Number(currentUser?.id))
    : [];
  const readOnlyMember = productMode && currentUser?.role === 'viewer';
  // 首页「人工判断」只用 humanModes；助手代审、种子演示与来源未知不混入人工采纳率
  const byMode = (mode) => (m.humanModes || []).find((x) => x.mode === mode) || { runs: 0, reviews: 0, adopted: 0, adoptRate: null, avgRating: null };
  const orgMetrics = byMode('organization');

  const meter = (rate) => (rate === null
    ? '<span class="muted small">暂无审核</span>'
    : `<div class="num">${rate}%</div><div class="meter"><span style="width:${rate}%"></span></div>`);

  const modeRow = (mode, label) => {
    const s = byMode(mode);
    return `<tr>
      <td><span class="chip mode-${mode}">${label}</span></td>
      <td class="num">${s.runs}</td>
      <td class="num">${s.reviews}</td>
      <td style="min-width:96px">${meter(s.adoptRate)}</td>
      <td class="num">${s.avgRating ?? '—'}</td>
      <td class="num">${m.citations[mode] || 0}</td>
    </tr>`;
  };

  view.innerHTML = `
    ${pageHead({
      pageContext: state.org.name,
      title: '工作台',
      lead: productMode ? '团队成员在同一个问题队列里协作；AI 参考已批准的团队知识提出建议，由成员审核并记录处理结果。' : '同一张问题单、同一个模型、同一个智能体角色。唯一变量是：它能不能读取团队已批准的经验。',
      actions: readOnlyMember ? '' : '<button class="btn btn-primary" id="new-ticket" type="button">新建问题单</button>',
    })}

    <section class="strip" aria-label="队列概览">
      <div class="strip-cell">
        <div class="strip-label">待处理</div>
        <div class="strip-value num">${m.tickets.open + m.tickets.reopened}</div>
        <div class="strip-foot">其中重开 ${m.tickets.reopened} 张</div>
      </div>
      <div class="strip-cell">
        <div class="strip-label">处理中</div>
        <div class="strip-value num">${m.tickets.in_progress + m.tickets.escalated}</div>
        <div class="strip-foot">已升级 ${m.tickets.escalated} 张</div>
      </div>
      <div class="strip-cell">
        <div class="strip-label">已解决</div>
        <div class="strip-value num">${m.tickets.resolved}<span class="unit">张</span></div>
        <div class="strip-foot">已沉淀知识 ${m.knowledge.published} 条</div>
      </div>
      <div class="strip-cell">
        <div class="strip-label">知识复用</div>
        <div class="strip-value num">${m.knowledge.totalUses}<span class="unit">次</span></div>
        <div class="strip-foot">涉及 ${m.knowledge.distinctCardsUsed} 条卡片</div>
      </div>
    </section>

    ${productMode
      ? `<p class="small muted" style="margin:10px 0 0">当前为 ${esc(state.org.name)} 的独立团队空间。AI 建议仍需成员核对；运行量、引用量和采纳记录是过程信息，不单独代表业务效果。</p>`
      : `<p class="small muted" style="margin:10px 0 0">
          数据范围：模拟样本工单 ${m.scope?.tickets?.sample ?? 0} · 真实试点工单 ${m.scope?.tickets?.pilot ?? 0}
          · 试点批准卡 ${m.scope?.pilotApprovedCards ?? 0}。试点工单检索排除模拟样本，只认明确批准、范围匹配的制度/指引；当前批次与全量指标含模拟样本，不代表真实业务成效。
        </p>`}

    ${productMode && !onboarding?.completed ? `<section class="section onboarding-panel" aria-labelledby="first-workflow-title">
      <div class="panel panel-body">
        <div class="section-head">
          <h2 id="first-workflow-title">跑通第一条团队学习闭环</h2>
          <p class="sub">${onboardingDoneCount === null ? '进度暂时无法读取；可以按下面的步骤继续。' : `已完成 ${onboardingDoneCount}/${onboarding.total} 项，进度按工作区中的成员、审核、引用和结果记录更新。`}</p>
        </div>
        <div class="notice onboarding-boundary"><div><strong>开始前先确认数据边界。</strong>由团队负责人确认任务内容可发送给已配置的模型服务，并约定脱敏、保留和人工升级规则。这个确认由团队负责，系统不会把它推断成“已授权”。</div></div>
        <ol class="onboarding-steps">
          ${onboardingSteps.map((step) => {
            const completed = onboarding?.milestones?.[step.key] === true;
            const stateLabel = onboarding
              ? `<span class="chip ${completed ? 'status-resolved' : 'status-open'}">${completed ? '已完成' : '待完成'}</span>`
              : '<span class="chip">进度未载入</span>';
            return `<li class="onboarding-step ${completed ? 'is-complete' : ''}">
              <div class="onboarding-step-head"><strong>${step.title}</strong>${stateLabel}</div>
              <span>${step.detail}</span>
            </li>`;
          }).join('')}
        </ol>
        <div class="onboarding-actions">
          ${currentUser?.role === 'admin' ? '<a class="btn" href="#/settings/members">团队成员设置</a>' : ''}
          <a class="btn" href="/first-session.html">打开首次试用准备卡</a>
          <a class="btn" href="#/memory">查看共享经验</a>
          <a class="btn" href="#/learning">查看团队复盘</a>
          ${readOnlyMember ? '' : '<button class="btn btn-primary" type="button" id="start-first-ticket">新建问题单</button>'}
        </div>
      </div>
    </section>` : ''}

    ${productMode && onboarding?.completed ? `<section class="section tight onboarding-complete" aria-label="团队学习闭环">
      <div class="notice"><div><strong>已记录一个跨成员学习闭环。</strong>团队复盘页可查看任务结果、知识引用和对应记录；这不单独证明工作质量或效率已经提升。</div><a class="btn btn-sm" href="#/learning">查看依据</a></div>
    </section>` : ''}

    ${!productMode && state.model.mode === 'demo' ? `<div class="notice">
      <i class="ri-error-warning-line" style="flex:none;margin-top:2px" aria-hidden="true"></i>
      <div><strong>当前是演示模式。</strong>服务端没有读到 <span class="code">MODEL_API_KEY</span>，两种模式的建议由本地规则生成，只用于走通流程。配置后重启服务，同一位置会换成真实模型输出，并标注模型名与耗时。</div>
    </div>` : ''}

    ${productMode ? `<section class="section" aria-labelledby="team-metrics-title">
      <div class="section-head">
        <h2 id="team-metrics-title">团队处理概况</h2>
        <p class="sub">这些数字帮助团队看见流程运行情况；任务是否解决、建议是否正确，还要结合实际处理结果判断。</p>
      </div>
      <div class="strip" aria-label="团队处理概况">
        <div class="strip-cell"><div class="strip-label">AI 建议</div><div class="strip-value num">${orgMetrics.runs}</div><div class="strip-foot">组织建议运行次数</div></div>
        <div class="strip-cell"><div class="strip-label">成员审核</div><div class="strip-value num">${m.reviewsBySource?.human || 0}</div><div class="strip-foot">已提交的人工审核</div></div>
        <div class="strip-cell"><div class="strip-label">共享知识</div><div class="strip-value num">${m.knowledge.published}</div><div class="strip-foot">团队已发布知识</div></div>
        <div class="strip-cell"><div class="strip-label">知识引用</div><div class="strip-value num">${m.knowledge.totalUses}</div><div class="strip-foot">AI 建议引用次数</div></div>
      </div>
    </section>` : `<section class="section" aria-labelledby="compare-title">
      <div class="section-head">
        <h2 id="compare-title">两种模式的对照 · 人工审核口径</h2>
        <p class="sub">这里的审核数与评分只统计来源为 human 的人工审核；助手代审不计入人工采纳率。数字只反映活动量与人工判断，不代表组织变聪明了。真要看效果，得看引用是否正确、经验有没有被下一条问题单复用。</p>
      </div>
      <div class="panel panel-body flush">
        <table class="table">
          <thead>
            <tr><th>模式</th><th>运行</th><th>已审核</th><th>采纳率（采纳或编辑后采纳）</th><th>平均评分</th><th>带引用的运行</th></tr>
          </thead>
          <tbody>
            ${modeRow('personal', '个人模式')}
            ${modeRow('organization', '组织模式')}
          </tbody>
        </table>
        <p class="small muted" style="padding:0 var(--space-4) var(--space-4)">
          全库审核记录按来源：人工 ${m.reviewsBySource?.human || 0} · 助手代审 ${m.reviewsBySource?.assistant || 0} · 种子演示 ${m.reviewsBySource?.seed || 0} · 来源未知 ${m.reviewsBySource?.unknown || 0}。只有人工行参与上表。
        </p>
      </div>
    </section>`}

    <div class="split section">
      <section class="panel" aria-labelledby="queue-title">
        <div class="panel-head">
          <h2 id="queue-title">待处理队列 · ${queue.length} 张${productMode ? ` · 分派给我 ${myQueue.length} 张` : ''}</h2>
          <a class="small" href="#/activity">查看全部事件</a>
        </div>
        ${queue.length ? `<div class="panel-body flush">
          <table class="table">
            <thead><tr><th>问题单</th><th>类别</th><th>紧急</th><th>状态</th><th>负责人</th><th class="right">更新</th></tr></thead>
            <tbody>
              ${queue.map((t) => `<tr>
                <td class="title-cell"><a href="#/t/${t.id}">${esc(t.title)}</a><div class="row-meta">#${t.id} · ${esc(t.urgency ? '用户填写紧急度' : '未填紧急度')}</div></td>
                <td class="nowrap">${esc(t.category || '未分类')}</td>
                <td>${urgencyChip(t.urgency)}</td>
                <td>${statusChip(t.status)}${productMode && Number(t.assignee_id) === Number(currentUser?.id) ? '<div class="row-meta">分派给我</div>' : ''}</td>
                <td class="nowrap">${esc(t.assignee_name || '未分派')}</td>
                <td class="right row-meta nowrap">${relTime(t.updated_at)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>` : `<div class="panel-body">
          <div class="empty">
            <h3>队列清空了</h3>
            <p>没有待处理问题单。可以新建一张，或去组织记忆里看已沉淀的经验——空队列正是观察知识是否够用的好时机。</p>
            ${readOnlyMember ? '' : '<button class="btn" type="button" id="new-ticket-2">新建问题单</button>'}
          </div>
        </div>`}
      </section>

      <aside class="panel" aria-labelledby="feed-title">
        <div class="panel-head"><h2 id="feed-title">最近组织事件</h2></div>
        <ul class="feed">
          ${eventsRes.events.map((e) => `<li>
            <span class="marker ${e.kind === 'agent_run' || e.kind === 'card_drafted' || e.kind === 'card_revision_drafted' || (e.kind === 'card_draft_edited' && String(e.actor || '').startsWith('agent:')) ? 'k-agent' : e.kind === 'memory_cited' ? 'k-memory' : e.kind.includes('review') || e.kind.includes('published') || e.kind === 'card_retired' || e.kind === 'ticket_model_authorization_changed' || (e.kind === 'card_draft_edited' && !String(e.actor || '').startsWith('agent:')) ? 'k-human' : ''}"></span>
            <div>
              <div class="what">${esc(eventSummary(e))}</div>
              <div class="when">${esc(KIND_LABEL[e.kind] || e.kind)} · ${esc(e.actor)} · ${relTime(e.created_at)}</div>
            </div>
          </li>`).join('') || '<li class="feed-empty"><div class="what muted">还没有事件。</div></li>'}
        </ul>
      </aside>
    </div>
  `;

  document.getElementById('new-ticket')?.addEventListener('click', () => openNewTicket(state.workItemTypes?.find((t) => t.id === 'support_ticket') || null));
  document.getElementById('new-ticket-2')?.addEventListener('click', () => openNewTicket(state.workItemTypes?.find((t) => t.id === 'support_ticket') || null));
  document.getElementById('start-first-ticket')?.addEventListener('click', () => openNewTicket(state.workItemTypes?.find((t) => t.id === 'support_ticket') || null));
  loadPendingCount();
}

/* ---------------- 新建问题单 ---------------- */

function openNewTicket(workItemType = null) {
  const dlg = document.getElementById('dlg');
  // P3 E4：类型由词表决定 UI 用词（用户永远看到中文类型标签，不裸露 WorkItem 词）
  const typeLabel = workItemType?.label || '问题单';
  dlg.innerHTML = `
    <form method="dialog" id="ticket-form">
      <div class="dialog-head">
        <h2>新建${esc(typeLabel)}</h2>
        <p>写清现象与影响范围。类别和紧急度可以不填，智能体会自己判断，你可以对照它判断得对不对。</p>
      </div>
      <div class="dialog-body">
        <div class="form-row">
          <label for="f-title">标题</label>
          <input class="input" id="f-title" name="title" required maxlength="120" placeholder="例如：换了新电脑后 VPN 连不上" />
        </div>
        <div class="form-row">
          <label for="f-desc">描述</label>
          <textarea class="textarea" id="f-desc" name="description" required minlength="8" placeholder="现象、发生时间、影响范围、已经试过什么"></textarea>
        </div>
        ${productMode
          ? `<input id="f-scope" type="hidden" name="scope" value="pilot" />
             <div class="notice"><div><strong>先分清两件事。</strong>录入前，团队负责人要确认这条工单可以保存在本工作区；如果要用 AI，还要另外确认必要内容可以发给模型，并完成脱敏。页面中的姓名和脱敏状态都是手工记录，系统不会核实授权真假或脱敏是否充分。</div></div>`
          : `<div class="form-row">
              <label for="f-scope">数据范围</label>
              <select class="select" id="f-scope" name="scope">
                <option value="sample" selected>模拟样本（默认）</option>
                <option value="pilot">真实试点</option>
              </select>
              <span class="small muted">真实试点会隔离检索：排除所有模拟样本，只认明确批准的制度/指引。不要录入个人信息。</span>
            </div>`}
        <div id="f-pilot-fields" hidden>
          <div class="form-row">
            <label for="f-source">数据来源 / 工作区存储确认依据 <span class="muted">（必填）</span></label>
            <input class="input" id="f-source" name="sourceRef" maxlength="300" ${productMode ? 'required' : ''} placeholder="例如：负责人确认的工单来源及批次号；不要写个人信息" />
            <span class="small muted">只记录数据来源和负责人确认依据；这是手工记录，不是系统授权核验。不要填客户姓名、账号、电话等个人信息。</span>
          </div>
          <div class="form-row">
            ${productMode
              ? `<label for="f-auth">工作区存储确认人 <span class="muted">（必填）</span></label><input class="input" id="f-auth" name="authorizedBy" required maxlength="80" placeholder="已实际确认可存入本工作区的负责人姓名" /><span class="small muted">姓名由成员手工记录，系统不验证其身份或授权。录入操作者 ${esc(currentUser?.name || currentUser?.email || '')} 会另由登录身份记录。</span>`
              : `<label for="f-auth">授权人 <span class="muted">（必填）</span></label>
                 <input class="input" id="f-auth" name="authorizedBy" maxlength="80" placeholder="例如：张三（试点负责人）" />`}
          </div>
          <div class="form-row">
            <label for="f-desens">脱敏状态 <span class="muted">（必填）</span></label>
            <select class="select" id="f-desens" name="desensitization" ${productMode ? 'required' : ''}>
              <option value="">请选择</option>
              <option value="done">已脱敏</option>
              <option value="partial">部分脱敏</option>
              <option value="not_needed">无需脱敏</option>
            </select>
            ${productMode ? '<span class="small muted">“部分脱敏”工单可以保存在工作区供人工处理，但 AI 会被服务端拦截。保存工单前仍须确认本地存储已获准；之后若要用 AI，请新建一条已完成脱敏的工单（本系统不提供修改工单正文的功能）。</span>' : ''}
          </div>
          ${productMode && currentUser?.role === 'admin'
            ? `<div class="form-row">
                <label for="f-model-auth">模型发送确认人 <span class="muted">（可之后登记）</span></label>
                <input class="input" id="f-model-auth" name="modelAuthorizedBy" maxlength="80" placeholder="仅在负责人已实际同意发送给模型后填写" />
                <span class="small muted">当前目标：${esc(lastState?.model?.baseUrl || '未知端点')} · ${esc(lastState?.model?.model || '未知模型')}。单独记录负责人同意把必要内容发给这个目标的确认；手工记录，不是身份认证。目标改变后需重新确认，否则 AI 会被拦截。</span>
              </div>`
            : productMode
              ? '<p class="small muted">模型发送确认需由管理员核对当前服务和模型，并在负责人实际确认后于工单详情登记；目标改变后需重新确认。</p>'
              : `<div class="form-row">
                  <label for="f-model-auth">模型发送确认人 <span class="muted">（可留空）</span></label>
                  <input class="input" id="f-model-auth" name="modelAuthorizedBy" maxlength="80" placeholder="负责人已实际同意发送必要内容给模型后填写" />
                  <span class="small muted">这是手工记录，不是身份认证；不确定时留空，AI 会被拦截。</span>
                </div>`}
        </div>
        <div class="form-grid">
          <div class="form-row">
            <label for="f-cat">类别（可留空）</label>
            <select class="select" id="f-cat" name="category">
              <option value="">不填</option>
              ${(workItemType?.fieldVocab?.category || []).map((c) => `<option>${esc(c)}</option>`).join('')}
            </select>
          </div>
          <div class="form-row">
            <label for="f-urg">紧急度（可留空）</label>
            <select class="select" id="f-urg" name="urgency">
              <option value="">不填</option>
              ${(workItemType?.fieldVocab?.urgency || []).map((u) => `<option>${esc(u)}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>
      <div class="dialog-foot">
        <button class="btn" type="button" data-close>取消</button>
        <button class="btn btn-primary" type="submit">创建并打开</button>
      </div>
    </form>`;
  if (productMode) {
    const input = dlg.querySelector('#p-reviewer');
    input.value = currentUser?.name || currentUser?.email || '';
    input.readOnly = true;
    dlg.querySelector('label[for="p-reviewer"]').textContent = '批准人（来自登录身份）';
    dlg.querySelector('.dialog-head p').textContent = '批准后可被团队试用工单的组织建议检索。请确认来源类型、来源、适用范围、审批主体、知识负责人和有效期；不能凭空升级为制度依据。';
  }
  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
  const scopeSel = dlg.querySelector('#f-scope');
  const pilotFields = dlg.querySelector('#f-pilot-fields');
  const syncPilotFields = () => { pilotFields.hidden = scopeSel.value !== 'pilot'; };
  scopeSel?.addEventListener('change', syncPilotFields);
  syncPilotFields();
  dlg.querySelector('#ticket-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const isPilot = productMode || fd.get('scope') === 'pilot';
    if (isPilot) {
      if (!String(fd.get('sourceRef') || '').trim() || !String(fd.get('authorizedBy') || '').trim() || !fd.get('desensitization')) {
        toast('真实试点工单必须填写数据来源、工作区存储确认人和脱敏状态', 'error');
        return;
      }
    }
    try {
      const { ticket } = await api('/api/tickets', {
        method: 'POST',
        body: JSON.stringify({
          title: fd.get('title'),
          description: fd.get('description'),
          category: fd.get('category'),
          urgency: fd.get('urgency'),
          workItemType: workItemType?.id || undefined,
          scope: isPilot ? 'pilot' : 'sample',
          sourceRef: fd.get('sourceRef'),
          authorizedBy: fd.get('authorizedBy'),
          modelAuthorizedBy: fd.get('modelAuthorizedBy'),
          desensitization: fd.get('desensitization') || 'unknown',
        }),
      });
      dlg.close();
      toast(`${typeLabel}已创建`);
      location.hash = `#/t/${ticket.id}`;
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  dlg.showModal();
  dlg.querySelector('#f-title')?.focus();
}

/* ---------------- 问题单详情 ---------------- */

/** 从检索来源快照里按编号查来源类型，供引用块标注证据等级 */
function sourceKindForRef(run, ref) {
  const src = (run.context_sources || []).find((s) => s.ref === ref);
  if (!src) return null;
  return src.meta?.source_kind || (src.type === 'case' ? 'resolved_case' : 'unknown');
}

function citationBlock(run) {
  const cites = run.output.citations || [];
  if (!run.output.citations) return '';
  if (!cites.length) {
    return `<div class="field-row"><div class="field-key">引用</div><div class="field-val muted small">本次没有引用任何团队记忆。</div></div>`;
  }
  return `<div style="margin-top:14px">
    <div class="small muted" style="margin-bottom:2px">引用来源 · ${cites.length} 条</div>
    ${cites.map((c) => `<div class="cite">
      <div class="cite-head"><span><span class="cite-ref">${esc(c.ref)}</span> ${esc(c.title || '')}</span><span class="small muted">${c.type === 'card' ? '已发布知识' : '历史案例'}</span></div>
      <div class="cite-head" style="margin-top:2px">${kindChip(sourceKindForRef(run, c.ref))}${scopeChip((run.context_sources || []).find((s) => s.ref === c.ref)?.meta?.scope)}</div>
      <div class="cite-quote">${esc(c.quote || '')}</div>
    </div>`).join('')}
    ${run.output.citation_audit?.dropped ? `<p class="small" style="color:var(--danger);margin-top:8px">${esc(run.output.citation_audit.note)}</p>` : ''}
    ${run.output.evidence_gate?.blocked ? `<p class="small" style="color:var(--danger);margin-top:8px">证据闸门：${esc(run.output.evidence_gate.reason)}，已在「不确定」里提示核实制度。</p>` : ''}
  </div>`;
}

function generalChecksBlock(out, isOrg) {
  const checks = Array.isArray(out?.general_checks) ? out.general_checks : [];
  if (!checks.length) return '';
  const label = isOrg
    ? '通用核查项（本次团队记忆未核实）'
    : '通用核查项（个人模式未读取团队记忆）';
  return `<div style="margin-top:14px">
    <div class="small muted">${label}</div>
    <ul class="small" style="padding-left:18px;color:#3c4257">${checks.slice(0, 2).map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
  </div>`;
}

function typesafeGateBlock(run) {
  const gate = (run.tool_calls || []).find((tool) => tool.name === 'typesafe_memory_gate');
  if (!gate) return '';
  if (gate.status !== 'shadow_only') {
    const status = gate.status === 'timeout' ? '超时，本轮未取得结果' : '暂不可用';
    return `<div class="field-row"><div class="field-key">Jev 影子判断</div><div class="field-val small muted">${status} · 未影响回答。</div></div>`;
  }
  const label = {
    likely_answerable: '可能有助于作答',
    likely_not_answerable: '可能无助于作答',
    uncertain: '判断不确定',
  };
  const legacyLabel = {
    likely_supports: '旧版建议：可能支持',
    likely_not_supports: '旧版建议：可能不支持',
    uncertain: '旧版建议：不确定',
  };
  return `<div class="field-row"><div class="field-key">Jev 影子判断</div><div class="field-val small">
    <span class="muted">${esc(gate.model)} · ${Number(gate.latency_ms) || 0}ms · 仅对照，未改变回答</span>
    <ul style="padding-left:18px;margin:6px 0 0">${(gate.decisions || []).map((item) => {
      const hasAnswerability = Number.isFinite(Number(item.answerability_probability));
      const probability = Number(hasAnswerability ? item.answerability_probability : item.support_probability);
      const probabilityText = Number.isFinite(probability) ? `${Math.round(probability * 100)}%` : '未知';
      const metric = hasAnswerability
        ? `对本题有帮助的概率 ${probabilityText}（包括支持或反驳）· ${esc(label[item.recommendation] || '未分类')}`
        : `历史旧口径支持概率 ${probabilityText} · ${esc(legacyLabel[item.recommendation] || '旧版未分类')}（未按新口径复算）`;
      return `<li>${esc(item.ref)} ${esc(item.title || '')}：${metric}（未应用）</li>`;
    }).join('')}</ul>
  </div></div>`;
}

function reviewBlock(run) {
  const last = run.reviews[0];
  if (last) {
    const label = last.decision === 'adopt' ? '已采纳' : last.decision === 'edit' ? '编辑后采纳' : '已拒绝';
    return `<div class="review-box">
      <div class="review-done">
        <span class="chip ${last.decision === 'reject' ? 'status-escalated' : 'status-resolved'}">${label}</span>
        ${reviewSourceChip(last.review_source_type)}
        <span class="num">${last.rating ? `${last.rating}/5` : '未评分'}</span>
        <span class="muted">${esc(last.reviewer)} · ${fmtTime(last.created_at)}</span>
      </div>
      ${last.reason ? `<p class="small muted">理由：${esc(last.reason)}</p>` : ''}
      ${last.edited_text ? `<div class="reply" style="font-size:13px">${esc(last.edited_text)}</div>` : ''}
      ${run.reviews.length > 1 ? `<details class="small" style="margin-top:10px">
        <summary>审核历史 ${run.reviews.length} 条 · 当前状态按最新一条</summary>
        <ul style="padding-left:18px;margin-top:6px">
          ${run.reviews.map((v) => `<li>${fmtTime(v.created_at)} · ${esc(REVIEW_SOURCE_LABEL[v.review_source_type] || '来源未知')} · ${esc(v.reviewer)} · ${esc(v.decision)} · ${v.rating ? `${v.rating}/5` : '未评分'}</li>`).join('')}
        </ul>
      </details>` : ''}
    </div>`;
  }
  if (productMode && currentUser?.role === 'viewer') {
    return '<div class="review-box"><div class="small muted">你有只读权限，可以查看建议与历史记录；审核操作由团队成员提交。</div></div>';
  }
  return `<div class="review-box" data-run="${run.id}">
    <div class="small muted">人工审核（提交后标为 human）· 采纳、编辑或拒绝都会记录，用于后续对比。</div>
    ${productMode
      ? `<div class="form-row"><span class="small">审核者：${esc(currentUser?.name || currentUser?.email || '')}（来自登录身份）</span></div>`
      : `<div class="form-row">
          <label for="reviewer-${run.id}">审核者姓名（必填）<span class="muted"> · 手工记录，非登录认证</span></label>
          <input class="input" id="reviewer-${run.id}" data-role="reviewer" required maxlength="60" placeholder="填写实际审核的同事姓名" />
        </div>`}
    <div class="form-row">
      <label for="reason-${run.id}">审核理由（建议填写）</label>
      <input class="input" id="reason-${run.id}" data-role="reason" placeholder="事实准不准？来源够不够？下一步安全清楚吗？" maxlength="200" />
      <div class="small muted">按“事实 / 来源 / 下一步”简写即可，方便团队复盘；不要填写 token 明文。</div>
    </div>
    <div class="form-row" data-role="edit-wrap" hidden>
      <label for="edit-${run.id}">修改后的回复（会作为实际对外内容）</label>
      <textarea class="textarea" id="edit-${run.id}" data-role="edited">${esc(run.output.draft_reply || '')}</textarea>
    </div>
    <div class="field-inline">评分
      <div class="rating" data-role="rating" role="group" aria-label="评分">
        ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-score="${n}" aria-pressed="false" aria-label="${n} 分">${n}</button>`).join('')}
      </div>
    </div>
    <div class="review-actions">
      <button class="btn btn-sm btn-primary" type="button" data-decision="adopt" data-run="${run.id}">采纳</button>
      <button class="btn btn-sm" type="button" data-decision="edit" data-run="${run.id}">编辑后采纳</button>
      <button class="btn btn-sm btn-danger" type="button" data-decision="reject" data-run="${run.id}">拒绝</button>
    </div>
  </div>`;
}

/** P2-3（④§6.1）：记忆有效性标注区。每条组织模式运行一条入口；三态互不推断。 */
function helpfulnessBlock(run, isOrg) {
  if (!isOrg) return '';
  const uses = run.uses || [];
  if (!uses.length) return '';
  const label = (use) => use.helpful === 1 ? '<span class="chip" style="color:var(--ok,#2e7d32)">有帮助</span>'
    : use.helpful === 0 ? '<span class="chip" style="color:var(--danger)">没帮助</span>'
      : '<span class="muted small">未标注</span>';
  return `<div style="margin-top:12px">
    <div class="small muted">记忆有效性标注（对本次实际使用结果的判断；不是审核决定，未标注不影响任何计算）</div>
    ${uses.map((use) => `<div class="field-inline" style="margin-top:6px;flex-wrap:wrap;gap:8px">
      ${label(use)} <span class="small muted">K${use.card_id} · 引用片段「${esc(String(use.snippet || '').slice(0, 24))}${String(use.snippet || '').length > 24 ? '…' : ''}」</span>
      <span style="display:inline-flex;gap:6px;margin-left:auto">
        <button type="button" class="btn btn-sm" data-use-helpful="helpful" data-use="${use.id}">有帮助</button>
        <button type="button" class="btn btn-sm" data-use-helpful="not_helpful" data-use="${use.id}">没帮助</button>
        ${use.helpful !== null ? '<button type="button" class="btn btn-sm" data-use-helpful="clear" data-use="' + use.id + '">清除</button>' : ''}
      </span>
    </div>`).join('')}
  </div>`;
}

function modeCard(run, mode) {
  const isOrg = mode === 'organization';
  const out = run.output || {};
  // P4-2：快路径命中必须明示来源，不冒充新模型运行（⑤§2 纪律）
  const originLabel = run.origin === 'cached' ? '缓存复用（历史已审建议）'
    : run.origin === 'demo' ? '演示生成' : run.origin === 'fallback' ? '模型失败回退' : '真实模型';
  return `<article class="panel mode-card" aria-labelledby="mode-${run.id}">
    <div class="panel-head">
      <div>
        <div class="mode-title" id="mode-${run.id}">
          <span class="chip mode-${mode}">${isOrg ? '组织模式' : '个人模式'}</span>
          <span class="origin-badge">${esc(originLabel)}</span>
        </div>
        <p class="mode-note">${isOrg ? '可检索已发布知识与历史案例，并准备交接摘要' : '只看这张问题单，不读取任何团队记忆'} · ${esc(run.model)} · ${run.latency_ms}ms</p>
        ${run.origin === 'cached' && out.fast_path_note ? `<div class="notice" style="margin-top:8px"><div><strong>快路径命中。</strong> ${esc(out.fast_path_note)}</div></div>` : ''}
      </div>
    </div>
    <div class="panel-body">
      <div class="field-row"><div class="field-key">摘要</div><div class="field-val">${esc(out.summary || '（空）')}</div></div>
      <div class="field-row"><div class="field-key">分类</div><div class="field-val">${esc(out.category || '—')}</div></div>
      <div class="field-row"><div class="field-key">优先级</div><div class="field-val"><span class="num">${esc(out.priority || '—')}</span>${out.escalation_needed ? ' · <span class="chip urgent">建议升级</span>' : ''}</div></div>
      ${isOrg ? typesafeGateBlock(run) : ''}
      <div style="margin-top:12px"><div class="field-key small muted">草稿回复</div><div class="reply">${esc(out.draft_reply || '（空）')}</div></div>
      ${generalChecksBlock(out, isOrg)}
      <div style="margin-top:14px">
        <div class="small muted">下一步动作</div>
        <div class="field-val"><ol>${(out.next_actions || []).map((a) => `<li>${esc(a)}</li>`).join('') || '<li class="muted">未给出</li>'}</ol></div>
      </div>
      ${isOrg ? `<div style="margin-top:14px">
        <div class="small muted">交接摘要（给下一位处理者）</div>
        <div class="reply" style="font-size:13px">${esc(out.handoff_summary || '（空）')}</div>
      </div>` : ''}
      ${citationBlock(run)}
      ${helpfulnessBlock(run, isOrg)}
      <div style="margin-top:14px">
        <div class="small muted">不确定 / 待人工核实</div>
        <ul class="small" style="padding-left:18px;color:#3c4257">${(out.uncertainties || []).map((u) => `<li>${esc(u)}</li>`).join('') || '<li class="muted">未列出</li>'}</ul>
      </div>
      ${isOrg && run.tool_calls.length ? `<p class="small muted" style="margin-top:10px">工具：${run.tool_calls.map((t) => `${esc(t.name)}${t.result_count !== undefined ? `（命中 ${t.result_count}）` : ''}`).join(' · ')}</p>` : ''}
      ${reviewBlock(run)}
    </div>
  </article>`;
}

async function renderTicket(id, groupId = null) {
  setNav('home');
  const data = await api(`/api/tickets/${id}`);
  const { ticket, groups, cards, events, handoff } = data;
  const readOnlyMember = productMode && currentUser?.role === 'viewer';
  const modelTarget = data.modelTarget || {};
  const savedModelBaseUrl = String(ticket.model_authorized_base_url || '').replace(/\/+$/, '');
  const savedModelName = String(ticket.model_authorized_model || '');
  const activeModelBaseUrl = String(modelTarget.baseUrl || '').replace(/\/+$/, '');
  const activeModelName = String(modelTarget.model || '');
  const modelTargetMatches = Boolean(savedModelBaseUrl && savedModelName
    && savedModelBaseUrl === activeModelBaseUrl && savedModelName === activeModelName);
  const localPilotGate = ticket.scope !== 'pilot' ? null
    : !String(ticket.source_ref || '').trim() ? '真实试点工单缺少数据来源记录，暂不能调用模型。'
      : !String(ticket.authorized_by || '').trim() ? '缺少工作区存储确认人记录，暂不能调用模型。'
        : !['done', 'not_needed'].includes(ticket.desensitization) ? '真实试点工单脱敏状态未达到「已脱敏 / 无需脱敏」，不能调用模型。'
          : !String(ticket.model_authorized_by || '').trim() ? '缺少模型发送确认记录，暂不能调用模型。请由管理员在负责人实际确认后登记。'
            : !savedModelBaseUrl || !savedModelName ? '模型发送确认没有绑定到具体服务和模型，暂不能调用模型。请由负责人重新确认后登记当前目标。'
              : !modelTargetMatches ? '当前模型服务或模型名称与确认记录不一致，之前的确认不能沿用。请负责人确认新目标后由管理员更新。'
                : null;
  const runGateMsg = data.runGate || localPilotGate;
  const draftGateMsg = data.draftGate || null;
  const modelAuthorizationPanel = productMode && ticket.scope === 'pilot'
    ? currentUser?.role === 'admin'
      ? `<details class="panel panel-body" style="margin-top:12px" ${ticket.model_authorized_by && modelTargetMatches ? '' : 'open'}>
          <summary><strong>模型发送确认：${ticket.model_authorized_by ? `已登记（${esc(ticket.model_authorized_by)}）${modelTargetMatches ? ' · 目标匹配' : ' · 目标不匹配或记录不完整'}` : '未登记，AI 暂不可用'}</strong></summary>
          <form id="model-authorization-form" style="margin-top:12px">
            <div class="form-row">
              <label for="model-authorized-by">确认负责人姓名</label>
              <input class="input" id="model-authorized-by" name="modelAuthorizedBy" maxlength="80" value="${esc(ticket.model_authorized_by || '')}" placeholder="负责人已实际同意发送必要内容给模型后填写" />
              <span class="small muted">当前目标：${esc(modelTarget.baseUrl || '未知端点')} · ${esc(modelTarget.model || '未知模型')}<br>上次确认目标：${esc(ticket.model_authorized_base_url || '未绑定')} · ${esc(ticket.model_authorized_model || '未绑定')}<br>先让负责人对当前目标重新确认，再保存。记录由管理员手工填写，不证明负责人确实同意；清空并保存会撤销记录并阻止后续模型调用。</span>
            </div>
            <button class="btn btn-sm" type="submit">登记 / 更新确认记录</button>
          </form>
        </details>`
      : `<p class="small muted" style="margin-top:10px">模型发送确认：${esc(ticket.model_authorized_by || '未登记，AI 暂不可用')} · 确认目标：${esc(ticket.model_authorized_base_url || '未绑定')} · ${esc(ticket.model_authorized_model || '未绑定')} · ${modelTargetMatches ? '与当前目标一致' : '与当前目标不一致或记录不完整'}。姓名由管理员手工记录，系统不核实授权。</p>`
    : '';
  if (!lastState) await loadState();
  const serverPromptVersion = lastState?.agent?.promptVersion || '';
  const promptVersionMismatch = serverPromptVersion !== UI_PROMPT_VERSION;
  const runButtonBlocked = Boolean(runGateMsg) || promptVersionMismatch;
  const runButtonTitle = promptVersionMismatch
    ? '页面与服务端提示词版本不一致，为避免混合版本暂时禁用'
    : runGateMsg || '';
  const promptVersionNotice = promptVersionMismatch
    ? `此页面对应提示词 ${UI_PROMPT_VERSION}，服务端正在运行 ${serverPromptVersion || '未知版本'}。为避免混合版本，生成按钮已暂时禁用；已保存结果仍可查看。重启服务并刷新页面后再生成。`
    : '';
  const people = lastState?.members || [];
  const assignablePeople = people.filter((person) => (
    !productMode || (person.status === 'active' && person.role !== 'viewer')
  ));
  const currentAssignee = people.find((person) => Number(person.id) === Number(ticket.assignee_id));
  const currentAssigneeNotAssignable = Boolean(ticket.assignee_id)
    && !assignablePeople.some((person) => Number(person.id) === Number(ticket.assignee_id));
  // 观察批次页会用 ?g=<run_group> 指到具体那一组；默认仍取最新一组
  const group = (groupId && groups.find((g) => g.runGroup === groupId)) || groups[0];
  const runOf = (mode) => group?.runs.find((r) => r.mode === mode);

  view.innerHTML = `
    <div class="crumbs"><a href="#/">工作台</a> / 问题单 #${ticket.id}</div>

    <header class="detail-head">
      <div class="chip-row" style="margin-top:0;margin-bottom:10px">
        ${statusChip(ticket.status)}
        ${scopeChip(ticket.scope)}
        <span class="chip">${esc(ticket.category || '未分类')}</span>
        ${ticket.urgency ? `<span class="chip ${/紧急|高/.test(ticket.urgency) ? 'urgent' : ''}">${esc(ticket.urgency)}</span>` : ''}
        <span class="chip">负责人 ${esc(ticket.assignee_name || '未分派')}</span>
        <span class="chip">创建 ${fmtTime(ticket.created_at)}</span>
      </div>
      <h1>${esc(ticket.title)}</h1>
      <p class="detail-desc">${esc(ticket.description)}</p>
      ${ticket.outcome_note ? `<p class="small muted" style="margin-top:10px">处理记录：${esc(ticket.outcome_note)}</p>` : ''}
      ${productMode && handoff ? `<div class="notice" style="margin-top:12px"><div>
        <strong>${handoff.pending ? '交接等待接收' : '交接已接收'}</strong>
        · ${esc(handoff.recipientName || ticket.assignee_name || '接手人')} · 摘要准备于 ${fmtTime(handoff.preparedAt)}
        ${handoff.pending ? ` · 已等待 ${fmtElapsed(Date.now() - Date.parse(handoff.preparedAt))}` : ` · 用时 ${fmtElapsed(handoff.waitMs)}，${fmtTime(handoff.acceptedAt)} 确认`}
        <div class="button-row" style="margin-top:8px">
          <button class="btn btn-sm" type="button" id="view-handoff">查看交接摘要</button>
          ${handoff.pending && Number(currentUser?.id) === Number(handoff.recipientMemberId) && !readOnlyMember ? '<button class="btn btn-primary btn-sm" type="button" id="accept-handoff">确认接收</button>' : ''}
        </div>
        ${handoff.pending ? '<div class="small muted" style="margin-top:6px">负责人或工单状态变更后，这次待接收交接会失效。</div>' : ''}
      </div></div>` : ''}
      ${ticket.scope === 'pilot'
        ? `<div class="notice" style="margin-top:12px"><div><strong>真实试点工单。</strong> 组织模式只检索明确批准用于试点、适用范围匹配的制度/指引，排除所有模拟样本；已解决案例仅作相似参考。没有权威依据时会提示核实制度。
          <div class="small" style="margin-top:8px">数据来源：${esc(ticket.source_ref || '未填')} · 工作区存储确认人：${esc(ticket.authorized_by || '未填')} · 脱敏状态：${esc({ unknown: '未声明', done: '已脱敏', partial: '部分脱敏', not_needed: '无需脱敏' }[ticket.desensitization] || '未声明')}</div></div></div>`
        : `<p class="small muted" style="margin-top:10px">模拟样本工单 · 组织模式沿用首轮试跑的检索口径，结果不代表真实业务成效。</p>`}
    </header>

    ${modelAuthorizationPanel}

    <div class="toolbar">
      ${readOnlyMember ? '<span class="small muted">只读成员：可以查看内容，不能生成建议、审核或修改工单。</span>' : `
        <button class="btn btn-primary" type="button" id="run-pair" ${runButtonBlocked ? `disabled title="${esc(runButtonTitle)}"` : ''}>${productMode ? '生成 AI 建议' : '生成两种建议'}</button>
        <button class="btn" type="button" id="record-outcome">记录进展 / 结果</button>
        <button class="btn" type="button" id="handoff" ${productMode ? 'title="先把负责人改派给另一位启用成员，再准备摘要"' : ''}>准备交接摘要</button>`}
      <span class="spacer"></span>
      ${readOnlyMember ? `<span class="field-inline">状态：${esc(STATUS_LABEL[ticket.status] || ticket.status)}</span><span class="field-inline">负责人：${esc(ticket.assignee_name || '未分派')}</span>` : `<label class="field-inline">状态
        <select class="select" id="status-select">
          ${Object.entries(STATUS_LABEL).map(([v, l]) => `<option value="${v}" ${v === ticket.status ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </label>
      <label class="field-inline">负责人
        <select class="select" id="assignee-select">
          <option value="">未分派</option>
          ${currentAssigneeNotAssignable ? `<option value="${ticket.assignee_id}" selected disabled>${esc(currentAssignee?.name || ticket.assignee_name || '原负责人')}（当前不可接单，请改派）</option>` : ''}
          ${assignablePeople.map((p) => `<option value="${p.id}" ${Number(p.id) === Number(ticket.assignee_id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select>
      </label>`}
      ${groups.length > 1 ? `<label class="field-inline">运行组
        <select class="select" id="group-select" aria-label="选择运行组">
          ${groups.map((g, i) => `<option value="${esc(g.runGroup)}" ${group?.runGroup === g.runGroup ? 'selected' : ''}>第 ${groups.length - i} 组 · ${fmtTime(g.createdAt)}</option>`).join('')}
        </select>
      </label>` : ''}
    </div>

    ${group ? `<section class="${productMode ? 'section' : 'duo'}" aria-label="${productMode ? 'AI 建议' : '两种模式并排结果'}">
        ${productMode
          ? modeCard(runOf('organization') || group.runs[0], 'organization')
          : `${modeCard(runOf('personal') || group.runs[0], 'personal')}${modeCard(runOf('organization') || group.runs[1] || group.runs[0], 'organization')}`}
      </section>
      <p class="small muted" style="margin-top:12px">本次运行组 <span class="code">${esc(group.runGroup)}</span>${productMode ? ' · 使用团队已发布经验，并保留引用和不确定项。' : ' · 同一模型、同一提示词版本。组织模式多出来的部分只有：检索到的记忆、引用和交接摘要。'}</p>`
      : `<section class="section">
        <div class="empty">
          <h3>${productMode ? '还没有 AI 建议' : '还没有跑过对比'}</h3>
          <p>${productMode ? (readOnlyMember ? '你可以查看团队工单和历史建议；有写入权限的成员可以生成建议并继续处理。' : '生成一份团队版建议：AI 会参考已发布的团队知识，成员确认后再处理。') : '点「生成两种建议」，会用同一张问题单分别跑个人模式和组织模式，结果并排放在这里。差别应该只来自是否读取了团队已批准的经验。'}</p>
          ${readOnlyMember ? '' : `<button class="btn btn-primary" type="button" id="run-pair-2" ${runButtonBlocked ? `disabled title="${esc(runButtonTitle)}"` : ''}>${productMode ? '生成 AI 建议' : '生成两种建议'}</button>`}
        </div>
      </section>`}

    ${promptVersionNotice ? `<div class="notice" style="margin-top:12px"><div><strong>版本不匹配。</strong> ${esc(promptVersionNotice)}</div></div>` : ''}
    ${runGateMsg ? `<div class="notice" style="margin-top:12px"><div><strong>运行已被数据闸门拦截。</strong> ${esc(runGateMsg)} 前端禁用只是提示，服务端同样拒绝。请先确认团队负责人已实际授权相应用途，再由管理员记录；系统不会替团队确认授权。</div></div>` : ''}

    ${ticket.status === 'resolved' ? `<section class="section tight" aria-labelledby="k-title">
      <div class="section-head">
        <h2 id="k-title">从这次处理里沉淀知识</h2>
        <p class="sub">智能体只能起草，发布必须人工审核。发布后，下一张相似问题单的组织模式才有机会引用它。真实试点还要求最新组织模式建议经过组织成员人工采纳或编辑后采纳。</p>
      </div>
      <div class="panel panel-body">
        ${draftGateMsg ? `<div class="notice" style="margin-bottom:12px"><div><strong>暂不能生成知识草稿。</strong> ${esc(draftGateMsg)} 编辑后采纳会用审核者填写的修订文本，采纳会用该组织模式运行的建议；不会回退到模型原文。</div></div>` : ''}
        ${cards.length ? cards.map((c) => `<div style="padding:10px 0;border-bottom:1px dashed var(--border)">
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <span class="chip status-${c.status === 'published' ? 'resolved' : c.status === 'retired' || c.status === 'rejected' ? 'escalated' : 'in_progress'}">${esc(CARD_STATUS_LABEL[c.status])}</span>
            <a href="#/memory">${esc(c.title)}</a>
          </div>
          <p class="small muted" style="margin-top:4px">被引用 ${c.uses.length} 次${(() => { const adoptedN = (c.uses || []).filter((u) => u.adopted === 1).length; return adoptedN ? ` · 其中采纳 ${adoptedN} 次` : ''; })()} · 版本 v${c.version}</p>
        </div>`).join('') : '<p class="small muted" style="margin-bottom:12px">这张单还没有对应的知识草稿。</p>'}
        ${readOnlyMember ? '' : `<button class="btn" type="button" id="draft-card" style="margin-top:12px" ${draftGateMsg ? 'disabled title="需要组织成员人工采纳或编辑后采纳"' : ''}>${cards.length ? '重新生成草稿' : '生成知识卡片草稿'}</button>`}
      </div>
    </section>` : ''}

    <section class="section tight" aria-labelledby="tl-title">
      <div class="section-head"><h2 id="tl-title">处理时间线</h2><p class="sub">所有 AI 与人工动作都留痕：谁在什么时候做了什么、依据是什么。</p></div>
      <div class="panel panel-body">
        <ul class="timeline">
          ${events.map((e) => `<li>
            <time>${fmtTime(e.created_at)}</time>
            <div><span class="actor">${esc(KIND_LABEL[e.kind] || e.kind)} · ${esc(e.actor)}</span><br/>${esc(eventSummary(e))}</div>
          </li>`).join('') || '<li><time>—</time><div class="muted">暂无事件</div></li>'}
        </ul>
      </div>
    </section>
  `;

  const rerender = () => renderTicket(id, group?.runGroup).catch((e) => toast(e.message, 'error'));

  document.getElementById('group-select')?.addEventListener('change', (e) => {
    location.hash = `#/t/${id}?g=${e.target.value}`;
  });

  document.getElementById('run-pair')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
      btn.textContent = productMode ? '正在生成建议…' : '两种模式运行中…';
    try {
      const result = await api(`/api/tickets/${id}/run`, { method: 'POST' });
      const latestGroup = result.groups?.[0]?.runGroup || null;
      // A fresh pair should be visible immediately, even when the operator
      // started from an older run-group deep link.
      if (latestGroup) history.replaceState(null, '', `#/t/${id}?g=${encodeURIComponent(latestGroup)}`);
      await renderTicket(id, latestGroup);
      toast(productMode ? 'AI 建议已生成，等待团队审核' : '两种模式已生成，可以并排比较了');
    } catch (err) {
      btn.disabled = false;
      btn.textContent = productMode ? '生成 AI 建议' : '生成两种建议';
      toast(err.message, 'error');
    }
  });
  document.getElementById('run-pair-2')?.addEventListener('click', () => document.getElementById('run-pair')?.click());

  document.getElementById('status-select')?.addEventListener('change', async (e) => {
    try {
      await api(`/api/tickets/${id}`, { method: 'PATCH', body: JSON.stringify({ status: e.target.value, updatedAt: ticket.updated_at }) });
      await rerender();
      toast('状态已更新');
    } catch (err) {
      if (err.status === 409) { toast('工单刚被他人更新，已刷新最新状态，请重试', 'error'); await rerender(); }
      else toast(err.message, 'error');
    }
  });

  document.getElementById('assignee-select')?.addEventListener('change', async (e) => {
    try {
      await api(`/api/tickets/${id}`, { method: 'PATCH', body: JSON.stringify({ assigneeId: e.target.value || null, updatedAt: ticket.updated_at }) });
      await rerender();
      toast('负责人已更新');
    } catch (err) {
      if (err.status === 409) { toast('工单刚被他人更新，已刷新最新状态，请重试', 'error'); await rerender(); }
      else toast(err.message, 'error');
    }
  });

  document.getElementById('model-authorization-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = e.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const modelAuthorizedBy = String(new FormData(e.currentTarget).get('modelAuthorizedBy') || '').trim();
      await api(`/api/tickets/${id}/model-authorization`, {
        method: 'PATCH',
        body: JSON.stringify({ modelAuthorizedBy }),
      });
      toast(modelAuthorizedBy ? '模型发送确认记录已保存' : '模型发送确认已撤销，AI 将继续被拦截');
      await rerender();
    } catch (err) {
      button.disabled = false;
      toast(err.message, 'error');
    }
  });

  document.getElementById('record-outcome')?.addEventListener('click', () => openOutcome(ticket, rerender));

  document.getElementById('handoff')?.addEventListener('click', async () => {
    try {
      const result = await api(`/api/tickets/${id}/handoff`, { method: 'POST' });
      const { handoff: text } = result;
      await rerender();
      openTextDialog('交接摘要', '摘要已记录在工单里，接手人可查看并确认接收。建议动作不会被标记为已执行。', text);
      if (productMode) toast(`交接摘要已准备，等待 ${result.recipient} 确认`);
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('view-handoff')?.addEventListener('click', () => {
    openTextDialog('交接摘要', '交接摘要留存在工单时间线中；建议动作不会被标记为已执行。', handoff?.text || '没有保存交接摘要。');
  });

  document.getElementById('accept-handoff')?.addEventListener('click', async (e) => {
    const button = e.currentTarget;
    button.disabled = true;
    try {
      const result = await api(`/api/tickets/${id}/handoff/accept`, { method: 'POST' });
      toast(`已确认接收，等待时间 ${fmtElapsed(result.waitMs)}`);
      await rerender();
    } catch (err) {
      button.disabled = false;
      toast(err.message, 'error');
    }
  });

  document.getElementById('draft-card')?.addEventListener('click', async () => {
    try {
      const res = await api(`/api/tickets/${id}/knowledge-draft`, { method: 'POST' });
      toast(res.created ? '草稿已生成，等人工审批' : '已有草稿，未重复生成');
      await rerender();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // 评分与审核
  view.querySelectorAll('[data-role="rating"]').forEach((group) => {
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-score]');
      if (!btn) return;
      group.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    });
  });

  view.querySelectorAll('[data-decision]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const box = btn.closest('.review-box');
      if (!box) return;
      const runId = btn.dataset.run;
      const decision = btn.dataset.decision;
      const wrap = box.querySelector('[data-role="edit-wrap"]');
      // 第一次点「编辑后采纳」只展开编辑框，第二次才是提交
      if (decision === 'edit' && wrap.hidden) {
        wrap.hidden = false;
        btn.textContent = '提交修改后的版本';
        wrap.querySelector('textarea').focus();
        return;
      }
      const score = box.querySelector('[data-role="rating"] button[aria-pressed="true"]')?.dataset.score;
      const reason = box.querySelector('[data-role="reason"]')?.value || '';
      const reviewer = productMode ? (currentUser?.name || currentUser?.email || '') : box.querySelector('[data-role="reviewer"]')?.value.trim() || '';
      if (!reviewer) {
        toast('请填写审核者姓名（手工记录，不是登录身份认证）', 'error');
        box.querySelector('[data-role="reviewer"]')?.focus();
        return;
      }
      // 详情页的提交一律显式标为 human；助手代审只能由显式传 assistant 的接口写入
      const payload = { decision, rating: score ? Number(score) : null, reason, reviewer, sourceType: 'human' };
      if (decision === 'edit') {
        const editedText = wrap.querySelector('textarea').value.trim();
        if (editedText.length < 5) {
          toast('修改后的回复太短', 'error');
          return;
        }
        payload.editedText = editedText;
      }
      btn.disabled = true;
      try {
        await api(`/api/runs/${runId}/review`, { method: 'POST', body: JSON.stringify(payload) });
        await rerender();
        toast(decision === 'reject' ? '已记录为拒绝' : '审核已记录');
      } catch (err) {
        btn.disabled = false;
        toast(err.message, 'error');
      }
    });
  });

  // P2-3：记忆有效性标注（有帮助 / 没帮助 / 清除）——工单解决后的一次性可选动作，不做强制
  view.querySelectorAll('[data-use-helpful]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await api(`/api/uses/${btn.dataset.use}/helpfulness`, {
          method: 'POST',
          body: JSON.stringify({ helpful: btn.dataset.useHelpful }),
        });
        await rerender();
        toast(btn.dataset.useHelpful === 'clear' ? '已清除标注' : '标注已记录');
      } catch (err) {
        btn.disabled = false;
        toast(err.message, 'error');
      }
    });
  });
}

/* ---------------- 记录结果 / 文本弹窗 ---------------- */

function openOutcome(ticket, after) {
  const dlg = document.getElementById('dlg');
  dlg.innerHTML = `
    <form method="dialog" id="outcome-form">
      <div class="dialog-head">
        <h2>记录处理进展 / 结果</h2>
        <p>处理中也可以记录已做动作、发现和待办，内容会进入时间线并带入交接摘要；选择「已解决」时必须写明实际结果。AI 建议不会自动记成已执行。</p>
      </div>
      <div class="dialog-body">
        <div class="form-row">
          <label for="o-status">结果</label>
          <select class="select" id="o-status" name="status">
            <option value="in_progress" ${ticket.status === 'in_progress' ? 'selected' : ''}>处理中</option>
            <option value="resolved" ${ticket.status === 'resolved' ? 'selected' : ''}>已解决</option>
            <option value="reopened" ${ticket.status === 'reopened' ? 'selected' : ''}>重开</option>
            <option value="escalated" ${ticket.status === 'escalated' ? 'selected' : ''}>升级</option>
          </select>
        </div>
        <div class="form-row">
          <label for="o-note">实际做了什么 / 结论</label>
          <textarea class="textarea" id="o-note" name="note" placeholder="例如：证书过期，重新签发并升级客户端后恢复。" maxlength="900">${esc(ticket.outcome_note || '')}</textarea>
        </div>
      </div>
      <div class="dialog-foot">
        <button class="btn" type="button" data-close>取消</button>
        <button class="btn btn-primary" type="submit">保存</button>
      </div>
    </form>`;
  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
  const statusInput = dlg.querySelector('#o-status');
  const noteInput = dlg.querySelector('#o-note');
  const syncOutcomeRequirement = () => {
    if (noteInput) noteInput.required = productMode && statusInput?.value === 'resolved';
  };
  statusInput?.addEventListener('change', syncOutcomeRequirement);
  syncOutcomeRequirement();
  dlg.querySelector('#outcome-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const status = fd.get('status');
    if (productMode && status === 'resolved' && !String(fd.get('note') || '').trim()) {
      toast('结案时请记录实际处理结果', 'error');
      dlg.querySelector('#o-note').focus();
      return;
    }
    try {
      await api(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          outcome: status === 'resolved' ? '已解决' : status === 'reopened' ? '未解决' : status === 'escalated' ? '已升级' : null,
          outcomeNote: fd.get('note'),
          updatedAt: ticket.updated_at,
        }),
      });
      dlg.close();
      toast('结果已记录');
      after();
    } catch (err) {
      if (err.status === 409) { toast('工单刚被他人更新，已刷新最新状态，请重新填写', 'error'); dlg.close(); after(); }
      else toast(err.message, 'error');
    }
  });
  dlg.showModal();
}

function openPromptDialog({ title, hint, label, submitLabel, danger = false, requireNote = false, onSubmit }) {
  const dlg = document.getElementById('dlg');
  dlg.innerHTML = `
    <form method="dialog" id="prompt-form">
      <div class="dialog-head"><h2>${esc(title)}</h2><p>${esc(hint || '')}</p></div>
      <div class="dialog-body">
        <div class="form-row">
          <label for="p-reviewer">审核者姓名（必填）<span class="muted"> · 手工记录，非登录认证</span></label>
          <input class="input" id="p-reviewer" required maxlength="60" placeholder="填写实际审核的同事姓名" />
        </div>
        <div class="form-row">
          <label for="p-note">${esc(label)}</label>
          <textarea class="textarea" id="p-note" maxlength="400" style="min-height:72px"></textarea>
        </div>
      </div>
      <div class="dialog-foot">
        <button class="btn" type="button" data-close>取消</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="submit">${esc(submitLabel)}</button>
      </div>
    </form>`;
  if (productMode) {
    const input = dlg.querySelector('#p-reviewer');
    input.value = currentUser?.name || currentUser?.email || '';
    input.readOnly = true;
    dlg.querySelector('label[for="p-reviewer"]').textContent = '审核者（来自登录身份）';
  }
  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
  dlg.querySelector('#prompt-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const note = dlg.querySelector('#p-note').value.trim();
    const reviewer = dlg.querySelector('#p-reviewer').value.trim();
    if (requireNote && !note) {
      toast('请填写原因', 'error');
      dlg.querySelector('#p-note').focus();
      return;
    }
    if (!reviewer) {
      toast('请填写审核者姓名（手工记录，不是登录身份认证）', 'error');
      dlg.querySelector('#p-reviewer').focus();
      return;
    }
    try {
      await onSubmit(note, reviewer);
      dlg.close();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  dlg.showModal();
  dlg.querySelector('#p-note')?.focus();
}

/** 明确批准一张卡进入真实试点检索：必须填来源、适用范围、审批主体。 */
function openCardDraftEditDialog(card, onSubmit) {
  const dlg = document.getElementById('dlg');
  dlg.innerHTML = `
    <form method="dialog" id="card-edit-form">
      <div class="dialog-head">
        <h2>编辑待审核知识卡 K${card.id}</h2>
        <p>保存后仍保持待审核，不会发布，也不会进入组织模式检索。${productMode ? '编辑者会从登录身份自动记录。' : '编辑者姓名是手工归属记录，不是登录身份认证。'}</p>
      </div>
      <div class="dialog-body card-edit-body">
        <div class="form-row">
          <label for="card-edit-content">修订后的知识卡正文</label>
          <textarea class="textarea card-edit-content" id="card-edit-content" required maxlength="12000">${esc(card.content)}</textarea>
        </div>
        <div class="form-row">
          <label for="card-edit-note">修改说明（必填）</label>
          <textarea class="textarea" id="card-edit-note" required maxlength="500" placeholder="说明补了什么事实、范围或来源边界"></textarea>
        </div>
        <div class="form-row">
          <label for="card-edit-editor">编辑者姓名（必填）<span class="muted"> · 手工记录，非登录认证</span></label>
          <input class="input" id="card-edit-editor" required maxlength="60" placeholder="填写实际编辑者姓名" />
        </div>
      </div>
      <div class="dialog-foot">
        <button class="btn" type="button" data-close>取消</button>
        <button class="btn btn-primary" type="submit">保存为待审核草稿</button>
      </div>
    </form>`;
  if (productMode) {
    const input = dlg.querySelector('#card-edit-editor');
    input.value = currentUser?.name || currentUser?.email || '';
    input.readOnly = true;
    dlg.querySelector('label[for="card-edit-editor"]').textContent = '编辑者（来自登录身份）';
    dlg.querySelector('.dialog-head p').textContent = '保存后仍保持待审核，不会发布，也不会进入组织模式检索。编辑者由团队登录身份自动记录。';
  }
  dlg.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => dlg.close()));
  dlg.querySelector('#card-edit-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const content = dlg.querySelector('#card-edit-content').value.trim();
    const note = dlg.querySelector('#card-edit-note').value.trim();
    const editor = dlg.querySelector('#card-edit-editor').value.trim();
    if (!content || !note || !editor) {
      toast('请填写卡片正文、修改说明和编辑者姓名', 'error');
      return;
    }
    try {
      await onSubmit({ content, note, editor });
      dlg.close();
    } catch (error) {
      toast(error.message, 'error');
    }
  });
  dlg.showModal();
  dlg.querySelector('#card-edit-content').focus();
}

function openCardRevisionDialog(card, onSubmit) {
  const dlg = document.getElementById('dlg');
  dlg.innerHTML = `
    <form method="dialog" id="card-revision-form">
      <div class="dialog-head">
        <h2>基于 K${card.id} v${card.version} 创建修订草稿</h2>
        <p>这会新建一张待审核的模拟样本修订稿。审核发布前，K${card.id} v${card.version} 继续被检索；发布新稿后，旧版保留在历史里并退出检索。此操作不会进入真实试点。</p>
      </div>
      <div class="dialog-body card-edit-body">
        <div class="form-row">
          <label for="card-revision-content">修订后的知识正文</label>
          <textarea class="textarea card-edit-content" id="card-revision-content" required maxlength="12000">${esc(card.content)}</textarea>
        </div>
        <div class="form-row">
          <label for="card-revision-sources">来源链接（每行一条）</label>
          <textarea class="textarea" id="card-revision-sources" maxlength="3000" style="min-height:92px">${esc(card.source_ref || '')}</textarea>
        </div>
        <div class="form-row">
          <label for="card-revision-scope">适用范围</label>
          <textarea class="textarea" id="card-revision-scope" maxlength="1000" style="min-height:68px">${esc(card.applies_to || '')}</textarea>
        </div>
        <div class="form-row">
          <label for="card-revision-note">修订说明</label>
          <textarea class="textarea" id="card-revision-note" required maxlength="500" placeholder="说明修正了什么、依据是什么"></textarea>
        </div>
      </div>
      <div class="dialog-foot">
        <button class="btn" type="button" data-close>取消</button>
        <button class="btn btn-primary" type="submit">保存为待审核修订</button>
      </div>
    </form>`;
  dlg.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => dlg.close()));
  dlg.querySelector('#card-revision-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const content = dlg.querySelector('#card-revision-content').value.trim();
    const note = dlg.querySelector('#card-revision-note').value.trim();
    const sourceRef = dlg.querySelector('#card-revision-sources').value.trim();
    const appliesTo = dlg.querySelector('#card-revision-scope').value.trim();
    if (!content || !note) {
      toast('请填写修订正文和修订说明', 'error');
      return;
    }
    try {
      await onSubmit({ content, note, sourceRef, appliesTo });
      dlg.close();
    } catch (error) {
      toast(error.message, 'error');
    }
  });
  dlg.showModal();
  dlg.querySelector('#card-revision-content').focus();
}

function openPilotApproveDialog(cardId, onSubmit) {
  const dlg = document.getElementById('dlg');
  dlg.innerHTML = `
    <form method="dialog" id="pilot-form">
      <div class="dialog-head"><h2>批准 K${cardId} 用于真实试点检索</h2>
        <p>批准后可被 pilot 工单的组织模式检索。来源类型、来源、适用范围、审批主体、知识负责人和批准人都必须填写；不能凭空升级为制度依据。批准人由操作者手工填写，仅作归属记录，不是登录身份认证。</p></div>
      <div class="dialog-body">
        <div class="form-row"><label for="p-kind">来源类型</label>
          <select class="select" id="p-kind" required>
            <option value="policy">制度政策（policy）</option>
            <option value="guide" selected>操作指引（guide）</option>
          </select></div>
        <div class="form-row"><label for="p-ref">来源（文件名 / 链接 / 制度编号）</label>
          <input class="input" id="p-ref" required maxlength="300" placeholder="例如：IT-SEC-003《远程访问规范》" /></div>
        <div class="form-row"><label for="p-applies">适用范围（用逗号分隔的场景或类别）</label>
          <input class="input" id="p-applies" required maxlength="300" placeholder="例如：网络与 VPN,远程办公；填「通用」表示全部场景" /></div>
        <div class="form-row"><label for="p-body">审批主体</label>
          <input class="input" id="p-body" required maxlength="200" placeholder="例如：信息安全部" /></div>
        <div class="form-row"><label for="p-owner">知识负责人 <span class="muted">（必填）</span></label>
          <input class="input" id="p-owner" required maxlength="80" placeholder="对这条知识内容负责的成员" /></div>
        <div class="form-row"><label for="p-valid">有效期至（UTC 日期，当日结束后失效；可留空）</label>
          <input class="input" id="p-valid" maxlength="40" placeholder="2027-12-31" /></div>
        <div class="form-row"><label for="p-reviewer">批准人（必填）<span class="muted"> · 手工记录，非登录认证</span></label>
          <input class="input" id="p-reviewer" required maxlength="60" placeholder="填写实际批准的同事姓名" /></div>
      </div>
      <div class="dialog-foot">
        <button class="btn" type="button" data-close>取消</button>
        <button class="btn btn-primary" type="submit">确认批准</button>
      </div>
    </form>`;
  if (productMode) {
    const input = dlg.querySelector('#p-reviewer');
    input.value = currentUser?.name || currentUser?.email || '';
    input.readOnly = true;
    dlg.querySelector('label[for="p-reviewer"]').textContent = '批准人（来自登录身份）';
    dlg.querySelector('.dialog-head p').textContent = '批准后可被团队试点工单的组织建议检索。请确认来源类型、来源、适用范围、审批主体、知识负责人和有效期；不能凭空升级为制度依据。批准人由团队登录身份记录。';
  }
  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
  dlg.querySelector('#pilot-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (id) => dlg.querySelector(id).value.trim();
    try {
      await onSubmit({
        sourceKind: v('#p-kind'), sourceRef: v('#p-ref'), appliesTo: v('#p-applies'),
        approvalBody: v('#p-body'), knowledgeOwner: v('#p-owner'),
        validUntil: v('#p-valid'), reviewer: v('#p-reviewer'),
      });
      dlg.close();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  dlg.showModal();
}

function openTextDialog(title, hint, text) {
  const dlg = document.getElementById('dlg');
  dlg.innerHTML = `
    <div class="dialog-head"><h2>${esc(title)}</h2><p>${esc(hint)}</p></div>
    <div class="dialog-body">
      <div class="reply" style="max-height:46vh;overflow:auto">${esc(text)}</div>
    </div>
    <div class="dialog-foot">
      <button class="btn" type="button" id="copy-text">复制</button>
      <button class="btn btn-primary" type="button" data-close>关闭</button>
    </div>`;
  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
  dlg.querySelector('#copy-text')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制');
    } catch {
      toast('浏览器不允许写剪贴板，请手动选中复制', 'error');
    }
  });
  dlg.showModal();
}

/* ---------------- 组织记忆 ---------------- */

async function renderMemory(query = '') {
  setNav('memory');
  const readOnlyMember = productMode && currentUser?.role === 'viewer';
  const tab = renderMemory.tab || 'published';
  const [data, pendingData] = await Promise.all([
    api(`/api/memory?status=&q=${encodeURIComponent(query)}`),
    api('/api/memory?status=pending'),
  ]);
  const pendingCount = pendingData.cards.length;
  const expiredCards = data.cards.filter(isExpiredPilotCard);
  const visibleCards = tab === 'all'
    ? data.cards
    : tab === 'expired'
      ? expiredCards
      : data.cards.filter((card) => card.status === tab);

  const tabs = [
    ['published', '已发布'],
    ['expired', '过期待复核'],
    ['pending', '待审核'],
    ['rejected', '已驳回'],
    ['retired', '已停用'],
    ['all', '全部'],
  ];

  view.innerHTML = `
    ${pageHead({
      pageContext: '组织记忆',
      title: '共享知识与已解决案例',
      lead: '智能体的知识不是它自己编的，而是从这里检索到的。每条卡片都带来源问题单、审批记录和被引用次数。',
      actions: `<a class="btn" href="#/activity">看引用事件</a>`,
    })}

    <section class="section tight">
      <form class="search-bar" id="mem-search" role="search">
        <input class="input" id="mem-q" type="search" placeholder="搜一条经验，例如：VPN 证书 / 共享盘权限" value="${esc(query)}" aria-label="搜索组织记忆" />
        <button class="btn" type="submit">搜索</button>
      </form>
      <p class="small muted" style="margin-top:8px">检索是本地全文匹配（中英混合），按标题与正文的命中权重排序。换成向量检索只需替换检索模块，其它不用改。</p>
    </section>

    <section class="section tight">
      <div class="tabs" role="tablist">
        ${tabs.map(([v, l]) => `<button class="tab" role="tab" data-tab="${v}" aria-selected="${tab === v}">${l}${v === 'pending' && pendingCount ? ` · ${pendingCount}` : v === 'expired' && expiredCards.length ? ` · ${expiredCards.length}` : ''}</button>`).join('')}
      </div>
      ${expiredCards.length ? `<div class="notice" style="margin-top:12px"><div><strong>${expiredCards.length} 条已过期知识已退出试点检索。</strong> 请知识负责人复核来源与适用范围；不再适用的卡片可在这里停用。<button class="btn btn-sm" type="button" data-show-expired style="margin-left:8px">查看过期知识</button></div></div>` : ''}
      <div class="panel panel-body flush" style="margin-top:16px">
        <div class="memory-list">
          ${visibleCards.length ? visibleCards.map((c) => `<div class="memory-item">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
              <h3>K${c.id} · ${esc(c.title)}</h3>
              <div class="chip-row" style="margin:0">
                ${scopeChip(c.scope)}
                ${kindChip(c.source_kind)}
                <span class="chip status-${c.superseded_by_card_id ? 'in_progress' : c.status === 'published' ? 'resolved' : c.status === 'rejected' || c.status === 'retired' ? 'escalated' : 'in_progress'}">${esc(c.superseded_by_card_id ? CARD_STATUS_LABEL.superseded : CARD_STATUS_LABEL[c.status] || c.status)}</span>
                ${c.status === 'published' && c.valid_until && isKnowledgeExpired(c.valid_until) ? `<span class="chip status-escalated">${c.scope === 'pilot' && c.pilot_approved ? '已过期 · 不再检索' : '有效期已过 · 请复核'}</span>` : ''}
                ${c.pilot_approved ? `<span class="chip scope-pilot">${c.status === 'retired' ? '曾批准用于试点' : '已批准用于试点'}</span>` : ''}
              </div>
            </div>
            <div class="memory-body">${esc(c.content)}</div>
            ${c.source_kind === 'policy' || c.source_kind === 'guide' ? `<p class="small muted" style="margin-top:6px">来源：${renderSourceRefs(c.source_ref)}<br>适用范围：${esc(c.applies_to || '未填')} · 审批主体：${esc(c.approval_body || '未填')} · 知识负责人：${esc(c.knowledge_owner || '未填')}${c.valid_until ? ` · 有效期至 ${esc(c.valid_until)}` : ''}</p>` : ''}
            <div class="memory-foot">
              <span>标签 ${esc(c.tags || '无')}</span>
              ${c.source_title ? `<span>来源 #${c.source_ticket_id} ${esc(c.source_title)}</span>` : '<span>来源：人工录入 / 演示数据</span>'}
              <span>被引用 ${c.uses.length} 次${(() => { const adoptedN = (c.uses || []).filter((u) => u.adopted === 1).length; const helpfulN = (c.uses || []).filter((u) => u.helpful === 1).length; const notHelpfulN = (c.uses || []).filter((u) => u.helpful === 0).length; const parts = []; if (adoptedN) parts.push(`审核采纳 ${adoptedN}`); if (helpfulN) parts.push(`有帮助 ${helpfulN}`); if (notHelpfulN) parts.push(`没帮助 ${notHelpfulN}`); return parts.length ? `（${parts.join(' · ')}）` : ''; })()}</span>
              <span>版本 v${c.version}</span>
              <span>更新 ${fmtTime(c.updated_at)}</span>
            </div>
            ${c.reviews?.length ? `<p class="small muted" style="margin-top:6px">最近审批：${esc(CARD_REVIEW_ACTION_LABEL[c.reviews[0].action] || c.reviews[0].action)} · ${esc(c.reviews[0].reviewer)}${c.reviews[0].note ? ` · ${esc(c.reviews[0].note)}` : ''}</p>` : ''}
            ${c.supersedes_card_id ? `<p class="small muted" style="margin-top:6px">修订候选：基于 K${c.supersedes_card_id} v${c.supersedes_version}。发布前仍由原版本提供检索；发布后原版本会退出检索并保留历史。</p>` : ''}
            ${c.superseded_by_card_id ? '<p class="small muted" style="margin-top:6px">此版本已保留为历史记录，不再进入组织记忆检索。</p>' : ''}
            ${c.status === 'retired' ? '<p class="small muted" style="margin-top:6px">此卡已停止用于后续检索；既有运行与引用历史仍保留。</p>' : ''}
            ${!readOnlyMember && c.status === 'pending' ? `<div class="memory-actions">
              <button class="btn btn-sm" type="button" data-edit-card="${c.id}">编辑草稿</button>
              <button class="btn btn-sm btn-primary" type="button" data-publish="${c.id}">发布</button>
              <button class="btn btn-sm btn-danger" type="button" data-reject="${c.id}">驳回</button>
            </div>` : ''}
            ${!readOnlyMember && lastState?.cardRevisionWorkflow >= 1 && c.status === 'published' && c.scope === 'sample' && !c.superseded_by_card_id ? `<div class="memory-actions">
              <button class="btn btn-sm" type="button" data-revise-card="${c.id}">基于此版本创建待审核修订</button>
              <span class="small muted">新稿审核通过前，当前版本继续生效。</span>
            </div>` : ''}
            ${!readOnlyMember && c.status === 'published' && c.scope === 'pilot' && !c.pilot_approved ? `<div class="memory-actions">
              <button class="btn btn-sm" type="button" data-pilot-approve="${c.id}">批准用于真实试点检索…</button>
              <span class="small muted">当前不进入 pilot 检索</span>
            </div>` : c.status === 'published' && c.scope === 'sample' ? `<p class="small muted">模拟样本卡片不能升级进入真实试点检索。</p>` : ''}
            ${!readOnlyMember && c.status === 'published' && !c.superseded_by_card_id ? `<div class="memory-actions">
              <button class="btn btn-sm btn-danger" type="button" data-retire-card="${c.id}">停用此知识</button>
              <span class="small muted">立即退出后续检索，保留历史引用</span>
            </div>` : ''}
          </div>`).join('') : `<div class="panel-body"><div class="empty">
            <h3>这个筛选下没有卡片</h3>
            <p>${tab === 'expired' ? '当前没有已过期的试点知识。' : query ? '换个关键词试试，或者去「全部」看看有没有相近的经验。' : '去问题单里把已解决的问题沉淀成知识卡片，它才会出现在这里。'}</p>
            <a class="btn" href="#/">回到工作台</a>
          </div></div>`}
        </div>
      </div>
    </section>

    <section class="section tight" aria-labelledby="cases-title">
      <div class="section-head">
        <h2 id="cases-title">已解决案例</h2>
        <p class="sub">组织模式除了卡片，也会检索这些案例，用来说明「上次是怎么处理的」。</p>
      </div>
      <div class="panel panel-body flush">
        <table class="table">
          <thead><tr><th>案例</th><th>类别</th><th>结果</th><th class="right">解决时间</th></tr></thead>
          <tbody>
            ${data.cases.length ? data.cases.map((c) => `<tr>
              <td class="title-cell"><a href="#/t/${c.id}">${esc(c.title)}</a><div class="row-meta">#${c.id}</div></td>
              <td class="nowrap">${esc(c.category || '未分类')}</td>
              <td class="small">${esc(c.outcome || '—')}${c.note ? ` · ${esc(c.note)}` : ''}</td>
              <td class="right row-meta nowrap">${fmtTime(c.resolvedAt)}</td>
            </tr>`).join('') : '<tr><td colspan="4" class="muted small">还没有已解决的案例。</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  `;

  document.getElementById('mem-search').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = document.getElementById('mem-q').value.trim();
    renderMemory(q).catch((err) => toast(err.message, 'error'));
  });

  view.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      renderMemory.tab = btn.dataset.tab;
      renderMemory(document.getElementById('mem-q').value.trim()).catch((err) => toast(err.message, 'error'));
    });
  });
  view.querySelector('[data-show-expired]')?.addEventListener('click', () => {
    renderMemory.tab = 'expired';
    renderMemory(document.getElementById('mem-q').value.trim()).catch((err) => toast(err.message, 'error'));
  });

  const approve = (cardId, action) => {
    openPromptDialog({
      title: action === 'publish' ? `发布知识卡片 K${cardId}` : `驳回知识卡片 K${cardId}`,
      hint: action === 'publish'
        ? '发布后，下一张相似问题单的组织模式就能检索到这条，并记录引用。'
        : '驳回原因会留在审批记录里，之后可以追溯为什么没有采用这条经验。',
      label: action === 'publish' ? '发布说明（可留空）' : '驳回原因',
      submitLabel: action === 'publish' ? '确认发布' : '确认驳回',
      danger: action === 'reject',
      onSubmit: async (note, reviewer) => {
        await api(`/api/cards/${cardId}/review`, { method: 'POST', body: JSON.stringify({ action, note, reviewer }) });
        toast(action === 'publish' ? `K${cardId} 已发布，组织模式下次就能引用` : `K${cardId} 已驳回`);
        await loadPendingCount();
        await renderMemory(document.getElementById('mem-q')?.value.trim() || '');
      },
    });
  };
  view.querySelectorAll('[data-publish]').forEach((b) => b.addEventListener('click', () => approve(Number(b.dataset.publish), 'publish')));
  view.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', () => approve(Number(b.dataset.reject), 'reject')));
  view.querySelectorAll('[data-retire-card]').forEach((b) => b.addEventListener('click', () => {
    const cardId = Number(b.dataset.retireCard);
    openPromptDialog({
      title: `停用知识卡片 K${cardId}`,
      hint: '停用后这条知识立即退出后续检索。旧运行、引用和审批记录会保留，停用原因会记入团队事件。',
      label: '停用原因（必填）',
      submitLabel: '确认停用',
      danger: true,
      requireNote: true,
      onSubmit: async (note, reviewer) => {
        await api(`/api/cards/${cardId}/retire`, {
          method: 'POST',
          body: JSON.stringify({ note, reviewer }),
        });
        toast(`K${cardId} 已停用，后续检索不再使用`);
        renderMemory.tab = 'retired';
        await renderMemory(document.getElementById('mem-q')?.value.trim() || '');
      },
    });
  }));
  view.querySelectorAll('[data-edit-card]').forEach((b) => b.addEventListener('click', () => {
    const cardId = Number(b.dataset.editCard);
    const card = data.cards.find((candidate) => candidate.id === cardId);
    if (!card) return;
    openCardDraftEditDialog(card, async ({ content, note, editor }) => {
      await api(`/api/cards/${cardId}/draft-edit`, {
        method: 'POST',
        body: JSON.stringify({ content, note, editor }),
      });
      toast(`K${cardId} 草稿已保存，仍待审核；尚未发布`);
      await loadPendingCount();
      await renderMemory(document.getElementById('mem-q')?.value.trim() || '');
    });
  }));
  view.querySelectorAll('[data-revise-card]').forEach((b) => b.addEventListener('click', () => {
    const cardId = Number(b.dataset.reviseCard);
    const card = data.cards.find((candidate) => candidate.id === cardId);
    if (!card) return;
    openCardRevisionDialog(card, async ({ content, note, sourceRef, appliesTo }) => {
      const result = await api(`/api/cards/${cardId}/revision-draft`, {
        method: 'POST',
        body: JSON.stringify({ content, note, sourceRef, appliesTo }),
      });
      toast(`已建立 K${result.card.supersedes_card_id} 的待审核修订稿；${result.card.title} 当前版本仍在生效`);
      renderMemory.tab = 'pending';
      await loadPendingCount();
      await renderMemory();
    });
  }));
  view.querySelectorAll('[data-pilot-approve]').forEach((b) => b.addEventListener('click', () => {
    const cardId = Number(b.dataset.pilotApprove);
    openPilotApproveDialog(cardId, async (meta) => {
      await api(`/api/cards/${cardId}/pilot-approve`, { method: 'POST', body: JSON.stringify(meta) });
      toast(`K${cardId} 已批准用于真实试点检索`);
      await renderMemory(document.getElementById('mem-q')?.value.trim() || '');
    });
  }));
  loadPendingCount();
}

/* ---------------- 事件 ---------------- */

async function renderActivity() {
  setNav('activity');
  const [state, eventsRes] = await Promise.all([lastState ? Promise.resolve(lastState) : loadState(), api('/api/events?limit=80')]);
  const events = eventsRes.events;
  view.innerHTML = `
    ${pageHead({
      pageContext: '事件流',
      title: '谁在什么时候做了什么',
      lead: '智能体运行、人工审核、知识发布、引用，全部落在同一条时间线上。没有这条线，「组织学到了什么」就只能靠回忆。',
      actions: '<a class="btn" href="#/">回到工作台</a>',
    })}
    <div class="panel panel-body flush section tight">
      <table class="table">
        <thead><tr><th>时间</th><th>事件</th><th>执行者</th><th>内容</th><th>问题单</th></tr></thead>
        <tbody>
          ${events.map((e) => `<tr>
            <td class="nowrap row-meta">${fmtTime(e.created_at)}</td>
            <td class="nowrap">${esc(KIND_LABEL[e.kind] || e.kind)}</td>
            <td class="nowrap small">${esc(e.actor)}</td>
            <td>${esc(eventSummary(e))}</td>
            <td class="nowrap small">${e.ticket_id ? `<a href="#/t/${e.ticket_id}">#${e.ticket_id}</a>` : '<span class="muted">—</span>'}</td>
          </tr>`).join('') || '<tr><td colspan="5" class="muted small">还没有事件。</td></tr>'}
        </tbody>
      </table>
    </div>
    <p class="small muted" style="margin-top:12px">共 ${events.length} 条，按时间倒序。${state ? `组织：${esc(state.org.name)}` : ''}</p>
  `;
}

/* ---------------- 设置 ---------------- */

async function renderSettings() {
  setNav('settings');
  const state = await loadState();
  if (!state) return;
  const model = state.model;
  const activeHandlerCount = (state.members || []).filter((member) => (
    member.status === 'active' && ['admin', 'member'].includes(member.role)
  )).length;
  const firstUseSteps = [
    {
      title: '确认模型连接已配置',
      status: model.configured ? '已配置' : '待配置',
      complete: model.configured,
      detail: model.configured
        ? `当前端点：${model.baseUrl}。系统只确认配置存在；不会在此页发送请求来验证模型是否可用。`
        : '请由部署管理员在服务端配置模型地址、名称和密钥；密钥不在浏览器填写。',
      href: '#model-title',
      action: '查看连接信息',
    },
    {
      title: '启用至少两位可处理任务的成员账号',
      status: activeHandlerCount >= 2 ? '已启用' : '待邀请同事',
      complete: activeHandlerCount >= 2,
      detail: `当前有 ${activeHandlerCount} 个已启用的管理员或成员账号。账号数量不能证明另一位成员已经独立登录。`,
      href: '#members-title',
      action: '团队成员设置',
      adminOnly: true,
    },
    {
      title: '由团队负责人确认数据使用规则',
      status: '需负责人确认',
      complete: false,
      detail: '确认哪些任务内容可发送到上方模型服务、谁授权、怎样脱敏、保留多久以及何时转交人工。系统不会自动检查或记录这项授权决定。',
      href: '#ai-data-title',
      action: '查看模型数据流',
    },
    {
      title: '备份工作区数据并保持新鲜',
      status: (() => {
        const b = state.backupFreshness;
        if (!b?.configured) return '未配置备份目录';
        if (b.ageDays === null) return '从未成功备份';
        return `${b.ageDays} 天前备份`;
      })(),
      complete: (() => {
        const b = state.backupFreshness;
        return Boolean(b?.configured && b.ageDays !== null && b.stale === false);
      })(),
      detail: '部署管理员在服务端用 `node scripts/workspace-data.js backup <DATA_DIR> <BACKUP_DIR>` 创建备份；配置 BACKUP_DIR 后这里显示最近成功备份距今天数，超过 7 天会提醒。备份不含登录会话；恢复后成员需重新登录。',
      href: '#backup-title',
      action: '查看备份状态',
      adminOnly: true,
    },
  ];
  view.innerHTML = `
    ${pageHead({
      pageContext: '设置',
      title: '模型、智能体与数据',
      lead: productMode
        ? '模型与登录配置由部署管理员在服务端维护；成员不能在浏览器里看到密钥。'
        : '模型连接只从服务端环境变量读取，密钥不会进入浏览器，也不会写进数据库。',
    })}

    ${productMode ? `
      ${(() => {
        const b = state.backupFreshness;
        if (!b?.configured || b.stale === false) return '';
        return `<section class="section tight" aria-labelledby="backup-title">
          <div class="notice" style="border-left:4px solid var(--warning,#b45309)"><div>
            <strong id="backup-title">备份提醒。</strong>
            ${b.ageDays === null
              ? '尚未发现任何成功备份记录；请由部署管理员立即创建第一次备份（workspace-data.js backup）。'
              : `距上次成功备份已 ${b.ageDays} 天（超过 7 天提醒阈值${b.note ? `；${esc(b.note)}` : ''}）；请由部署管理员创建新备份。`}
            备份仅保存在服务端配置的 BACKUP_DIR，成员无需操作。
          </div></div>
        </section>`;
      })()}
      <section class="section tight onboarding-panel" aria-labelledby="first-use-setup-title">
        <div class="panel panel-body">
          <div class="section-head">
            <h2 id="first-use-setup-title">新团队开始前</h2>
            <p class="sub">先看清连接状态、成员准备和数据边界，再录入第一条真实任务。</p>
          </div>
          <ol class="onboarding-steps">
            ${firstUseSteps.map((step) => `<li class="onboarding-step ${step.complete ? 'is-complete' : ''}">
              <div class="onboarding-step-head"><strong>${esc(step.title)}</strong><span class="chip ${step.complete ? 'status-resolved' : 'status-open'}">${esc(step.status)}</span></div>
              <span>${esc(step.detail)}</span>
              ${(!step.adminOnly || currentUser?.role === 'admin') ? `<a class="small" href="${esc(step.href)}">${esc(step.action)}</a>` : ''}
            </li>`).join('')}
          </ol>
          <p class="small muted">这是一份准备清单，不是授权表或安全认证。真实工单仍须由团队负责人确认授权和脱敏后再提交。</p>
        </div>
      </section>` : ''}

    ${productMode && currentUser?.role === 'admin' ? `
      <section class="section tight" aria-labelledby="workspace-profile-title">
        <div class="section-head">
          <h2 id="workspace-profile-title">团队资料</h2>
          <p class="sub">管理员可修改工作区显示名称。</p>
        </div>
        <div class="panel panel-body">
          <form id="workspace-profile-form" class="form-grid">
            <div class="form-row">
              <label for="workspace-display-name">团队显示名称</label>
              <input class="input" id="workspace-display-name" name="name" value="${esc(state.org.name)}" required maxlength="80" />
            </div>
            <div class="button-row">
              <button class="btn btn-primary" type="submit">保存团队名称</button>
              <span id="workspace-profile-result" class="small muted" aria-live="polite"></span>
            </div>
          </form>
          <p class="small muted" style="margin:12px 0 0">名称保存在本团队数据库中，并显示在登录页和工作区。它不会改变域名、身份提供方、数据库位置或团队数据隔离范围；管理员导出也会包含此名称。</p>
        </div>
      </section>` : ''}

    <section class="section tight" aria-labelledby="model-title">
      <div class="section-head"><h2 id="model-title">模型连接</h2><p class="sub">${esc(model.note)}</p></div>
      <div class="panel panel-body">
        <div class="kv">
          <div>当前状态</div><div><span class="dot ${model.mode === 'live' ? 'live' : 'demo'}" style="background:${model.mode === 'live' ? 'var(--ok)' : 'var(--warn)'}"></span>${esc(model.modeLabel)}</div>
          <div>端点</div><div><span class="code">${esc(model.baseUrl)}</span></div>
          <div>模型名</div><div><span class="code">${esc(model.model)}</span></div>
          <div>智能体角色</div><div>${esc(state.agent.role)} · 提示词版本 <span class="code">${esc(state.agent.promptVersion)}</span></div>
        </div>
        ${productMode && currentUser?.role === 'admin' ? `
          <div class="button-row" style="margin-top:14px">
            <button class="btn" type="button" id="model-connection-check">测试模型连接</button>
            <span class="small muted">点击后才发送固定虚构请求；不含工单或团队知识。服务方可能按请求计费。</span>
          </div>
          <p id="model-connection-result" class="small muted" style="margin-top:8px" aria-live="polite"></p>` : ''}
        ${productMode
          ? `<p class="small muted" style="margin-top:16px">产品模式从服务部署环境读取配置。本实例启动时已通过必需项检查；此页不显示任何密钥。修改配置后需重启服务。</p>`
          : `<p class="small muted" style="margin-top:16px">启用真实模型：在项目根目录建 <span class="code">.env</span>，写入下面三项，然后重启服务。</p>`}
        <div class="panel panel-body" style="background:var(--surface-sunken);margin-top:10px">
          <div class="kv">
            <div>MODEL_API_KEY</div><div><span class="code">${model.previewOnly ? '预览虚构状态（无实际密钥）' : model.configured ? '已读取（不显示）' : '未设置'}</span></div>
            <div>MODEL_BASE_URL</div><div><span class="code">${esc(model.baseUrl)}</span></div>
            <div>MODEL_NAME</div><div><span class="code">${esc(model.model)}</span></div>
          <div>单次回复上限</div><div><span class="code">${Number(model.maxOutputTokens) || 4096}</span> tokens（可在服务端用 <span class="code">MODEL_MAX_OUTPUT_TOKENS</span> 设置，范围 1024–8192；默认 4096）</div>
          ${productMode ? `<div>团队请求额度</div><div id="model-call-usage">${Number(state.modelUsage?.used) || 0} / ${Number(model.maxCallsPerHour) || 60} 次（滚动 1 小时；含所有成员的建议生成和连接检查，失败请求也计数）</div>` : ''}
            ${productMode
              ? `<div>DATA_DIR</div><div>必须显式指定独立产品数据目录，不能使用项目默认演示目录</div>
                 <div>团队登录</div><div><span class="code">OIDC_ISSUER</span>、<span class="code">OIDC_CLIENT_ID</span>、<span class="code">OIDC_CLIENT_SECRET</span>、<span class="code">OIDC_BOOTSTRAP_ADMIN_EMAIL</span> 均为必需配置，值不在此页显示</div>
                 <div>外部地址</div><div><span class="code">APP_PUBLIC_URL</span> 必须使用 HTTPS，并与身份提供方登记的回调地址一致</div>`
              : `<div>PORT / DATA_DIR</div><div>可选，默认 <span class="code">4173</span> 与 <span class="code">./data</span></div>`}
          </div>
        </div>
      </div>
    </section>

    <section class="section tight" aria-labelledby="rule-title">
      <div class="section-head"><h2 id="rule-title">智能体能做什么，不能做什么</h2></div>
      <div class="panel panel-body">
        <div class="kv">
          <div>可以自主执行</div><div>读取当前问题单；检索已发布知识与已解决案例；草拟回复、下一步动作、交接摘要；起草知识卡片。</div>
          <div>必须人工确认</div><div>对客回复、正式分派、关闭问题单、发布或修改共享知识。这些动作没有智能体直连入口。</div>
          <div>审核者怎么记</div><div>${productMode ? '审核、编辑和批准记录自动关联当前登录成员；系统保留成员编号以便追溯。' : '审核者姓名由操作者在每次审核时手工填写，仅用于归属追溯；系统不代填默认姓名，也不把这段记录当作登录身份认证或电子签名。'}</div>
          <div>${productMode ? '建议生成方式' : '两种模式的唯一差异'}</div><div>${productMode ? '产品模式只生成组织建议：检索团队已批准知识，生成建议并等待成员审核。' : `只有组织模式能调用 <span class="code">search_approved_memory</span> 与 <span class="code">prepare_handoff</span>；模型、提示词版本、输出结构完全一致。`}</div>
          <div>${productMode ? '模型不可用时' : '演示模式'}</div><div>${productMode ? '请求会明确失败，不会保存演示生成的内容冒充真实模型建议。' : '未配置密钥时用本地规则生成结果，界面与运行记录都标注为演示生成，不冒充模型输出。'}</div>
        </div>
      </div>
    </section>

    <section class="section tight" aria-labelledby="ai-data-title">
      <div class="section-head"><h2 id="ai-data-title">生成建议时，哪些内容会发给模型？</h2><p class="sub">请求由本应用服务端发起，发往上方显示的模型端点；浏览器不会直接连接模型。</p></div>
      <div class="panel panel-body">
        <div class="kv">
          <div>主模型请求</div><div>${model.previewOnly
            ? '本机界面预览：下面按“已配置模型”的代码路径展示将发送的字段，但使用虚构端点，不会实际发送请求。提示词包含工单编号、标题、描述、类别和紧急度；组织建议还会带上本团队检索到的最多 4 条知识或已解决案例摘录，以及来源标题、类型、适用范围等信息。'
            : model.mode === 'live'
              ? `当前已配置模型。提示词包含工单编号、标题、描述、类别和紧急度；组织建议还会带上本团队检索到的最多 4 条知识或已解决案例摘录，以及来源标题、类型、适用范围等信息。`
            : '当前是本地演示模式：由应用内规则生成，不会向上方模型端点发送请求。'}</div>
          <div>不作为提示词字段</div><div>录单时填写的数据来源、工作区存储确认人、模型发送确认人、脱敏状态和成员登录资料不会作为主模型提示词字段发送；但工单标题、描述等文字本身可能包含个人信息，系统不会自动识别或清除。</div>
          <div>真实产品工单</div><div>${productMode
            ? '服务端要求来源、工作区存储确认人和模型发送确认人记录齐全，且脱敏状态为“已脱敏”或“无需脱敏”；发送确认还绑定到登记时的模型服务端点和模型名称，目标变化后会拦截并要求负责人重新确认。管理员可清除记录以撤销；所有姓名和脱敏状态都是手工记录，系统不会验证授权真实性或检查脱敏是否充分。端点与名称相同也不代表服务协议内容没有改变。'
            : '演示站不代表真实团队数据流程。产品模式下，服务端会拦截“部分脱敏”或“未声明”的真实工单。'}</div>
          <div>模型提供方</div><div>实际接收方由上方模型端点决定。系统无法从这里确认该提供方如何保存、使用或删除请求内容；管理员应先核对服务协议和团队的数据规则，再录入真实工单。</div>
          <div>单次输出限制</div><div>主模型每次回复最多生成 ${Number(model.maxOutputTokens) || 4096} tokens。它限制单次输出长度，不是总费用上限；输入长度及服务方计费仍需另行管理。</div>
          ${productMode ? '<div>团队请求额度</div><div>产品模式按本团队最近 1 小时限制模型请求次数，连接检查和失败请求都会计数。请求次数限制不是金额限额；模型服务方单价和输入 token 仍需管理员关注。</div>' : ''}
          ${productMode ? '<div>连接检查</div><div>管理员点击“测试模型连接”时，服务端只发送固定的虚构 JSON 指令；不带工单或团队知识。用量审计只记录操作者、时间和请求用途，不保存提示词、回复或密钥。模型服务方仍可能按请求计费。</div>' : ''}
          <div>TypeSafe / JEV 旁路</div><div>${productMode
            ? '当前产品模式不会把真实工单发送给 TypeSafe / JEV。'
            : model.sampleShadowCheckEnabled
              ? '当前已启用，仅在演示样本的组织模式且找到候选记忆时运行；会把样本工单标题、描述、类别和候选记忆摘录发送到 TypeSafe System One（api.typesafe.ai）。结果只作影子比较，不改变主模型输入或检索结果。'
              : '当前未启用。只有在演示模式显式配置 TypeSafe 密钥和 shadow 开关后，才会对找到候选记忆的演示样本发送影子判断；不会处理真实产品工单。'}</div>
        </div>
        <p class="small muted" style="margin:14px 0 0">提交工单前，请先确认数据来源与授权，并清除不需要发送的个人信息。标记“已脱敏”不会自动改写工单正文。</p>
      </div>
    </section>

    <section class="section tight" aria-labelledby="data-title">
      <div class="section-head"><h2 id="data-title">数据</h2><p class="sub">${productMode ? '每个团队部署使用独立数据库目录；产品模式拒绝加载包含演示工单或知识卡的数据。' : '所有数据在本地 SQLite 单文件里，删除即清空。首次启动会载入虚构演示数据。'}</p></div>
      <div class="panel panel-body">
        <div class="kv">
          <div>问题单</div><div class="num">${state.metrics.tickets.total}</div>
          <div>运行记录</div><div class="num">${state.metrics.modes.reduce((a, m) => a + m.runs, 0)}</div>
          <div>已发布知识</div><div class="num">${state.metrics.knowledge.published}</div>
          <div>数据文件</div><div>${productMode ? '由部署配置 DATA_DIR 指定（此实例独立）' : '<span class="code">data/app.db</span>'}</div>
        </div>
      </div>
    </section>

    ${productMode && currentUser?.role === 'admin' ? `
      <section class="section tight" aria-labelledby="members-title">
        <div class="section-head"><h2 id="members-title">团队成员</h2><p class="sub">只允许受邀邮箱登录；审核者与操作者由登录身份自动记录。</p></div>
        <div class="panel panel-body">
          <form id="member-invite-form" class="form-grid" style="align-items:end">
            <div class="form-row"><label for="invite-email">邀请邮箱</label><input class="input" id="invite-email" type="email" required maxlength="200" placeholder="teammate@example.com" /></div>
            <div class="form-row"><label for="invite-role">初始角色</label><select class="select" id="invite-role"><option value="member">成员</option><option value="viewer">只读成员</option><option value="admin">管理员</option></select></div>
            <button class="btn btn-primary" type="submit">创建邀请</button>
          </form>
          <p class="small muted" style="margin:10px 0 16px">邀请会在 7 天后过期。把登录地址发给对方，并确认其登录邮箱与受邀邮箱一致；系统不会代发邮件。</p>
          <div id="member-list"><p class="small muted">正在读取成员…</p></div>
          <div id="invite-result" class="small" style="margin-top:10px"></div>
        </div>
      </section>` : ''}

    ${productMode && currentUser?.role === 'admin' ? `
      <section class="section tight" aria-labelledby="workspace-data-title">
        <div class="section-head"><h2 id="workspace-data-title">团队数据</h2><p class="sub">导出任务、AI 建议、审核、共享知识、事件和站内反馈，留作团队存档或迁移。</p></div>
        <div class="panel panel-body">
          <p class="small muted">导出文件可能包含工单描述和处理记录，请按团队的数据管理规则妥善保存。登录会话和身份提供方密钥不会包含在文件中。</p>
          <button class="btn" type="button" id="workspace-export" style="margin-top:12px">导出团队数据（JSON）</button>
          <p id="workspace-export-result" class="small muted" style="margin-top:8px" aria-live="polite"></p>
        </div>
      </section>` : ''}

    ${productMode ? `
      <section class="section tight" aria-labelledby="feedback-title">
        <div class="section-head"><h2 id="feedback-title">使用反馈</h2><p class="sub">把产品问题或改进建议留给本团队管理员处理；管理员需进入此页查看，当前不发送邮件通知。</p></div>
        <div class="panel panel-body">
          <form id="feedback-form" class="form-grid">
            <div class="form-row">
              <label for="feedback-category">反馈类型</label>
              <select class="select" id="feedback-category" required>
                <option value="bug">遇到问题</option><option value="idea">改进建议</option><option value="other">其他</option>
              </select>
            </div>
            <div class="form-row">
              <label for="feedback-message">发生了什么 / 希望怎样改</label>
              <textarea class="textarea" id="feedback-message" required minlength="10" maxlength="2000" rows="4" placeholder="尽量写清楚你做了什么、看到了什么、预期是什么。"></textarea>
            </div>
            <div class="button-row">
              <button class="btn btn-primary" type="submit">提交反馈</button>
              <span id="feedback-submit-result" class="small muted" aria-live="polite"></span>
            </div>
          </form>
          <p class="small muted" style="margin-top:12px">反馈只保存在这个团队工作区，具体内容仅提交者和管理员可见；类别、提交成员、页面位置与状态变化会进入团队事件流，正文不会写入事件流。不会自动附加工单正文、AI 答案或浏览记录，也不会发送给开发者。状态只表示处理进度，不代表管理员已回复。请不要写入密码、密钥或客户个人信息。</p>
          <div id="feedback-own-list" style="margin-top:18px"><p class="small muted">正在读取你的反馈…（最近 50 条）</p></div>
          ${currentUser?.role === 'admin' ? `<div style="margin-top:24px;padding-top:18px;border-top:1px solid var(--border)">
            <h3 style="font-size:19px;margin-bottom:4px">团队反馈收件箱</h3>
            <p class="small muted" style="margin-bottom:10px">最近 100 条，按待处理和处理中优先显示；状态变更会记录管理员身份。</p>
            <div id="feedback-inbox"><p class="small muted">正在读取团队反馈…</p></div>
          </div>` : ''}
        </div>
      </section>` : ''}

    ${!productMode ? `<section class="section tight">
      <div class="panel danger-zone">
        <div class="panel-head"><h2>危险区</h2></div>
        <div class="panel-body">
          <p class="small" style="margin-bottom:12px">重置会删掉所有问题单、运行记录、审核、知识卡片与事件，然后重新载入演示数据。这个动作不可撤销。</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <input class="input" id="reset-confirm" placeholder="输入 重置 以确认" aria-label="输入重置以确认" />
            <button class="btn btn-danger" type="button" id="reset-btn">重置演示数据</button>
          </div>
        </div>
      </div>
    </section>` : ''}
  `;

  document.getElementById('reset-btn')?.addEventListener('click', async () => {
    if (document.getElementById('reset-confirm').value.trim() !== '重置') {
      toast('请先在输入框里输入「重置」', 'error');
      return;
    }
    try {
      await api('/api/admin/reset', { method: 'POST' });
      toast('已重置为演示数据');
      await loadState();
      location.hash = '#/';
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  if (productMode && currentUser?.role === 'admin') {
    const profileForm = document.getElementById('workspace-profile-form');
    profileForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = document.getElementById('workspace-display-name');
      const result = document.getElementById('workspace-profile-result');
      const button = profileForm.querySelector('[type="submit"]');
      button.disabled = true;
      result.textContent = '正在保存…';
      try {
        const saved = await api('/api/admin/workspace-profile', {
          method: 'PATCH',
          body: JSON.stringify({ name: input.value }),
        });
        input.value = saved.org.name;
        state.org.name = saved.org.name;
        const brand = document.getElementById('brand-name');
        if (brand) {
          brand.textContent = saved.org.name;
          brand.title = saved.org.name;
        }
        result.textContent = saved.changed ? '团队显示名称已保存。' : '名称未变化。';
      } catch (error) {
        result.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });

    const modelCheckButton = document.getElementById('model-connection-check');
    const modelCheckResult = document.getElementById('model-connection-result');
    modelCheckButton?.addEventListener('click', async () => {
      modelCheckButton.disabled = true;
      modelCheckResult.textContent = '正在用固定虚构内容检查模型连接…';
      modelCheckResult.className = 'small muted';
      try {
        const result = await api('/api/admin/model-check', { method: 'POST', body: '{}' });
        modelCheckResult.textContent = `连接成功 · ${result.model} · ${result.latencyMs} ms。请求内容没有保存。`;
        modelCheckResult.className = 'small';
        modelCheckResult.style.color = 'var(--ok)';
      } catch (error) {
        modelCheckResult.textContent = `连接检查失败：${error.message}`;
        modelCheckResult.className = 'small';
        modelCheckResult.style.color = 'var(--danger)';
      } finally {
        modelCheckButton.disabled = false;
        try {
          const latest = await api('/api/state');
          const usage = latest.modelUsage;
          const usageEl = document.getElementById('model-call-usage');
          if (usage && usageEl) {
            usageEl.textContent = `${Number(usage.used) || 0} / ${Number(usage.limit) || 60} 次（滚动 1 小时；含所有成员的建议生成和连接检查，失败请求也计数）`;
          }
        } catch { /* 当前结果仍保留；刷新额度失败时可手动刷新页面 */ }
      }
    });

    const form = document.getElementById('member-invite-form');
    const list = document.getElementById('member-list');
    const loadMembers = async () => {
      const data = await api('/api/members');
      const roles = { admin: '管理员', member: '成员', viewer: '只读成员' };
      const statuses = { active: '已加入', invited: '待接受邀请', disabled: '已停用' };
      list.innerHTML = data.members.length ? `<table class="table"><thead><tr><th>成员</th><th>角色</th><th>状态</th><th>操作</th></tr></thead><tbody>${data.members.map((member) => `<tr>
        <td>${esc(member.name)}<div class="small muted">${esc(member.email)}</div></td>
        <td><select class="select" data-member-role="${member.id}" aria-label="${esc(member.email)} 的角色">${Object.entries(roles).map(([key, label]) => `<option value="${key}" ${member.role === key ? 'selected' : ''}>${label}</option>`).join('')}</select></td>
        <td>${statuses[member.status] || esc(member.status)}${member.invite_expires_at && member.status === 'invited' ? `<div class="small muted">有效至 ${fmtTime(member.invite_expires_at)}</div>` : ''}</td>
        <td><button class="btn btn-sm" type="button" data-member-save="${member.id}">保存角色</button>${member.status === 'active' || member.status === 'disabled' ? `<button class="btn btn-sm" type="button" data-member-toggle="${member.id}" data-next-status="${member.status === 'active' ? 'disabled' : 'active'}">${member.status === 'active' ? '停用' : '重新启用'}</button>` : ''}</td>
      </tr>`).join('')}</tbody></table>` : '<p class="small muted">当前没有成员记录。</p>';
    };
    try {
      await loadMembers();
    } catch (error) {
      list.innerHTML = `<p class="small muted">成员列表暂时无法载入：${esc(error.message)}。其他设置仍可查看。</p>`;
    }
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = document.getElementById('invite-email').value.trim();
      const role = document.getElementById('invite-role').value;
      const result = document.getElementById('invite-result');
      let invite;
      try {
        invite = await api('/api/members/invites', { method: 'POST', body: JSON.stringify({ email, role }) });
      } catch (error) {
        result.textContent = error.message;
        return;
      }
      const roleLabels = { admin: '管理员', member: '成员', viewer: '只读成员' };
      const workspaceName = authStatus?.organization || '团队工作区';
      const inviteText = `你好，你已受邀加入${workspaceName}，初始角色为${roleLabels[invite.member.role] || '成员'}。请在 7 天内打开团队登录页，并使用受邀邮箱 ${invite.member.email} 登录：\n${invite.loginUrl}\n\n如果邀请已过期或登录邮箱不匹配，请联系团队管理员。`;
      result.innerHTML = `已创建 ${esc(invite.member.email)} 的邀请，有效期 7 天。请通过团队批准的渠道发送登录说明。`;
      form.reset();
      openTextDialog('复制团队邀请消息', '请通过团队批准的渠道发送给受邀成员。系统不会代发邮件。', inviteText);
      try {
        await loadMembers();
      } catch (error) {
        toast(`邀请已创建；成员列表暂时无法刷新：${error.message}`, 'error');
      }
    });
    list.addEventListener('click', async (event) => {
      const save = event.target.closest('[data-member-save]');
      const toggle = event.target.closest('[data-member-toggle]');
      const memberId = save?.dataset.memberSave || toggle?.dataset.memberToggle;
      if (!memberId) return;
      try {
        const payload = save
          ? { role: list.querySelector(`[data-member-role="${memberId}"]`).value }
          : { status: toggle.dataset.nextStatus };
        await api(`/api/members/${memberId}`, { method: 'PATCH', body: JSON.stringify(payload) });
        toast('成员设置已保存');
        await loadMembers();
      } catch (error) {
        toast(error.message, 'error');
      }
    });

    document.getElementById('workspace-export')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const result = document.getElementById('workspace-export-result');
      button.disabled = true;
      result.textContent = '正在准备导出文件…';
      try {
        const response = await fetch('/api/admin/export', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          if (response.status === 401) {
            currentUser = null;
            loginRequired = true;
            renderLogin();
          }
          throw new Error(payload.error || `导出失败（${response.status}）`);
        }
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = `team-workspace-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        result.textContent = '导出完成；操作已记入团队事件。';
      } catch (error) {
        result.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
  }

  if (productMode) {
    const feedbackListHtml = (items, { admin = false } = {}) => items.length
      ? `<div class="table-wrap"><table class="table feedback-table">
          <thead><tr>${admin ? '<th>提交成员</th>' : ''}<th>反馈</th><th>状态</th><th>提交时间</th>${admin ? '<th>处理</th>' : ''}</tr></thead>
          <tbody>${items.map((item) => `<tr>
            ${admin ? `<td class="nowrap">${esc(item.reporter_name || item.reporter_email)}<div class="row-meta">${esc(item.reporter_email || '')}</div></td>` : ''}
            <td style="min-width:260px"><span class="chip">${esc(FEEDBACK_CATEGORY_LABEL[item.category] || '其他')}</span>
              <div class="feedback-message">${esc(item.message)}</div><div class="row-meta">页面：${esc(item.page || '未记录')}</div>
              ${admin && item.updated_by_name ? `<div class="row-meta">最近处理：${esc(item.updated_by_name)} · ${fmtTime(item.updated_at)}</div>` : ''}
            </td>
            <td><span class="chip feedback-${esc(item.status)}">${esc(FEEDBACK_STATUS_LABEL[item.status] || item.status)}</span></td>
            <td class="nowrap">${fmtTime(item.created_at)}</td>
            ${admin ? `<td class="nowrap"><select class="select" data-feedback-status="${item.id}" aria-label="反馈 ${item.id} 的状态">
              ${Object.entries(FEEDBACK_STATUS_LABEL).map(([value, label]) => `<option value="${value}" ${item.status === value ? 'selected' : ''}>${label}</option>`).join('')}
            </select><button class="btn btn-sm" type="button" data-feedback-save="${item.id}" style="margin-top:6px">保存</button></td>` : ''}
          </tr>`).join('')}</tbody>
        </table></div>`
      : '<p class="small muted">目前没有反馈记录。</p>';

    const ownList = document.getElementById('feedback-own-list');
    const inbox = document.getElementById('feedback-inbox');
    const loadOwnFeedback = async () => {
      const data = await api('/api/feedback');
      if (ownList) ownList.innerHTML = `<h3 style="font-size:17px;margin-bottom:8px">我提交的反馈</h3>${feedbackListHtml(data.feedback)}`;
    };
    const loadFeedbackInbox = async () => {
      if (!inbox) return;
      const data = await api('/api/admin/feedback');
      inbox.innerHTML = feedbackListHtml(data.feedback, { admin: true });
    };
    const reloadFeedback = async () => {
      await loadOwnFeedback();
      await loadFeedbackInbox();
    };
    const form = document.getElementById('feedback-form');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      const result = document.getElementById('feedback-submit-result');
      submit.disabled = true;
      result.textContent = '正在提交…';
      try {
        await api('/api/feedback', {
          method: 'POST',
          body: JSON.stringify({
            category: document.getElementById('feedback-category').value,
            message: document.getElementById('feedback-message').value,
            page: location.hash.split('?')[0].slice(0, 180),
          }),
        });
        form.reset();
        result.textContent = '已提交给本团队管理员。';
        try {
          await reloadFeedback();
        } catch (error) {
          toast(`反馈已提交，但列表刷新失败：${error.message}`, 'error');
        }
      } catch (error) {
        result.textContent = error.message;
      } finally {
        submit.disabled = false;
      }
    });
    inbox?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-feedback-save]');
      if (!button) return;
      const id = button.dataset.feedbackSave;
      button.disabled = true;
      try {
        const status = inbox.querySelector(`[data-feedback-status="${id}"]`).value;
        await api(`/api/admin/feedback/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
        toast('反馈状态已更新');
      } catch (error) {
        toast(error.message, 'error');
        button.disabled = false;
        return;
      }
      try {
        await reloadFeedback();
      } catch (error) {
        toast(`状态已更新，但列表刷新失败：${error.message}`, 'error');
      }
    });
    reloadFeedback().catch((error) => {
      if (ownList) ownList.innerHTML = `<p class="small" style="color:var(--danger)">${esc(error.message)}</p>`;
      if (inbox) inbox.innerHTML = '<p class="small muted">团队反馈收件箱无法载入。</p>';
    });
  }
}

/* ---------------- 真实试点闭环（只读） ---------------- */

async function renderPilotLoop() {
  setNav('pilot');
  let d;
  try {
    d = await api('/api/pilot-loop').catch((err) => {
      throw new Error(`${err.message}。若刚更新服务端代码，请重启 4173 服务后刷新。`);
    });
  } catch (err) {
    view.innerHTML = `<div class="empty"><h3>试点闭环没能载入</h3><p>${esc(err.message)}</p><a class="btn" href="#/">回到工作台</a></div>`;
    return;
  }
  const s = d.summary;
  const rs = d.reviewStats;
  const uncitedHits = (d.crossTicketHits || []).filter((u) => !u.cited);
  const reuseTable = (rows) => `<table class="table">
    <thead><tr><th>知识</th><th>来源工单</th><th>用于工单</th><th>运行组</th><th>引用</th><th>时间</th></tr></thead>
    <tbody>${rows.map((u) => `<tr>
      <td><a href="#/memory">K${u.cardId} ${esc(u.cardTitle)}</a></td>
      <td>${u.sourceTicketId ? `#${u.sourceTicketId}` : '外部来源'}</td>
      <td>#${u.usedInTicketId} ${esc(u.usedInTicketTitle || '')}</td>
      <td><span class="code">${esc(u.usedInRunGroup || '—')}</span></td>
      <td>${u.cited ? '<span class="chip status-resolved">已引用</span>' : '<span class="chip">命中未引用</span>'}</td>
      <td>${fmtTime(u.createdAt)}</td>
    </tr>`).join('')}</tbody>
  </table>`;
  const statRow = (label, c, note = '') => `<tr>
    <td>${label}${note ? ` <span class="small muted">${note}</span>` : ''}</td>
    <td class="num">${c.adopt}</td>
    <td class="num">${c.edit}</td>
    <td class="num">${c.reject}</td>
    <td class="num">${c.unreviewed}</td>
    <td class="num">${c.total}</td>
  </tr>`;
  const sourceStatRow = (key) => statRow(
    `${d.reviewSourceLabel[key] || key} <span class="code">${key}</span>`,
    rs.bySource[key] || { adopt: 0, edit: 0, reject: 0, unreviewed: 0, total: 0 },
  );

  view.innerHTML = `
    ${pageHead({
      pageContext: '真实试点 · 只读核对',
      title: '试点闭环',
      lead: '一条授权工单的建议，经组织成员判断与知识审核后，能否成为可追溯的共享知识，并在另一条不同的新工单中被正确复用。本页只读，不调用模型、不写数据。',
    })}

    <div class="notice">
      <div><strong>机制核对，不是成效结论。</strong> ${esc(d.scopeNotice)}「试点有效」仍需组织成员结合真实处理结果人工判断。</div>
    </div>

    <section class="strip" aria-label="试点闭环概览">
      <div class="strip-cell"><div class="strip-label">试点工单</div><div class="strip-value num">${s.pilotTickets}</div><div class="strip-foot">授权来源与脱敏状态见下</div></div>
      <div class="strip-cell"><div class="strip-label">双模式运行</div><div class="strip-value num">${s.pilotRuns}</div><div class="strip-foot">${s.runGroups} 个运行组</div></div>
      <div class="strip-cell"><div class="strip-label">人工审核运行</div><div class="strip-value num">${s.humanReviewedRuns}</div><div class="strip-foot">仅来源为 human</div></div>
      <div class="strip-cell"><div class="strip-label">跨单命中</div><div class="strip-value num">${s.crossTicketHitCount}</div><div class="strip-foot">另一条工单命中（含未引用）</div></div>
      <div class="strip-cell"><div class="strip-label">实际引用复用</div><div class="strip-value num">${s.crossTicketReuseCount}</div><div class="strip-foot">跨单命中中被真正引用</div></div>
    </section>

    <section class="section tight" aria-labelledby="pl-review-title">
      <div class="section-head">
        <h2 id="pl-review-title">人工审核分母（分母写清楚）</h2>
        <p class="sub">每条运行按最新一条审核决定当前状态，历史全部保留。未审核单独计数，不摊进采纳或拒绝。只有来源为 human 的行是组织成员的人工判断。</p>
      </div>
      <div class="panel panel-body">
        <table class="table">
          <thead><tr><th>口径</th><th>采纳</th><th>编辑后采纳</th><th>拒绝</th><th>未审核</th><th>分母</th></tr></thead>
          <tbody>
            ${statRow('个人模式', rs.byMode.personal)}
            ${statRow('组织模式', rs.byMode.organization)}
            ${statRow('合计', rs.total)}
          </tbody>
        </table>
        <table class="table" style="margin-top:14px">
          <thead><tr><th>按审核来源</th><th>采纳</th><th>编辑后采纳</th><th>拒绝</th><th>未审核</th><th>分母</th></tr></thead>
          <tbody>
            ${['human', 'assistant', 'seed', 'unknown'].map(sourceStatRow).join('')}
          </tbody>
        </table>
        <p class="small muted" style="margin-top:12px">human 行才是组织成员人工审核；assistant 行是助手代审，不能计入人工采纳率。分母均为试点运行数，未经审核的运行不进入任何决定。</p>
      </div>
    </section>

    <section class="section tight" aria-labelledby="pl-run-title">
      <div class="section-head">
        <h2 id="pl-run-title">同组双模式运行与可复核依据</h2>
        <p class="sub">每条运行记录工单 ID、运行组、模型与提示词版本、检索来源和引用；组织模式须排除自身工单，个人模式不得读取组织记忆。</p>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px">
        ${d.runs.length ? d.runs.map((r) => `<article class="panel" aria-label="运行 ${r.id}">
          <div class="panel-body">
            <div class="chip-row" style="margin-top:0;margin-bottom:8px">
              <span class="chip mode-${r.mode}">${r.mode === 'organization' ? '组织模式' : '个人模式'}</span>
              ${scopeChip(r.scope)}
              ${r.reviewState.source ? reviewSourceChip(r.reviewState.source) : '<span class="chip">未审核</span>'}
              ${r.reviewState.decision ? decisionChip(r.reviewState.decision) : ''}
              ${r.selfRetrieval === true ? '<span class="chip status-resolved">已排除自身</span>' : ''}
              ${r.evidenceGate?.blocked ? '<span class="chip urgent">证据闸门：需核实制度</span>' : ''}
            </div>
            <p class="small">工单 #${r.ticketId} · 运行 ${r.id} · 组 <span class="code">${esc(r.runGroup)}</span> · 模型 ${esc(r.model)} · 提示词 ${esc(r.promptVersion)} · ${fmtTime(r.createdAt)}</p>
            ${r.retrieval ? `<p class="small muted">检索：${esc(r.retrieval.query || '')} · 命中 ${r.retrieval.resultCount} 条 · 排除工单 ${r.retrieval.excludeTicketId ?? '未记录'} · 范围 ${esc(r.retrieval.scope || '未记录')}</p>` : '<p class="small muted">个人模式：未调用组织记忆检索。</p>'}
            <p class="small muted">检索来源：${r.contextRefs.length ? r.contextRefs.map((x) => `${esc(x.ref)}（${esc(x.sourceKind || x.type)}）`).join(' · ') : '无'} · 最终引用：${r.citationRefs.length ? r.citationRefs.map((x) => esc(x)).join(' · ') : '无'}</p>
            ${r.reviewState.review ? `<p class="small">审核：${esc(r.reviewState.review.reviewer)} · ${esc(r.reviewState.review.reason || '无理由')} · ${fmtTime(r.reviewState.review.createdAt)}</p>` : ''}
          </div>
        </article>`).join('') : emptyPanel('还没有试点工单的运行记录', '先在试点工单上生成两种建议，这里会逐条显示可复核依据。')}
      </div>
    </section>

    <section class="section tight" aria-labelledby="pl-kb-title">
      <div class="section-head">
        <h2 id="pl-kb-title">知识链：待审 → 发布 → 批准用于试点</h2>
        <p class="sub">人工认可的回复只形成待审知识，不自动发布；批准用于试点检索前须能核对来源、适用范围、审批主体、知识负责人和有效状态。</p>
      </div>
      <div class="panel panel-body">
        ${d.knowledge.length ? `<table class="table">
          <thead><tr><th>卡片</th><th>状态</th><th>来源工单</th><th>来源</th><th>适用范围</th><th>审批主体</th><th>知识负责人</th><th>有效期</th><th>试点批准</th></tr></thead>
          <tbody>${d.knowledge.map((k) => `<tr>
            <td><a href="#/memory">K${k.id} ${esc(k.title)}</a></td>
            <td>${CARD_STATUS_LABEL[k.status] || k.status}</td>
            <td>${k.sourceTicketId ? `#${k.sourceTicketId}` : '—'}</td>
            <td>${kindChip(k.sourceKind)} ${esc(k.sourceRef || '—')}</td>
            <td>${esc(k.appliesTo || '—')}</td>
            <td>${esc(k.approvalBody || '—')}</td>
            <td>${esc(k.knowledgeOwner || '—')}</td>
            <td>${esc(k.validUntil || '长期')}</td>
            <td>${k.pilotApproved ? '<span class="chip scope-pilot">已批准</span>' : '<span class="chip">未批准</span>'}</td>
          </tr>`).join('')}</tbody>
        </table>` : emptyPanel('还没有试点知识卡片', '在已解决并人工审核的试点工单上生成知识草稿，再经人工审核发布。')}
      </div>
    </section>

    <section class="section tight" aria-labelledby="pl-reuse-title">
      <div class="section-head">
        <h2 id="pl-reuse-title">跨工单复用核对</h2>
        <p class="sub">分母分开写：跨单命中 ${s.crossTicketHitCount} 条 = 另一条不同试点工单检索到来自别的工单的知识；实际引用复用 ${s.crossTicketReuseCount} 条 = 其中被该轮输出真正引用。同单命中与自我检索两个口径都不计入。</p>
      </div>
      <div class="panel panel-body">
        <h3 class="small">实际引用复用（${s.crossTicketReuseCount}）</h3>
        ${d.crossTicketReuse.length ? reuseTable(d.crossTicketReuse) : emptyPanel('还没有可核对的实际引用复用', '当另一条试点工单的组织模式命中并引用了来自不同工单的已批准知识，这里会显示记录。')}
        <h3 class="small" style="margin-top:16px">跨单命中但未引用（${uncitedHits.length}，不计入复用）</h3>
        ${uncitedHits.length ? reuseTable(uncitedHits) : '<p class="small muted">没有命中未引用的记录。</p>'}
        <p class="small muted" style="margin-top:12px">命中未引用只说明检索到了但模型输出未采纳该来源，需要人工核对是否引用正确；不计入复用成功，也不能据此声称知识被复用。</p>
      </div>
    </section>

    <section class="section tight" aria-labelledby="pl-ticket-title">
      <div class="section-head">
        <h2 id="pl-ticket-title">试点工单与数据边界登记</h2>
        <p class="sub">试点工单必须登记数据来源、工作区存储确认人和脱敏状态；调用模型还要求管理员单独登记模型发送确认人。</p>
      </div>
      <div class="panel panel-body">
        ${d.tickets.length ? `<table class="table">
          <thead><tr><th>工单</th><th>状态</th><th>数据来源 / 存储确认依据</th><th>工作区存储确认人</th><th>模型发送确认人 / 确认目标</th><th>脱敏状态</th><th>创建时间</th></tr></thead>
          <tbody>${d.tickets.map((t) => `<tr>
            <td><a href="#/t/${t.id}">#${t.id} ${esc(t.title)}</a></td>
            <td>${STATUS_LABEL[t.status] || t.status}</td>
            <td>${esc(t.sourceRef || '—')}</td>
            <td>${esc(t.authorizedBy || '—')}</td>
            <td>${esc(t.modelAuthorizedBy || '未登记')}${t.modelAuthorizationTarget ? `<div class="row-meta">${esc(t.modelAuthorizationTarget.baseUrl || '未绑定')} · ${esc(t.modelAuthorizationTarget.model || '未绑定')}</div>` : ''}</td>
            <td>${esc(t.desensitizationLabel)}</td>
            <td>${fmtTime(t.createdAt)}</td>
          </tr>`).join('')}</tbody>
        </table>` : emptyPanel('还没有真实试点工单', '在工作台点「新建问题单」，填写数据来源、工作区存储确认人和脱敏状态；如要调用模型，还需管理员另行登记发送确认。')}
      </div>
    </section>
  `;
}

async function renderTeamLearning() {
  setNav('learning');
  let data;
  try {
    data = await api('/api/team-learning');
  } catch (error) {
    view.innerHTML = `<div class="empty"><h3>团队复盘暂时无法载入</h3><p>${esc(error.message)}</p><a class="btn" href="#/">回到工作台</a></div>`;
    return;
  }
  const s = data.summary;
  const percent = (n, d) => d ? `${Math.round((n / d) * 100)}%` : '暂无数据';
  const statusName = (status) => STATUS_LABEL[status] || status || '未记录';
  const cycleTime = (minutes) => {
    if (!Number.isFinite(minutes)) return '暂无数据';
    if (minutes < 60) return `${Math.round(minutes)} 分钟`;
    if (minutes < 1440) return `${(minutes / 60).toFixed(1)} 小时`;
    return `${(minutes / 1440).toFixed(1)} 天`;
  };

  view.innerHTML = `
    ${pageHead({
      pageContext: '团队复盘',
      title: '任务结果与经验迁移',
      lead: '把处理结果、返工与升级、交接等待、AI 建议审核和知识跨任务引用放在一起看，帮助团队发现流程哪里有效、哪里还需要修正。',
    })}

    <div class="notice">
      <div><strong>这是流程观察，不是成效证明。</strong> 引用或采纳只说明发生过这些动作，不代表知识一定改变了答案，也不代表团队效率已经提高。请结合任务实际结果判断。</div>
    </div>

    <section class="strip" aria-label="团队复盘摘要">
      <div class="strip-cell"><div class="strip-label">工单</div><div class="strip-value num">${s.tickets}</div><div class="strip-foot">全部状态</div></div>
      <div class="strip-cell"><div class="strip-label">已解决并记录结果</div><div class="strip-value num">${s.outcomeRecorded} / ${s.resolvedTickets}</div><div class="strip-foot">${percent(s.outcomeRecorded, s.resolvedTickets)} 的已解决工单</div></div>
      <div class="strip-cell"><div class="strip-label">人工审核 AI 建议</div><div class="strip-value num">${s.humanReviewedRuns} / ${s.organizationRuns}</div><div class="strip-foot">${percent(s.humanReviewedRuns, s.organizationRuns)} 的组织建议运行</div></div>
      <div class="strip-cell"><div class="strip-label">跨任务记忆引用</div><div class="strip-value num">${s.crossTaskCitations} / ${s.crossTaskRetrievals}</div><div class="strip-foot">答案实际引用 / 卡片或已解决案例命中</div></div>
    </section>

    <section class="section tight" aria-labelledby="learning-status-title">
      <div class="section-head"><h2 id="learning-status-title">协作与治理信号</h2><p class="sub">全量数据范围：${data.period.from ? `${fmtTime(data.period.from)} 至 ${fmtTime(data.period.to)}` : '还没有工单'}；页面生成于 ${fmtTime(data.generatedAt)}。</p></div>
      <div class="panel panel-body">
        <table class="table">
          <thead><tr><th>观察项</th><th>数量</th><th>怎么读</th></tr></thead>
          <tbody>
            <tr><td>待处理或重开</td><td class="num">${s.openTickets}</td><td>当前队列状态，不等同于逾期。</td></tr>
            <tr><td>处理中或已升级</td><td class="num">${s.inProgressTickets}</td><td>其中曾升级的不同工单：${s.ticketsEverEscalated}。</td></tr>
            <tr><td>曾重开</td><td class="num">${s.ticketsEverReopened}</td><td>按时间线里至少出现一次“重开”的不同工单计数。</td></tr>
            <tr><td>等待接收的交接</td><td class="num">${s.pendingHandoffs}</td><td>当前负责人尚未确认的交接；改派或结案后不再计为等待。</td></tr>
            <tr><td>交接接收等待中位数</td><td class="num">${cycleTime(s.handoffWaitMedianMinutes)}${s.handoffWaitCount ? `（n=${s.handoffWaitCount}）` : ''}</td><td>从准备交接摘要到接手人确认的日历时间；不代表实际投入工时。</td></tr>
            <tr><td>AI 建议已审核</td><td class="num">${s.reviewedRuns} / ${s.organizationRuns}</td><td>含各来源审核；产品新审核应由团队登录成员提交。</td></tr>
            <tr><td>已发布共享知识</td><td class="num">${s.publishedKnowledge}</td><td>另有待审核 ${s.pendingKnowledge} 条；已过有效期 ${s.expiredKnowledge} 条。</td></tr>
            <tr><td>已解决工单日历周期中位数</td><td class="num">${cycleTime(s.resolutionCycleMedianMinutes)}${s.resolutionCycleCount ? `（n=${s.resolutionCycleCount}）` : ''}</td><td>从创建到最近一次结案；按自然时间计算，不代表实际投入工时。仅统计有有效时间戳且当前为已解决状态的工单。</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="section tight" aria-labelledby="learning-reuse-title">
      <div class="section-head"><h2 id="learning-reuse-title">记忆有没有进入另一项任务</h2><p class="sub">统计知识卡和已解决案例；检索命中与回答实际引用分开。这里只说明发生过检索/引用，不证明它改变了处理结果；明细最多显示最近 100 条。</p></div>
      <div class="panel panel-body flush">
        ${data.crossTaskUses.length ? `<table class="table">
          <thead><tr><th>记忆来源</th><th>来源工单</th><th>使用工单</th><th>答案引用</th><th>时间</th></tr></thead>
          <tbody>${data.crossTaskUses.map((use) => `<tr>
            <td>${use.sourceType === 'card'
              ? `<a href="#/memory">${esc(use.sourceRef)} ${esc(use.sourceTitle)}</a>`
              : `<a href="#/t/${use.sourceId}">${esc(use.sourceRef)} ${esc(use.sourceTitle)}</a>`}</td>
            <td>${use.sourceTicketId ? `工单 #${use.sourceTicketId}` : '外部资料'}</td>
            <td><a href="#/t/${use.usedInTicketId}">#${use.usedInTicketId} ${esc(use.usedInTicketTitle)}</a></td>
            <td>${use.cited ? '<span class="chip status-resolved">已引用</span>' : '<span class="chip">命中未引用</span>'}</td>
            <td class="nowrap">${fmtTime(use.createdAt)}</td>
          </tr>`).join('')}</tbody>
        </table>` : `<div class="empty"><h3>还没有跨任务记忆记录</h3><p>团队发布知识卡，或积累已解决工单案例，再在另一张工单运行组织建议后，这里会区分“检索命中”和“答案引用”。</p></div>`}
      </div>
    </section>

    <section class="section tight" aria-labelledby="learning-outcome-title">
      <div class="section-head"><h2 id="learning-outcome-title">最近工单结果</h2><p class="sub">只展示已记录的结果；空白表示还没有记录，不推断为成功或失败。</p></div>
      <div class="panel panel-body flush">
        ${data.recentTickets.length ? `<table class="table">
          <thead><tr><th>工单</th><th>状态</th><th>结果</th><th>处理记录</th><th>最近更新</th></tr></thead>
          <tbody>${data.recentTickets.map((ticket) => `<tr>
            <td class="title-cell"><a href="#/t/${ticket.id}">#${ticket.id} ${esc(ticket.title)}</a></td>
            <td>${esc(statusName(ticket.status))}</td>
            <td>${esc(ticket.outcome || '未记录')}</td>
            <td>${esc(ticket.outcomeNote || '未记录')}</td>
            <td class="nowrap">${fmtTime(ticket.updatedAt)}</td>
          </tr>`).join('')}</tbody>
        </table>` : `<div class="empty"><h3>还没有任务记录</h3><p>团队处理工单后，实际结果会出现在这里。</p><a class="btn" href="#/">查看工作台</a></div>`}
      </div>
    </section>
  `;
}

function emptyPanel(title, hint) {
  return `<div class="empty"><h3>${esc(title)}</h3><p>${esc(hint)}</p></div>`;
}

/* ---------------- 观察批次（首轮 10 组模拟样本，只读） ---------------- */

const DECISION_CHIP = {
  adopt: '<span class="chip status-resolved">已采纳</span>',
  edit: '<span class="chip status-resolved">编辑后采纳</span>',
  reject: '<span class="chip status-escalated">已拒绝</span>',
};
const decisionChip = (d) => DECISION_CHIP[d] || '<span class="chip">未审核</span>';

function batchSourceBlock(run, isOrg) {
  if (!isOrg) {
    return `<div style="margin-top:12px"><div class="field-key small muted">检索来源</div>
      <div class="field-val muted small">个人模式不读取组织记忆（对照组口径）。</div></div>`;
  }
  const srcs = run.context_sources || [];
  const body = srcs.length
    ? srcs.map((s) => `<div class="cite">
        <div class="cite-head"><span><span class="cite-ref">${esc(s.ref)}</span> ${esc(s.title || '')}</span>
          <span class="small muted">${s.type === 'card' ? '已发布知识' : '已解决案例'}</span></div>
        <div class="cite-head" style="margin-top:2px">${kindChip(s.meta?.source_kind)}${scopeChip(s.meta?.scope)}</div>
        <div class="cite-quote">${esc(s.snippet || '')}</div>
      </div>`).join('')
    : '<div class="field-val muted small">本次检索没有命中团队记忆。</div>';
  return `<div style="margin-top:12px"><div class="field-key small muted">检索来源 · ${srcs.length} 条（含引用与未引用）</div>${body}</div>`;
}

function batchCitationBlock(run, isOrg) {
  const cites = (run.output && run.output.citations) || [];
  const body = cites.length
    ? cites.map((c) => `<div class="cite">
        <div class="cite-head"><span><span class="cite-ref">${esc(c.ref)}</span> ${esc(c.title || '')}</span>
          <span class="small muted">${c.type === 'card' ? '已发布知识' : '已解决案例'}</span></div>
        <div class="cite-head" style="margin-top:2px">${kindChip(sourceKindForRef(run, c.ref))}</div>
        <div class="cite-quote">${esc(c.quote || '')}</div>
      </div>`).join('')
    : `<div class="field-val muted small">${isOrg ? '模型最终没有引用任何记忆。' : '个人模式不产生引用（对照组口径）。'}</div>`;
  return `<div style="margin-top:12px"><div class="field-key small muted">模型最终引用 · ${cites.length} 条</div>${body}
    ${isOrg && run.output?.citation_audit?.dropped ? `<p class="small" style="color:var(--danger);margin-top:8px">${esc(run.output.citation_audit.note)}</p>` : ''}
  </div>`;
}

function batchModeCard(run, mode, decision, info) {
  const isOrg = mode === 'organization';
  const out = run.output || {};
  const originLabel = run.origin === 'live' ? '真实模型' : run.origin === 'fallback' ? '模型失败回退' : '演示生成';
  return `<article class="panel mode-card" aria-label="${isOrg ? '组织模式' : '个人模式'}运行 #${run.id}">
    <div class="panel-head">
      <div>
        <div class="mode-title">
          <span class="chip mode-${mode}">${isOrg ? '组织模式' : '个人模式'}</span>
          ${scopeChip(run.scope)}
          <span class="origin-badge">${esc(originLabel)}</span>
          ${decisionChip(decision)}
          ${info ? reviewSourceChip(info.sourceType) : '<span class="chip">未审核</span>'}
        </div>
        <p class="mode-note">运行 #${run.id} · ${esc(run.model)} · ${esc(run.prompt_version || '—')} · ${run.latency_ms}ms</p>
        ${info ? `<p class="mode-note">最近审核：${esc(info.reviewer || '未标注')} · ${fmtTime(info.createdAt)}${info.rating ? ` · ${info.rating}/5` : ''} · 历史 ${info.historyCount} 条</p>` : ''}
      </div>
    </div>
    <div class="panel-body">
      <div class="field-row"><div class="field-key">摘要</div><div class="field-val">${esc(out.summary || '（空）')}</div></div>
      <div class="field-row"><div class="field-key">分类</div><div class="field-val">${esc(out.category || '—')}</div></div>
      <div class="field-row"><div class="field-key">优先级</div><div class="field-val"><span class="num">${esc(out.priority || '—')}</span>${out.escalation_needed ? ' · <span class="chip urgent">建议升级</span>' : ''}</div></div>
      <div style="margin-top:12px"><div class="field-key small muted">草稿回复</div><div class="reply reply-scroll">${esc(out.draft_reply || '（空）')}</div></div>
      ${generalChecksBlock(out, isOrg)}
      ${batchSourceBlock(run, isOrg)}
      ${batchCitationBlock(run, isOrg)}
      ${info && info.historyCount > 1 ? `<details class="small" style="margin-top:12px">
        <summary>审核历史 ${info.historyCount} 条 · 当前状态取最新一条</summary>
        <ul style="padding-left:18px;margin-top:6px">
          ${run.reviews.map((v) => `<li>${fmtTime(v.created_at)} · ${esc(REVIEW_SOURCE_LABEL[v.review_source_type] || '来源未知')} · ${esc(v.reviewer)} · ${esc(v.decision)} · ${v.rating ? `${v.rating}/5` : ''}</li>`).join('')}
        </ul>
      </details>` : ''}
    </div>
  </article>`;
}

async function renderBatch() {
  setNav('batch');
  let data;
  try {
    data = await api('/api/observation/pilot-2026-11').catch((err) => {
      throw new Error(`${err.message}。若刚更新服务端代码，请重启 4173 服务后刷新。`);
    });
  } catch (err) {
    view.innerHTML = `<div class="empty"><h3>观察批次没能载入</h3><p>${esc(err.message)}</p><a class="btn" href="#/">回到工作台</a></div>`;
    return;
  }
  const { batch, stats, pairs } = data;
  const { groups, groupsBySource, runs } = stats;
  const srcLabel = { human: '人工审核', assistant: '助手代审', seed: '种子演示', unknown: '来源未知', seedUnknown: '种子/未知合计' };
  const sourceStatRow = (key) => {
    const s = runs.bySource[key];
    return `<tr>
      <td>${srcLabel[key]} <span class="code">${key}</span></td>
      <td class="num">${s.reviewed}</td>
      <td class="num">${s.adopt}</td>
      <td class="num">${s.edit}</td>
      <td class="num">${s.reject}</td>
      <td class="num">${s.denominator} 条运行</td>
    </tr>`;
  };
  const statRow = (label, s) => `<tr>
    <td>${label}</td>
    <td class="num">${s.adopt}</td>
    <td class="num">${s.edit}</td>
    <td class="num">${s.reject}</td>
    <td class="num">${s.unreviewed}</td>
    <td class="num">${s.total} 条运行</td>
  </tr>`;

  view.innerHTML = `
    ${pageHead({
      pageContext: '研究观察 · 只读页面',
      title: batch.label,
      lead: '按观察记录的 run_group 白名单逐组核对两种模式的输出与引用。审核来源只认记录里的来源类型：人工、助手代审、种子演示、来源未知分别计数；每条运行显示最近审核者与来源。',
    })}

    <div class="notice">
      <div><strong>模拟样本，不是真实业务成效。</strong> 本批 10 组工单、知识卡与运行的数据范围均为 ${scopeChip('sample')}；检索来源里的 K 卡来源类型为「来源未核实（unknown）」、C 案例为「已解决案例（仅参考）」，不得读作制度依据。${esc(batch.sampleNote)} 工作台首页的「人工审核口径」只算来源为 human 的记录，与本页分来源展示互相对照。记录口径见 <span class="code">${esc(batch.source)}</span>。</div>
    </div>

    <section class="strip" aria-label="本批次组级统计">
      <div class="strip-cell"><div class="strip-label">总组数（分母）</div><div class="strip-value num">${groups.total}</div><div class="strip-foot">入选的 run_group 数量</div></div>
      <div class="strip-cell"><div class="strip-label">人工审核组</div><div class="strip-value num">${groupsBySource.human.both}</div><div class="strip-foot">两侧最新审核均为 human</div></div>
      <div class="strip-cell"><div class="strip-label">助手代审组</div><div class="strip-value num">${groupsBySource.assistant.both}</div><div class="strip-foot">两侧最新审核均为 assistant</div></div>
      <div class="strip-cell"><div class="strip-label">两侧均无记录</div><div class="strip-value num">${groups.unreviewed}</div><div class="strip-foot">两侧都没有审核记录</div></div>
    </section>
    <p class="small muted" style="margin:8px 0 0">组级来源分母 = ${groupsBySource.denominator} 组；「human 两侧」${groupsBySource.human.both} 组、「assistant 两侧」${groupsBySource.assistant.both} 组、「种子/未知两侧」${groupsBySource.seedUnknown.both} 组、来源混合 ${groupsBySource.mixed} 组（同一组两侧来源不同，不计入任何单一来源）。任一侧出现某来源的组数：人工 ${groupsBySource.human.any} · 助手 ${groupsBySource.assistant.any} · 种子/未知 ${groupsBySource.seedUnknown.any}。</p>

    <section class="section tight" aria-labelledby="batch-stat-title">
      <div class="section-head">
        <h2 id="batch-stat-title">运行级审核统计（分母写清楚）</h2>
        <p class="sub">每条运行按最新一条审核决定当前状态，历史全部保留。下表合并全部来源，仅供与本批旧记录对照。</p>
      </div>
      <div class="panel panel-body">
        <table class="table">
          <thead><tr><th>口径</th><th>采纳</th><th>编辑后采纳</th><th>拒绝</th><th>未审核</th><th>分母</th></tr></thead>
          <tbody>
            ${statRow('个人模式', runs.byMode.personal)}
            ${statRow('组织模式', runs.byMode.organization)}
            ${statRow('两模式合计（全部来源）', runs.total)}
          </tbody>
        </table>
        <p class="small muted" style="margin-top:12px">未审核单独计数，不摊进采纳、编辑或拒绝。这一行包含助手代审与种子/未知记录，不能读作人工审核成效。</p>
      </div>
    </section>

    <section class="section tight" aria-labelledby="batch-source-stat-title">
      <div class="section-head">
        <h2 id="batch-source-stat-title">按审核来源拆分</h2>
        <p class="sub">来源只认记录里的 review_source_type，不从审核者姓名推断。每个来源的分母都是本批全部 ${runs.denominator} 条运行；桶内只数「最新审核属于该来源」的运行。</p>
      </div>
      <div class="panel panel-body">
        <table class="table">
          <thead><tr><th>审核来源</th><th>已审核</th><th>采纳</th><th>编辑后采纳</th><th>拒绝</th><th>分母</th></tr></thead>
          <tbody>
            ${sourceStatRow('human')}
            ${sourceStatRow('assistant')}
            ${sourceStatRow('seed')}
            ${sourceStatRow('unknown')}
            ${sourceStatRow('seedUnknown')}
          </tbody>
        </table>
        <p class="small muted" style="margin-top:12px">「种子/未知合计」是 seed 与 unknown 的去重合并视图，不是新增记录。人工审核口径请读 human 行；本批 human 为 0 时，不能把助手代审的采纳数当作人工结论。审核者及其来源类型在每条运行卡片上单独标注。</p>
      </div>
    </section>

    <section class="section tight" aria-labelledby="batch-list-title">
      <div class="section-head">
        <h2 id="batch-list-title">${pairs.length} 组成对运行</h2>
        <p class="sub">${esc(batch.criteria)}</p>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px">
        ${pairs.map((p, i) => `<article class="panel" aria-labelledby="pair-${i}">
          <div class="panel-head">
            <div>
              <div class="chip-row" style="margin-top:0;margin-bottom:8px">
                <span class="chip">${esc(p.dataClass)}</span>
                <span class="chip">${esc(STATUS_LABEL[p.ticket?.status] || '工单缺失')}</span>
                ${decisionChip(p.reviewState.personal)}
                ${decisionChip(p.reviewState.organization)}
              </div>
              <h2 id="pair-${i}">${p.ticket ? `<a href="#/t/${p.ticket.id}?g=${p.runGroup}">#${p.ticket.id} ${esc(p.ticket.title)}</a>` : `工单不存在 · ${esc(p.runGroup)}`}</h2>
              <p class="mode-note">运行组 <span class="code">${esc(p.runGroup)}</span> · ${fmtTime(p.personal?.created_at || p.organization?.created_at)}</p>
            </div>
          </div>
          <div class="panel-body">
            ${p.missing
              ? `<p class="small" style="color:var(--danger)">这一组的运行记录不完整，无法展示两种输出。统计中按未审核计入，避免漏算。</p>`
              : `<div class="duo">
                  ${batchModeCard(p.personal, 'personal', p.reviewState.personal, p.reviewInfo.personal)}
                  ${batchModeCard(p.organization, 'organization', p.reviewState.organization, p.reviewInfo.organization)}
                </div>
                <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:14px">
                  <a class="btn btn-sm btn-primary" href="#/t/${p.ticket.id}?g=${p.runGroup}">进入工单详情查看这一组</a>
                  <span class="small muted">详情页显示审核者、决定、理由和修订稿。本页只读；审核记录不等于实际发送或业务结果。</span>
                </div>`}
          </div>
        </article>`).join('')}
      </div>
    </section>
  `;
}

/* ---------------- 路由 ---------------- */

async function route() {
  const hash = location.hash || '#/';
  const clean = hash.replace(/^#\/?/, '');
  const [seg, param] = clean.split('/');
  try {
    if (!seg) await renderHome();
    else if (seg === 't' && param) {
      const [idPart, qs] = String(param).split('?');
      const gid = qs ? new URLSearchParams(qs).get('g') : null;
      await renderTicket(Number(idPart), gid);
    }
    else if (seg === 'batch') await renderBatch();
    else if (seg === 'pilot') await renderPilotLoop();
    else if (seg === 'learning') await renderTeamLearning();
    else if (seg === 'memory') await renderMemory();
    else if (seg === 'activity') await renderActivity();
  else if (seg === 'settings') await renderSettings();
    else await renderHome();
  } catch (err) {
    view.innerHTML = `<div class="empty"><h3>这一页没载入出来</h3><p>${esc(err.message)}</p><a class="btn" href="#/">回到工作台</a></div>`;
  }
  if (seg === 'settings' && param === 'members') {
    document.getElementById('members-title')?.scrollIntoView({ block: 'start', behavior: 'instant' });
  } else {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
}

// 全局弹窗容器
const dlg = document.createElement('dialog');
dlg.id = 'dlg';
document.body.appendChild(dlg);
dlg.addEventListener('click', (e) => {
  if (e.target === dlg) dlg.close();
});

window.addEventListener('hashchange', route);
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
    const q = document.getElementById('mem-q');
    if (q) {
      e.preventDefault();
      q.focus();
    }
  }
});

initializeApp();
