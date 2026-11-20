import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const draftPath = path.join(root, 'research/drafts/K1-fine-grained-PAT-enterprise-policy-boundary.md');
const baseUrl = String(process.env.IO_REVIEW_BASE_URL || 'http://127.0.0.1:4186').replace(/\/$/, '');
const sourceCardId = 1;

function parseCandidate(markdown) {
  const bodyMatch = markdown.match(/## 建议替换为以下正文\r?\n\r?\n([\s\S]*?)\r?\n\r?\n## 建议保留的卡片元数据/);
  if (!bodyMatch) throw new Error('候选文件中找不到“建议替换为以下正文”区块');
  const content = bodyMatch[1].trim();
  const appliesToMatch = content.match(/^\*\*适用范围：\*\*\s*(.+)$/m);
  if (!appliesToMatch) throw new Error('候选正文中找不到适用范围');
  const sourceRefs = [...markdown.matchAll(/^\s*-\s*\[[^\]]+\]\((https:\/\/[^)]+)\)\s*$/gm)]
    .map((match) => match[1]);
  if (sourceRefs.length < 3) throw new Error(`候选来源链接不足（当前 ${sourceRefs.length} 条）`);
  return {
    content,
    appliesTo: appliesToMatch[1].trim(),
    sourceRef: sourceRefs.join('\n'),
    note: '修正 fine-grained PAT 创建时的期限边界，区分企业与组织上限、既有 token 的访问拦截，并避免套用 classic PAT 的使用/SSO 检查时点。',
  };
}

async function request(route, options) {
  const response = await fetch(`${baseUrl}${route}`, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${route} 返回 ${response.status}：${data.error || '请求失败'}`);
  return data;
}

const markdown = fs.readFileSync(draftPath, 'utf8');
const candidate = parseCandidate(markdown);
const memory = await request('/api/memory', { method: 'GET' });
const current = memory.cards.find((card) => card.id === sourceCardId);
if (!current) throw new Error(`找不到 K${sourceCardId}`);
if (current.status !== 'published' || current.scope !== 'sample' || current.version !== 2) {
  throw new Error(`K${sourceCardId} 状态已变化（${current.status}/${current.scope}/v${current.version}）；停止提交，请先人工复核`);
}
if (current.superseded_by_card_id) throw new Error(`K${sourceCardId} 已被替代，停止提交`);
const pending = await request('/api/memory?status=pending', { method: 'GET' });
if (pending.cards.some((card) => card.supersedes_card_id === sourceCardId)) {
  throw new Error(`K${sourceCardId} 已有待审修订；不会重复创建`);
}

const result = await request(`/api/cards/${sourceCardId}/revision-draft`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(candidate),
});

process.stdout.write(JSON.stringify({
  created: result.created,
  cardId: result.card.id,
  title: result.card.title,
  status: result.card.status,
  version: result.card.version,
  scope: result.card.scope,
  supersedesCardId: result.card.supersedes_card_id,
  supersedesVersion: result.card.supersedes_version,
  published: false,
  modelCalled: false,
}, null, 2) + '\n');
