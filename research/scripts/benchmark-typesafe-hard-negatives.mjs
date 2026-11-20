/*
 * Hard-negative check for Jev's evidence-relevance sidecar.
 * Uses only fictional sample-card excerpts, makes 11 live API calls, and writes
 * no database data. Labels ask whether the excerpt helps answer, including by
 * providing relevant counterevidence.
 */

process.env.TYPESAFE_MEMORY_GATE = 'shadow';
const { assessMemoryRelevance } = await import('../../server/typesafe-gate.js');

const sources = {
  K14: { title: '新同事账号权限开通的标准路径', snippet: '新入职或转岗同事无法登录内部系统：先确认人员在职且已激活，让直属主管在权限申请单确认，按最小权限开通；生产或财务系统写权限需要二级审批。' },
  K13: { title: 'VPN 连接失败：先查证书有效期，再换网络', snippet: 'VPN 认证失败或提示证书无效：确认客户端版本，查看证书到期时间，过期后重新签发；再换网络复测。' },
  K15: { title: 'Outlook 收不到外部邮件时的排查顺序', snippet: '内部邮件正常、外部邮件收不到：用网页版确认服务端状态，检查垃圾邮件和隔离区，查看退信中的 SPF/DKIM 信息，并确认邮箱容量与附件上限。' },
  K16: { title: '楼层打印机离线：三步恢复', snippet: '共享打印机离线或任务卡在队列：检查电源和网线，清理队列卡住任务并重启打印服务，客户端重新添加打印机。' },
  K19: { title: '[效果演示] 设计软件 7 天试用授权申请', snippet: '仅作虚构演示，不代表真实制度：申请时说明软件用途与试用期限，经项目负责人确认后安排 7 天试用，到期前复核是否续用。' },
};

const cases = [
  { id: 'K14_access_steps', source: 'K14', expected: true, category: '账号与权限', title: '转岗后无法登录', description: '转岗同事无法登录内部系统，要先核实什么状态并走哪些权限步骤？' },
  { id: 'K14_password_reset', source: 'K14', expected: false, category: '账号与权限', title: '忘记密码', description: '转岗后忘记系统密码，怎样重置密码？' },
  { id: 'K13_expired_certificate', source: 'K13', expected: true, category: '网络与 VPN', title: 'VPN 证书无效', description: 'VPN 提示证书无效，应如何检查并处理过期证书？' },
  { id: 'K13_expired_password', source: 'K13', expected: false, category: '网络与 VPN', title: 'VPN 密码过期', description: 'VPN 因密码过期认证失败，怎样重设密码？' },
  { id: 'K15_spf_bounce', source: 'K15', expected: true, category: '邮箱与协作', title: '外部邮件 SPF 退信', description: '内部邮件正常，外部发件退信提到 SPF/DKIM，应该查什么？' },
  { id: 'K15_out_of_office', source: 'K15', expected: false, category: '邮箱与协作', title: 'Outlook 自动回复', description: '如何设置外出期间的 Outlook 自动回复？' },
  { id: 'K16_offline_queue', source: 'K16', expected: true, category: '打印与设备', title: '打印机离线且队列卡住', description: '共享打印机显示离线、任务卡在队列里，建议先做什么？' },
  { id: 'K16_blank_pages', source: 'K16', expected: false, category: '打印与设备', title: '打印空白页', description: '打印机可以连接但每张纸都空白，应如何检查墨粉或纸张？' },
  { id: 'K19_trial_review', source: 'K19', expected: true, category: '软件与授权', title: '试用申请与到期复核', description: '申请 7 天试用前应确认什么，到期前要做什么？' },
  { id: 'K19_auto_renewal', source: 'K19', expected: true, category: '软件与授权', title: '自动续期反证', description: '这条记忆对“试用到期后可不复核自动续期”提供了什么相关信息？' },
  { id: 'K19_trial_account_sharing', source: 'K19', expected: false, category: '软件与授权', title: '试用账号共享', description: '这条记忆是否说明 7 天试用账号可以交给外部合作方轮流登录？' },
];

const results = [];
for (const item of cases) {
  const source = sources[item.source];
  try {
    const result = await assessMemoryRelevance({
      title: item.title,
      description: item.description,
      category: item.category,
      scope: 'sample',
    }, [{ ref: item.source, title: source.title, snippet: source.snippet, type: 'card', meta: { scope: 'sample', source_kind: 'unknown' } }]);
    const decision = result.decisions[0];
    results.push({
      id: item.id,
      model: result.model,
      expected_answerable: item.expected,
      answerability_probability: decision.answerability_probability,
      recommendation: decision.recommendation,
      binary_match_at_0_5: (decision.answerability_probability >= 0.5) === item.expected,
      decisive_match: decision.recommendation === 'uncertain' ? null : (decision.recommendation === 'likely_answerable') === item.expected,
      latency_ms: result.latencyMs,
    });
  } catch (error) {
    results.push({ id: item.id, expected_answerable: item.expected, error: error?.name || 'error' });
  }
}

const valid = results.filter((row) => Number.isFinite(row.answerability_probability));
const decisive = valid.filter((row) => row.decisive_match !== null);
console.log(JSON.stringify({
  models: [...new Set(valid.map((row) => row.model))],
  cases: results.length,
  binary_matches_at_0_5: valid.filter((row) => row.binary_match_at_0_5).length,
  decisive_matches: decisive.filter((row) => row.decisive_match).length,
  decisive_count: decisive.length,
  uncertain_count: valid.length - decisive.length,
  results,
}, null, 2));
