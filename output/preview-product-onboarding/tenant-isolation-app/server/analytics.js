import { searchMemory } from './retrieval.js';
import { cardMatchesScope, isKnowledgeExpired, SOURCE_KIND_LABEL } from './data-scope.js';

/**
 * 观察面板与组织记忆检索的独立查询层。
 * 从 store 拆出来：这一层的读法是「为观察服务」的聚合查询，
 * 与问题单流程的增删改不是一个变化频率。
 */
export function createAnalytics(db) {
  const stmt = {
    ticketCountByStatus: db.prepare('SELECT status, COUNT(*) AS n FROM tickets GROUP BY status'),
    modeStats: db.prepare(`SELECT r.mode,
                         COUNT(DISTINCT r.id) AS runs,
                         COUNT(v.id) AS reviews,
                         SUM(CASE WHEN v.decision IN ('adopt','edit') THEN 1 ELSE 0 END) AS adopted,
                         SUM(CASE WHEN v.decision = 'reject' THEN 1 ELSE 0 END) AS rejected,
                         AVG(v.rating) AS avg_rating
                  FROM runs r LEFT JOIN reviews v ON v.run_id = r.id GROUP BY r.mode`),
    // 审核来源拆分：seed/unknown 只用于历史口径，新写入仅有 human / assistant
    sourceStats: db.prepare(`SELECT r.mode, COALESCE(v.review_source_type, 'unknown') AS source_type,
                                    COUNT(v.id) AS reviews,
                                    SUM(CASE WHEN v.decision IN ('adopt','edit') THEN 1 ELSE 0 END) AS adopted,
                                    SUM(CASE WHEN v.decision = 'reject' THEN 1 ELSE 0 END) AS rejected,
                                    SUM(CASE WHEN v.rating IS NOT NULL THEN v.rating ELSE 0 END) AS rating_sum,
                                    SUM(CASE WHEN v.rating IS NOT NULL THEN 1 ELSE 0 END) AS rating_n
                             FROM runs r LEFT JOIN reviews v ON v.run_id = r.id
                             GROUP BY r.mode, source_type`),
    citationStats: db.prepare(`SELECT mode, COUNT(*) AS n FROM runs WHERE context_sources != '[]' GROUP BY mode`),
    ticketsByScope: db.prepare(`SELECT scope, COUNT(*) AS n FROM tickets GROUP BY scope`),
    runsByScope: db.prepare(`SELECT scope, COUNT(*) AS n FROM runs GROUP BY scope`),
    cardsByScope: db.prepare(`SELECT scope, COUNT(*) AS n FROM knowledge_cards GROUP BY scope`),
    pilotApprovedCards: db.prepare(`SELECT COUNT(*) AS n FROM knowledge_cards
                                    WHERE scope = 'pilot' AND pilot_approved = 1 AND status = 'published'
                                      AND superseded_by_card_id IS NULL`),
    usesCount: db.prepare('SELECT COUNT(*) AS n FROM knowledge_uses'),
    distinctReusedCards: db.prepare('SELECT COUNT(*) AS n FROM (SELECT card_id FROM knowledge_uses GROUP BY card_id)'),
    cardsPublished: db.prepare(`SELECT c.*, t.title AS source_title, t.category AS source_category FROM knowledge_cards c
                       LEFT JOIN tickets t ON t.id = c.source_ticket_id
                       WHERE c.status = 'published' AND c.superseded_by_card_id IS NULL ORDER BY c.updated_at DESC`),
    ticketResolvedCases: db.prepare(`SELECT * FROM tickets WHERE status = 'resolved' ORDER BY resolved_at DESC LIMIT 200`),
    // 试点专用候选：只取明确批准用于 pilot 的已发布卡，且必须带来源元数据
    cardsPilotApproved: db.prepare(`SELECT c.*, t.title AS source_title, t.category AS source_category FROM knowledge_cards c
                       LEFT JOIN tickets t ON t.id = c.source_ticket_id
                       WHERE c.status = 'published' AND c.scope = 'pilot' AND c.pilot_approved = 1
                         AND c.superseded_by_card_id IS NULL
                         AND c.source_kind IN ('policy','guide')
                       ORDER BY c.updated_at DESC`),
  };

  function metrics() {
    const counts = stmt.ticketCountByStatus.all().reduce((acc, r) => ({ ...acc, [r.status]: r.n }), {});
    const modes = stmt.modeStats.all().map((r) => ({
      mode: r.mode,
      runs: r.runs,
      reviews: r.reviews,
      adopted: r.adopted || 0,
      rejected: r.rejected || 0,
      adoptRate: r.reviews ? Math.round((r.adopted / r.reviews) * 100) : null,
      avgRating: r.avg_rating ? Number(r.avg_rating.toFixed(2)) : null,
    }));
    const citations = stmt.citationStats.all().reduce((acc, r) => ({ ...acc, [r.mode]: r.n }), {});
    const totalReviews = modes.reduce((a, m) => a + m.reviews, 0);
    const totalAdopted = modes.reduce((a, m) => a + m.adopted, 0);

    /* 按来源拆分：保留旧 modes / overall 的全部来源口径，另给人工专用口径。
     * 前端首页的人力判断指标只用 humanModes，避免把助手代审显示为人工审核。 */
    const sumOf = (r) => ({
      reviews: r.reviews,
      adopted: r.adopted || 0,
      rejected: r.rejected || 0,
      ratingSum: r.rating_sum || 0,
      ratingN: r.rating_n || 0,
    });
    const finish = (r) => ({
      reviews: r.reviews,
      adopted: r.adopted,
      rejected: r.rejected,
      adoptRate: r.reviews ? Math.round((r.adopted / r.reviews) * 100) : null,
      avgRating: r.ratingN ? Number((r.ratingSum / r.ratingN).toFixed(2)) : null,
    });
    const emptyBucket = () => ({ reviews: 0, adopted: 0, rejected: 0, ratingSum: 0, ratingN: 0, byMode: {} });
    const buckets = {};
    for (const row of stmt.sourceStats.all()) {
      const bucket = buckets[row.source_type] ||= emptyBucket();
      bucket.reviews += row.reviews;
      bucket.adopted += row.adopted || 0;
      bucket.rejected += row.rejected || 0;
      bucket.ratingSum += row.rating_sum || 0;
      bucket.ratingN += row.rating_n || 0;
      bucket.byMode[row.mode] = sumOf(row);
    }
    const bySource = {};
    for (const [source, b] of Object.entries(buckets)) {
      bySource[source] = {
        ...finish(b),
        byMode: Object.fromEntries(Object.entries(b.byMode).map(([mode, r]) => [mode, finish(r)])),
      };
    }
    const reviewsBySource = { assistant: 0, human: 0, seed: 0, unknown: 0 };
    for (const [source, b] of Object.entries(buckets)) reviewsBySource[source] = b.reviews;
    const human = bySource.human || { reviews: 0, adopted: 0, rejected: 0, adoptRate: null, avgRating: null, byMode: {} };
    const humanModes = modes.map((m) => {
      const h = human.byMode[m.mode] || { reviews: 0, adopted: 0, rejected: 0, adoptRate: null, avgRating: null };
      return { mode: m.mode, runs: m.runs, reviews: h.reviews, adopted: h.adopted, rejected: h.rejected, adoptRate: h.adoptRate, avgRating: h.avgRating };
    });
    const humanOverall = {
      reviews: human.reviews, adopted: human.adopted, rejected: human.rejected,
      adoptRate: human.adoptRate, avgRating: human.avgRating,
    };
    const countBy = (rows) => rows.reduce((acc, r) => ({ ...acc, [r.scope]: r.n }), {});

    return {
      tickets: {
        open: counts.open || 0,
        in_progress: counts.in_progress || 0,
        resolved: counts.resolved || 0,
        reopened: counts.reopened || 0,
        escalated: counts.escalated || 0,
        total: Object.values(counts).reduce((a, b) => a + b, 0),
      },
      modes,
      citations,
      // 数据范围：sample 模拟样本 / pilot 真实试点
      scope: {
        tickets: countBy(stmt.ticketsByScope.all()),
        runs: countBy(stmt.runsByScope.all()),
        cards: countBy(stmt.cardsByScope.all()),
        pilotApprovedCards: stmt.pilotApprovedCards.get().n,
      },
      // 来源分类：人工 / 助手 / 种子 / 未知；humanModes 只含组织成员提交的审核
      reviewsBySource,
      bySource,
      humanModes,
      humanOverall,
      knowledge: {
        totalUses: stmt.usesCount.get().n,
        distinctCardsUsed: stmt.distinctReusedCards.get().n,
        published: stmt.cardsPublished.all().length,
      },
      overall: {
        reviews: totalReviews,
        adopted: totalAdopted,
        adoptRate: totalReviews ? Math.round((totalAdopted / totalReviews) * 100) : null,
      },
    };
  }

  /**
   * 组织模式检索：已发布知识 + 已解决案例。
   *
   * scope 决定检索边界：
   *  - 不传（通用搜索接口）：保持旧行为——全部已发布卡 + 全部已解决案例；
   *    excludeTicketId 仍生效（自我检索修复），不传则不过滤。
   *  - 'sample'：模拟样本工单。同样走旧口径，保证首轮 10 组批次可复现。
   *  - 'pilot'：真实试点。排除所有 sample 工单与 sample 案例；知识卡只取
   *    scope=pilot 且 pilot_approved=1、带来源类型、适用范围匹配、未过期的
   *    policy/guide 卡。案例只取 scope=pilot 的已解决单，且一律标为参考。
   *
   * 返回项 meta 带 scope / source_kind / 来源元数据，便于界面与运行记录追溯。
   */
  function searchApprovedMemory(query, limit = 4, { excludeTicketId = null, scope = null, ticketCategory = '' } = {}) {
    const isPilot = scope === 'pilot';
    const now = Date.now();

    const notExpired = (card) => !isKnowledgeExpired(card.valid_until, now);
    const cardMeta = (c) => ({
      status: c.status,
      sourceTicketId: c.source_ticket_id,
      version: c.version,
      scope: c.scope || 'sample',
      source_kind: c.source_kind || 'unknown',
      source_kind_label: SOURCE_KIND_LABEL[c.source_kind] || SOURCE_KIND_LABEL.unknown,
      source_ref: c.source_ref || '',
      applies_to: c.applies_to || '',
      approval_body: c.approval_body || '',
      knowledge_owner: c.knowledge_owner || '',
      valid_until: c.valid_until || null,
      pilot_approved: Boolean(c.pilot_approved),
    });

    let cardRows = stmt.cardsPublished.all();
    if (isPilot) {
      cardRows = stmt.cardsPilotApproved.all()
        .filter((c) => notExpired(c) && cardMatchesScope(c, { category: ticketCategory }));
    }

    const cards = cardRows.map((c) => ({
      id: c.id,
      type: 'card',
      title: c.title,
      body: c.content,
      tags: c.tags,
      category: c.source_category || '',
      meta: cardMeta(c),
    }));

    let caseRows = stmt.ticketResolvedCases.all();
    if (isPilot) caseRows = caseRows.filter((t) => t.scope === 'pilot');
    const cases = caseRows
      .filter((t) => !excludeTicketId || t.id !== excludeTicketId)
      .map((t) => ({
        id: t.id,
        type: 'case',
        title: t.title,
        body: `${t.description}\n处理结果：${t.outcome || ''} ${t.outcome_note || ''}`,
        tags: t.category || '',
        category: t.category || '',
        meta: {
          resolvedAt: t.resolved_at,
          scope: t.scope || 'sample',
          source_kind: 'resolved_case',
          source_kind_label: SOURCE_KIND_LABEL.resolved_case,
          reference_only: true,
        },
      }));

    return searchMemory(query, [...cards, ...cases], { limit, category: ticketCategory });
  }

  return { metrics, searchApprovedMemory };
}
