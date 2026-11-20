import { runPair } from './agent.js';

const DAY = 24 * 60 * 60 * 1000;

const MEMBERS = [
  ['林可', 'IT 服务台 · 一线'],
  ['周叙', '系统与权限'],
  ['陈迟', '网络与终端'],
];

const CARDS = [
  {
    title: 'VPN 连接失败：先查证书有效期，再换网络',
    tags: '网络与 VPN,VPN,证书',
    content: `适用场景：远程办公时 VPN 客户端提示「认证失败 / 证书无效 / 无法建立隧道」。
处理步骤：
1. 确认客户端版本是否为内部软件中心的最新包，旧版本会因协议升级而直接握手失败。
2. 打开客户端证书页，查看证书到期时间；公司证书有效期为 1 年，过期后必须重新签发。
3. 换一次网络（手机热点）复测，排除本地网络或运营商对隧道端口的限制。
4. 以上都不通时，删除客户端配置目录后重装，并让账号持有人在自助门户重置一次密码。
注意：同一办公区多人同时无法连接属于群体性事件，直接升级到 IT 值班，不要逐个排查。`,
  },
  {
    title: '新同事账号权限开通的标准路径',
    tags: '账号与权限,入职,权限申请',
    content: `适用场景：新入职或转岗同事无法登录某个内部系统。
处理步骤：
1. 先在工号系统确认人员状态是否为「在职且已激活」，未激活的账号一律无法授权。
2. 让直属主管在权限申请单上确认；口头同意不算，审计要求有单据。
3. 按最小权限开通：先给只读，确有需要再加写权限，审批链多一级。
4. 开通后请本人在 24 小时内登录一次，超过 7 天未登录的临时授权会自动回收。
注意：生产环境与财务系统的写权限一律需要二级审批，不接受加急口头授权。`,
  },
  {
    title: 'Outlook 收不到外部邮件时的排查顺序',
    tags: '邮箱与协作,退信,垃圾邮件',
    content: `适用场景：同事反馈外部邮件收不到，内部邮件正常。
处理步骤：
1. 用网页版邮箱登录，确认服务端是否真的没有这封信，排除客户端同步问题。
2. 检查「垃圾邮件」与「隔离区」，外部新域名常被策略先拦后放。
3. 请发件方提供退信原文；若退信提到 policy reject 或 SPF/DKIM，问题在对方域名配置。
4. 确认邮箱容量与单封附件上限，超限会静默拒收。
注意：整部门同时收不到外部邮件时，先查邮件网关状态，再看单账号。`,
  },
  {
    title: '楼层打印机离线：三步恢复',
    tags: '打印与设备,打印机,离线',
    content: `适用场景：共享打印机显示离线，或打印任务一直卡在队列。
处理步骤：
1. 到设备面板确认电源与网线指示灯，离线多半是网线松脱或设备休眠未唤醒。
2. 在打印服务器上清空该队列的卡住任务，再重启打印服务。
3. 客户端删除旧打印机后重新添加，驱动按型号选择，不要用通用 PCL。
注意：整层都无法打印时，先看打印服务器，不要逐台电脑处理。`,
  },
];

const PENDING_DRAFTS = [
  {
    title: '会议室的投屏设备需要先切信号源',
    tags: '打印与设备,会议室,投屏',
    content: `适用场景：会议室笔记本连不上投影。
处理步骤：
1. 确认墙面面板的信号源切换到 HDMI-2（笔记本接口）。
2. 无线投屏需要输入面板上的四位配对码。
3. 长时间无信号时，长按面板电源 5 秒重启矩阵。
注意：本条由智能体起草，尚未经过人工确认，请核实后再发布。`,
  },
  {
    title: '共享盘权限变更要走主管审批',
    tags: '账号与权限,共享盘',
    content: `适用场景：同事申请访问部门共享盘的某个目录。
处理步骤：
1. 确认目录归属部门与数据敏感级别。
2. 由目录负责人而非申请人主管审批。
3. 授权默认 90 天，到期自动回收。
注意：本条由智能体起草，尚未经过人工确认。`,
  },
];

export async function seedIfEmpty(store) {
  if (store.listTickets().length > 0) return false;

  const memberIds = MEMBERS.map(([name, role]) => store.addMember(name, role));

  const tickets = [
    {
      title: '在家连不上公司 VPN，提示认证失败',
      description: '晚上在家办公，VPN 客户端一直提示认证失败，重启电脑也不行。同一时间同事是否能连我不知道。',
      category: '网络与 VPN',
      urgency: '高',
      status: 'resolved',
      assigneeId: memberIds[2],
      outcome: '已解决',
      outcomeNote: '客户端证书过期，重新签发证书并升级客户端后恢复。',
    },
    {
      title: '新同事登录不了工单系统',
      description: '本周入职的新同事用初始密码登录工单系统提示账号不存在，需要尽快开通，他今天要接单。',
      category: '账号与权限',
      urgency: '中',
      status: 'resolved',
      assigneeId: memberIds[1],
      outcome: '已解决',
      outcomeNote: '工号状态未激活，激活后按只读权限开通，第二天补写权限。',
    },
    {
      title: '财务部打印机一直显示离线',
      description: '财务部 3 楼打印机今天上午开始显示离线，重启打印机没用，几个人都打不出来。',
      category: '打印与设备',
      urgency: '紧急',
      status: 'resolved',
      assigneeId: memberIds[0],
      outcome: '已解决',
      outcomeNote: '打印服务器队列堵塞，清空队列并重启打印服务后恢复。',
    },
    {
      title: '外部客户发的邮件收不到',
      description: '客户说上周发过两封邮件给我，但我这边完全没收到，内部邮件正常。',
      category: '邮箱与协作',
      urgency: '中',
      status: 'escalated',
      assigneeId: memberIds[1],
      outcome: null,
      outcomeNote: '疑似对方域名 SPF 配置问题，已转交邮件网关管理员。',
    },
    {
      title: '换了新电脑后 VPN 还是连不上',
      description: '上周刚换的新笔记本，装好 VPN 客户端后连接提示证书无效。旧电脑是能连的，出差要用，比较急。',
      category: '网络与 VPN',
      urgency: '紧急',
      status: 'open',
      assigneeId: null,
      outcome: null,
      outcomeNote: null,
    },
    {
      title: '转岗后访问不了部门共享盘',
      description: '我从测试组转到产品组，共享盘里产品组的目录打不开，提示没有权限。主管说可以给，但不知道要走什么流程。',
      category: '账号与权限',
      urgency: '中',
      status: 'open',
      assigneeId: null,
      outcome: null,
      outcomeNote: null,
    },
    {
      title: '会议室投影连不上笔记本',
      description: '2 号会议室插上 HDMI 之后投影没有反应，换了接口也不行，一会要用。',
      category: '打印与设备',
      urgency: '紧急',
      status: 'in_progress',
      assigneeId: memberIds[0],
      outcome: null,
      outcomeNote: null,
    },
  ];

  const created = [];
  for (const t of tickets) {
    const ticket = store.createTicket({
      title: t.title,
      description: t.description,
      category: t.category,
      urgency: t.urgency,
      assigneeId: t.assigneeId,
      status: t.status,
    });
    if (t.status === 'resolved') {
      store.updateTicket(ticket.id, { status: 'resolved', outcome: t.outcome, outcomeNote: t.outcomeNote, actor: 'system:seed' });
    } else if (t.outcomeNote) {
      store.updateTicket(ticket.id, { outcomeNote: t.outcomeNote, actor: 'system:seed' });
    }
    created.push(store.getTicket(ticket.id));
  }

  // 已发布知识（明确标注为虚构演示数据）
  for (const card of CARDS) {
    const c = store.createCard({
      title: card.title,
      content: card.content,
      tags: card.tags,
      sourceTicketId: created[0].id,
      status: 'pending',
    });
    store.reviewCard({ cardId: c.id, action: 'publish', note: '演示数据：已人工核对', reviewer: '林可' });
  }
  for (const card of PENDING_DRAFTS) {
    store.createCard({
      title: card.title,
      content: card.content,
      tags: card.tags,
      sourceTicketId: null,
      status: 'pending',
    });
  }

  // 两张已解决问题单留下完整的「两种模式 + 人工审核」记录，让观察面板不是空的
  const seededRuns = [
    {
      ticket: created[0],
      reviews: {
        organization: { decision: 'adopt', rating: 5, reason: '证书这一步就是根因，步骤可以直接给用户。' },
        personal: { decision: 'edit', rating: 3, reason: '方向对但漏了证书过期，按实际处理改写后采纳。', editedText: '请先查看客户端证书到期时间，过期需重新签发；随后升级客户端并换网络复测。' },
      },
    },
    {
      ticket: created[1],
      reviews: {
        organization: { decision: 'adopt', rating: 4, reason: '指出了工号未激活这个前置条件。' },
        personal: { decision: 'reject', rating: 2, reason: '太笼统，没有可执行的第一步。' },
      },
    },
  ];

  for (const item of seededRuns) {
    const pair = await runPair({ store, ticket: item.ticket });
    for (const [mode, review] of Object.entries(item.reviews)) {
      const run = mode === 'organization' ? pair.organization : pair.personal;
      store.addReview({
        runId: run.id,
        decision: review.decision,
        editedText: review.editedText || null,
        rating: review.rating,
        reason: review.reason,
        reviewer: '林可',
      });
    }
  }

  // 时间线倒序铺开：让首页的「最近」看起来像真实的一周
  const backdate = store.raw.prepare('UPDATE tickets SET created_at = ?, updated_at = ? WHERE id = ?');
  created.forEach((t, i) => {
    const offset = (created.length - i) * 7 * 60 * 60 * 1000;
    const iso = new Date(Date.now() - offset).toISOString();
    backdate.run(iso, iso, t.id);
  });

  store.addEvent({
    ticketId: null,
    kind: 'seed_loaded',
    actor: 'system',
    summary: `载入演示数据：${created.length} 张问题单、${CARDS.length} 条已发布知识、${PENDING_DRAFTS.length} 条待审草稿（全部为虚构）`,
    payload: {},
  });
  return true;
}
