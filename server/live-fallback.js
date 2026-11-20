/** A configured live model failed. Return an explicit no-answer result. */
export function liveModelUnavailableOutput(category = '其他') {
  return {
    summary: '真实模型未能返回有效答复',
    category: category || '其他',
    priority: 'P2',
    draft_reply: '本次真实模型请求未能返回有效答复，没有生成可供采纳或对外发送的处理建议。请稍后重试；下方引用来源仅供人工核对。',
    next_actions: [],
    general_checks: [],
    escalation_needed: false,
    handoff_summary: '',
    citations: [],
    uncertainties: ['真实模型请求未成功；本次没有可用建议。'],
  };
}
