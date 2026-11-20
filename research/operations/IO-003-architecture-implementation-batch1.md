# IO-003：架构落地第一批（P1 安全加固 + P2 记忆闭环 + P3 领域核心演进）

**状态：** **已完成（2026-11-20）**——P1+P2+P3+P4+P5 全部落地：smoke 42/0、acceptance.js 端到端验收 14/0（含备份恢复演练）、perf-baseline.js 性能基线 11/0（应用层 4ms；检索包络 1k=133ms / 5k≈28s / 10k≈110s → ADR-007 重评实测依据）【本机已验证】；ADR-009 已接受；D-7 决定提供商暂不接（P7 推迟）。路线图剩余：P6 真实团队试点（用户主导；前置清单含产品模式 429 端到端验证）与 P7（推迟），无 AI 侧待办。
**目标：** 按 `research/architecture/08-roadmap.md` 已确认的 P1/P2/P3 实施第一批变更：P1 把权限阶梯与审计从约定变成代码断言并消除已知安全瑕疵；P2 补齐采用/有效跟踪（R1）；P3 落地 ADR-008 的 E1/E2（通用 WorkItem 类型层起步）。
**负责人：** 用户负责验收、运行测试/演练脚本的时机（D-5）与真实数据决策；AI 负责实现、静态复核与证据记录。
**输入依据：** `research/architecture/01–08`（2026-11-20 用户确认 D-0…D-6）；ADR-001…008 已接受；`AGENTS.md` 工作限制（测试仅在用户要求时运行；不读凭证；不访问业务数据库；不启停服务）。

## 完成条件

- P1 全部 7 项落地：错误规范化（500 固定文案+errorId、库不可用 503）、AI actor 写断言、UI_PROMPT_VERSION===PROMPT_VERSION 启动断言、审计 payload 白名单成文、事件 kind 常量单点化、90s 运行去重、updated_at 乐观并发。
- P2 全部 6 项落地：knowledge_uses 幂等加列（adopted/adopted_review_id/helpful/helpful_note/helpful_by_member_id/helpful_recorded_at + 索引）、权威审核回写、POST /api/uses/:id/helpfulness + 事件 use_helpfulness_recorded、派生视图（hit/adopted/helpful 计数与 helpfulRate）、runs 加 path/path_reason/tokens 列、smoke 扩展（脚本写好，运行时机由用户指定）。
- P3 第一批（E1/E2）落地：概念重命名仅限代码注释/文档（DB 列名、表名、API 路径不变）；work_item_types 描述对象 + tickets.work_item_type 列（默认 support_ticket，全量回填）；category/urgency 词表外置；核心机制护栏断言成文。E3（通用读模型路由）与 E4（第二类型 pilot_prep）在 P1/P2 验证后进行。
- 每项独立提交可回退；加列迁移幂等（重复执行无副作用）；不破坏现有功能与既有事件语义。

## 纪律（不可越过）

- 不读取 `.env`/凭证；不访问 `data/*.db`；不启动/停止 4173/4182/4186/4192/4193/4195 上的运行实例；不调用付费模型。
- 自动化测试与 smoke 脚本**不运行**——扩展脚本只写不跑（D-5：运行时机由用户指定）；静态校验仅限 `node --check`。
- AI 建议 ≠ 真实结果；所有新指标数字标注【暂定】直到本机验证。
- 每完成一项，在本文件"已完成"区记录代码证据（文件:行）。

## 已完成（2026-11-20，全部为静态实现 + 一次性临时目录探针；未运行 smoke、未启动服务、未触碰 4173–4195 与 data/*.db）

### P1 安全与边界加固（路线图 P1 工项 1–7，全部落地）

- **P1-1 错误规范化**：`server/api.js` 新增 `serverError()`（500 固定文案 + 8 位 errorId，err.message 只进日志）与 `serviceUnavailable()`（SQLite 错误 → 503 固定文案）；分发层 catch 按 `err.code`/SqliteError 分流。原来 `err.message || '服务器内部错误'` 直接回显客户端的路径已移除。
- **P1-2 AI actor 写断言**：分发层对非 GET/HEAD 检查 `x-actor` 头 + PATCH 工单处理对 `body.actor` 的 `agent:*` 前缀拒绝（403 + `agent_write_rejected` 审计事件，payload 仅 actorName/method/path）。服务端内部事件（agent_run 等）不受影响。
- **P1-3 版本一致性启动断言**：新文件 `public/app-version.js` 为单一事实来源；`server/index.js` 启动时比对 `PROMPT_VERSION !== UI_PROMPT_VERSION` 即拒绝启动；`public/app.js` 改为 ES module import（浏览器侧引用同一文件，已验证可被 Node 解析）。
- **P1-4 payload 白名单成文**：新文件 `server/event-kinds.js`（28 个 kind × 白名单字段表）；`store.addEvent` 写入点直接校验，白名单外字段抛错（探针验证：sneaky 字段被拦截）。
- **P1-5 事件 kind 单点化 + UI 同步断言**：同文件导出 `EVENT_KIND_LABEL`；`/api/state` 下发 `eventKinds`；`public/app.js` `assertKindLabelsSynced()` 在 loadState 时对账，不一致 console.warn（不阻断使用）。UI `KIND_LABEL` 已补齐新增 kind（agent_suggestion_ready / use_helpfulness_recorded / card_pilot_approved / agent_write_rejected 等）。
- **P1-6 运行去重**：`POST /api/tickets/:id/run` 先查 `runs` 表最新时间（`store.latestRunAtForTicket`），90s 内 → 409 `RUN_DUPLICATED`（以 runs 表为准，事件时间序可能被演示数据回拨）。
- **P1-7 乐观并发**：PATCH /api/tickets/:id 接受 `updatedAt`；`store.updateTicket` 新增 `{ expectedUpdatedAt }` 三参 + `UPDATE ... WHERE updated_at = ?` 守卫，双重校验，冲突返回 409 `STALE_WRITE` + latestUpdatedAt；不带 updatedAt 的旧调用保持兼容（行为不变）。UI 三处 PATCH 均已携带 updatedAt + 409 处理（状态/负责人下拉、结果弹窗）。

### P2 记忆闭环（路线图 P2 工项 1–6）

- **P2-1 迁移**：`server/db.js` `migrateMemoryLoop()`——knowledge_uses 加 adopted/adopted_review_id/helpful/helpful_note/helpful_by_member_id/helpful_recorded_at + idx_uses_card_adopted/idx_uses_run。**一次性临时 DATA_DIR 验证**：14 张表齐全、列/索引齐、二次 openDb 幂等通过；未触碰真实数据库（迁移将在用户指定时机随服务重启生效）。
- **P2-2 权威审核回写**：`store.addReview` 在插入 review 后按最新决定重写该组织模式运行全部 use 行（adopt/edit→adopted=1+review_id；reject→adopted=0+清引用；改判覆盖已验证）。
- **P2-3 有效性标注**：新路由 `POST /api/uses/:id/helpfulness`（helpful/not_helpful/clear 三态 + 备注 ≤500 字）；`store.recordUseHelpfulness` 写行 + `use_helpfulness_recorded` 事件（payload 只有 useId/runId/cardId/helpful/hasNote，无正文）；UI 工单详情组织模式卡片渲染三态按钮（解决后可选动作，不强制）；知识卡列表/详情显示「审核采纳 N · 有帮助 N · 没帮助 N」。
- **P2-4 派生视图**：`analytics.metrics().knowledge.useOutcome`——uses/adopted/adoptRate/helpful/notHelpful/unrated/helpfulRate；**helpfulRate 分母只算已标注**（三态互不推断，④§6.2 口径）。
- **P2-5 runs 落库扩展**：`migrateRunPath()` 加 path/path_reason/gate_ms/retrieve_ms/model_ms/prompt_tokens/completion_tokens；`llm.completeJson` 透传 usage（缺失保持 null，不伪造）；`agent.runAgent` 测 retrieve_ms 并落 path='main'（分层路由属 P4）；runPair 调用方零改动。runsByTicket 消费者全部 `r.*` 透传，自动兼容。
- **P2-6 smoke 扩展**：`scripts/smoke.js` 新增 5b/5c 段（回写、三态标注+清除+非法值、派生统计、重复运行 409、过期 updated_at 409、最新值写入成功、AI 身份 403、词表外类别 400、新事件 kind 断言）+ 第二单补采纳审核。**只写不跑（D-5：运行时机由用户指定）。**

### P3 领域核心演进（E1–E4 全部完成，E5 不排期）

- **E1 概念重命名**：仅语义层——store.js/api.js/db.js 头注释建立「工作项 WorkItem ↔ tickets 表/API 路径冻结名」映射；DB 列名、表名、路由路径全部未动（零破坏）。
- **E2 类型层**：新文件 `server/work-items.js`——WORK_ITEM_TYPES 描述对象（id/label/statusVocab/fieldVocab），核心机制护栏写死在文件头；db.js `migrateWorkItemType()` 加 `tickets.work_item_type`（默认 'support_ticket'，全量回填即默认值语义）；`createTicket` 落列 + 类型校验；POST /api/tickets 按 `getWorkItemType` 校验 category/urgency 词表（词表外 400）；`/api/state` 下发 `workItemTypes`；新建工单弹窗的类别/紧急度下拉改从类型词表渲染（UI 不再写死词表；seed 词表与 support_ticket 词表一致已核对）。
- **E3 通用读模型路由**：`GET /api/work-items?type=&status=&parent=`（④§10.3）——按类型过滤 + `typeLabel`（中文标签来自类型描述对象，UI 不裸露 WorkItem 词）；写路径保持 `/api/tickets`（新旧并存零破坏）；未知类型 400。
- **E4 第二类型接入**：pilot_prep（试点准备任务，跨职能词表：试点协调/物料与场地/数据与授权/演练与培训/其他）进 WORK_ITEM_TYPES；`tickets.parent_ticket_id` 迁移列（REFERENCES tickets）；POST 接受 parentTicketId（父不存在 400）；`ticket_created` 事件 payload 扩展 workItemType/parentTicketId（白名单已同步）；UI 新建对话框按类型渲染标题与提示。
- **E4 探针验证（一次性临时 DATA_DIR，④§10.4 足迹基准逐项过）**：W-101（pilot_prep）→ W-102（support_ticket 子项）跨类型父子建立；子项走**同一运行管道**（createRun + searchApprovedMemory 上下文 + addReview 权威回写 adopted=1）——零新表、零机制分支；E3 类型/父过滤正确；无效父 id 与未知类型均被拒；不带类型参数的旧路径默认 support_ticket 完全不受影响。
- **E5（表归并）不排期**——仅 ADR-008 重评条件 ②（类型数 ≥3 且跨类型查询高频）成立时开新 ADR。
- **E3/E4 语义收尾**：smoke.js 增 5d 段（第二类型创建/跨类型父子/E3 双过滤/typeLabel/未知类型 400/子项运行管道/无效父 400 断言）——只写未跑（D-5）。

### 本机验证记录（均非 smoke、非服务启动；一次性临时 DATA_DIR，用后即删）

- 全部改动文件 `node --check` 通过（server 9 文件 + scripts/smoke.js + public 2 文件）。
- 迁移探针：表 14 张、新列/索引齐全、二次打开幂等。
- store 探针：work_item_type 落列、run 路径/拆分列落库、adopt 回写 1/1、改判后 0/null、三态标注与清除、乐观并发冲突与放行、白名单外 payload 抛错、未知 use 返回 null。
- 事件 kind 扫描：28 个注册 kind，全仓 `kind: '...'` 字面量无未注册项。
- 版本常量：两侧同值（support-agent-v4.0-matched）。
- 探针数据全部落在 `%TEMP%/dsh-ior-sandbox-test*` 并已删除；未读取 `.env`、未访问 `data/*.db`、未启停任何运行实例、未调用模型。

## 边界与未完成

- **2026-11-20 收尾（用户三项决策后）：** ① D-5 授权运行 smoke——首轮 3 处失败均为**测试脚本侧**问题（旧断言缺 `reviewer` 参数、预期失败调用误用抛错型 call），修复后重跑 **39 通过 / 0 失败**，业务代码零改动；P1/P2/P3 通过条件正式达成【本机已验证】。② ADR-009 经用户确认接受（9 条 ADR 全部已接受）。③ D-7 决定：连接器提供商**暂不接、接口先行**——P7 推迟至真实需求出现，连接器接口与 external_actions 设计保持就绪。
- **2026-11-20 追加（总纲符合性核对后）：** 补齐执行域设计缺口——新文档 ⑨（连接器与执行闭环：目标解析/九态运行状态机/external_actions 审批+幂等+outcome_uncertain/周报与邮件用例走查/进度传输取舍）、④§11（runs 状态列 + external_actions DDL，只设计不实施）、③ 流程 9/10 + 总纲映射附表、⑦ ADR-009、⑧ P7 阶段（依赖 D-7）、README 索引/一页结论/D-7 决策点。全部为【架构已设计】，无代码变更。
- **2026-11-20 追加（P3 收尾）：** E3/E4 实现完成（work-items.js 增 pilot_prep、parent_ticket_id 列迁移、GET /api/work-items、UI 类型标签渲染）；E4 探针验证零机制复制；smoke 增 5d 段（未跑）。P1+P2+P3 全部实现完毕。
- 迁移尚未应用到真实产品数据库（`data/*.db` 未触碰）；将在用户指定时机随服务重启生效——迁移幂等，重复执行无副作用。
- smoke/演练脚本运行（P1/P2 通过条件依赖它）、真实数据回填与真实团队验证均等待用户指定时机（D-5）。
- 本批未实现 E3（GET /api/work-items 读模型路由）与 E4（pilot_prep 第二类型验证）；E5（表归并）不排期，仅 ADR-008 触发条件命中时开新 ADR。
- P4（延迟分层——routeRequest/缓存快路径）、P5（部署验收包）、P6（真实团队试点）按路线图另行推进。
- helpful 标注 UI 未做 viewer 角色隐藏以外的特殊权限处理：写接口继承现有登录/CSRF/viewer 拦截链，只读成员无法调用。
- 本工作项不含任何对真实用户的联系或对真实成效的声明；AI 建议 ≠ 真实结果。
