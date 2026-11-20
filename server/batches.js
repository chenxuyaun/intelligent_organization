/* ------------------------------------------------------------------ *
 * 观察批次定义与聚合视图。
 *
 * 口径：批次以 research/observations 记录中的 run_group 白名单为准，
 * 不按工单 ID 筛选——#15–17 的复验组、#20 较早的重复运行、demo 演示
 * 运行和其它探索运行都不在名单内，天然排除。
 *
 * 审核口径：每条运行按最新一条审核记录决定「当前状态」，全部历史保留
 * 在 run.reviews 里；来源只看 review_source_type，不从 reviewer 名称推断。
 * 本文件只读数据库，不写任何数据；人工审核仍走问题单详情页既有流程。
 * ------------------------------------------------------------------ */

export const OBSERVATION_BATCHES = [
  {
    id: 'pilot-2026-11',
    label: '观察批次 01 · live 模型首轮模拟试跑',
    source: 'research/observations/2026-11-live-model-simulated-pilot.md',
    sampleNote:
      '本批次全部为模拟样本：#18–21 是启动种子模拟数据，#22–27 是标题带「模拟观察」的新增数据。'
      + '这些工单没有真实业务结果，任何统计都不能当作真实业务成效展示。',
    criteria:
      '入选 10 组成对运行（个人 + 组织各一条，共 20 条 live 输出，提示词版本 support-agent-v1）。'
      + '排除：#15–17 的首轮探索组与修复复验组（存在自我检索泄漏或属复验）、#20 较早的重复运行、demo 演示运行。',
    pairs: [
      { ticketId: 18, runGroup: 'gmwj10vi5lsjd', dataClass: '种子模拟' },
      { ticketId: 19, runGroup: 'gmwj118duewwi', dataClass: '种子模拟' },
      { ticketId: 20, runGroup: 'gmwj0sn8004a2', dataClass: '种子模拟' },
      { ticketId: 21, runGroup: 'gmwj11m780ye0', dataClass: '种子模拟' },
      { ticketId: 22, runGroup: 'gmwj14na9je9a', dataClass: '模拟观察 S01' },
      { ticketId: 23, runGroup: 'gmwj152q50izn', dataClass: '模拟观察 S02' },
      { ticketId: 24, runGroup: 'gmwj15knglngx', dataClass: '模拟观察 S03' },
      { ticketId: 25, runGroup: 'gmwj1646effy7', dataClass: '模拟观察 S04' },
      { ticketId: 26, runGroup: 'gmwj16n2zcqrh', dataClass: '模拟观察 S05' },
      { ticketId: 27, runGroup: 'gmwj171g9vnqh', dataClass: '模拟观察 S06' },
    ],
  },
];

const SOURCE_BUCKETS = ['human', 'assistant', 'seed', 'unknown'];
const bucketOf = (source) => (source === 'seed' || source === 'unknown' ? 'seedUnknown' : source);

/** 最新审核：run.reviews 由数据层按 id DESC 返回，[0] 即最新决定。 */
function latestReview(run) {
  return run && run.reviews && run.reviews.length ? run.reviews[0] : null;
}
function sourceOf(run) {
  const r = latestReview(run);
  return r ? (r.review_source_type || 'unknown') : 'unreviewed';
}
function reviewInfo(run) {
  const r = latestReview(run);
  if (!r) return null;
  return {
    id: r.id,
    decision: r.decision,
    sourceType: r.review_source_type || 'unknown',
    reviewer: r.reviewer,
    rating: r.rating,
    reason: r.reason,
    editedText: r.edited_text,
    createdAt: r.created_at,
    historyCount: run.reviews.length,
  };
}

/** 只读聚合：把批次定义展开为可展示的配对视图 + 明确分母的统计。 */
export function buildBatchView(store, def) {
  const pairs = def.pairs.map((p) => {
    const ticket = store.getTicket(p.ticketId);
    const runs = ticket ? store.runsByTicket(p.ticketId).filter((r) => r.run_group === p.runGroup) : [];
    const personal = runs.find((r) => r.mode === 'personal') || null;
    const organization = runs.find((r) => r.mode === 'organization') || null;
    return {
      ...p,
      ticket: ticket
        ? { id: ticket.id, title: ticket.title, status: ticket.status, category: ticket.category, urgency: ticket.urgency }
        : null,
      personal,
      organization,
      // 兼容旧字段：当前决定取最新审核，不是「存在任意审核」
      reviewState: {
        personal: latestReview(personal)?.decision || null,
        organization: latestReview(organization)?.decision || null,
      },
      reviewInfo: { personal: reviewInfo(personal), organization: reviewInfo(organization) },
      reviewSource: { personal: sourceOf(personal), organization: sourceOf(organization) },
      missing: !personal || !organization,
    };
  });

  /* 运行级旧口径：全部来源合并，保留给旧页面对照；分母 = 20 条入选运行。 */
  const blank = () => ({ adopt: 0, edit: 0, reject: 0, unreviewed: 0, total: 0 });
  const byMode = { personal: blank(), organization: blank() };
  for (const p of pairs) {
    for (const mode of ['personal', 'organization']) {
      const d = p.reviewState[mode];
      byMode[mode].total += 1;
      if (d) byMode[mode][d] += 1;
      else byMode[mode].unreviewed += 1;
    }
  }
  const runsTotal = blank();
  for (const mode of Object.keys(byMode)) {
    for (const k of Object.keys(runsTotal)) runsTotal[k] += byMode[mode][k];
  }

  /* 运行级新口径：按审核来源分桶。每个桶的分母都是同样的 20 条运行，
   * 桶内只数「最新审核属于该来源」的运行；未审核不摊进任何决定。 */
  const bySource = {};
  for (const key of [...SOURCE_BUCKETS, 'seedUnknown']) {
    bySource[key] = { ...blank(), reviewed: 0, personal: 0, organization: 0, denominator: runsTotal.total };
  }
  for (const p of pairs) {
    for (const mode of ['personal', 'organization']) {
      const src = p.reviewSource[mode];
      if (src === 'unreviewed') continue;
      for (const key of new Set([src, bucketOf(src)])) {
        const cell = bySource[key];
        cell.reviewed += 1;
        cell[mode] += 1;
        const d = p.reviewState[mode];
        if (d) cell[d] += 1;
      }
    }
  }
  for (const cell of Object.values(bySource)) {
    cell.unreviewed = cell.denominator - cell.reviewed;
  }

  /* 组级旧口径：分母 = 10 组；「有记录」含所有来源。 */
  const groups = { total: pairs.length, reviewed: 0, partial: 0, unreviewed: 0 };
  /* 组级新口径：both = 两侧最新审核都属于该来源；any = 至少一侧属于该来源。 */
  const groupsBySource = {};
  for (const key of [...SOURCE_BUCKETS, 'seedUnknown']) groupsBySource[key] = { both: 0, any: 0 };
  groupsBySource.mixed = 0;
  for (const p of pairs) {
    const a = p.reviewState.personal;
    const b = p.reviewState.organization;
    if (a && b) groups.reviewed += 1;
    else if (a || b) groups.partial += 1;
    else groups.unreviewed += 1;

    const sa = p.reviewSource.personal;
    const sb = p.reviewSource.organization;
    if (sa === 'unreviewed' && sb === 'unreviewed') continue;
    const setA = sa === 'unreviewed' ? [] : new Set([sa, bucketOf(sa)]);
    const setB = sb === 'unreviewed' ? [] : new Set([sb, bucketOf(sb)]);
    const shared = [...setA].filter((s) => setB.has(s));
    for (const key of shared) groupsBySource[key].both += 1;
    for (const key of new Set([...setA, ...setB])) groupsBySource[key].any += 1;
    if (sa !== 'unreviewed' && sb !== 'unreviewed' && sa !== sb) groupsBySource.mixed += 1;
  }
  groupsBySource.denominator = pairs.length;

  return {
    batch: {
      id: def.id, label: def.label, source: def.source,
      sampleNote: def.sampleNote, criteria: def.criteria,
      rule: '每条运行按最新一条审核决定当前状态；审核来源只认 review_source_type：human 人工 / assistant 助手代审 / seed 种子演示 / unknown 来源未知。历史审核全部保留。',
    },
    stats: { groups, groupsBySource, runs: { denominator: runsTotal.total, byMode, total: runsTotal, bySource } },
    pairs,
  };
}
