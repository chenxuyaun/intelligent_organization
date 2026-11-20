/* 审核来源分类：与数据库路径、环境配置无关，可被独立迁移脚本直接引用。 */

export const REVIEW_SOURCES = ['assistant', 'human', 'seed', 'unknown'];
export const REVIEW_SOURCE_LABEL = {
  assistant: '助手代审', human: '人工审核', seed: '种子演示', unknown: '来源未知',
};

/**
 * 幂等迁移：为旧库补审核来源列，并按可核实证据回填。
 * 只更新仍为 unknown 的行；不删除、不改写决定/评分/修订稿/理由/审核者/时间。
 *   1) reviewer 精确等于「Codex（助手代审）」 → assistant
 *   2) 关联运行的 origin='demo'（可确认来自种子演示运行） → seed
 *   3) 其余无法确认来源的历史记录保持 unknown
 */
export function migrateReviewSources(db) {
  const cols = db.prepare('PRAGMA table_info(reviews)').all();
  if (!cols.some((c) => c.name === 'review_source_type')) {
    db.exec(`ALTER TABLE reviews ADD COLUMN review_source_type TEXT NOT NULL DEFAULT 'unknown'
             CHECK (review_source_type IN ('assistant','human','seed','unknown'))`);
  }
  db.exec(`UPDATE reviews SET review_source_type = 'assistant'
           WHERE review_source_type = 'unknown' AND reviewer = 'Codex（助手代审）'`);
  db.exec(`UPDATE reviews SET review_source_type = 'seed'
           WHERE review_source_type = 'unknown'
             AND run_id IN (SELECT id FROM runs WHERE origin = 'demo')`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_reviews_source ON reviews(review_source_type)');
}
