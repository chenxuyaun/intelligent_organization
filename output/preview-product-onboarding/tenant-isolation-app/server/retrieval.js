/**
 * 本地全文检索（中英混合，无外部依赖）
 *
 * 为什么不用 SQLite FTS5：FTS5 的 unicode61 分词器把整段中文当成一个 token，
 * 中文短查询几乎命中不了；trigram 又要求查询 >= 3 字。问题单只有几十条，
 * 直接做加权打分更可控，也更容易解释「为什么引用了这一条」。
 *
 * 换向量检索的接缝就在这个文件：只要保持 searchMemory(query, corpus) 的签名与返回结构。
 */

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;
const STOP = new Set([
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '怎么',
  '如何', '可以', '需要', '这个', '那个', '我们', '你们', '问题', '情况', 'the', 'a', 'an',
  'and', 'or', 'to', 'of', 'is', 'it', 'my', 'i', 'for', 'on', 'in', 'with', 'please',
]);

export function tokenize(text) {
  const out = [];
  const src = String(text || '').toLowerCase();
  const latin = src.match(/[a-z0-9][a-z0-9._-]*/g) || [];
  for (const w of latin) {
    if (w.length >= 2 && !STOP.has(w)) out.push(w);
  }
  // 中文：取二元组，避免依赖分词词典
  const runs = String(text || '').match(/[\u3400-\u9fff\uf900-\ufaff]+/g) || [];
  for (const run of runs) {
    if (run.length === 1) {
      if (!STOP.has(run)) out.push(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i += 1) {
      const gram = run.slice(i, i + 2);
      if (!STOP.has(gram)) out.push(gram);
    }
  }
  return out;
}

function termFrequency(tokens) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

function idf(token, docs) {
  const df = docs.reduce((acc, d) => acc + (d.tf.has(token) ? 1 : 0), 0);
  return Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
}

/**
 * 从正文中选择与问题相关的完整段落。
 * 单一命中窗口可能只保留长卡片后半段，漏掉前面定义的关键规则；
 * 多段摘录让模型能同时看到问题里涉及的不同规则。
 */
export function snippet(text, queryTokens, size = 640) {
  const paragraphs = String(text || '')
    .replace(/\r/g, '')
    .split(/\n+/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const src = paragraphs.join(' ');
  if (!src) return '';
  if (src.length <= size) return src;

  const tokens = [...new Set((queryTokens || [])
    .map((token) => String(token).toLowerCase())
    .filter((token) => token.length >= 2))];
  if (!tokens.length) return `${src.slice(0, size)}…`;

  const ranked = paragraphs
    .map((paragraph, index) => {
      const lower = paragraph.toLowerCase();
      const matches = tokens.filter((token) => lower.includes(token));
      const score = matches.reduce((total, token) => total + (token.length >= 5 ? 2 : 1), 0);
      return { paragraph, index, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  if (!ranked.length) return `${src.slice(0, size)}…`;

  const selected = [];
  let used = 0;
  for (const item of ranked) {
    const separatorLength = selected.length ? 5 : 0; // " … "
    const remaining = size - used - separatorLength;
    if (item.paragraph.length <= remaining) {
      selected.push(item);
      used += item.paragraph.length + separatorLength;
      continue;
    }
    if (!selected.length && remaining > 80) {
      const lower = item.paragraph.toLowerCase();
      const hit = tokens.map((token) => lower.indexOf(token)).find((index) => index >= 0) ?? 0;
      const start = Math.max(0, hit - Math.floor(remaining / 3));
      selected.push({ ...item, paragraph: item.paragraph.slice(start, start + remaining) });
      break;
    }
  }

  if (!selected.length) return `${src.slice(0, size)}…`;
  selected.sort((a, b) => a.index - b.index);
  const parts = selected.map((item, index) => {
    const previous = selected[index - 1];
    const omittedBefore = index === 0 ? item.index > 0 : item.index > previous.index + 1;
    return `${omittedBefore ? '…' : ''}${item.paragraph}`;
  });
  if (selected.at(-1).index < paragraphs.length - 1) parts[parts.length - 1] += '…';
  return parts.join(' … ');
}

/**
 * @param {string} query 问题单标题 + 描述
 * @param {Array<{id:number, type:'card'|'case', title:string, body:string, tags?:string, meta?:object}>} corpus
 * @param {{limit?:number, minScore?:number, category?:string, categoryBoost?:number}} opts
 */
export function searchMemory(query, corpus, opts = {}) {
  const limit = opts.limit ?? 4;
  const minScore = opts.minScore ?? 1.2;
  const category = String(opts.category || '').trim().toLowerCase();
  const categoryBoost = opts.categoryBoost ?? 2.5;
  const qTokens = tokenize(query);
  if (!qTokens.length || !corpus.length) return [];

  const docs = corpus.map((doc) => ({
    doc,
    tf: termFrequency(tokenize(`${doc.title} ${doc.tags || ''} ${doc.body} ${doc.body}`)),
  }));

  const scores = docs.map(({ doc, tf }) => {
    let score = 0;
    const matched = [];
    for (const token of new Set(qTokens)) {
      if (!tf.has(token)) continue;
      const weight = idf(token, docs);
      score += weight * Math.min(tf.get(token), 3);
      matched.push(token);
    }
    // 标题命中额外加权：标题相同/接近的案例更可能是同类问题
    const titleTokens = new Set(tokenize(doc.title));
    for (const token of new Set(qTokens)) {
      if (titleTokens.has(token)) score += 1.5 * idf(token, docs);
    }
    const categoryMatch = Boolean(category && String(doc.category || '').trim().toLowerCase() === category);
    if (categoryMatch) score += categoryBoost;
    if (doc.type === 'card') score *= 1.15; // 已批准知识略优先于历史案例
    return { doc, score, matched, categoryMatch };
  });

  return scores
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s, i) => ({
      rank: i + 1,
      ref: `${s.doc.type === 'card' ? 'K' : 'C'}${s.doc.id}`,
      id: s.doc.id,
      type: s.doc.type,
      title: s.doc.title,
      snippet: snippet(s.doc.body, s.matched.length ? s.matched : qTokens),
      score: Number(s.score.toFixed(2)),
      category_match: s.categoryMatch,
      meta: s.doc.meta || {},
    }));
}
