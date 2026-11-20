import http from 'node:http';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PUBLIC_DIR, HOST, PORT, DB_PATH, PRODUCT_MODE, ORG_NAME, modelStatus, validateProductConfig } from './config.js';
import { openDb } from './db.js';
import { createStore } from './store.js';
import { createApi } from './api.js';
import { seedIfEmpty } from './seed.js';
import { createAuth } from './auth.js';
import { PROMPT_VERSION } from './agent.js';
import { UI_PROMPT_VERSION } from '../public/app-version.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
};

const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'",
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
};

function serveStatic(req, res, pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Bad path');
    return;
  }
  if (decodedPath.includes('\0')) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Bad path');
    return;
  }
  const baseDir = path.resolve(PUBLIC_DIR);
  const rel = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^([/\\])+/, '');
  const filePath = path.resolve(baseDir, rel);
  const relative = path.relative(baseDir, filePath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // 前端用 hash 路由，未知路径回落到首页
      if (!path.extname(pathname)) {
        fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
          if (e2) res.writeHead(404).end('Not found');
          else res.writeHead(200, { 'content-type': MIME['.html'] }).end(html);
        });
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    res.end(data);
  });
}

function assertProductDatabaseCleanBeforeMigration(dbPath) {
  if (!PRODUCT_MODE || !fs.existsSync(dbPath)) return;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    const relevantTables = ['tickets', 'knowledge_cards', 'members'];
    if (!relevantTables.some((table) => tables.has(table))) return;
    if (!relevantTables.every((table) => tables.has(table))) {
      throw new Error('产品模式拒绝升级结构不完整的既有数据库；请使用全新的 DATA_DIR');
    }

    const columns = (table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
    if (!columns('tickets').has('scope') || !columns('knowledge_cards').has('scope') || !columns('members').has('status')) {
      throw new Error('产品模式无法在迁移前确认既有数据库不含演示数据；请使用全新的 DATA_DIR');
    }

    const sampleCount = db.prepare(`SELECT
      (SELECT COUNT(*) FROM tickets WHERE scope = 'sample') +
      (SELECT COUNT(*) FROM knowledge_cards WHERE scope = 'sample') +
      (SELECT COUNT(*) FROM members WHERE status = 'sample') AS n`).get().n;
    if (sampleCount > 0) {
      throw new Error('产品模式不能使用含演示工单、知识或成员的数据库；已在迁移前停止，请为客户设置全新的 DATA_DIR');
    }
  } finally {
    db.close();
  }
}

const WORKSPACE_LOCK_NAME = 'app.lock';
let workspaceLockFd = null;
let workspaceLockPath = null;
let workspaceLockToken = null;

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

function releaseWorkspaceLock() {
  if (workspaceLockFd === null) return;
  try {
    const current = JSON.parse(fs.readFileSync(workspaceLockPath, 'utf8'));
    if (current.pid === process.pid && current.token === workspaceLockToken) {
      fs.unlinkSync(workspaceLockPath);
    }
  } catch {
    // Keep shutdown best-effort; the next operator can inspect a stale lock.
  }
  try {
    fs.closeSync(workspaceLockFd);
  } catch {
    // The descriptor may already be closed during process shutdown.
  }
  workspaceLockFd = null;
  workspaceLockPath = null;
  workspaceLockToken = null;
}

function acquireWorkspaceLock() {
  if (!PRODUCT_MODE) return;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  workspaceLockPath = path.join(path.dirname(DB_PATH), WORKSPACE_LOCK_NAME);
  const record = { pid: process.pid, token: randomUUID(), startedAt: new Date().toISOString() };
  let fd;
  try {
    fd = fs.openSync(workspaceLockPath, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(record), 'utf8');
    fs.fsyncSync(fd);
    workspaceLockFd = fd;
    workspaceLockToken = record.token;
    process.on('exit', releaseWorkspaceLock);
  } catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
      try { fs.unlinkSync(workspaceLockPath); } catch { /* ignore */ }
    }
    if (error.code !== 'EEXIST') throw error;

    let existing;
    try {
      existing = JSON.parse(fs.readFileSync(workspaceLockPath, 'utf8'));
    } catch {
      throw new Error(`工作区锁 ${workspaceLockPath} 无法读取。请确认没有服务正在运行，再人工检查并清理该锁文件。`);
    }
    if (!Number.isSafeInteger(existing.pid) || existing.pid < 1 || typeof existing.token !== 'string') {
      throw new Error(`工作区锁 ${workspaceLockPath} 格式无效。请确认没有服务正在运行，再人工检查并清理该锁文件。`);
    }
    if (isProcessAlive(existing.pid)) {
      throw new Error(`工作区 ${path.dirname(DB_PATH)} 正由 PID ${existing.pid} 使用；为避免并发访问，当前实例未启动。`);
    }
    throw new Error(`工作区锁记录的 PID ${existing.pid} 已不存在，但锁文件仍在。请人工确认后删除 ${workspaceLockPath}，再重新启动。`);
  }
}

// Product mode must reject demo data before openDb() can apply migrations.
validateProductConfig();
acquireWorkspaceLock();
assertProductDatabaseCleanBeforeMigration(DB_PATH);
const db = openDb();
// 前端图标统一用 RemixIcon（随 public/vendor 分发）；缺失时提前提醒，避免界面图标全空
if (!fs.existsSync(path.join(PUBLIC_DIR, 'vendor', 'remixicon', 'remixicon.css'))) {
  console.warn('警告：public/vendor/remixicon 缺失，执行 npm i && npm run vendor-icons 或重新安装依赖');
}
const store = createStore(db);
// 版本一致性断言（路线图 P1 工项 3、①R9）：前后端提示词版本必须同源。
// 两者本就应引用同一常量；不一致即有人复制了旧值，拒绝启动强制对齐。
if (UI_PROMPT_VERSION !== PROMPT_VERSION) {
  throw new Error(`提示词版本不一致：服务端 ${PROMPT_VERSION}，前端 ${UI_PROMPT_VERSION}。请核对 public/app.js UI_PROMPT_VERSION 与 server/agent.js PROMPT_VERSION 后重启。`);
}
if (PRODUCT_MODE) {
  const sampleCount = db.prepare(`SELECT
    (SELECT COUNT(*) FROM tickets WHERE scope = 'sample') +
    (SELECT COUNT(*) FROM knowledge_cards WHERE scope = 'sample') +
    (SELECT COUNT(*) FROM members WHERE status = 'sample') AS n`).get().n;
  if (sampleCount > 0) {
    throw new Error('产品模式不能使用含演示工单、知识或成员的数据库。请为客户设置独立、全新的 DATA_DIR。');
  }
}
const seeded = PRODUCT_MODE ? false : await seedIfEmpty(store);
const auth = await createAuth(db);
const handleApi = createApi(store, auth);

const server = http.createServer(async (req, res) => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  if (PRODUCT_MODE) res.setHeader('strict-transport-security', 'max-age=31536000');
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    const handled = await handleApi(req, res);
    if (!handled) res.writeHead(404).end('{}');
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end('Method not allowed');
    return;
  }
  serveStatic(req, res, url.pathname);
});

server.once('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`启动失败：${HOST}:${PORT} 已被占用。可能已有服务在运行；本程序不会自动停止它。请先检查现有服务，或为新实例配置其他 PORT。`);
  } else {
    console.error(`启动失败：无法监听 ${HOST}:${PORT}。${error.message}`);
  }
  try {
    db.close();
  } catch {
    /* ignore */
  }
  releaseWorkspaceLock();
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  const model = modelStatus();
  const counts = store.metrics();
  console.log('');
  console.log(`  ${PRODUCT_MODE ? '组织智能工作台 · 产品模式' : '组织智能实验台 · 演示模式'} · 已启动`);
  console.log(`  地址      http://${HOST}:${PORT}`);
  console.log(`  数据      ${DB_PATH}`);
  console.log(`  模型      ${model.modeLabel}（${model.mode === 'live' ? model.model : '未配置 MODEL_API_KEY'}）`);
  console.log(`  组织      ${PRODUCT_MODE ? store.workspaceName(ORG_NAME) : '示例团队 · IT 支持组'}`);
  console.log(`  状态      ${counts.tickets.total} 张问题单 / ${counts.knowledge.published} 条已发布知识${seeded ? '（本次已载入演示数据）' : ''}`);
  console.log('');
});

const shutdown = () => {
  server.close(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    releaseWorkspaceLock();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
