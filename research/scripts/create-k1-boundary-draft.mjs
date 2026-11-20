// Create a pending, sample-only addendum to K1 in the isolated 4182 database.
// Requires DATA_DIR to be explicitly pointed at that database. The source ticket
// and published K1 are checked before any write. The card is never auto-published.

import path from 'node:path';

const expectedTitle = 'PAT 上限收紧后旧 token 会怎样？';
const cardTitle = 'GitHub 组织 PAT 上限收紧后的存量 token 影响（补充说明）';
const sourceUrl = 'https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization';
const content = [
  '适用范围：GitHub.com 组织的 Personal access token 最大有效期策略。',
  '',
  '来源事实：当组织设定的最大有效期策略使某成员 token 不合规时，该 token 会被阻止访问该组织；仅设置策略不会撤销或停用 token。用户会在调用该组织 API 遭拒时发现 token 不合规。',
  '',
  '边界：是否属于该情形，以目标组织当前策略、token 类型和 token 所有者关系为准。本卡总结 GitHub 公开规则，不代表任何公司的内部制度。',
  '',
  '后续处理：先请组织/企业管理员核实当前策略和具体 token 情况。若需恢复访问，按管理员指引处理；GitHub 该页面未规定唯一恢复步骤，因此不要断言必须重新生成 token。不要要求用户提供 token 明文。',
].join('\n');

const configuredDir = process.env.DATA_DIR;
if (!configuredDir) {
  throw new Error('Refusing to write: explicitly set DATA_DIR to the isolated 4182 sample database.');
}

const { openDb } = await import('../../server/db.js');
const { createStore } = await import('../../server/store.js');
const db = openDb();
try {
  const store = createStore(db);
  const ticket = store.getTicket(4);
  const baseCard = store.getCard(1);
  if (!ticket || ticket.title !== expectedTitle || ticket.scope !== 'sample') {
    throw new Error('Refusing to write: ticket #4 is not the expected isolated sample.');
  }
  if (!baseCard || baseCard.status !== 'published' || baseCard.scope !== 'sample') {
    throw new Error('Refusing to write: K1 is not the expected published sample card.');
  }

  const existing = store.listCards().find((card) => card.title === cardTitle);
  if (existing) {
    process.stdout.write(`${JSON.stringify({ created: false, card: { id: existing.id, title: existing.title, status: existing.status, scope: existing.scope } })}\n`);
  } else {
    const card = store.createCard({
      title: cardTitle,
      content,
      tags: 'GitHub PAT fine-grained 组织 生命周期 上限 存量 token',
      sourceTicketId: ticket.id,
      status: 'pending',
      sourceKind: 'guide',
      sourceRef: sourceUrl,
      appliesTo: 'GitHub.com 组织成员的 personal access token；仅在 token 生命周期超过该组织当前最大有效期策略时适用。',
    });
    process.stdout.write(`${JSON.stringify({ created: true, dataDir: path.resolve(configuredDir), card: { id: card.id, title: card.title, status: card.status, scope: card.scope, source_ticket_id: card.source_ticket_id, source_kind: card.source_kind, source_ref: card.source_ref } })}\n`);
  }
} finally {
  db.close();
}
