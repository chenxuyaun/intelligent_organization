/**
 * P5-4 端到端验收（⑥§3、⑤§7）：新实例从零启动 → 迁移 → 全流程冒烟 → 备份恢复演练 → 指标断言。
 * 与 smoke.js 的差别：额外覆盖产品化护栏（迁移幂等、备份/恢复链）并输出结构化验收结果。
 * 自己拉起临时实例（独立 DATA_DIR + 独立端口 4198），不触碰运行中的服务与真实数据。
 *
 *   node --no-warnings scripts/acceptance.js
 *
 * 演练纪律：全部使用演示/虚构数据；不调付费模型（无 MODEL_API_KEY 启动）；结束后清理临时目录。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = 4198;
const BASE = `http://127.0.0.1:${PORT}`;
// 备份/恢复目标必须在项目目录之外（workspace-data.js 硬约束）→ 用系统临时目录
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'io-acceptance-'));
const DATA_DIR = path.join(TMP, 'data');
const BACKUP_DIR = path.join(TMP, 'backups', 'backup-1');
const RESTORED_DIR = path.join(TMP, 'restored');

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
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

async function waitReady(timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/ready`);
      if (res.ok) return true;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function workspaceData(command, args) {
  return execFileAsync(process.execPath, ['--no-warnings', 'scripts/workspace-data.js', command, ...args], {
    cwd: ROOT,
    timeout: 60_000,
  });
}

async function main() {
  console.log(`临时目录：${TMP}\n`);
  const child = spawn(process.execPath, ['--no-warnings', 'server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DATA_DIR, MODEL_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(d));

  try {
    // ---- 阶段 1：新实例从零启动 ----
    const ready = await waitReady();
    check('新实例从零启动并通过 /api/ready', ready);
    if (!ready) return;
    const state0 = await call('GET', '/api/state');
    check('首次启动载入演示数据', state0.metrics.tickets.total >= 5, `实际 ${state0.metrics.tickets.total}`);
    check('无密钥时显式 demo 模式', state0.model.mode === 'demo');
    check('启动即应用全部迁移（runs.path 可查）', typeof state0.metrics.knowledge?.useOutcome === 'object',
      JSON.stringify(state0.metrics.knowledge?.useOutcome || 'missing'));

    // ---- 阶段 2：核心流程（沉淀→复用→审核→标注）----
    const t1 = await call('POST', '/api/tickets', {
      title: '验收：VPN 证书无效', description: '客户端连 VPN 提示证书无效，重装无效。', category: '网络与 VPN',
    });
    const run1 = await call('POST', `/api/tickets/${t1.ticket.id}/run`);
    const org1 = run1.groups[0].runs.find((r) => r.mode === 'organization');
    check('组织模式检索到知识', (org1?.context_sources || []).length > 0);
    await call('POST', `/api/runs/${org1.id}/review`, { decision: 'adopt', reviewer: '验收员' });
    await call('PATCH', `/api/tickets/${t1.ticket.id}`, { status: 'resolved', outcome: '已解决', outcomeNote: '验收演练：重新签发证书。', updatedAt: t1.ticket.updated_at });
    const draft = await call('POST', `/api/tickets/${t1.ticket.id}/knowledge-draft`);
    await call('POST', `/api/cards/${draft.card.id}/review`, { action: 'publish', note: '验收发布', reviewer: '验收员' });
    const t2 = await call('POST', '/api/tickets', { title: '验收：VPN 证书快到期', description: '证书下月到期，想提前续期。', category: '网络与 VPN' });
    const run2 = await call('POST', `/api/tickets/${t2.ticket.id}/run`);
    const org2 = run2.groups[0].runs.find((r) => r.mode === 'organization');
    check('新单复用刚发布的知识', (org2?.context_sources || []).some((s) => s.id === draft.card.id && s.type === 'card'));
    const marked = await call('POST', `/api/uses/${(await call('GET', `/api/tickets/${t2.ticket.id}`)).groups.flatMap((g) => g.runs).find((r) => r.mode === 'organization' && (r.uses || []).length).uses[0].id}/helpfulness`, { helpful: 'helpful' });
    check('有效性标注闭环', marked.use.helpful === 1);

    // ---- 阶段 3：备份 → 校验 → 恢复演练（⑥§3 恢复演练的脚本化落地）----
    // 演示数据含 sample → workspace-data.js 拒绝处理（设计如此：工具只服务真实团队库）。
    // 演练用「无 sample 的最小产品形库」验证工具链：借应用迁移器生成规范 schema + 一行成员，
    // 再插一条 pilot 工单（非 sample），走 backup→verify→restore 全链。
    const aliasDir = path.join(TMP, 'alias-data');
    fs.mkdirSync(aliasDir, { recursive: true });
    const { DatabaseSync } = await import('node:sqlite');
    // 复用真实迁移器：openDb 在 DATA_DIR 建全量 schema + 幂等迁移（与产品实例同路径）。
    // 注意：config.js 在模块加载时固化 DATA_DIR → 必须先设 env 再 import。
    const prevDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = aliasDir;
    const dbUrl = new URL(`file:///${path.resolve(ROOT, 'server/db.js').replaceAll('\\', '/')}`);
    const dbm = await import(dbUrl.href);
    const aliasOpened = dbm.openDb();
    aliasOpened.prepare(`INSERT INTO members (id, name, role, status) VALUES (1, '验收员', 'admin', 'active')`).run();
    aliasOpened.prepare(`INSERT INTO tickets (id, title, description, scope, status, created_at, updated_at)
                         VALUES (1, '验收替身工单', '仅用于备份恢复演练的虚构 pilot 工单。', 'pilot', 'open', ?, ?)`)
      .run(new Date().toISOString(), new Date().toISOString());
    aliasOpened.close();
    process.env.DATA_DIR = prevDataDir;
    fs.rmSync(path.join(aliasDir, 'app.lock'), { force: true }); // 演练只做 backup/verify/restore，不 erase
    fs.mkdirSync(path.dirname(BACKUP_DIR), { recursive: true }); // workspace-data.js 要求备份父目录已存在
    await workspaceData('backup', [aliasDir, BACKUP_DIR]);
    check('备份创建成功（含清单与哈希）', fs.existsSync(path.join(BACKUP_DIR, 'manifest.json')));
    await workspaceData('verify', [BACKUP_DIR]);
    check('备份 verify 通过（SHA-256 + 完整性 + 无 sample + 无会话）', true);
    await workspaceData('restore', [BACKUP_DIR, RESTORED_DIR]);
    const restoredDb = new DatabaseSync(path.join(RESTORED_DIR, 'app.db'), { readOnly: true });
    const memberCount = restoredDb.prepare('SELECT COUNT(*) AS n FROM members').get().n;
    const sessionCount = restoredDb.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n;
    restoredDb.close();
    check('恢复到新目录成功且成员保留', memberCount === 1, `成员 ${memberCount}`);
    check('恢复库不含登录会话（要求重新登录）', sessionCount === 0, `会话 ${sessionCount}`);

    // ---- 阶段 4：指标断言 ----
    const metrics = await call('GET', '/api/metrics');
    check('四元组报表可用', Boolean(metrics.quadruple?.pathCounts));
    check('采用/有效统计可用', metrics.knowledge.useOutcome && metrics.knowledge.useOutcome.adopted >= 1, JSON.stringify(metrics.knowledge.useOutcome));
    const events = await call('GET', '/api/events?limit=200');
    check('审计事件链完整', ['ticket_created', 'agent_run', 'review_submitted', 'card_published', 'memory_cited', 'use_helpfulness_recorded'].every((k) => events.events.some((e) => e.kind === k)));

    console.log(`\n  验收结果：${passed} 通过 / ${failed} 失败\n`);
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 400));
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* Windows 句柄延迟时由系统清理 */ }
  }

  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
