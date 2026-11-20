#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream } from 'node:fs';
import { backup, DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL_ROOT = fs.realpathSync(ROOT);
const FORMAT = 'intelligent-organization-workspace-backup-v1';
const DB_NAME = 'app.db';
const LOCK_NAME = 'app.lock';
const MANIFEST_NAME = 'manifest.json';

function usage() {
  console.error(`
用法：
  node scripts/workspace-data.js backup <DATA_DIR> <BACKUP_DIR>
  node scripts/workspace-data.js verify <BACKUP_DIR>
  node scripts/workspace-data.js restore <BACKUP_DIR> <NEW_DATA_DIR>
  node scripts/workspace-data.js erase <DATA_DIR> --service-stopped --confirm "DELETE <canonical DATA_DIR>"

备份和恢复只接受不含 sample 演示数据的团队数据库。
恢复目标必须是新目录或空目录；不会覆盖已有文件。
删除命令需要操作者确认服务已停止，并精确输入数据目录确认词。
`);
}

function fail(message) {
  throw new Error(message);
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (
    !path.isAbsolute(relative)
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
  );
}

function assertOutsideProject(target, label) {
  const resolved = path.resolve(target);
  if (isWithin(REAL_ROOT, resolved)) fail(`${label} 必须放在项目目录之外，避免把团队数据放进代码仓库`);
  return resolved;
}

function existingWorkspaceDir(input, label) {
  const resolved = path.resolve(input);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) fail(`${label} 必须是已存在的目录`);
  return assertOutsideProject(fs.realpathSync(resolved), label);
}

function newWorkspaceDir(input, label) {
  const resolved = path.resolve(input);
  const parentDir = path.dirname(resolved);
  if (!fs.existsSync(parentDir) || !fs.statSync(parentDir).isDirectory()) {
    fail(`${label} 的父目录必须已存在`);
  }
  if (fs.existsSync(resolved) && fs.lstatSync(resolved).isSymbolicLink()) {
    fail(`${label} 不能是符号链接或目录联接`);
  }
  const canonical = path.join(fs.realpathSync(parentDir), path.basename(resolved));
  return assertOutsideProject(canonical, label);
}

function assertPathsDisjoint(a, b) {
  if (isWithin(a, b) || isWithin(b, a)) {
    fail('源目录与目标目录不能相同，也不能互相嵌套');
  }
}

function assertWorkspaceLockInactive(dataDir) {
  const lockPath = path.join(dataDir, LOCK_NAME);
  if (!fs.existsSync(lockPath)) return;
  const stat = fs.lstatSync(lockPath);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('工作区锁不是普通文件，拒绝删除');

  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    fail('工作区锁无法解析；请检查服务状态并人工处理，未删除任何内容');
  }
  if (!Number.isSafeInteger(lock.pid) || lock.pid < 1 || typeof lock.token !== 'string') {
    fail('工作区锁格式无效；请检查服务状态并人工处理，未删除任何内容');
  }
  try {
    process.kill(lock.pid, 0);
    fail(`工作区锁显示 PID ${lock.pid} 仍在运行；请停止该服务后再删除`);
  } catch (error) {
    if (error.code === 'EPERM') fail(`无法确认 PID ${lock.pid} 已停止；拒绝删除工作区`);
    if (error.code !== 'ESRCH') throw error;
  }
}

function readProductDatabase(dbPath, { requireCleanAuth = false } = {}) {
  if (!fs.existsSync(dbPath) || !fs.statSync(dbPath).isFile()) {
    fail(`数据库文件不存在：${dbPath}`);
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    for (const table of ['tickets', 'runs', 'knowledge_cards', 'members', 'auth_sessions', 'oidc_login_flows']) {
      if (!tables.has(table)) fail(`不是受支持的团队工作区数据库：缺少 ${table} 表`);
    }

    const columns = (table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
    if (!columns('tickets').has('scope') || !columns('knowledge_cards').has('scope') || !columns('members').has('status')) {
      fail('数据库结构较旧；请先使用当前应用完成结构升级，再备份或恢复');
    }

    const integrity = db.prepare('PRAGMA integrity_check').get()?.integrity_check;
    if (integrity !== 'ok') fail(`数据库完整性检查失败：${integrity || '无结果'}`);
    if (db.prepare('PRAGMA foreign_key_check').all().length > 0) {
      fail('数据库存在外键完整性问题');
    }

    const sampleCounts = {
      tickets: db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE scope = 'sample'").get().n,
      knowledge: db.prepare("SELECT COUNT(*) AS n FROM knowledge_cards WHERE scope = 'sample'").get().n,
      members: db.prepare("SELECT COUNT(*) AS n FROM members WHERE status = 'sample'").get().n,
    };
    if (Object.values(sampleCounts).some((count) => count > 0)) {
      fail('数据库包含 sample 演示数据；产品工作区备份工具拒绝处理它');
    }
    if (requireCleanAuth) {
      const transientAuth = db.prepare(`SELECT
        (SELECT COUNT(*) FROM auth_sessions) +
        (SELECT COUNT(*) FROM oidc_login_flows) AS n`).get().n;
      if (transientAuth > 0) fail('备份包含临时登录状态；拒绝恢复，请使用本工具新建备份');
    }

    return {
      counts: {
        tickets: db.prepare('SELECT COUNT(*) AS n FROM tickets').get().n,
        runs: db.prepare('SELECT COUNT(*) AS n FROM runs').get().n,
        knowledgeCards: db.prepare('SELECT COUNT(*) AS n FROM knowledge_cards').get().n,
        members: db.prepare('SELECT COUNT(*) AS n FROM members').get().n,
        feedback: tables.has('feedback') ? db.prepare('SELECT COUNT(*) AS n FROM feedback').get().n : 0,
      },
    };
  } finally {
    db.close();
  }
}

async function sha256(file) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return hash.digest('hex');
}

function loadBackup(backupDir) {
  const resolved = existingWorkspaceDir(backupDir, 'BACKUP_DIR');
  const manifestPath = path.join(resolved, MANIFEST_NAME);
  const dbPath = path.join(resolved, DB_NAME);
  const isRegularFile = (file) => fs.existsSync(file)
    && fs.lstatSync(file).isFile()
    && !fs.lstatSync(file).isSymbolicLink();
  if (!isRegularFile(manifestPath) || !isRegularFile(dbPath)) {
    fail('备份目录不完整：需要 app.db 和 manifest.json');
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    fail('备份清单不是有效 JSON');
  }
  if (manifest.format !== FORMAT || !/^[a-f0-9]{64}$/.test(manifest.sha256 || '')) {
    fail('备份清单格式或版本不受支持');
  }
  return { resolved, manifest, dbPath };
}

async function verifyBackup(backupDir) {
  const backupInfo = loadBackup(backupDir);
  const stats = fs.statSync(backupInfo.dbPath);
  if (stats.size !== backupInfo.manifest.bytes) fail('备份文件大小与清单不一致');
  if (await sha256(backupInfo.dbPath) !== backupInfo.manifest.sha256) fail('备份文件 SHA-256 校验失败');
  const inspected = readProductDatabase(backupInfo.dbPath, { requireCleanAuth: true });
  return { ...backupInfo, inspected };
}

async function createBackup(dataDir, backupDir) {
  const sourceDir = existingWorkspaceDir(dataDir, 'DATA_DIR');
  const targetDir = newWorkspaceDir(backupDir, 'BACKUP_DIR');
  assertPathsDisjoint(sourceDir, targetDir);
  const sourceDbPath = path.join(sourceDir, DB_NAME);
  const parentDir = path.dirname(targetDir);
  if (!fs.existsSync(parentDir) || !fs.statSync(parentDir).isDirectory()) {
    fail('备份目标的父目录必须已存在');
  }
  if (fs.existsSync(targetDir)) fail('备份目标已存在；为避免覆盖，请指定一个新目录');
  readProductDatabase(sourceDbPath);
  const stagingDir = `${targetDir}.partial-${process.pid}-${Date.now()}`;
  fs.mkdirSync(stagingDir);
  try {
    const sourceDb = new DatabaseSync(sourceDbPath, { readOnly: true });
    try {
      await backup(sourceDb, path.join(stagingDir, DB_NAME));
    } finally {
      sourceDb.close();
    }

    // A restore must require fresh login. Remove only transient auth material
    // from the copy; the source workspace is opened read-only and left untouched.
    const snapshot = new DatabaseSync(path.join(stagingDir, DB_NAME));
    try {
      snapshot.exec('BEGIN IMMEDIATE; DELETE FROM auth_sessions; DELETE FROM oidc_login_flows; COMMIT;');
      snapshot.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
      const journalMode = snapshot.prepare('PRAGMA journal_mode = DELETE').get()?.journal_mode;
      if (journalMode !== 'delete') fail('无法把备份快照整理为单文件数据库');
    } finally {
      snapshot.close();
    }

    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${path.join(stagingDir, DB_NAME)}${suffix}`;
      if (!fs.existsSync(sidecar)) continue;
      if (fs.statSync(sidecar).size > 0) fail('备份快照仍有未合并的 SQLite sidecar 文件');
      fs.rmSync(sidecar, { force: true });
    }

    const inspected = readProductDatabase(path.join(stagingDir, DB_NAME), { requireCleanAuth: true });
    const dbStats = fs.statSync(path.join(stagingDir, DB_NAME));
    const manifest = {
      format: FORMAT,
      createdAt: new Date().toISOString(),
      nodeVersion: process.version,
      bytes: dbStats.size,
      sha256: await sha256(path.join(stagingDir, DB_NAME)),
      counts: inspected.counts,
      excludedTables: ['auth_sessions', 'oidc_login_flows'],
    };
    fs.writeFileSync(path.join(stagingDir, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    fs.renameSync(stagingDir, targetDir);
    console.log(`备份已创建：${targetDir}`);
    console.log(`记录数：工单 ${inspected.counts.tickets}，运行 ${inspected.counts.runs}，知识卡 ${inspected.counts.knowledgeCards}，成员 ${inspected.counts.members}，反馈 ${inspected.counts.feedback}`);
    console.log('完整性与 SHA-256 校验通过；登录会话和临时登录流程未包含在备份中。');
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

async function restoreBackup(backupDir, dataDir) {
  const verified = await verifyBackup(backupDir);
  const targetDir = newWorkspaceDir(dataDir, '恢复目标 DATA_DIR');
  assertPathsDisjoint(verified.resolved, targetDir);
  const existed = fs.existsSync(targetDir);
  if (existed) {
    if (!fs.statSync(targetDir).isDirectory() || fs.readdirSync(targetDir).length > 0) {
      fail('恢复目标必须是新目录或空目录；不会覆盖现有文件');
    }
  } else {
    fs.mkdirSync(targetDir, { recursive: false });
  }

  const targetDbPath = path.join(targetDir, DB_NAME);
  try {
    fs.copyFileSync(verified.dbPath, targetDbPath, fs.constants.COPYFILE_EXCL);
    const restored = readProductDatabase(targetDbPath);
    console.log(`工作区已恢复到新目录：${targetDir}`);
    console.log(`记录数：工单 ${restored.counts.tickets}，运行 ${restored.counts.runs}，知识卡 ${restored.counts.knowledgeCards}，成员 ${restored.counts.members}，反馈 ${restored.counts.feedback}`);
    console.log('应用需使用该目录作为 DATA_DIR；旧目录未被修改。成员需要重新登录。');
  } catch (error) {
    if (fs.existsSync(targetDbPath)) fs.rmSync(targetDbPath, { force: true });
    if (!existed) fs.rmdirSync(targetDir);
    throw error;
  }
}

function eraseWorkspace(dataDir, serviceStoppedFlag, confirmation) {
  if (serviceStoppedFlag !== '--service-stopped') {
    fail('删除前必须停止产品服务，并显式传入 --service-stopped');
  }
  if (!path.isAbsolute(dataDir)) fail('删除命令只接受绝对 DATA_DIR 路径');
  const inputDir = path.resolve(dataDir);
  if (!fs.existsSync(inputDir) || !fs.lstatSync(inputDir).isDirectory() || fs.lstatSync(inputDir).isSymbolicLink()) {
    fail('DATA_DIR 必须是实际存在的普通目录，不能是符号链接或目录联接');
  }
  const targetDir = fs.realpathSync(inputDir);
  assertOutsideProject(targetDir, 'DATA_DIR');
  if (isWithin(targetDir, REAL_ROOT)) fail('DATA_DIR 不能是项目目录本身或其上级目录');

  const expectedConfirmation = `DELETE ${targetDir}`;
  if (confirmation !== expectedConfirmation) {
    fail(`确认文本不匹配；如确认服务已停止且目标无误，请输入：${expectedConfirmation}`);
  }

  assertWorkspaceLockInactive(targetDir);
  const allowedNames = new Set([LOCK_NAME, DB_NAME, `${DB_NAME}-wal`, `${DB_NAME}-shm`, `${DB_NAME}-journal`]);
  const assertKnownRegularFiles = (entries) => {
    const unexpected = entries.filter((name) => !allowedNames.has(name));
    if (unexpected.length) {
      fail(`DATA_DIR 含有不属于工作区数据库的文件；为避免误删，未删除任何内容：${unexpected.join(', ')}`);
    }
    for (const name of entries) {
      const stat = fs.lstatSync(path.join(targetDir, name));
      if (!stat.isFile() || stat.isSymbolicLink()) fail(`拒绝删除非普通文件：${name}`);
    }
  };
  assertKnownRegularFiles(fs.readdirSync(targetDir));

  const dbPath = path.join(targetDir, DB_NAME);
  if (!fs.existsSync(dbPath)) fail('DATA_DIR 中没有 app.db，拒绝猜测要删除的目标');
  const inspected = readProductDatabase(dbPath);
  // Read-only validation may create a SQLite shared-memory sidecar; recheck before removal.
  assertKnownRegularFiles(fs.readdirSync(targetDir));
  assertWorkspaceLockInactive(targetDir);

  // Remove SQLite sidecars first so a failure leaves the primary database intact where possible.
  for (const name of [`${DB_NAME}-wal`, `${DB_NAME}-shm`, `${DB_NAME}-journal`, DB_NAME, LOCK_NAME]) {
    const file = path.join(targetDir, name);
    if (fs.existsSync(file)) fs.rmSync(file);
  }
  console.log(`已删除工作区数据库文件；目录保留：${targetDir}`);
  console.log(`本次工作区包含：工单 ${inspected.counts.tickets}，运行 ${inspected.counts.runs}，知识卡 ${inspected.counts.knowledgeCards}，成员 ${inspected.counts.members}，反馈 ${inspected.counts.feedback}`);
  console.log('此命令不删除其他导出文件、独立备份或存储快照，也不保证介质级安全擦除；需按部署方保留策略另行清理。');
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'erase') {
    const [dataDir, serviceStoppedFlag, confirmFlag, confirmation, ...extra] = args;
    if (!dataDir || serviceStoppedFlag !== '--service-stopped' || confirmFlag !== '--confirm' || !confirmation || extra.length) {
      usage();
      process.exitCode = 2;
      return;
    }
    return eraseWorkspace(dataDir, serviceStoppedFlag, confirmation);
  }

  const [first, second, ...extra] = args;
  if (extra.length || !command || !first || (command !== 'verify' && !second) || (command === 'verify' && second)) {
    usage();
    process.exitCode = 2;
    return;
  }

  if (command === 'backup') return createBackup(first, second);
  if (command === 'verify') {
    const verified = await verifyBackup(first);
    console.log(`备份有效：${verified.resolved}`);
    console.log(`创建时间：${verified.manifest.createdAt}`);
    console.log(`SHA-256：${verified.manifest.sha256}`);
    console.log(`记录数：工单 ${verified.inspected.counts.tickets}，运行 ${verified.inspected.counts.runs}，知识卡 ${verified.inspected.counts.knowledgeCards}，成员 ${verified.inspected.counts.members}，反馈 ${verified.inspected.counts.feedback}`);
    return;
  }
  if (command === 'restore') return restoreBackup(first, second);
  usage();
  process.exitCode = 2;
}

main().catch((error) => {
  console.error(`失败：${error.message}`);
  process.exitCode = 1;
});
