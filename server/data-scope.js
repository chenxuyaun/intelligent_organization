/* 数据范围与知识来源分类。
 *
 * 与数据库路径、环境配置无关，可被独立迁移脚本直接引用。
 *
 * 口径：
 *  - scope=sample：虚构种子 / 模拟样本。保留旧检索行为，供首轮 10 组批次复现。
 *  - scope=pilot ：真实试点。检索默认排除 sample 工单与 sample 案例，只接受
 *                  明确批准、适用范围匹配、在有效期内的知识卡。
 *  - 运行 scope 自动继承工单 scope，不单独填写。
 *  - 知识来源 source_kind：policy / guide 为权威知识；resolved_case 仅相似参考；
 *    unknown 为历史来源，不能支撑制度性结论。
 */

export const DATA_SCOPES = ['sample', 'pilot'];
export const SCOPE_LABEL = { sample: '模拟样本', pilot: '真实试点' };

export const SOURCE_KINDS = ['policy', 'guide', 'resolved_case', 'unknown'];
export const SOURCE_KIND_LABEL = {
  policy: '制度政策',
  guide: '操作指引',
  resolved_case: '已解决案例（仅相似参考）',
  unknown: '来源未核实',
};

/** 试点工单脱敏状态：unknown 表示尚未声明，不能视为已脱敏。 */
export const DESENSITIZATION_STATES = ['unknown', 'done', 'partial', 'not_needed'];
export const DESENSITIZATION_LABEL = {
  unknown: '未声明',
  done: '已脱敏',
  partial: '部分脱敏',
  not_needed: '无需脱敏',
};

/** 只有 policy / guide 且带审批主体的知识卡可支撑制度性结论。 */
export const AUTHORITATIVE_KINDS = ['policy', 'guide'];

/** Expiry dates are date-only values: the card stays valid through that UTC day. */
export function isValidKnowledgeDate(value) {
  const date = String(value ?? '').trim();
  if (!date) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split('-').map(Number);
  if (year < 1000) return false;
  const timestamp = Date.UTC(year, month - 1, day);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date;
}

/** Invalid non-empty dates fail closed and are treated as expired. */
export function isKnowledgeExpired(validUntil, now = Date.now()) {
  const value = String(validUntil ?? '').trim();
  if (!value) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    if (!isValidKnowledgeDate(value)) return true;
    const [year, month, day] = value.split('-').map(Number);
    return now >= Date.UTC(year, month - 1, day + 1);
  }
  const timestamp = Date.parse(value);
  return !Number.isFinite(timestamp) || now >= timestamp;
}

export function isAuthoritative(source) {
  if (!source || source.type !== 'card') return false;
  return AUTHORITATIVE_KINDS.includes(source.meta?.source_kind);
}

/** 适用范围匹配：无法核实适用范围时一律不进入试点检索（fail closed）。 */
export function cardMatchesScope(card, ticket = {}) {
  const applies = String(card.applies_to || '').trim();
  if (!applies) return false;
  const scopes = applies.split(/[，,;；\n]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const universalScopes = new Set(['通用', '所有场景', '全部场景', 'all', 'any']);
  if (scopes.some((x) => universalScopes.has(x))) return true;
  const category = String(ticket.category || '').trim();
  if (!category) return false;
  const tagScopes = String(card.tags || '').split(/[，,;；\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const normalizedCategory = category.toLowerCase();
  return scopes.includes(normalizedCategory) || tagScopes.includes(normalizedCategory);
}

/** 制度性表述的检测词：命中且没有权威来源时提示人工核实制度。 */
const INSTITUTIONAL_RE = /公司规定|公司政策|制度要求|必须审批|一律需要|按制度|按规定|法定要求|强制要求/;
export function hasInstitutionalClaim(output) {
  const text = `${output?.draft_reply || ''} ${(output?.next_actions || []).join(' ')}`;
  return INSTITUTIONAL_RE.test(text);
}

/**
 * 幂等迁移：为工单 / 运行 / 知识卡补数据范围与来源元数据列。
 * 只补列和按可核实证据回填，不删除、不改写标题/正文/审核/引用等历史内容。
 *  - 全部现有工单、知识卡 → sample（都是虚构种子或模拟样本）
 *  - 运行 scope 从所属工单继承
 *  - 现有知识卡 source_kind → unknown（无审批主体/适用范围/有效期证据），
 *    pilot_approved → 0；历史来源不自动升级为制度依据
 */
export function migrateDataScopes(db) {
  const addColumns = (table, defs) => {
    const cols = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const [name, ddl] of defs) {
      if (!cols.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
    }
  };

  addColumns('tickets', [
    ['scope', `TEXT NOT NULL DEFAULT 'sample' CHECK (scope IN ('sample','pilot'))`],
    // 试点工单的授权来源与脱敏状态，默认空/未声明，历史行保持保守值
    ['source_ref', `TEXT NOT NULL DEFAULT ''`],
    ['desensitization', `TEXT NOT NULL DEFAULT 'unknown' CHECK (desensitization IN ('unknown','done','partial','not_needed'))`],
    ['authorized_by', `TEXT NOT NULL DEFAULT ''`],
    // 模型发送确认单独记录；历史工单默认未确认，不能据旧字段推断已授权发送。
    ['model_authorized_by', `TEXT NOT NULL DEFAULT ''`],
    ['model_authorized_base_url', `TEXT NOT NULL DEFAULT ''`],
    ['model_authorized_model', `TEXT NOT NULL DEFAULT ''`],
  ]);
  addColumns('runs', [
    ['scope', `TEXT NOT NULL DEFAULT 'sample' CHECK (scope IN ('sample','pilot'))`],
  ]);
  addColumns('knowledge_cards', [
    ['scope', `TEXT NOT NULL DEFAULT 'sample' CHECK (scope IN ('sample','pilot'))`],
    ['source_kind', `TEXT NOT NULL DEFAULT 'unknown' CHECK (source_kind IN ('policy','guide','resolved_case','unknown'))`],
    ['source_ref', `TEXT NOT NULL DEFAULT ''`],
    ['applies_to', `TEXT NOT NULL DEFAULT ''`],
    ['approval_body', `TEXT NOT NULL DEFAULT ''`],
    ['valid_until', `TEXT`],
    ['pilot_approved', `INTEGER NOT NULL DEFAULT 0`],
    // 知识负责人：谁对这条知识的内容负责，与审批主体分开记录
    ['knowledge_owner', `TEXT NOT NULL DEFAULT ''`],
  ]);

  // 幂等回填：只处理缺省/空值；不覆盖已明确写入的试点批准。
  db.exec(`UPDATE tickets SET scope = 'sample' WHERE scope IS NULL OR scope = ''`);
  db.exec(`UPDATE knowledge_cards SET scope = 'sample' WHERE scope IS NULL OR scope = ''`);
  db.exec(`UPDATE knowledge_cards SET source_kind = 'unknown'
           WHERE source_kind IS NULL OR source_kind = ''`);
  db.exec(`UPDATE knowledge_cards SET pilot_approved = 0 WHERE pilot_approved IS NULL`);
  // 运行始终继承工单范围；重复执行结果一致。
  db.exec(`UPDATE runs SET scope = COALESCE((SELECT t.scope FROM tickets t WHERE t.id = runs.ticket_id), 'sample')
           WHERE scope IS NULL OR scope = ''
              OR scope <> COALESCE((SELECT t.scope FROM tickets t WHERE t.id = runs.ticket_id), 'sample')`);

  db.exec('CREATE INDEX IF NOT EXISTS idx_tickets_scope ON tickets(scope)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_runs_scope ON runs(scope)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_cards_scope ON knowledge_cards(scope)');
}
