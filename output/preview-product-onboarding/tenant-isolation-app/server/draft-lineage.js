/**
 * Carry only explicit, same-scope published-card citations into a knowledge
 * draft. This is review context, not an approval or a claim that the draft is
 * itself authoritative.
 */
export function buildDraftLineage({ store, ticket, orgRun }) {
  const citations = Array.isArray(orgRun?.output?.citations) ? orgRun.output.citations : [];
  const seen = new Set();
  const sources = [];

  for (const citation of citations) {
    if (citation?.type !== 'card') continue;
    const id = Number(citation.id);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;

    const card = store.getCard(id);
    if (!card || card.status !== 'published' || card.scope !== ticket?.scope) continue;
    seen.add(id);
    sources.push({
      id,
      ref: String(citation.ref || `K${id}`),
      title: card.title,
      sourceKind: card.source_kind || 'unknown',
      sourceRef: String(card.source_ref || '').trim(),
      appliesTo: String(card.applies_to || '').trim(),
    });
  }

  const urls = [...new Set(sources.flatMap((source) => source.sourceRef
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)))];
  const kinds = new Set(sources.map((source) => source.sourceKind));
  const sourceKind = sources.length > 0
    && kinds.size === 1
    && ['policy', 'guide'].includes(sources[0].sourceKind)
    ? sources[0].sourceKind
    : 'unknown';
  const appliesTo = sources.map((source) =>
    `${source.ref}《${source.title}》：${source.appliesTo || '原卡未标注适用范围'}`,
  ).join('\n');

  const reviewNotes = sources.length ? [
    '引用依据（从本次组织答复引用的已发布知识带入；发布前需人工核验）：',
    ...sources.map((source) => [
      `- ${source.ref}《${source.title}》`,
      `  原适用范围：${source.appliesTo || '未标注'}`,
      `  来源链接：${source.sourceRef || '未记录'}`,
    ].join('\n')),
    `来源组织运行：R${orgRun.id}。请审核本草稿是否新增了可复用步骤，或与以上已发布知识重复。`,
  ].join('\n') : '';

  return {
    sourceKind,
    sourceRef: urls.join('\n'),
    appliesTo,
    reviewNotes,
    sourceRefs: sources.map((source) => source.ref),
  };
}
