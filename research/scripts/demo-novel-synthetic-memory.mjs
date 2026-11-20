// Live, in-memory demonstration that an organization run can use a novel
// synthetic fact supplied only as retrieved memory. No app DB writes occur.
process.env.TYPESAFE_API_KEY = '';
process.env.TYPESAFE_MEMORY_GATE = 'off';

const [{ modelStatus }, { runPair, PROMPT_VERSION }] = await Promise.all([
  import('../../server/config.js'),
  import('../../server/agent.js'),
]);
if (!modelStatus().configured) throw new Error('Live answer model is not configured; no model calls were made.');

const ticket = {
  id: 9907,
  title: '雾灯组的临时技术凭证规则是什么？',
  description: '这是完全虚构的机制演示。雾灯组申请临时技术凭证时，最长可以使用几天？发放前必须由哪个岗位批准？请只回答本题的模拟团队规则；没有依据的真实组织政策不要推测。',
  category: '账号与权限',
  urgency: '低',
  scope: 'sample',
};

const sources = [{
  ref: 'K4',
  type: 'card',
  id: 9404,
  title: '纯虚构实验记忆：雾灯组临时技术凭证',
  snippet: '【完全虚构的演示规则，不代表任何公司或真实组织制度】仅适用于本题的模拟团队“雾灯组”：临时技术凭证最长有效期为 17 天；发放之前必须由“二号审核岗”书面批准，批准记录写入“雾灯台账”。这只是为验证组织记忆检索而随机编造的实验内容，不能用于真实凭证或真实组织。',
  meta: {
    source_kind: 'policy',
    scope: 'sample',
    applies_to: '仅限本脚本内的纯虚构团队与问题。',
    approval_body: '虚构演示数据，不是真实审批主体。',
  },
}];

const store = {
  searchApprovedMemory: () => sources,
  createRun: (run) => ({ ...run, id: run.mode === 'personal' ? 1 : 2 }),
  createRunGroup: () => 'in-memory-synthetic-memory-demo',
  addEvent: () => {},
};

const pair = await runPair({ store, ticket });
const compact = (run) => ({
  origin: run.origin,
  promptVersion: run.promptVersion,
  retrievedRefs: (run.contextSources || []).map((source) => source.ref),
  citedRefs: [...new Set((run.output.citations || []).map((citation) => citation.ref))],
  draftReply: run.output.draft_reply,
  uncertainties: run.output.uncertainties,
});

process.stdout.write(`${JSON.stringify({
  experiment: 'A synthetic novel fact exists only in organization retrieved memory',
  label: '虚构机制演示，不代表真实公司制度；不是业务效果证据',
  ticket: { id: ticket.id, title: ticket.title, scope: ticket.scope },
  model: modelStatus().model,
  promptVersion: PROMPT_VERSION,
  storage: 'in-memory only; no tickets, runs, reviews, or cards written',
  personal: compact(pair.personal),
  organization: compact(pair.organization),
}, null, 2)}\n`);

if (pair.personal.origin !== 'live' || pair.organization.origin !== 'live') process.exitCode = 2;
