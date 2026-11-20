// Create a pending, sample-only card for the classic PAT default-expiration rule.
// Requires an explicit DATA_DIR. The target ticket and published K2 are validated
// before writing; this script never publishes the draft.

import path from 'node:path';

const expectedTicketTitle = '组织调整 classic PAT 时限，旧令牌怎样？';
const cardTitle = 'GitHub classic PAT 默认过期与组织上限';
const sourceUrl = 'https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization';
const content = [
  '适用范围：GitHub.com personal access tokens (classic)。',
  '',
  '来源事实：GitHub 官方文档说明，classic PAT 默认没有强制过期要求；组织 owner 仍可为 classic PAT 设置最大有效期策略。',
  '',
  '边界：classic PAT 默认无强制过期，不等于所有组织都允许无过期 token；必须核实目标组织的当前策略。不要把 fine-grained PAT 的组织/企业资源默认 366 天规则套用到 classic PAT。',
  '',
  '若目标组织已设置有效期上限，存量不合规 token 的组织访问影响见 K2「GitHub 组织 PAT 上限收紧后的存量 token 影响（补充说明）」；具体 token 是否受限取决于当前组织策略、token 类型和所有者关系。该公开规则不代表任何公司的内部制度。',
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
  const ticket = store.getTicket(6);
  const k2 = store.getCard(2);
  if (!ticket || ticket.title !== expectedTicketTitle || ticket.scope !== 'sample') {
    throw new Error('Refusing to write: ticket #6 is not the expected isolated sample.');
  }
  if (!k2 || k2.status !== 'published' || k2.scope !== 'sample') {
    throw new Error('Refusing to write: K2 is not the expected published sample card.');
  }

  const existing = store.listCards().find((card) => card.title === cardTitle);
  if (existing) {
    process.stdout.write(`${JSON.stringify({ created: false, card: { id: existing.id, title: existing.title, status: existing.status, scope: existing.scope } })}\n`);
  } else {
    const card = store.createCard({
      title: cardTitle,
      content,
      tags: 'GitHub classic PAT personal access token 默认过期 生命周期 组织策略',
      sourceTicketId: ticket.id,
      status: 'pending',
      sourceKind: 'guide',
      sourceRef: sourceUrl,
      appliesTo: 'GitHub.com classic personal access tokens；默认过期要求与目标组织自定义最大有效期策略需分开判断。',
    });
    process.stdout.write(`${JSON.stringify({ created: true, dataDir: path.resolve(configuredDir), card: { id: card.id, title: card.title, status: card.status, scope: card.scope, source_ticket_id: card.source_ticket_id, source_kind: card.source_kind, source_ref: card.source_ref } })}\n`);
  }
} finally {
  db.close();
}
