import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, DB_PATH } from './config.js';
import { nowIso } from './time.js';
import { migrateReviewSources } from './review-source.js';
import { migrateDataScopes } from './data-scope.js';

/**
 * 物理层 SCHEMA（ADR-008 E1：tickets 表在语义上是通用工作项事实表；表名/列名冻结至 E5 评审）。
 * work_item_type 列由 migrateWorkItemType 幂等补齐；类型词表见 work-items.js。
 */
const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  email TEXT,
  oidc_issuer TEXT,
  oidc_subject TEXT,
  status TEXT NOT NULL DEFAULT 'sample'
    CHECK (status IN ('sample','invited','active','disabled')),
  invited_at TEXT,
  invite_expires_at TEXT,
  activated_at TEXT
);

CREATE TABLE IF NOT EXISTS workspace_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
  updated_by_member_id INTEGER REFERENCES members(id),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oidc_login_flows (
  state_hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  nonce TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  urgency TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  assignee_id INTEGER REFERENCES members(id),
  outcome TEXT,
  outcome_note TEXT,
  resolved_at TEXT,
  scope TEXT NOT NULL DEFAULT 'sample' CHECK (scope IN ('sample','pilot')),
  source_ref TEXT NOT NULL DEFAULT '',
  desensitization TEXT NOT NULL DEFAULT 'unknown' CHECK (desensitization IN ('unknown','done','partial','not_needed')),
  authorized_by TEXT NOT NULL DEFAULT '',
  model_authorized_by TEXT NOT NULL DEFAULT '',
  model_authorized_base_url TEXT NOT NULL DEFAULT '',
  model_authorized_model TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_groups (
  id TEXT PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_group TEXT NOT NULL,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id),
  mode TEXT NOT NULL CHECK (mode IN ('personal','organization')),
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  context_sources TEXT NOT NULL DEFAULT '[]',
  tool_calls TEXT NOT NULL DEFAULT '[]',
  output TEXT NOT NULL,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL DEFAULT 'live',
  scope TEXT NOT NULL DEFAULT 'sample' CHECK (scope IN ('sample','pilot')),
  created_by_member_id INTEGER REFERENCES members(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  decision TEXT NOT NULL CHECK (decision IN ('adopt','edit','reject')),
  edited_text TEXT,
  rating INTEGER,
  reason TEXT NOT NULL DEFAULT '',
  reviewer TEXT NOT NULL,
  reviewer_member_id INTEGER REFERENCES members(id),
  review_source_type TEXT NOT NULL DEFAULT 'unknown'
    CHECK (review_source_type IN ('assistant','human','seed','unknown')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  source_ticket_id INTEGER REFERENCES tickets(id),
  status TEXT NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 1,
  scope TEXT NOT NULL DEFAULT 'sample' CHECK (scope IN ('sample','pilot')),
  source_kind TEXT NOT NULL DEFAULT 'unknown' CHECK (source_kind IN ('policy','guide','resolved_case','unknown')),
  source_ref TEXT NOT NULL DEFAULT '',
  applies_to TEXT NOT NULL DEFAULT '',
  approval_body TEXT NOT NULL DEFAULT '',
  valid_until TEXT,
  pilot_approved INTEGER NOT NULL DEFAULT 0,
  knowledge_owner TEXT NOT NULL DEFAULT '',
  supersedes_card_id INTEGER REFERENCES knowledge_cards(id),
  supersedes_version INTEGER,
  superseded_by_card_id INTEGER REFERENCES knowledge_cards(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS card_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES knowledge_cards(id),
  action TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  reviewer TEXT NOT NULL,
  reviewer_member_id INTEGER REFERENCES members(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_uses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES knowledge_cards(id),
  run_id INTEGER NOT NULL REFERENCES runs(id),
  ticket_id INTEGER NOT NULL REFERENCES tickets(id),
  snippet TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER REFERENCES tickets(id),
  kind TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'system',
  actor_member_id INTEGER REFERENCES members(id),
  summary TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL CHECK (category IN ('bug','idea','other')),
  message TEXT NOT NULL CHECK (length(trim(message)) BETWEEN 1 AND 2000),
  page TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','resolved')),
  reporter_member_id INTEGER NOT NULL REFERENCES members(id),
  updated_by_member_id INTEGER REFERENCES members(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_ticket ON runs(ticket_id);
CREATE INDEX IF NOT EXISTS idx_runs_group ON runs(run_group);
CREATE INDEX IF NOT EXISTS idx_reviews_run ON reviews(run_id);
CREATE INDEX IF NOT EXISTS idx_events_ticket ON events(ticket_id);
CREATE INDEX IF NOT EXISTS idx_events_kind_created ON events(kind, created_at);
CREATE INDEX IF NOT EXISTS idx_uses_card ON knowledge_uses(card_id);
CREATE INDEX IF NOT EXISTS idx_cards_status ON knowledge_cards(status);
CREATE INDEX IF NOT EXISTS idx_feedback_status_created ON feedback(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_reporter_created ON feedback(reporter_member_id, created_at DESC);
`;

export { REVIEW_SOURCES, REVIEW_SOURCE_LABEL, migrateReviewSources } from './review-source.js';
export { DATA_SCOPES, SCOPE_LABEL, SOURCE_KINDS, SOURCE_KIND_LABEL, DESENSITIZATION_STATES, DESENSITIZATION_LABEL, migrateDataScopes } from './data-scope.js';

export function openDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec(SCHEMA);
  migrateMemberAuth(db);
  migrateCardRevisions(db);
  migrateReviewSources(db);
  migrateDataScopes(db);
  migrateMemoryLoop(db);
  migrateRunPath(db);
  migrateWorkItemType(db);
  return db;
}

function migrateMemberAuth(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(members)').all().map((row) => row.name));
  const defs = [
    ['email', 'TEXT'],
    ['oidc_issuer', 'TEXT'],
    ['oidc_subject', 'TEXT'],
    ['status', `TEXT NOT NULL DEFAULT 'sample' CHECK (status IN ('sample','invited','active','disabled'))`],
    ['invited_at', 'TEXT'],
    ['invite_expires_at', 'TEXT'],
    ['activated_at', 'TEXT'],
  ];
  for (const [name, ddl] of defs) {
    if (!columns.has(name)) db.exec(`ALTER TABLE members ADD COLUMN ${name} ${ddl}`);
  }
  for (const [table, name] of [
    ['runs', 'created_by_member_id'],
    ['reviews', 'reviewer_member_id'],
    ['card_reviews', 'reviewer_member_id'],
    ['events', 'actor_member_id'],
  ]) {
    const tableColumns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
    if (!tableColumns.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} INTEGER REFERENCES members(id)`);
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_members_email ON members(lower(email)) WHERE email IS NOT NULL`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_members_oidc_identity
           ON members(oidc_issuer, oidc_subject)
           WHERE oidc_issuer IS NOT NULL AND oidc_subject IS NOT NULL`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_oidc_flows_expiry ON oidc_login_flows(expires_at)');
}

function migrateCardRevisions(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(knowledge_cards)').all().map((row) => row.name));
  if (!columns.has('supersedes_card_id')) {
    db.exec('ALTER TABLE knowledge_cards ADD COLUMN supersedes_card_id INTEGER REFERENCES knowledge_cards(id)');
  }
  if (!columns.has('supersedes_version')) {
    db.exec('ALTER TABLE knowledge_cards ADD COLUMN supersedes_version INTEGER');
  }
  if (!columns.has('superseded_by_card_id')) {
    db.exec('ALTER TABLE knowledge_cards ADD COLUMN superseded_by_card_id INTEGER REFERENCES knowledge_cards(id)');
  }
}

/** P2 记忆闭环（④§6.1）：knowledge_uses 采用/有效跟踪列，全部加列、可回退（旧代码忽略新列）。
 *  adopted/adopted_review_id 由权威审核回写（store.applyAdoptionToUses）；
 *  helpful 三态是成员手工标注，不与审核结果互相推断。 */
function migrateMemoryLoop(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(knowledge_uses)').all().map((row) => row.name));
  const defs = [
    ['adopted', 'INTEGER NOT NULL DEFAULT 0'],
    ['adopted_review_id', 'INTEGER REFERENCES reviews(id)'],
    ['helpful', 'INTEGER'],
    ['helpful_note', 'TEXT NOT NULL DEFAULT \'\''],
    ['helpful_by_member_id', 'INTEGER REFERENCES members(id)'],
    ['helpful_recorded_at', 'TEXT'],
  ];
  for (const [name, ddl] of defs) {
    if (!columns.has(name)) db.exec(`ALTER TABLE knowledge_uses ADD COLUMN ${name} ${ddl}`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_uses_card_adopted ON knowledge_uses(card_id, adopted)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_uses_run ON knowledge_uses(run_id)');
}

/** P2-5 / P4 前置（④§7、⑤§6）：runs 路径与延迟拆分列。v1 只落库不启用分层（routeRequest 属 P4）。 */
function migrateRunPath(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(runs)').all().map((row) => row.name));
  const defs = [
    ['path', "TEXT NOT NULL DEFAULT 'main'"],
    ['path_reason', "TEXT NOT NULL DEFAULT ''"],
    ['gate_ms', 'INTEGER NOT NULL DEFAULT 0'],
    ['retrieve_ms', 'INTEGER NOT NULL DEFAULT 0'],
    ['model_ms', 'INTEGER NOT NULL DEFAULT 0'],
    ['prompt_tokens', 'INTEGER'],
    ['completion_tokens', 'INTEGER'],
  ];
  for (const [name, ddl] of defs) {
    if (!columns.has(name)) db.exec(`ALTER TABLE runs ADD COLUMN ${name} ${ddl}`);
  }
}

/** P3 E2/E4（④§10.1）：通用工作项类型列 + 跨类型父子列。
 *  support_ticket 是首个场景适配；列被旧代码忽略即回退。
 *  状态 CHECK 冻结在 support_ticket 词表上（ADR-008：CHECK 重构仅 E5 触发时进行）。 */
function migrateWorkItemType(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(tickets)').all().map((row) => row.name));
  if (!columns.has('work_item_type')) {
    db.exec(`ALTER TABLE tickets ADD COLUMN work_item_type TEXT NOT NULL DEFAULT 'support_ticket'`);
  }
  if (!columns.has('parent_ticket_id')) {
    db.exec('ALTER TABLE tickets ADD COLUMN parent_ticket_id INTEGER REFERENCES tickets(id)');
  }
}

export { nowIso } from './time.js';

export const TICKET_STATUS = ['open', 'in_progress', 'resolved', 'reopened', 'escalated'];
export const CARD_STATUS = ['draft', 'pending', 'published', 'rejected', 'retired'];

export { DB_PATH, path };
