/**
 * 端到端冒烟：验证「旧问题沉淀经验 → 新问题复用经验」这条主线真的跑得通。
 * 自己拉起一个临时实例（独立 DATA_DIR），不污染日常数据。
 *
 *   node --no-warnings scripts/smoke.js
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = 4199;
const DATA_DIR = path.join(ROOT, 'data', '.smoke');
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;

function check(name, cond, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function call(method, pathname, body) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${pathname} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}

/** 预期失败的调用：返回 {status, body} 而不抛错——给「被拒绝」断言用。 */
async function tryCall(method, pathname, body) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, body: data };
}

async function waitReady(timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function main() {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });

  const child = spawn(process.execPath, ['--no-warnings', 'server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DATA_DIR, MODEL_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => process.stderr.write(d));

  try {
    const ready = await waitReady();
    check('临时实例启动', ready);
    if (!ready) return;

    const state = await call('GET', '/api/state');
    check('首次启动自动载入演示数据', state.metrics.tickets.total >= 5, `实际 ${state.metrics.tickets.total}`);
    check('无密钥时标注为演示模式', state.model.mode === 'demo');

    // 1. 新建一张与「VPN 证书」相关的问题单
    const created = await call('POST', '/api/tickets', {
      title: '出差前 VPN 提示证书无效',
      description: '明天出差，客户端连公司 VPN 时提示证书无效，重装过一次还是不行。',
      category: '网络与 VPN',
      urgency: '紧急',
    });
    const ticketId = created.ticket.id;
    check('新建问题单', Boolean(ticketId));

    // 2. 同一张单跑两种模式
    const afterRun = await call('POST', `/api/tickets/${ticketId}/run`);
    const group = afterRun.groups[0];
    const personal = group.runs.find((r) => r.mode === 'personal');
    const org = group.runs.find((r) => r.mode === 'organization');
    check('并排生成两条运行记录', Boolean(personal && org));
    check('个人模式不引用组织记忆', (personal?.output.citations || []).length === 0, JSON.stringify(personal?.output.citations));
    check('组织模式检索到已发布知识', (org?.context_sources || []).length > 0, `命中 ${org?.context_sources?.length}`);
    check('组织模式引用可追溯', (org?.output.citations || []).every((c) => c.ref && c.title));
    check('两种模式共用同一提示词版本', personal.prompt_version === org.prompt_version);
    check('输出结构含全部字段', ['summary', 'category', 'priority', 'draft_reply', 'next_actions', 'escalation_needed', 'handoff_summary', 'citations', 'uncertainties'].every((k) => k in org.output));
    check('组织模式留下交接摘要', (org.output.handoff_summary || '').length > 10);

    // 3. 人工审核（编辑后采纳）——审核者姓名必须显式填写（服务端契约）
    await call('POST', `/api/runs/${org.id}/review`, {
      decision: 'edit',
      editedText: '先看客户端证书到期时间，过期要重新签发；再换网络复测。',
      rating: 5,
      reason: '和实际处理一致，删掉多余的客户端重装步骤。',
      reviewer: '林可',
    });
    const detail = await call('GET', `/api/tickets/${ticketId}`);
    check('审核记录落库', detail.reviews.some((r) => r.run_id === org.id && r.decision === 'edit'));

    // 4. 解决问题并沉淀知识
    await call('PATCH', `/api/tickets/${ticketId}`, { status: 'resolved', outcome: '已解决', outcomeNote: '证书过期，重新签发后恢复。' });
    const draft = await call('POST', `/api/tickets/${ticketId}/knowledge-draft`);
    check('生成待审知识草稿', draft.card.status === 'pending');
    const secondDraft = await call('POST', `/api/tickets/${ticketId}/knowledge-draft`);
    check('同一张单不重复起草', secondDraft.created === false);

    await call('POST', `/api/cards/${draft.card.id}/review`, { action: 'publish', note: '核对后发布', reviewer: '林可' });
    const memory = await call('GET', '/api/memory?status=published');
    check('知识卡片已发布', memory.cards.some((c) => c.id === draft.card.id && c.status === 'published'));

    // 5. 新单复用刚发布的经验
    const second = await call('POST', '/api/tickets', {
      title: 'VPN 证书快到期了怎么续',
      description: '同事说我的 VPN 证书这个月到期，出差前想先续一下，不知道在哪操作。',
      category: '网络与 VPN',
      urgency: '中',
    });
    const secondRun = await call('POST', `/api/tickets/${second.ticket.id}/run`);
    const secondOrg = secondRun.groups[0].runs.find((r) => r.mode === 'organization');
    const cited = (secondOrg.context_sources || []).some((s) => s.id === draft.card.id && s.type === 'card');
    check('新问题检索到刚沉淀的知识', cited, JSON.stringify((secondOrg.context_sources || []).map((s) => s.ref)));
    await call('POST', `/api/runs/${secondOrg.id}/review`, { decision: 'adopt', rating: 4, reason: '复用经验有效', reviewer: '林可' });

    const card = (await call('GET', '/api/memory?status=published')).cards.find((c) => c.id === draft.card.id);
    check('知识卡片记录了被引用', card.uses.length >= 1, `引用 ${card.uses.length} 次`);

    // 5b. P2 记忆闭环：权威审核回写 + 有效性标注（路线图 P2 工项 2/3，④§6）
    check('审核采纳回写 use 行', card.uses.every((u) => u.adopted === 1 && u.adopted_review_id), JSON.stringify(card.uses.map((u) => [u.id, u.adopted])));
    const detailAfterReview = await call('GET', `/api/tickets/${second.ticket.id}`);
    const orgRunForUses = detailAfterReview.groups.flatMap((g) => g.runs).find((r) => r.mode === 'organization' && (r.uses || []).length);
    check('详情页暴露 uses 行', Boolean(orgRunForUses));
    const useRow = orgRunForUses.uses[0];
    const marked = await call('POST', `/api/uses/${useRow.id}/helpfulness`, { helpful: 'helpful', note: '结论直接可用' });
    check('有效性标注落库', marked.use.helpful === 1 && marked.use.helpful_by_member_id === null, JSON.stringify(marked.use));
    const markedCleared = await call('POST', `/api/uses/${useRow.id}/helpfulness`, { helpful: 'clear' });
    check('标注可清除（三态）', markedCleared.use.helpful === null && markedCleared.use.helpful_by_member_id === null);
    const badMark = await fetch(`${BASE}/api/uses/${useRow.id}/helpfulness`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ helpful: 'maybe' }) });
    check('非法标注值被拒绝', badMark.status === 400);
    const metricsLoop = await call('GET', '/api/metrics');
    check('采用/有效派生统计可用', typeof metricsLoop.knowledge.useOutcome?.helpfulRate === 'number' || metricsLoop.knowledge.useOutcome?.helpfulRate === null,
      JSON.stringify(metricsLoop.knowledge.useOutcome));

    // 5c. P1 断言：运行去重 / 乐观并发 / 错误规范化 / AI actor 写断言（路线图 P1 工项 1/2/6/7）
    const dupRun = await tryCall('POST', `/api/tickets/${second.ticket.id}/run`);
    check('90 秒内重复运行被拒', dupRun.status === 409 && dupRun.body.error?.includes('刚生成过建议'), JSON.stringify(dupRun.body));
    const stalePatch = await tryCall('PATCH', `/api/tickets/${second.ticket.id}`, { assigneeId: null, updatedAt: '2000-01-01T00:00:00.000Z' });
    check('过期 updated_at 写入被拒（409）', stalePatch.status === 409 && stalePatch.body.error?.includes('已被他人更新'), JSON.stringify(stalePatch.body));
    const freshDetail = await call('GET', `/api/tickets/${second.ticket.id}`);
    const okPatch = await call('PATCH', `/api/tickets/${second.ticket.id}`, { assigneeId: null, updatedAt: freshDetail.ticket.updated_at });
    check('携带最新 updated_at 写入成功', okPatch.ticket && !okPatch.error, JSON.stringify(okPatch.error || ''));
    const badActor = await tryCall('PATCH', `/api/tickets/${second.ticket.id}`, { actor: 'agent:rogue' });
    check('AI 身份写请求被拒（403）', badActor.status === 403, JSON.stringify(badActor.body));
    const typeGuard = await tryCall('POST', '/api/tickets', { title: '词表外类别', description: '验证服务端按类型校验场景词表。', category: '火星配送' });
    check('词表外类别被拒绝', typeGuard.status === 400 && typeGuard.body.error?.includes('类别需是以下之一'), JSON.stringify(typeGuard.body));

    // 5d. P3 E3/E4：通用读模型 + 第二类型 pilot_prep + 跨类型父子（②§8.3 足迹基准）
    const parent = await call('POST', '/api/tickets', {
      title: '新产品试点准备', description: '为下月产品试点做跨职能准备（虚构演示任务）。', workItemType: 'pilot_prep', category: '试点协调', urgency: '高',
    });
    check('第二类型 pilot_prep 可创建', parent.ticket && parent.ticket.work_item_type === 'pilot_prep', JSON.stringify(parent.error || parent.ticket?.work_item_type));
    const child = await call('POST', '/api/tickets', {
      title: '试点支持工单', description: '试点期间客服侧准备工作，挂试点父项下。', workItemType: 'support_ticket', category: '网络与 VPN', parentTicketId: parent.ticket.id,
    });
    check('跨类型父子建立', child.ticket && Number(child.ticket.parent_ticket_id) === Number(parent.ticket.id), JSON.stringify(child.error || child.ticket?.parent_ticket_id));
    const byType = await call('GET', '/api/work-items?type=pilot_prep');
    check('E3 按类型查询', byType.workItems.some((t) => t.id === parent.ticket.id && t.typeLabel === '试点准备任务'), JSON.stringify(byType.workItems?.map((t) => [t.id, t.typeLabel])));
    const byParent = await call('GET', `/api/work-items?parent=${parent.ticket.id}`);
    check('E3 按父查询', byParent.workItems.some((t) => t.id === child.ticket.id), JSON.stringify(byParent.workItems?.map((t) => t.id)));
    const badType = await tryCall('GET', '/api/work-items?type=no_such_type');
    check('E3 未知类型被拒', badType.status === 400, JSON.stringify(badType.body));
    const childRun = await call('POST', `/api/tickets/${child.ticket.id}/run`);
    const childOrg = childRun.groups?.[0]?.runs?.find((r) => r.mode === 'organization');
    check('第二类型子项走同一运行管道', Boolean(childOrg));
    const badParent = await tryCall('POST', '/api/tickets', { title: '坏父', description: '父工作项不存在的请求应被拒绝。', parentTicketId: 999999 });
    check('无效父 id 被拒', badParent.status === 400 && badParent.body.error?.includes('父工作项不存在'), JSON.stringify(badParent.body));

    // 6. 指标与事件
    const metrics = await call('GET', '/api/metrics');
    check('按模式统计采纳率', metrics.modes.length === 2);
    check('知识复用计数 > 0', metrics.knowledge.totalUses > 0);
    // 5e. P4：四元组报表 + path 落库 + modelHealth（⑤§2/§4/§6；demo 下快路径关闭，端到端 mock 验证属后续）
    check('四元组报表存在', metrics.quadruple && Array.isArray(metrics.quadruple.latencyByPath) && metrics.quadruple.pathCounts && metrics.quadruple.escalationRate && metrics.quadruple.tokens,
      JSON.stringify(Object.keys(metrics.quadruple || {})));
    check('所有运行 path 字段落库（demo 固定 main）', Object.values(metrics.quadruple.pathCounts).every((n) => n > 0) && metrics.quadruple.pathCounts.main > 0,
      JSON.stringify(metrics.quadruple.pathCounts));
    const stateP4 = await call('GET', '/api/state');
    check('modelHealth 字段暴露', stateP4.modelHealth && Number.isInteger(stateP4.modelHealth.consecutiveFailures) && stateP4.modelHealth.consecutiveFailures >= 0,
      JSON.stringify(stateP4.modelHealth));
    const events = await call('GET', '/api/events?limit=200');
    check('关键动作写入事件', ['agent_run', 'review_submitted', 'card_published', 'memory_cited', 'use_helpfulness_recorded', 'agent_write_rejected'].every((k) => events.events.some((e) => e.kind === k)));

    // 7. 校验失败路径
    const bad = await tryCall('POST', '/api/tickets', { title: '', description: 'x' });
    check('空标题被拒绝', bad.status === 400);

    console.log(`\n  结果：${passed} 通过 / ${failed} 失败\n`);
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  }

  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
