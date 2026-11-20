/**
 * 演示模式生成器 + 交接摘要：纯函数，不访问数据库。
 * 未配置模型时用它走通全流程，界面会标注「演示模式」。
 */

export function ticketQuery(ticket) {
  return `${ticket.title}\n${ticket.description}\n${ticket.category || ''}`;
}

export function cardSteps(content) {
  const lines = String(content || '').split(/\r?\n/);
  const numbered = [];
  const other = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(?:\d+[.、)]|[-*•])\s*(.+)$/);
    if (m && m[1].length > 4) numbered.push(m[1].trim().slice(0, 140));
    else if (!line.startsWith('适用场景') && !line.startsWith('处理步骤') && !line.startsWith('注意') && line.length > 6) {
      other.push(line.slice(0, 140));
    }
  }
  return (numbered.length >= 2 ? numbered : other).slice(0, 5);
}

export function firstSentence(text, max = 90) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  const cut = clean.split(/[。！？\n]/)[0] || clean;
  return cut.length > max ? `${cut.slice(0, max)}…` : cut;
}

export function prepareHandoff(ticket, output, sources, review) {
  const sourceRows = sources || [];
  const citations = Array.isArray(output?.citations) ? output.citations : [];
  const citedRefs = [...new Set(citations.map((c) => c.ref).filter(Boolean))];
  const citationQuotes = new Map();
  for (const citation of citations) {
    if (!citation.ref || !citation.quote) continue;
    const list = citationQuotes.get(citation.ref) || [];
    if (!list.includes(citation.quote)) list.push(citation.quote);
    citationQuotes.set(citation.ref, list);
  }
  const sourceByRef = new Map(sourceRows.map((s) => [s.ref, s]));
  const describeSource = (ref) => {
    const source = sourceByRef.get(ref);
    if (!source) return ref;
    const kind = source.meta?.source_kind || (source.type === 'case' ? 'resolved_case' : 'unknown');
    const kindLabel = {
      policy: '制度政策',
      guide: '操作指引',
      resolved_case: '已解决案例（仅参考）',
      unknown: '来源未核实',
    }[kind] || '来源未核实';
    const scopeLabel = source.meta?.scope === 'pilot' ? '真实试点' : '模拟样本';
    const typeLabel = source.type === 'case' ? '案例' : '知识卡';
    const quotes = (citationQuotes.get(ref) || []).slice(0, 2)
      .map((quote) => `“${quote.slice(0, 100)}${quote.length > 100 ? '…' : ''}”`);
    return `${ref}「${source.title}」（${typeLabel}；${kindLabel}；${scopeLabel}${quotes.length ? `；引用摘录：${quotes.join(' / ')}` : ''}）`;
  };
  const lines = [
    `交接摘要 · 问题单 #${ticket.id}「${ticket.title}」`,
    `现状：${output.summary}`,
    `判断：${output.category || '待归类'} · ${output.priority || 'P3'}${output.escalation_needed ? ' · 建议升级' : ''}`,
  ];
  if (review) {
    const label = review.decision === 'adopt' ? '已采纳' : review.decision === 'edit' ? '编辑后采纳' : '已拒绝';
    lines.push(`人工结论：${label}${review.rating ? `（${review.rating}/5）` : ''}${review.reason ? `，理由：${review.reason}` : ''}`);
    const editedReply = String(review.edited_text || '').trim();
    const suggestedReply = String(output.draft_reply || '').trim();
    if (review.decision === 'edit' && editedReply) {
      lines.push(`审核后采纳的答复（接手前请核对）：${editedReply}`);
    } else if (review.decision === 'adopt' && suggestedReply) {
      lines.push(`已采纳的答复（接手前请核对）：${suggestedReply}`);
    } else if (review.decision === 'reject') {
      lines.push('本次 AI 建议已被拒绝，不可作为已批准答复。');
    }
  } else {
    lines.push('人工审核：尚未记录');
  }
  const progressNote = String(ticket.outcome_note || '').trim();
  if (progressNote) {
    lines.push(`工单当前处理记录（成员填写，接手前请核对）：${progressNote}`);
  } else {
    lines.push('工单当前没有已记录的处理进展 / 结果；以下建议未标记为已执行。');
  }
  lines.push(`建议后续（尚未记录为已执行）：${(output.next_actions || []).slice(0, 3).join(' → ') || '无'}`);
  if (citedRefs.length) lines.push(`模型引用：${citedRefs.map(describeSource).join('；')}`);
  else lines.push('模型未引用团队记忆。');
  const unreferenced = sourceRows.filter((s) => !citedRefs.includes(s.ref));
  if (unreferenced.length) lines.push(`检索到但未引用：${unreferenced.map((s) => describeSource(s.ref)).join('；')}`);
  if ((output.uncertainties || []).length) lines.push(`待确认：${output.uncertainties.slice(0, 3).join('；')}`);
  return lines.join('\n');
}

const PROFILES = [
  {
    key: '网络与 VPN',
    keywords: ['vpn', '内网', '连不上', '连接失败', '拨号', '远程', '证书', '隧道'],
    steps: [
      '确认公司 VPN 客户端已升级到最新版本，再重新登录',
      '切换一次网络（有线 / 手机热点）排除本地网络限制',
      '若提示证书或身份验证失败，退出客户端并清理缓存后重连',
    ],
    ask: ['具体报错文字或截图', '同一网络下其他同事是否正常', '你的账号是否最近改过密码'],
    urgencyHigh: ['多人', '全员', '整个部门', '所有同事'],
  },
  {
    key: '账号与权限',
    keywords: ['账号', '权限', '登录', '密码', '锁定', '重置', '开通', '角色', '授权'],
    steps: [
      '在自助门户提交一次密码重置，确认账号未处于锁定状态',
      '确认需要的是哪一类系统权限（读 / 写 / 审批）以及对应系统名称',
      '由直属主管在权限申请单上确认，再交由 IT 开通',
    ],
    ask: ['需要访问的具体系统与模块', '主管是否已同意', '账号是工号账号还是外包账号'],
    urgencyHigh: ['全员', '多人', '生产', '财务'],
  },
  {
    key: '邮箱与协作',
    keywords: ['邮箱', '邮件', '退信', '收件', '发件', 'outlook', 'foxmail', '附件', '日历'],
    steps: [
      '确认邮箱容量与附件大小是否超限',
      '用网页版邮箱登录一次，区分是客户端问题还是服务端问题',
      '检查是否被收件方反垃圾策略拦截，必要时请对方查看隔离区',
    ],
    ask: ['退信原文', '是单个收件人还是全部收件人', '是否使用了外部中继'],
    urgencyHigh: ['全公司', '多名客户', '对外'],
  },
  {
    key: '打印与设备',
    keywords: ['打印', '打印机', '扫描', '复印', '墨盒', '卡纸', '驱动'],
    steps: [
      '确认打印机电源与网线，面板是否有报错灯',
      '删除旧队列后重新添加打印机，驱动选择对应型号',
      '换一台同事的电脑试打，判断是打印机还是单机环境问题',
    ],
    ask: ['打印机编号或所在楼层', '是打印全失败还是特定文件失败', '面板显示的报错'],
    urgencyHigh: ['整层', '多人', '前台'],
  },
  {
    key: '软件与授权',
    keywords: ['安装', '软件', '授权', 'license', '激活', '版本', '插件', '崩溃'],
    steps: [
      '确认软件是否在白名单内，以及当前账号是否有对应授权',
      '从内部软件中心下载安装包，避免使用来源不明的版本',
      '安装后重启一次，确认插件与授权状态',
    ],
    ask: ['软件名称与版本', '是否已申请过授权', '报错截图'],
    urgencyHigh: ['全员', '多人', '项目组'],
  },
  {
    key: '其他',
    keywords: [],
    steps: [
      '先复述你理解的诉求，确认没有理解偏差',
      '收集环境信息：设备、系统版本、发生时间、复现步骤',
      '判断是否需要转交对应系统负责人',
    ],
    ask: ['发生时间与复现步骤', '影响范围', '期望的解决时间'],
    urgencyHigh: ['多人', '全员'],
  },
];

function pickProfile(ticket) {
  const text = ticketQuery(ticket).toLowerCase();
  let best = PROFILES[PROFILES.length - 1];
  let bestHits = 0;
  for (const p of PROFILES) {
    const hits = p.keywords.filter((k) => text.includes(k.toLowerCase())).length;
    if (hits > bestHits) {
      best = p;
      bestHits = hits;
    }
  }
  return best;
}

function priorityOf(ticket, profile) {
  const urgency = (ticket.urgency || '').toLowerCase();
  const text = ticketQuery(ticket);
  const wideImpact = profile.urgencyHigh.some((k) => text.includes(k));
  if (urgency.includes('紧急') || urgency.includes('高') || urgency === 'p1' || urgency.includes('urgent')) return 'P1';
  if (wideImpact) return 'P1';
  if (urgency.includes('中') || urgency.includes('低') || urgency === 'p2') return 'P2';
  return 'P2';
}

export function demoGenerate(ticket, sources, mode) {
  const profile = pickProfile(ticket);
  const priority = priorityOf(ticket, profile);
  const cards = sources.filter((s) => s.type === 'card');
  const cases = sources.filter((s) => s.type === 'case');
  const top = cards[0] || null;
  const steps = top ? cardSteps(top.content) : [];
  const usable = steps.length >= 2 ? steps.slice(0, 4) : profile.steps;
  const wideImpact = profile.urgencyHigh.some((k) => ticketQuery(ticket).includes(k));
  const escalation = priority === 'P1' || wideImpact;

  const replyLines = [
    `你好，关于「${ticket.title}」，我先按 ${profile.key} 这一类来处理：${firstSentence(ticket.description, 60)}`,
    '',
    '可以先这样试：',
    ...usable.map((s, i) => `${i + 1}. ${s}`),
    '',
    top
      ? `这个判断依据的是团队已发布的经验 K${top.id}「${top.title}」；如果和你的实际环境不一致，请直接告诉我。`
      : '这条还没有对应的团队经验可参考，我按通用排查顺序给的步骤，可能不够贴合你的环境。',
    '',
    `为了继续往下走，我还需要：${profile.ask.join('、')}。`,
  ];

  const uncertainties = [
    '未确认你的设备与系统版本，步骤可能需要调整',
    `影响范围只从描述推断（${wideImpact ? '可能影响多人' : '看起来只有你一人'}）`,
  ];
  if (mode === 'organization') {
    if (top) uncertainties.push(`引用的 K${top.id} 上次确认时间未知，若环境已变化请以实际为准`);
    else uncertainties.push('组织记忆里没有高度相似的知识，本次实际是通用排查');
    if (cases.length) uncertainties.push(`检索到 ${cases.length} 条相似历史案例，但案例结论未必适用于当前环境`);
  } else {
    uncertainties.push('个人模式不查阅团队历史案例，无法判断是否与既往问题同源');
    uncertainties.push('无法确认是否已有同事处理过同类问题');
  }

  const nextActions = [
    ...usable.slice(0, 3),
    `向提问人收集：${profile.ask.slice(0, 2).join('、')}`,
    escalation ? '同步 IT 值班，确认是否为群体性事件' : '处理完成后回填结果，判断是否需要沉淀知识',
  ];
  const citations = mode === 'organization'
    ? sources.map((s) => ({ ref: s.ref, quote: s.snippet, type: s.type, title: s.title, id: s.id }))
    : [];
  const output = {
    summary: firstSentence(`${ticket.title}：${ticket.description}`, 110),
    category: profile.key,
    priority,
    draft_reply: replyLines.join('\n'),
    next_actions: nextActions,
    escalation_needed: escalation,
    handoff_summary: prepareHandoff(
      ticket,
      { summary: firstSentence(ticket.description, 80), category: profile.key, priority, next_actions: nextActions, citations, uncertainties },
      mode === 'organization' ? sources : [],
    ),
    citations,
    uncertainties,
  };
  return output;
}
