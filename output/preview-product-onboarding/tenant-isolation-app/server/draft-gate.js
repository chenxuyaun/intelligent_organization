/* 试点知识草稿的人工认可闸门（纯逻辑，不读配置、不读 .env、不调用模型）。
 *
 * 真实试点工单：必须由「最新组织模式运行」的「最新审核」是组织成员人工审核
 * （review_source_type=human）且决定为 adopt / edit，才允许生成待审草稿。
 *  - edit：处理步骤只能用该审核的 edited_text
 *  - adopt：处理步骤只能用该组织模式运行的建议（output.next_actions）
 *  - 未审核 / assistant|seed|unknown / reject：返回 error，不创建也不修改知识卡
 * sample 工单返回 null，保留原草稿流程；不回退到模型原文生成试点草稿。
 */

const SOURCE_LABEL = {
  human: '人工审核',
  assistant: '助手代审',
  seed: '种子演示',
  unknown: '来源未知',
};

export function pilotDraftGate(store, ticket) {
  if (!ticket || ticket.scope !== 'pilot') return null;
  // 显式按 id 取最大，不依赖调用方数组的排序；历史全部保留但不改变当前状态。
  const orgRun = store.runsByTicket(ticket.id)
    .filter((r) => r.mode === 'organization')
    .reduce((a, b) => (!a || Number(b.id) > Number(a.id) ? b : a), null);
  if (!orgRun) return { error: '试点工单还没有组织模式运行，暂不能生成知识草稿' };
  const review = (orgRun.reviews || [])
    .reduce((a, b) => (!a || Number(b.id) > Number(a.id) ? b : a), null);
  if (!review) return { error: '最新组织模式建议尚未审核，暂不能生成知识草稿' };
  if (review.review_source_type !== 'human') {
    const label = SOURCE_LABEL[review.review_source_type] || '非人工来源';
    return { error: `最新审核为${label}，不是组织成员人工审核，暂不能生成知识草稿` };
  }
  if (review.decision === 'reject') return { error: '最新人工审核决定为拒绝，不能生成知识草稿' };
  if (review.decision !== 'adopt' && review.decision !== 'edit') {
    return { error: '最新人工审核决定不是采纳或编辑后采纳，暂不能生成知识草稿' };
  }
  if (review.decision === 'edit' && !String(review.edited_text || '').trim()) {
    return { error: '编辑后采纳必须填写编辑后的文本，暂不能生成知识草稿' };
  }
  return { orgRun, review };
}
