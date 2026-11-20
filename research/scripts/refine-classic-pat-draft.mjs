// Refine the pending classic PAT card in the isolated 4182 sample database.
// This is content-only: it neither publishes the card nor adds a review.

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const configuredDir = process.env.DATA_DIR;
if (!configuredDir) throw new Error('Refusing to write: set DATA_DIR to the isolated 4182 sample database.');
const dataDir = path.resolve(configuredDir);
if (path.basename(dataDir) !== 'intorg-human-loop-20261117') {
  throw new Error('Refusing to write: DATA_DIR is not the known isolated 4182 sample directory.');
}
const dbPath = path.join(dataDir, 'app.db');
if (!fs.existsSync(dbPath)) throw new Error('Refusing to write: isolated app.db was not found.');

const expectedTitle = 'GitHub classic PAT 默认过期与组织上限';
const oldContent = [
  '适用范围：GitHub.com personal access tokens (classic)。',
  '',
  '来源事实：GitHub 官方文档说明，classic PAT 默认没有强制过期要求；组织 owner 仍可为 classic PAT 设置最大有效期策略。',
  '',
  '边界：classic PAT 默认无强制过期，不等于所有组织都允许无过期 token；必须核实目标组织的当前策略。不要把 fine-grained PAT 的组织/企业资源默认 366 天规则套用到 classic PAT。',
  '',
  '若目标组织已设置有效期上限，存量不合规 token 的组织访问影响见 K2「GitHub 组织 PAT 上限收紧后的存量 token 影响（补充说明）」；具体 token 是否受限取决于当前组织策略、token 类型和所有者关系。该公开规则不代表任何公司的内部制度。',
].join('\n');
const revisedContent = [
  '适用范围：GitHub.com personal access tokens (classic)。以下为 GitHub 公开规则，不代表任何公司的内部制度。',
  '',
  '默认规则：GitHub 组织 PAT 政策文档说明，classic PAT 没有必须设置过期时间的要求；创建者仍可为单张 token 选择过期日期，因此“没有强制过期要求”不等于“每张 token 都永不过期”。',
  '',
  '组织上限：组织 owner 可以为 classic PAT 设置最大有效期。若 token 属于该组织成员且生命周期超过当前上限，它会被阻止访问该组织；设置策略本身不会撤销或停用 token。实际是否适用取决于目标组织当前设置、token 类型和所有者关系。具体恢复路径由管理员核实，官方页面没有规定唯一方案，不要断言必须重新生成 token。',
  '',
  '类型边界：组织/企业资源下 fine-grained PAT 的默认最大有效期为 366 天；这条规则不适用于 classic PAT。官方文档中“expires_in 未提供时默认 30 天”的说明位于 fine-grained PAT URL 模板章节，不能据此推断 classic PAT 的默认期限。',
  '',
  '另一个独立规则：GitHub 会自动移除一年未使用的 personal access token。它是按未使用时长触发的清理，不等同于 classic PAT 的强制过期要求；若 token 很久未用，应核实最近使用时间。',
  '',
  '补充来源（classic PAT 创建与未使用清理）：https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens',
].join('\n');

const db = new DatabaseSync(dbPath);
try {
  const store = (await import('../../server/store.js')).createStore(db);
  const ticket = store.getTicket(6);
  const card = store.getCard(3);
  const k2 = store.getCard(2);
  if (!ticket || ticket.title !== '组织调整 classic PAT 时限，旧令牌怎样？' || ticket.scope !== 'sample') {
    throw new Error('Refusing to write: ticket #6 does not match the expected sample.');
  }
  if (!k2 || k2.status !== 'published' || k2.scope !== 'sample') {
    throw new Error('Refusing to write: K2 is not the expected published sample card.');
  }
  if (!card || card.title !== expectedTitle || card.source_ticket_id !== 6 || card.scope !== 'sample') {
    throw new Error('Refusing to write: K3 identity or scope does not match.');
  }
  if (card.status !== 'pending' || card.version !== 1 || card.reviews.length || card.uses.length) {
    throw new Error('Refusing to write: K3 is no longer an unused, unreviewed pending draft.');
  }
  if (card.content === revisedContent) {
    process.stdout.write(`${JSON.stringify({ changed: false, cardId: card.id, status: card.status, version: card.version, reviews: 0, uses: 0 })}\n`);
  } else {
    if (card.content !== oldContent) throw new Error('Refusing to write: K3 content differs from the expected draft.');
    db.exec('BEGIN IMMEDIATE');
    try {
      const updated = db.prepare(`UPDATE knowledge_cards SET content = ?, updated_at = ?
                                 WHERE id = ? AND status = 'pending' AND scope = 'sample' AND version = 1`)
        .run(revisedContent, new Date().toISOString(), card.id);
      if (Number(updated.changes) !== 1) throw new Error('K3 was not updated exactly once.');
      store.addEvent({
        ticketId: ticket.id,
        kind: 'card_draft_edited',
        actor: 'agent:research',
        summary: '补充 K3 待审草稿：区分强制过期、单张 token 过期日与一年未使用清理',
        payload: {
          cardId: card.id,
          status: 'pending',
          reviewerRequired: true,
          sourceRefs: [
            'https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization',
            'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens',
          ],
          summary: '仅更新待审卡正文；未发布、未增加审核、未加入真实试点检索。',
        },
      });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    const verified = store.getCard(card.id);
    process.stdout.write(`${JSON.stringify({ changed: true, cardId: verified.id, title: verified.title, status: verified.status, version: verified.version, reviews: verified.reviews.length, uses: verified.uses.length, content: verified.content })}\n`);
  }
} finally {
  db.close();
}
