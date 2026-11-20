/*
 * Cross-domain TypeSafe memory relevance check using only fictional sample cards.
 * Makes 10 live API calls, writes no database data, and never includes pilot data.
 * Labels are authored for this synthetic check and are not human business approvals.
 */

process.env.TYPESAFE_MEMORY_GATE = 'shadow';
const { assessMemoryRelevance } = await import('../../server/typesafe-gate.js');

const sources = {
  K14: {
    title: '新同事账号权限开通的标准路径',
    snippet: '适用场景：新入职或转岗同事无法登录某个内部系统。先确认人员状态为在职且已激活，让直属主管在权限申请单确认，按最小权限开通；生产环境与财务系统写权限需要二级审批。',
  },
  K13: {
    title: 'VPN 连接失败：先查证书有效期，再换网络',
    snippet: '适用场景：远程办公时 VPN 提示认证失败、证书无效或无法建立隧道。确认客户端版本，查看证书到期时间，过期后重新签发；再换网络复测。',
  },
  K15: {
    title: 'Outlook 收不到外部邮件时的排查顺序',
    snippet: '适用场景：内部邮件正常、外部邮件收不到。先用网页版确认服务端是否收到，再查垃圾邮件和隔离区，查看退信原文中的 SPF/DKIM 信息，并确认邮箱容量与附件上限。',
  },
  K16: {
    title: '楼层打印机离线：三步恢复',
    snippet: '适用场景：共享打印机显示离线或任务卡在队列。检查设备电源和网线，清理队列卡住的任务并重启打印服务，客户端重新添加打印机。',
  },
  K19: {
    title: '[效果演示] 设计软件 7 天试用授权申请',
    snippet: '仅作虚构演示，不代表真实制度：申请时说明软件用途与试用期限，经项目负责人确认后安排 7 天试用，到期前复核是否续用。',
  },
};

const cases = [
  { id: 'K14_account_access', source: 'K14', expected: true, category: '账号与权限', title: '转岗后无法登录内部系统', description: '转岗同事无法登录内部系统，应先核实什么状态、由谁确认申请？' },
  { id: 'K14_printer_mismatch', source: 'K14', expected: false, category: '打印与设备', title: '共享打印机离线', description: '共享打印机显示离线，怎样恢复打印？' },
  { id: 'K13_vpn_certificate', source: 'K13', expected: true, category: '网络与 VPN', title: 'VPN 证书无效', description: 'VPN 提示证书无效，应该检查什么并如何处理过期证书？' },
  { id: 'K13_email_mismatch', source: 'K13', expected: false, category: '邮箱与协作', title: '外部邮件收不到', description: '内部邮件正常但收不到外部邮件，先查哪些地方？' },
  { id: 'K15_external_email', source: 'K15', expected: true, category: '邮箱与协作', title: '外部邮件排查', description: '内部邮件正常、外部邮件收不到，应该怎样排查？' },
  { id: 'K15_vpn_mismatch', source: 'K15', expected: false, category: '网络与 VPN', title: 'VPN 证书过期', description: 'VPN 证书过期后如何重新签发？' },
  { id: 'K16_printer_offline', source: 'K16', expected: true, category: '打印与设备', title: '打印机离线和队列卡住', description: '共享打印机离线，打印任务卡住，先做什么？' },
  { id: 'K16_account_mismatch', source: 'K16', expected: false, category: '账号与权限', title: '新同事权限开通', description: '新入职同事无法登录系统，权限开通要核实什么？' },
  { id: 'K19_trial_process', source: 'K19', expected: true, category: '软件与授权', title: '软件短期试用', description: '软件试用前应确认什么信息，到期前如何处理？' },
  { id: 'K19_license_sharing', source: 'K19', expected: false, category: '软件与授权', title: '单人许可证共享', description: '单人版账号可以让同事轮流登录共享吗？' },
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
    }, [{
      ref: item.source,
      title: source.title,
      snippet: source.snippet,
      type: 'card',
      meta: { scope: 'sample', source_kind: 'unknown' },
    }]);
    const decision = result.decisions[0];
    const predicted = decision.answerability_probability >= 0.5;
    results.push({
      id: item.id,
      model: result.model,
      source: item.source,
      expected_answerable: item.expected,
      answerability_probability: decision.answerability_probability,
      recommendation: decision.recommendation,
      binary_match: predicted === item.expected,
      latency_ms: result.latencyMs,
    });
  } catch (error) {
    results.push({ id: item.id, source: item.source, expected_answerable: item.expected, error: error?.name || 'error' });
  }
}

const valid = results.filter((row) => Number.isFinite(row.answerability_probability));
const decisive = valid.filter((row) => row.recommendation !== 'uncertain');
console.log(JSON.stringify({
  models: [...new Set(valid.map((row) => row.model))],
  cases: results.length,
  binary_matches_at_0_5: valid.filter((row) => row.binary_match).length,
  decisive_matches: decisive.filter((row) => row.binary_match).length,
  decisive_count: decisive.length,
  results,
}, null, 2));
