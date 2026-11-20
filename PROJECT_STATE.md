# PROJECT_STATE

## 目标
交付「组织智能实验台」第一版：单组织客服问题单工作台，个人模式 / 组织模式并排对照，知识卡片人工审批与复用（依据 `MVP_PLAN.md`）。

## 已完成
- 服务端骨架：`server/`（零框架 HTTP + node:sqlite，零运行时依赖除 RemixIcon 字体）
- 数据层：问题单 / 运行记录 / 人工审核 / 知识卡片 / 组织事件，SQLite 单文件 `data/app.db`
- 智能体：`server/agent.js` + `server/demo-brain.js`，固定 JSON 输出、引用硬校验、三个受控工具
- 检索：`server/retrieval.js`（CJK 二元组加权），向量检索接缝已预留
- 前端：`public/` 单页应用（工作台 / 问题单详情 / 组织记忆 / 事件 / 设置，窄屏底部 Tab）
- 演示模式：无 MODEL_API_KEY 时本地规则生成，界面与运行记录均标注
- 演示数据：`server/seed.js`（7 问题单 / 4 已发布卡 / 2 待审草稿 / 2 组带审核运行）
- 测试：`npm run smoke` 21 项断言全过（含「沉淀经验 → 新单复用」主线）
- 视觉：Chrome 无头实测截图 `.design/shot-*.png`；工程门禁 20/20；视觉度量仅剩 VM21（真实照片，工具界面豁免）

## 首轮 live 模型模拟试跑（2026-11-16）
- 服务确认在线：`http://127.0.0.1:4173`；模型状态 `live / deepseek-flash`
- 完成 10 张问题单、10 组成对运行、20 条入选 live 输出：#18–21 为种子模拟数据，#22–27 为本轮新增且标题带「模拟观察」的数据
- #15–17 也曾 live 运行，但这些已解决种子单会被组织模式检索为当前单的历史案例，存在自我检索泄漏，不纳入 10 组主样本
- #20 有重复 live 对照，本轮只选最近一组
- 10 组仍待人工审核；没有把 AI 预审建议写入系统的人工采纳/编辑/拒绝记录
- 首页全局指标受种子运行、预置审核、探索运行和重复运行影响，不能代表这 10 组；详见 `research/observations/2026-11-live-model-simulated-pilot.md`

## 助手代审记录（2026-11-16）
- 按明确白名单完成 #18–27 共 20 条输出的助手代审，数据库审核者标为 `Codex（助手代审）`；按每条运行的最新记录，个人模式 7 条采纳、3 条编辑后采纳（平均评分 4.4/5），组织模式 1 条采纳、9 条编辑后采纳（平均评分 3.2/5），无拒绝项。#21 组织稿的一条早期审核已通过新记录更正，历史保留。
- 这些是对模拟输出的单一助手评阅，不是组织成员的人工审核、真实业务采纳或实际处理结果；评分不可作为组织模式效果结论。详细理由及限制见 `research/observations/2026-11-live-model-simulated-pilot.md`。
- 编辑后采纳的修订稿保存于对应 review 记录；没有发送工单回复、发布知识卡、调用模型或更改业务处理状态。
- 审核记录已加来源类型字段并按来源拆分统计，助手代审不再被显示为人工审核；详见下方「审核来源分类」节。

## 审核来源分类（2026-11-16，已重启并复验）
- 来源类型 `review_source_type`：`human` 人工 / `assistant` 助手代审 / `seed` 种子演示 / `unknown` 来源未知。来源只认字段，不从 reviewer 名称推断。
- 幂等迁移 `server/review-source.js`：reviewer 精确等于「Codex（助手代审）」→ assistant；关联运行 origin=demo → seed；其余历史记录保持 unknown。只更新仍为 unknown 的行，不删除、不改写决定/评分/修订稿/理由/审核者/时间。执行两次结果一致：25 条审核 = 21 assistant + 4 seed + 0 unknown，总条数与 #21 两条历史均未变。
- 写入路径：详情页提交默认且显式 `human`；助手代审必须显式传 `assistant` 并填写审核者；API 拒绝 seed/unknown 写入（仅供迁移使用）。
- 统计口径：每条运行按**最新一条**审核决定当前状态，全部历史保留。观察批次页与首页分别展示来源：首页「人工审核口径」只算 human（当前 0 条），观察批次页给全来源合并行 + 按来源拆分行，每行分母写清（组 10 / 运行 20）。种子+未知合并为去重视图，不新增记录。
- 修改文件：`server/db.js`（建表补齐 + 启动时幂等迁移）、`server/review-source.js`（新增）、`server/store.js`、`server/api.js`、`server/analytics.js`、`server/batches.js`、`public/app.js`、`public/styles.css`。
- 未调用模型、未改工单业务数据；已重启 4173 并验证新口径生效。`/api/state` 显示全库 assistant 21 / seed 4 / human 0 / unknown 0；人工首页审核数为 0。

## 当前待处理
- 如需人工基线，另由组织成员复核 #18–27 的个人/组织模式输出；本批 human 审核为 0，不能把助手代审记录当成人工样本
- 观察批次按来源复核通过：10 组 / 20 条运行；assistant 两侧 10 组、20 条运行，human 0；全来源历史审核记录共 25 条（21 assistant 含 #21 更正历史 + 4 seed）
- 准备真实工单样本后再开展正式业务观察；种子和本轮新增模拟数据不计为真实业务案例

## 检索自我排除修复（2026-11-16，已重启并复验）
- `server/agent.js`：组织模式检索把当前 `ticket.id` 传入检索层；`tool_calls` 记录新增 `exclude_ticket_id` 字段
- `server/store.js`：`searchApprovedMemory` 透传 opts 给 analytics 层
- `server/analytics.js`：已解决案例候选在检索前排除与 `excludeTicketId` 同 ID 的案例；不传时行为不变（通用搜索接口不受影响）；已发布知识卡片不受影响
- 重启后重新运行 #15–17，组织模式均排除了同 ID 的历史案例；个人模式均无组织记忆引用
- 复验运行组：#15 `gmwj2flosgnxt`（个人 #45 / 组织 #46）；#16 `gmwj2ih82nbcc`（个人 #47 / 组织 #48）；#17 `gmwj2jlv61rwk`（个人 #49 / 组织 #50）
- 复验只证明检索修复生效；#15–17 是虚构种子单，不纳入首轮 10 组成对观察样本

## 观察批次页（2026-11-16，已重启并验证）
- 新增 `server/batches.js`：按观察记录的 **run_group 白名单**定义 10 组模拟样本（#18–21 种子模拟 + #22–27 模拟观察 S01–S06），提供只读聚合视图；排除 #15–17 复验/探索组、#20 较早重复组、demo 演示运行，不按工单 ID 筛选。
- `server/api.js` 新增 `GET /api/observation`（批次列表）与 `GET /api/observation/pilot-2026-11`（10 组详情 + 分母明确的统计）。
- `public/index.html` / `public/app.js` / `public/styles.css`：新增「观察批次」导航与只读页面（配对输出、检索来源、最终引用、审核状态、工单详情深链 `#/t/{id}?g={runGroup}`）；工单详情页新增运行组选择器，审核仍走既有流程。
- 统计口径：组级分母 10（有记录/部分/无记录分列，并按来源区分），运行级分母 20（个人 10 + 组织 10，未审核不算采纳/拒绝）。首次只读核对时 10 组均未审核；助手代审后按来源复核为 assistant 两侧 10 组、20 条运行，human 0。
- 验证深链 `#/t/18?g=gmwj10vi5lsjd` 会打开 #18 详情并定位到指定运行组；当前工作台停留在该组，尚未提交人工审核。
- 页面标注「模拟样本，不是真实业务成效」，每条运行显示审核者和来源，并提供全来源与来源拆分统计。服务重启后只读接口验证：全库 21 assistant / 4 seed / 0 human / 0 unknown；本批 20 条当前状态均来自 assistant，首页人工审核为 0。未调用模型、未生成业务内容。

## 数据范围隔离与来源可追溯（2026-11-17，已重启并复验）
- 目标：为小规模真实工单试点隔离模拟数据，提高组织记忆的依据可追溯性。**未导入任何真实工单或个人信息**；变更前全库 13 工单 / 38 运行 / 6 卡 / 25 审核，变更后条数不变。
- 新增 `server/data-scope.js`：`scope` 取 sample / pilot；运行 scope 自动继承工单，不单独填写。知识来源 `source_kind` 取 policy / guide / resolved_case / unknown。
- 幂等迁移（连跑两次结果一致，只补列与缺省回填，不删改历史）：全部现有工单/卡/运行 → `sample`；6 张现有卡 `source_kind=unknown`、`pilot_approved=0`（历史来源无审批主体/适用范围/有效期证据，不自动升级为制度依据）；历史 C 案例固定标 `resolved_case`（仅相似参考）。已写入明确值的行不被覆盖。
- `server/db.js` 建表含新列并在 openDb 时跑迁移；新增列的索引在迁移后创建，兼容尚未迁移的旧库。`server/store.js` 建工单默认 sample（显式 pilot 才进入试点）、知识卡只继承来源工单范围，建卡时不自动批准。`approveCardForPilot` 只接受 pilot 范围卡且来源工单也须为 pilot；sample 种子卡不可升级。
- 检索边界 `server/analytics.js::searchApprovedMemory`：
  - 不传 scope（通用搜索接口）与 `sample`：保持旧行为，全部已发布卡 + 全部已解决案例，`excludeTicketId` 自我排除仍生效——首轮 10 组可复现。
  - `pilot`：排除所有 sample 工单与 sample 案例；知识卡只取 `scope=pilot AND pilot_approved=1 AND status=published AND source_kind∈{policy,guide}`，且适用范围匹配当前工单类别、未过有效期；返回项 meta 带 scope/source_kind/来源/适用范围/审批主体。
- 试点适用范围匹配采用逗号分隔的精确类别/标签，不用 `any` 等子串做通配；明确填写「通用」「all」等完整 token 才能跨类别匹配。
- 既有隔离副本验证：sample 组 4 条命中、pilot 组批准前 0 条、批准后 1 条 guide、类别不匹配 0 条；真实库未新增试点数据。随后补上 sample 卡拒绝升级的服务端闸门与 UI 限制。
- 证据闸门 `server/agent.js`：提示词增加证据分级规则；pilot 未命中 policy/guide 时始终提示责任人核实并写 `evidence_gate`，sample 仅在检测到制度性表述且无权威来源时触发；tool_calls 记录 scope、类别、逐条来源类型与证据判定。历史案例不得单独支撑制度结论。
- API：`POST /api/tickets` 支持 `scope`；`POST /api/cards/:id/pilot-approve` 人工批准卡进入试点（校验元数据）。`/api/state` 的 `metrics.scope` 给出工单/运行/卡的范围分布与试点批准卡数。
- 界面：工单详情、卡片、引用、观察批次均显示数据范围与来源类型标签；组织记忆页可对已发布卡发起「批准用于真实试点检索」；首页显示范围分布；新建工单可选 sample/pilot（默认 sample，并提示不要录入个人信息）。首轮 10 组批次白名单与统计口径未改。
- 修改文件：`server/{data-scope,db,store,analytics,agent,api}.js`、`public/{app,styles}.js/css`。重启后健康检查通过；只读核对范围为 13 sample 工单 / 38 sample 运行 / 6 sample 卡、0 pilot 数据、0 试点批准卡；25 条审核仍为 21 assistant / 4 seed。观察批次仍为 10 组、20 条运行、无缺失配对。未调用模型、未发布知识卡。

## 真实试点闭环准备（2026-11-17，代码改动完成；未重启、待生效）
- 目标：把「授权工单 → 双模式建议 → 人工审核 → 知识审核 → 另一条新工单复用」串成可复核闭环。**未导入任何真实工单/个人信息、未创建人工审核记录、未调用模型、未读取/输出 .env、未清库、未重启 4173、未跑自动化测试**；迁移与聚合只在隔离副本上验证，真实库与服务未动。
- 先做只读核对，已有能力不重复建设：双模式成对运行 + model/prompt_version/run_group/检索来源记录（`agent.js`/`runs`）、人工审核四要素 + 助手代审分离（`reviews`/`analytics`）、自我检索排除、个人模式不读组织记忆、sample→pilot 升级闸门——均已在位。真实缺口只有三处，已补齐：
  1. **试点工单元数据**：`tickets` 新增 `source_ref`（数据来源/授权依据）、`desensitization`（脱敏状态 unknown/done/partial/not_needed）、`authorized_by`（授权人）。`POST /api/tickets` 对 pilot 单强制三项齐全，缺省/未声明一律拒绝进入隔离区；sample 单不校验。
  2. **知识负责人**：`knowledge_cards` 新增 `knowledge_owner`，与 `approval_body`（审批主体）分开记录；`approveCardForPilot` 把它列为必填校验，进入检索的卡 meta 也带此字段。
  3. **试点闭环只读页**：新增 `server/pilot-loop.js` 与 `GET /api/pilot-loop`，前端新增导航「试点闭环」；只取 scope=pilot 数据，串起授权登记、运行可复核依据（工单 ID/运行组/模型/提示词/检索来源/是否排除自身）、按来源拆分且分母明确的审核统计、知识链状态、跨工单复用核对（只有不同工单命中且引用才算复用）。
- 迁移：扩展 `migrateDataScopes` 幂等加列 + 保守回填（老行 scope=sample、source_ref 空、desensitization=unknown、knowledge_owner 空），不改任何标题/正文/审核/决定/评分；隔离副本连跑两次结果一致，13 工单 / 38 运行 / 6 卡 / 25 审核条数不变，integrity ok。
- 静态检查：全部 `server/*.js` 与 `public/app.js` 语法通过；隔离副本验证试点视图在纯 sample 库上四项计数全为 0（样本被完全排除）；内存夹具验证 human/assistant 分开计、未审核单独计、组织模式排除自身、个人模式无检索、跨单复用计数正确。
- 修改文件：`server/{data-scope,db,store,analytics,api,pilot-loop}.js`、`public/{app.js,index.html}`。
- **需重启生效**：当前 4173 仍是旧代码；本轮改动（新列迁移、`/api/pilot-loop`、新页面、pilot 建单校验、知识负责人必填）都只在服务重启后才生效。未重启前不要录入试点工单。

## 试点闭环三处修复（2026-11-17，第三轮；代码完成，未重启、待生效）
- 边界同上一轮：只读核对现有实现后做最小修改，未导入真实工单/个人信息、未创建人工审核、未调用模型、未读取或输出 .env、未清库、未重启 4173、未跑自动化测试；无需新迁移（复用已有 `desensitization` / `review_source_type` 列）。
- **1. 知识草稿必须由真实人工认可触发**：新增无配置依赖的 `server/draft-gate.js`，`pilotDraftGate(store, ticket)` 显式按 id 取「最新组织模式运行」及其「最新审核」；仅 `review_source_type='human'` 且 `adopt`/`edit` 才允许起草。`edit` 处理步骤取该审核的 `edited_text`（空文本也拦截），`adopt` 取该组织模式运行的 `output.next_actions`；未审核 / assistant / seed / unknown / reject 由 `POST /api/tickets/:id/knowledge-draft` 返回 409，不创建也不修改卡片，不回退模型原文。`ticketView` 增加只读 `draftGate` 原因，详情页显示为何暂不能生成并禁用按钮。sample 完全保留旧口径（`pilotDraftGate` 返回 null），唯一差别是试点闸门先于「已有草稿」检查，避免人工撤回认可后重生成。
- **2. 跨单复用口径修正**：`server/pilot-loop.js` 区分 `crossTicketHits`（不同工单检索命中，含未引用）与 `crossTicketReuse`（其中被输出真正引用），summary 增 `crossTicketHitCount`，`crossTicketReuseCount` 只按实际引用计数；工单自身命中两个口径都不计。闭环页概览分列「跨单命中 / 实际引用复用」，复用表只列已引用记录，另列「命中未引用（不计复用）」明细，并写明两个分母。
- **3. 试点运行数据闸门**：`POST /api/tickets/:id/run` 服务端强制 `scope=pilot` 且 `desensitization ∈ {done, not_needed}`，否则 409 且明确提示脱敏状态；`partial` / `unknown` / 其他值一律拒绝，调用模型发生在闸门之后。`ticketView` 增只读 `runGate` 原因，详情页显示拦截说明并禁用两个「生成两种建议」按钮；前端禁用只是提示，不是防线。
- 修改/新增文件：`server/{draft-gate,agent,api,pilot-loop}.js`、`public/app.js`。
- 验证：全部 `server/*.js` 与 `app.js` 语法通过；纯内存夹具（不读 .env / 不碰数据库 / 不调模型）逐项验证 10 种审核状态、sample 不受影响、跨单命中 2 / 实际引用复用 1 且自身命中与 sample 被排除。夹具发现原「最新审核 = 数组首项」的隐含假设，已在 gate 与 pilot-loop 改为显式按 id 取最大。临时验证脚本已清理。
- 已知限制：当前 UI 不能在已创建的试点工单上修改脱敏状态；若建单时误选 `partial`，只能重建工单或后续增加受控的 PATCH 入口。本轮未扩范围。

## 当前待处理（真实试点启动前，需人工确认）
- 由组织成员录入 pilot 工单（最小必要信息，不含个人信息）并提供可核验的真实 policy/guide 来源。现有 sample 种子卡不能升级；批准按钮只对 pilot 来源卡显示，API 也会拒绝 sample 卡。
- 人工核实来源、适用范围、审批主体和有效期后，再批准候选卡进入 pilot 检索；此前 pilot 组织模式无权威知识时会提示核实制度，这是预期行为。
- 重启 4173 后：先用一张授权试点工单走「审核—知识审核—新工单复用」，在「试点闭环」页逐项核对；再由组织成员判断成效，不以机制跑通或评分代替真实结果。
- 准备可追溯的人工审核，再汇总成对差异与实际处理结果
- 依据错误引用和知识迁移情况，决定是否调整检索阈值、标签或向量检索

## 时效性记忆公开资料对照（2026-11-17）
- 完成 5 组公开 GitHub 规则新旧版本对照，比较普通资料片段与明确标注生效时间/适用范围的记忆；DeepSeek Flash、组织模式、两套 `%TEMP%` 隔离数据库，不含真实组织资料。
- 首轮 10 次中 2 次返回空内容；各重试一次后均获得可读回答。逐题定性复核显示结构化组在 4 项上更明确，GraphQL 一项两组方向均正确、结构化组时间边界更完整。只有单模型和单次有效回答，不能作为普遍提升结论。
- 后续完成受控复测：相同来源文本、标题、标签、来源链接、问题和检索候选，只改变 `applies_to`；10/10 live 输出非空，两组每题检索的来源编号相同。日期字段帮助表述时间，但没有修复过期规则和创建仓库权限被片段截断的问题，也没有让审批问题召回正确的 K7/K8。
- 隔离样本上补了小规模检索改进：`server/retrieval.js` 将片段上限从 96 提到 480 字符；`server/analytics.js` 将来源工单类别传给检索，完全同类时软加权 2.5 分，并记录 `category_match`。过期策略、审批 API、仓库权限各跑两种记忆版本一次，6/6 live 非空；两版都读出 366 天规则、召回 K7/K8、读出 `repository_creation:write`。仅 3 题/条件各 1 次，需扩大样本并检查长文档与类别偏置。
- 4173 曾在临时服务清理期间离线，现已恢复并加载新代码；只读复核主库仍为 15 工单 / 42 运行 / 7 sample 卡 / 0 pilot 批准卡，未新增业务记录。研究记录与临时页面：`research/observations/2026-11-temporal-memory-public-source-benchmark.md`；初测端口 4177/4178，复测端口 4179/4180。
- 为进入「人确认 → 组织记忆 → 新问题复用」阶段，在 4180 的临时结构化样本库新增 K10 过期规则候选卡，`scope=sample`、`status=pending`，附 GitHub 官方 2024/2025 changelog 与适用范围。未创建审核记录、未发布、未用于检索；主库不变。需用户阅读并明确发布/修改/驳回及审核者姓名后，才能用新问题验证复用。
- 为得到干净的发布前后比较，另建 4182 隔离库，只含来源工单 #1、待审候选 K1、待处理问题 #2。发布前基线组 `gmwkskaxf4b43`：个人/组织均 live，均无知识引用；组织稿要求核对现行组织策略。K1 未发布、未检索。只读检索预检确认 pending K1 不在正式搜索结果中；模拟发布状态时 K1 能以同类优先匹配新问题，且完整规则进入片段；无数据库写入、无模型调用。用户决定并填写审核者后，才创建 #3 新问题并运行复用验证。预设通过标准：个人引用数 0；组织引用包含 K1；回答区分个人无过期与组织默认 366 天、正确标明 2022 历史规则、要求核实实际组织策略。4180 的 K10 仍待审，但不用于此项因果比较。
- 组织记忆页来源 URL 改为可点击的 HTTPS 链接，安全地新标签打开；`public/app.js` 语法检查与 4182 静态资源响应检查通过。此改动仅降低人工核验来源的操作成本，不发布、不审核 K1。
- 发布后复用验证脚本已保存为 `research/scripts/run-after-review.mjs`，通过语法检查。它要求 K1 已发布、最新审批动作含审核者姓名，且后续问题不存在；之后才创建新问题并调用成对模型运行。当前尚未执行。
- 另用已由用户批准的虚构演示卡 K19 做了独立复用演示：只含 K19 一张已发布卡的临时副本运行在 4183；新建 sample 工单 #30 的个人/组织两种 live 输出均来自 `deepseek-flash`。个人模式 0 条记忆引用，组织模式检索并引用 K19，且明确它是虚构、来源未核实，不代表真实制度。运行组 `gmwktaqav5nrs`；[配对结果](http://127.0.0.1:4183/#/t/30?g=gmwktaqav5nrs)。该单次演示不证明准确率或真实业务效果；主库未修改。
- 追溯到 K19 的人工编辑来源：主库工单 #28 的组织 live 运行 #52 原先给出通用核查清单；审核 #34（human，陈朋）将其编辑成显式限定为“虚构演示”的 7 天步骤，修订内容进入 K19；卡片发布审核 #13 同样标注不代表真实制度。隔离新工单 #30 后续检索 K19 并引用这条编辑后的步骤，同时保留非真实制度声明。这证明模拟数据里的“模型草稿→人工编辑→组织记忆→新单复用”可追溯，不等于真实业务效果。
- 在同一隔离副本做 3 组复用边界复测（工单 #31–33）：个人模式均为 0 组织记忆引用；组织模式均检索到 K19。两道边界题中，组织模式没有将虚构演示推断成正式审批权限或许可证共享许可，但“许可证共享”题也暴露同类别检索会带入相关度不足的 K19。组级详情链接与限制见 `research/observations/2026-11-temporal-memory-public-source-benchmark.md`；副本总计 19 单 / 50 运行 / 1 张已发布卡 / 4 次知识使用，主库计数保持 15 单 / 42 运行 / 7 卡 / 26 审核。
- 对 #33 做了检索打分复算：K19 不加类别权重为 17.37，加权为 20.24，最低检索分 1.2。类别加权不是 K19 命中的唯一原因；宽泛关键词重叠也把“相关领域”卡片带入上下文。模型本次说明该来源不能支持许可证共享，但需要后续区分检索相关度与证据充分性。
- 只读核验检索边界：同一许可证共享问题在 sample scope 返回 K19（sample / unknown / 8.33 分），pilot scope 返回 0 个候选，隔离副本的已批准试点卡数为 0；没有创建 pilot 工单或调用模型。说明当前过滤会把 K19 拦在真实试点之外。
- 重新核对 K1 的公开来源：GitHub 当前组织文档确认 fine-grained PAT 默认最大期限为 366 天且企业级策略可约束组织策略；个人 PAT 文档与 2024/2022 changelog 支持无过期选项及 beta 旧规则的历史边界。K1 仍 pending、无审核记录；本次只查看公开页面，未改卡或写审核。
- 对主库 19 组成对 live `deepseek-flash` 数据作只读分析：个人平均模型请求 9.25 秒、组织 9.54 秒，组织−个人平均差 +0.29 秒且 10 组为正、9 组为负。旧 `runPair()` 串行等待两次请求，组内请求时长和中位数 18.61 秒。
- 为降低并排等待，`server/agent.js` 将 `runPair()` 改为 `Promise.all` 并行调用，并已重启 4173 加载。4183 隔离库先测不同问题 #34–36，再对同一虚构问题 #37 重复 7 组；共 10 组配对 API 用时平均 9.09 秒、中位数 8.69 秒，范围 6.97–11.65 秒。同题 7 组中组织模型调用平均 9.00 秒、个人 7.81 秒，差值中位数 +0.25 秒；样本小且模型输出/网络波动，不能把差值归因于检索。个人每次 0 条组织记忆，组织每次检索 K19。实验数据仅在 4183 临时库；主库重启后仍是 15 单 / 42 次运行 / 7 张卡 / 26 条审核。尚未测浏览器端到端，下一步先测界面体验，再评估 JEV 快模型。
- 查阅 TypeSafe 官方 API 后确认 Jev 输出结构化 yes/no / choice / score，不生成回复文本；适合做快速相关性、分流或证据充分性判断，不可直接替代 DeepSeek 回复模型。用 .env 中 `TYPESAFE_API_KEY` 调用 `jev-latest`（解析为 `jev-1.14.0`），密钥值未输出。
- 新增 `server/typesafe-gate.js` 与 `TYPESAFE_MEMORY_GATE` 配置（默认 off）：只在 4183 显式启用 `shadow`，且仅处理 sample 工单；与 DeepSeek 并行，2.5 秒上限；概率及“建议支持/不支持”写进运行 `tool_calls` 并显示于工单详情，但 `applied=false`，不改变检索、提示词、回答；pilot 工单不会发送到 TypeSafe。`public/app.js` 新增影子判断展示。
- Jev 直接 API 同一虚构 K19 状态 5 次耗时 0.628–0.856 秒（均值 0.698、中位 0.654），4 个并行判断输出稳定且符合样本已知边界；许可证共享直接 API 回答 0.03/0.03/0.96（不支持共享 / 证据不足 / 需查正式授权）。
- 4183 影子集成：#33 许可证共享题上 K19 支持概率 0.03、Jev 626ms、组 API 11.06s；#37 试用步骤正向题上概率 0.87、Jev 623ms、组 API 6.84s。两者均未应用过滤；DeepSeek 保持原样读取来源并生成回复。第一次集成失败状态为 unavailable，原因未知；放宽超时和加错误分类后两条复测成功。仅隔离库有新增运行，4173 主库保持 15 单 / 42 次运行 / 7 卡 / 26 审核。
- 新增可重复脚本 `research/scripts/benchmark-typesafe-memory-gate.mjs`，同一虚构 K19 对 10 个自拟标签问题运行相关性判断，往返均值 284ms、中位数 233ms；0.5 二元阈值 9/10，影子三档阈值下 9 条明确结果均符合预期、1 条 0.74 进入不确定。标签不是组织成员审核，不证明真实制度准确性；调用仅用虚构文本、不写数据库。
- 已实际运行该脚本复现第二批 10 个问题：仍为二元 9/10，9 条明确结果均符合标签，自动续期问题 0.78 留在不确定区；平均 286ms、中位 237ms。TypeSafe 调用指向在线 `https://api.typesafe.ai`，这不是本地 JEV 推理；局域网离线/不出网尚未实现。
- 增加 `research/scripts/benchmark-typesafe-cross-domain.mjs`，用五张已核实为 `sample` / `unknown` 的模拟卡（账号、VPN、邮件、打印机、软件试用）组成 10 个直接相关/错配问题。通过同一 gate 函数调用 `jev-1.14.0`，10/10 与我预设的简单标签一致；往返均值 268ms、中位 219ms。标签没有组织成员复核、只测单候选、范围仍窄，不据此启用自动过滤；API 调用只发送虚构摘录，不写数据库。
- Jev 暂留 4183 影子模式；当时仅有 #33/#37 两个集成判断。需增加人工预标注的直接支持/主题相似/不相关样本，评估误过滤率后再考虑应用。浏览器实际点击到页面绘制计时仍未完成；Codex 预览请求曾排队，不能视为已打开。
- 修正协作交接摘要的事实口径：旧逻辑把 `next_actions`（模型建议）写成“已尝试”，并混淆模型引用与检索候选。现 `server/demo-brain.js` 明确区分“人工审核、无执行记录、建议后续、模型引用、检索到但未引用、待确认”；`server/agent.js` 同步提示词与新运行格式；`server/api.js` 为历史运行动态派生摘要并带入该运行最新审核；`public/app.js` 更新用户提示。4183 的 #30 显示 K19 的 unknown/sample 标签和实际引用摘录；4173 的 #28/#52 显示陈朋的编辑后采纳和未引用卡片。两服务已重启、在线；语法检查通过，未跑自动化测试、未调用模型、未增工单/运行。主库计数保持 15/42/7/26。
- 该实验只测试“时效知识能否改善局部回答”，没有证明集体判断或组织学习；还需人工确认记忆并观察新问题上的复用与实际结果。
- 2026-11-18：按用户指示，核对 GitHub 官方文档及 2024/2025 Changelog 后，在 4182 隔离库发布 K1（GitHub.com fine-grained PAT 过期规则）。发布说明写明组织策略须以当前设置为准、不代表任何公司内部制度；审核者陈朋，手工填写归属、非登录认证。页面已显示 K1 已发布；它仍是模拟样本卡，不能升级进入真实试点检索。
- 修正 JEV 判断指标：旧 `support_probability` / `likely_supports` 容易把“来源有助于回答”和“来源支持主张”混为一谈；新字段为 `answerability_probability`，明确包括支持、反驳或限制，但不判断来源权威性或制度真实性。详情页把旧运行显示为历史旧口径，不按新标准重算。三组 benchmark 脚本已同步；语法检查通过。
- 用新口径重跑纯虚构 TypeSafe 样本：K19 单卡 10 题 10/10 自拟标签一致，平均 334ms、中位 227ms；跨 5 张模拟卡的 11 个正向/近主题及反证样本 11/11 一致，平均 251ms、中位 208ms。标签由助手自拟、不是组织成员评审；仅直连接口调用，不写数据库。自动续期反证概率 0.96：K19 的“到期前复核是否续用”有助于回答，但不证明真实组织允许或禁止自动续期。
- 2026-11-18：已按原临时数据库路径和 `TYPESAFE_MEMORY_GATE=shadow` 重启 4183，确认 #38 为 sample 后完成新口径集成复测，运行组 `gmwkxajq4uyil`。Jev 对 K19 输出 `answerability_probability=0.98`、`likely_answerable`，658ms，`applied=false`；DeepSeek 的组织回答仍说明 K19 是虚构演示，不足以推出自动续期。个人模式引用 0，组织模式引用 K19 3 处。详情页已核实显示“对本题有帮助的概率 98%（包括支持或反驳）· 可能有助于作答”，且标注仅对照、未改变回答。4173 主服务未重启，Jev 保持关闭；4183 保持 shadow，不启用自动过滤。浏览器点击到页面呈现耗时仍待测。
- K1 的发布后验证已完成：执行 `research/scripts/run-after-review.mjs` 在 4182 建立虚构问题 #3，运行组 `gmwkx1tn4cy82`。发布前 #2 组织模式 0 个知识引用；发布后 #3 个人模式检索/引用均为 0，组织模式检索到 K1 并引用 4 处。live 回答区分个人 `no expiration`、组织默认 366 天、可调整策略和历史 beta 规则，同时要求核实具体组织设置。自动检查的个人 no-expiration 正则最初误报，因只允许 30 字符间距；已放宽并以原句静态验证为 true，没有重新调用模型。#3 与运行只写入 4182 隔离库，4173 主库不变。下一步由用户查看 #3 并记录真实审核决定；不代填人工结论。
- 2026-11-18 补充：#38 又在 4183 运行两次新口径 shadow 对照。第 3 组 `gmwkxjrkqexo5`：Jev 0.98 / 660ms，个人 0 引用、组织引用 K19 1 处；第 4 组 `gmwkxopri5epf`：Jev 0.98 / 723ms，个人 0 引用、组织引用 K19 2 处，组织回答继续拒绝把虚构条目推成制度许可。通过界面从点击到显示第 4 组结果一次实测 7,903ms，DeepSeek 两模式各约 6.3–6.7 秒；只有单次计时，尚不能视作稳定均值或证明 Jev 提速。4183 保持 shadow，4173 保持 Jev 关闭；研究记录里的下一步是重复端到端时延测量，并等待用户对 4182 #3 作真实审核。
- 2026-11-18：继续在 4183 的虚构 sample 工单 #38 做界面时延复测。第 5 组 `gmwkxwso8wppk` 两侧均为 fallback（5,011/5,007ms），Jev 返回 timeout / `invalid_response`，不计入 live 速度样本；第 6–9 组恢复 live。第 8 组 `gmwky55kpc4lt`：个人/组织 10,330/6,393ms、Jev 0.98/660ms；第 9 组 `gmwky8l9fosyl`：10,155/6,017ms、Jev 0.98/764ms；两组组织模式均引用 K19、个人模式 0 引用，Jev `applied=false`。
- 端到端复测发现并修复详情页旧组停留问题：`public/app.js` 现在按运行 API 返回的最新组刷新页面并同步深链。手动从第 4 组旧链接启动，修复后自动呈现第 9 组且地址栏为 `#/t/38?g=gmwky8l9fosyl`。第 8、9 组点击到页面显示分别 10,642ms / 10,587ms（均值 10,614.5ms，n=2，不是稳定估计）；Jev 比 DeepSeek 快，但不缩短本轮等待。`node --check public/app.js` 通过，4183 `/app.js` 返回修正内容。只改前端文件、未重启服务；4173、4182、4183 健康，4173 的 Jev 仍关闭，4182 K1 #3 仍待用户人工审核，主库无本轮实验记录。
- 2026-11-18：对 4182 隔离样本 #3 做了只读复核并再次核对 GitHub 官方资料。#3 个人/组织 live 输出仍是 0 / 4 条引用，review 数均为 0。官方当前资料支持 K1 关键规则（个人无期限可选、组织默认最大 366 天、管理员可设上限、2022 beta 必须过期）；组织稿未声称知道用户实际策略，并提示查看当前设置。该“助手预核对”已写入观察记录，但没有写成人工审核；#3 仍待用户决定。审批流默认启用与 token 过期规则分开说明。
- 2026-11-18：用户确认 #3 组织模式答复“够好，采纳”。恢复 4182 时找到并使用原隔离库 `C:\Users\yuesh\AppData\Local\Temp\intorg-human-loop-20261117\app.db`，没有连接主库；当前服务使用 4182，健康检查通过。人工审核已写入组织运行 #4：`decision=adopt`、`review_source_type=human`、审核者“陈朋”、未评分；个人运行 #3 仍未审核。工单 #3 仍为 `sample/open`，没有记录真实业务解决结果，也没有改写 K1。
- 同一隔离库新增边界样本 #4“PAT 上限收紧后旧 token 会怎样？”，运行组 `gmwlgm8zxf3rk`，两模式均 live。个人模式 0 引用；组织模式检索 K1 并引用 2 处，谨慎指出 K1 未说明旧 180 天 token 是否立即撤销。GitHub 当前组织文档补充：不符合生命周期上限的 token 会被阻止访问组织资源，但策略本身不会撤销或停用 token；用户会在组织 API 调用被拒绝时发现不符合要求。K1 尚未包含这条细节；#4 未经人工审核，未生成或发布新卡。该复测仅说明模拟样本中的复用和一个知识缺口，不代表真实组织效果。
- 已整理一条 K1 补充建议：现有超限 token 不会因设置策略而自动撤销/停用，但组织 API 访问可能被阻止；依据 GitHub 当前组织 PAT 策略文档。建议仍留在观察记录，未写入已发布 K1、未创建审核记录、未重启主服务。下一步需人决定是否把这个具体边界加入样本组织记忆。
- 2026-11-18：新增 `research/scripts/benchmark-k1-boundary-supplement.mjs`，用生产 `runAgent` 提示词、内存 store stub 做 K1 句子消融：基线和加句各 3 次，`deepseek-flash` 全部 live；个人数据/数据库未触碰，TypeSafe 关闭。处理组 3/3 明确回答“不会因设策略自动撤销/停用，但不合规时会被阻止访问组织”，基线 0/3 明确覆盖两点；说明此局部知识补充稳定改变了当前问题的回答，不能外推为准确率或组织业务效果。发现处理组 3/3 都推断需要重新生成/替换 token；官方来源未规定唯一恢复步骤，后续记忆只能收录阻止访问/不自动撤销两项事实，恢复建议须标为条件性并待组织管理员核实。现已将 K1 待审措辞改为与 GitHub 当前文档一致的“会被阻止访问”，不写入正式卡；K1 正文、审批和隔离数据库均未修改。脚本语法检查通过。
- 同轮已在 4182 临时样本库创建 K2「GitHub 组织 PAT 上限收紧后的存量 token 影响（补充说明）」作为人工可审的待审候选，链接 #4、`source_kind=guide`、引用 GitHub 官方组织策略页。K2 为 `pending/sample`，0 审核、0 使用；检索预览只返回 K1，因此未审核前不会进入后续生成。K1 仍 published v2、正文不变。创建脚本 `research/scripts/create-k1-boundary-draft.mjs` 校验数据库内目标工单和 K1 后幂等创建；4182 健康检查通过。
- 用户批准发布后，已在 4182 将 K2 发布，审核者陈朋，备注明确只作 GitHub 公开规则模拟补充，不代表公司制度。不同措辞的新模拟问题 #5 运行组 `gmwlhc2g3743l`：个人 live 0 引用；组织 live 检索 K2 排第 1、K1 排第 2，4 条引用通过校验，K2 使用数 1。组织稿按来源区分“设置策略不自动撤销/停用”与“不合规会被阻止访问组织”，并明确不得断言必须重新生成；无记忆的个人稿反而建议按 3 个月上限新建并轮换。用户之后确认组织稿“够好，采纳”，已记录 `human/adopt`、审核者陈朋、未评分；个人稿未审核，#5 保持 `sample/open`、未记录真实解决。该单次虚构配对只构成局部方向性证据，没有用真实 token/业务数据，主库未动。
- 2026-11-18：#5 后新增 classic PAT 边界样本 #6，运行组 `gmwlhi47fxly3`。个人 live 0 引用；组织 live 检索 K2/K1，正确用 K2 解释组织策略对不合规成员 token 的阻断与不自动撤销，并未把 K1 的 fine-grained 366 天默认规则套到 classic；但 classic PAT 默认无强制过期这一事实尚不在记忆里，故组织回答将其列为待核实。个人稿无来源却猜测政策“通常约束新建或续期”，对照显示来源记忆可以减少这类泛化。依据 GitHub 当前组织文档，classic PAT 默认无强制过期要求，但组织 owner 可设置最大有效期，且不合规成员 token 会被阻止访问组织。已据此在 4182 新建 K3「GitHub classic PAT 默认过期与组织上限」待审补充卡，关联 #6；`pending/sample`、0 审核、0 使用、检索预览不返回。K1/K2 未修改，K3 未发布。用户随后确认 #6 修订稿编辑后采纳，审核者陈朋、来源 `human`、未评分；模拟工单仍 `sample/open`，不代表业务已解决。用生产 `runAgent` 加内存 store stub 做消融，基线 K2+K1 与增加 K3 各 3 次、交替顺序，六次均 live 且未写数据库；K3 条件 3/3 引用 K3，但只有 2/3 明确表达“classic PAT 默认没有强制过期”，基线 0/3 明确表达。说明补卡稳定改变了引用来源，但不能保证关键事实进入答案；单问题小样本，不是准确率或业务效果证明。观测耗时基线 21.6–31.8 秒、处理组 13.7–22.4 秒，不作性能结论。K3 仍 pending，用户尚未批准发布；观察记录详见 `research/observations/2026-11-temporal-memory-public-source-benchmark.md`。创建脚本 `research/scripts/create-classic-pat-default-draft.mjs` 做目标工单/K2 校验后幂等创建。
- 2026-11-18：继续用未入库的新问法做 3 组 paired live 复测（个人无记忆 vs 组织候选 K3/K2/K1）。组织候选 3/3 引 K3，3/3 明确说 classic PAT 没有强制过期要求、区分组织上限和 fine-grained 366 天；无记忆组只有 1/3 明确答出，另有回答把 fine-grained URL 模板中的 30 天默认值泛化到 classic。组织模式 2/3 仍建议更换/生成 token，恢复动作超出当前公开材料证据，标记为剩余缺口。核对 GitHub 当前个人 PAT 文档后，确认：classic PAT 无强制过期要求；创建者可选过期日期；一年未使用 PAT 会被自动移除；“未提供 expires_in 默认 30 天”属于 fine-grained URL 模板，不能推广到 classic。随后用 `research/scripts/refine-classic-pat-draft.mjs` 只更新 4182 隔离库的 K3 pending 文本并记 `card_draft_edited` 事件；API 验证仍为 `pending/sample`、版本 1、0 审核、0 使用，#6 仍 1 条 human review，未新增工单/运行、未发布、未触及主库或 pilot。细节和限制见观察记录末尾。
- 2026-11-18：对更新后的 K3 再测一年未使用场景，脚本 `research/scripts/benchmark-classic-pat-inactivity-query.mjs` 使用同一生产 `runAgent`，个人无记忆与组织候选各 3 次，六次 live、无 DB 写入。组织候选 3/3 明确区分 GitHub 一年未使用自动移除 PAT 与组织生命周期超限阻止组织访问；个人无记忆 0/3 确认前者，均要求核实。组织候选 3/3 还分清 fine-grained 366 天规则，并把 token 状态、最近使用时间和实际组织策略留待核查；没有断言必须重新生成 token。方向性证据限于单一虚构问题和模型；K3 仍 pending、未经人工审核或发布。详见观察记录“ 一年未使用规则的独立复测”。
- 2026-11-18 追加：#6 的组织答复已由用户确认“编辑后采纳”，审核者陈朋；API 只读核对显示决定、修订稿与理由均已保存。待审 K3 页面现在提供“编辑草稿”；提交要求正文、修改说明和编辑者姓名，保存仍保持 pending，不等同发布。4182 隔离页人工检查可见编辑入口；K3 仍 `pending/sample`、0 审核、0 使用。本轮未编辑或发布 K3。检查时 4182 在线、4173 连接被拒；没有操作 4173。下一步由人审核 K3 的来源和范围，再决定是否在 sample 中发布并做持久化复测。
- 2026-11-18 当前数据复核（4182 隔离库，只读）：#3/#5/#6 均有一组个人/组织运行和一条人工组织模式审核；决定依次为 adopt/adopt/edit，审核者均为陈朋。K1 已发布 sample 卡被引用 4 次，K2 被引用 2 次；K3 仍 pending，0 次引用。#3 组织稿引用 K1；#5 与 #6 引用 K2/K1。可观察到“知识复用→人工判断→发现缺口→补充待审知识”的单主题闭环；由于只有一名审核者、一个公开主题和模拟数据，这还不是集体学习成效证据。下一关键验证仍是人工审核 K3，再用新问法观察已发布知识的检索、关键事实表达和人工决定。
- 2026-11-18 核查更正：重查 GitHub 官方规则发现需补充策略层级差异。组织级政策文档确认 classic PAT 无强制过期要求、超限成员 token 会被挡在组织外且策略本身不撤销/停用；GitHub Enterprise Cloud 企业级文档进一步说明，企业级期限策略会在 token 使用/SSO 授权时检查，错误会提示调整期限，并提示生成符合期限的新 token。K3 当前正文尚未包含这个 enterprise-specific 细节，待审稿应先补足再让人决定发布。来源见下方观察记录中的 GitHub 官方链接。
- 运行时状态更正：4182 的待审核页可显示“编辑草稿”按钮，但当前服务端仍是旧进程；`POST /api/cards/3/draft-edit` 实测返回 404“没有这个接口”，因此该按钮暂不能保存。请求未改变数据库：K3 仍 `pending/sample`、v1、0 审核、0 使用；#6 原审核仍为 human/edit、审核者陈朋。只重启 4182 的命令被执行安全策略拒绝；未用其他方式绕过，4173 未触碰。
- 待审内容修订建议：在 K3 加入一段“若组织受 GitHub Enterprise Cloud 企业级最大期限策略约束，classic PAT 在使用/SSO 授权时检查期限，提示调整期限或生成符合期限的新 token；仅限企业级策略说明，不能推广为所有组织级策略”。#6 已保存的人审修订记录未被追改；如需补入该回答，应另作一条可追溯的人工更正。
- 2026-11-18：新增可审阅候选正文 `research/drafts/K3-classic-PAT-enterprise-policy-addendum.md`，按 GitHub 当前官方资料区分组织级与企业级期限策略，补充 classic PAT 的 enterprise policy 提示生成合规新 token。它只是本地候选文件，未写入 4182、未批准、未发布。当前 4182 API 仍缺 draft-edit 路由（404）；待受支持地重启隔离服务后再同步和复验。

- 2026-11-18：用户明确批准 K3 发布到 4182 模拟记忆；`POST /api/cards/3/review` 成功，状态 `published/sample`、审核者陈朋，发布后版本 2。随后新建纯虚构 sample 工单 #7“教程里的30天能套用到 classic PAT 吗？”，运行组 `gmwlqnsynlwz9`；个人和组织均 live。个人引用 0；组织检索 K3/K1/K2 并引用 K3/K3/K1/K2，K3 当前引用 1 次。组织回答仍未明确表达“classic PAT 没有强制过期要求”，而说资料不足需再查；该运行 `sample/open`、0 审核、未解决。
- 失效定位：#7 持久化的 K3 context snippet 从卡片后半截开始，漏掉最前面的“classic PAT 没有必须设置过期时间”段落。`server/retrieval.js` 原 snippet 取第一个命中词周边单一 480 字符窗口；问题中的 “30” 命中后半部，导致证据裁剪漏掉关键规则。
- 修复：`server/retrieval.js` 改为按查询相关度选多段完整段落，默认上限 640 字符。纯内存夹具基于已发布 K3 和 #7 原问题，554 字符摘录同时包含无强制过期、fine-grained 模板 30 天、组织上限和一年未使用规则；`node --check` 与夹具均通过。该改动尚未加载到正在运行的 4182；线上 #7 仍是修复前结果。只重启 4182 的命令此前被安全策略拒绝，本轮未再尝试。
- K3 的企业级策略补充仍只在本地候选 `research/drafts/K3-classic-PAT-enterprise-policy-addendum.md`；已发布卡未被静默改写。下一步应在 4182 加载新检索代码后，对 #7 原问题再跑一组，验证摘录与回答是否补上关键事实；#7 的审核仍由人决定。
- #7 写入后当前发布卡引用数只读复核：K1 5 次、K2 3 次、K3 1 次；三张均 `published/sample`、版本 2、各 1 条发布审核。#7 的组织模式是本轮 K3 的首次持久化复用，内容表达仍未达标。
- 2026-11-18：以 #7 为同题对照，用生产 `runAgent`、同一 DeepSeek Flash、同一提示版本和同一 K1/K2/K3 来源，只切换 K3 摘录算法。旧摘录：已持久化原回答 + 2 次内存复跑，明确说出 classic PAT 无强制过期要求为 0/3；新多段摘录：1 次 + 2 次内存 live 运行，明确说出该规则为 3/3。六次均 live；新摘录也保留 30 天 fine-grained 模板范围、组织上限和一年未使用清理。基于单一虚构问题/单模型的局部结果，不外推为总体准确率。脚本 `research/scripts/benchmark-classic-pat-live-snippet-repair.mjs`；内存复跑未写数据库。API 核对 #7 仍 2 条持久化运行、0 审核，K3 仍 1 次持久化引用。4182 尚未加载新代码，需重启后再做端到端确认。
- 2026-11-18：因原 4182 仍载旧代码，未尝试停止它；在空闲端口 4186 建了隔离复验副本（临时目录 `io-retrieval-preview-20261118-150508`），只读复制 4182 的虚构 #7 与已发布 sample K1–K3，不改 4182 数据。副本使用当前 `server/retrieval.js` 与 DeepSeek Flash，TypeSafe 关闭；新配对运行 `gmwls34dk33ce` 端到端通过：个人 live、0 引用；组织 live、检索 K3/K1/K2，K3 摘录保留“classic PAT 没有必须设置过期时间的要求”，回答明确说出该规则，并区分 fine-grained 模板 30 天、组织上限和一年未使用清理。页面已打开供用户查看。副本内 #7 为 sample/open、0 人工审核；本次人工判断尚未记录。证据为一个新配对样本，不证明总体准确率或真实组织成效；4182 仍保持旧进程与原数据库不变，4186 预览服务继续运行。
- 2026-11-18：为测不同问法迁移，在 4186 临时副本新建虚构 #8（classic PAT 创建约两年、过期日尚余八个月、14 个月未使用、组织上限 180 天），运行组 `gmwls8tys2565`。个人 live 0 引用；组织 live 检索 K3/K1/K2。组织回答区分个人过期日、一年未使用自动清理和组织访问限制，指出未来过期日不证明 token 仍存在/可访问，并建议核实 token 列表、Last used 和组织策略；未断言必须重新生成。此结果是单一配对迁移信号，不是准确率或组织效果证据。需要人工审阅的边界：模型额外提出 scopes、SSO、第三方访问和只读 API 调用等建议，当前引文未为每项提供明确来源；不能把这些扩展建议当成已被 K3/K1/K2 证明。#8 仍 sample/open、0 审核，用户判断未录入；4182 数据不变。
- 2026-11-18：新增 `research/scripts/benchmark-published-memory-repeat.mjs`，只读 4186 #8 的已检索来源，以内存 store stub 用生产 `runAgent` 再跑两组个人/组织对照（4 次 live、无数据库写入）。两组组织回答都引用 K3/K2 并复现一年未使用清理与组织访问限制的区分，未断言必须重新生成；输出中的额外 SSO/scopes/只读调用建议未稳定重现。第一次复跑把“过期日显示在 8 个月后”视作可能有两种起算点，需改写新测试题以明确“距今天 8 个月后到期”。脚本最初把内存结果误读为 `context_sources`，已改用 `contextSources`；实际引用可由两轮 citations 确认。复跑固定首轮检索片段，只测生成重复性；不证明检索稳定性、跨用户一致性或组织效果。#8 仍 0 审核。
- 2026-11-18：新增 organization-only 证据表达约束，`server/agent.js` 提示版本升为 `support-agent-v2`：规则句 inline 标 `[K#]`，一般未核实的检查建议单独标注且限两条，未经要求不推荐凭证 API 调用，重要时间歧义先澄清。#8 固定来源内存配对复跑一次成功：个人/组织 live，组织句末引用 K3、一般检查分区且无 API 测试建议；样本 n=1。
- 2026-11-18：发现 live 模型超时的旧 catch 会调用 `demoGenerate`，可能输出无关步骤却保留组织记忆引用。新增 `server/live-fallback.js`，live 失败现在返回清楚的无答案占位、零引用、零建议步骤；无模型配置的 demo 模式不变。使用本机无监听地址强制 `runAgent` 捕获失败，验证 `origin=fallback`、零引用/动作且没有无关模板文本；语法检查通过。
- 4187 临时 UI 服务启动被执行策略拒绝，未尝试绕过；4186 仍使用内存中的 v1 代码，v2 只在隔离内存复跑验证，尚未加载到 UI。4182/4186 原运行数据与审核未被本轮内存实验写入；#7/#8 人工审核仍 0。
- 2026-11-18：将 `support-agent-v3.1` 的未核实一般检查建议拆入 `general_checks`：服务端固定最多两项，自动把带“通用核查项”标题的残留从 `draft_reply` 抽离，前端详情页与观察批次页独立标注为未由本次记忆核实；人工编辑/采纳只处理 `draft_reply`。零来源 live 复测：citations 0、无假 `[K#]`、general_checks 2，未索取 token 名称/ID/截图/组织名称，未建议凭证 API 或状态变更；主答复明确缺少来源并请求澄清。一次固定来源 #8 live 配对中，组织稿逐句引用 K3/K2。代码语法检查通过；模型结果未持久化。
- 本地工作树代码已是 `support-agent-v3.1`，但 4186 仍加载 v1；4187 服务启动被执行策略拒绝，未尝试其他启动路径。UI 端到端检查未完成；4182/4186 应用数据库未被本轮内存试验写入，#7/#8 仍无人审。
- 2026-11-18：在 v3.1 上用 #8 固定 K3/K1/K2 摘录再做一次组织模式 live 内存复跑：引用 K3/K2，结构化 general_checks 为 2 条只读核实项，正文无 checklist 段。初次断言把正文提及“通用核查项”误认作重复标题，已修正脚本检测表达式；模型结果未写入数据库。
- 2026-11-18 状态更正：使用当前工作树 `runPair()` 对 4186 临时副本工单 #8 持久化写入 v3.1 live 配对运行组 `gmwltk59f1oo8`（运行 ID 5/6）；随后在页面 `#/t/8?g=gmwltk59f1oo8` 查看。生成时没有重启 4186；其服务进程仍载 v1，本次通过直接调用当前代码并指向隔离副本数据库生成，在线 API/前端读取并展示保存结果。组织模式检索 K3/K1/K2、引用 K3/K2，引用事实逐句带来源标记，并将两条未核实只读检查单列；personal 模式 0 引用，但仍提出较多未引用检查项（名称/ID、截图、scope、SSO），是待改进差异。#8 仍 `sample/open`、0 审核；没有代用户提交审核。新增记录只在 4186 临时副本，4182 与主数据库未动。单组模拟不能证明准确率或组织成效；详情见 `research/observations/2026-11-temporal-memory-public-source-benchmark.md` 的“v3.1 配对运行落入隔离副本并在页面展示”。
- 2026-11-18：纠正对照实验混杂因素。虽然系统状态文案声称两模式提示词相同，旧实现仅 organization 收到证据引用、隐私和核查约束。将这些约束统一后，新版 `support-agent-v4.0-matched` 共享 system prompt、回答规则与 `general_checks` 结构；organization 唯一额外条件是获得检索记忆。语法检查通过。通过新隔离脚本 `research/scripts/run-matched-prompt-sample-pair.mjs` 对 4186 临时副本 #8 新增 live 配对组 `gmwltvzvtl65d`（组织运行 #7、个人 #8）：organization 检索 K3/K1/K2、引用 K3/K2，个人检索/引用 0；两者都 live。组织答复有可追溯的知识依据；个人答复仍用通用知识提到一年未使用清理，且估算 token 生命周期约 32 个月、提出 SSO/审批核查。来源记忆改善了可追溯性，本组没有证明总体正确率提升，也不能归因所有措辞差异。#8 为 `sample/open`、0 审核；运行只写入 4186 临时副本，4182 与主数据库不变。复验细节见观察记录“提示词匹配后的 live 对照”。
- 2026-11-18：在固定 #8 来源下，用 `benchmark-published-memory-repeat.mjs` 再做两组 v4.0-matched 内存配对（4 次 live、无 DB 写入）。连同持久化首组共 3 组；organization 3/3 检索 K3/K1/K2、引用 K3/K2，personal 3/3 无来源/无引用，但也都提到一年未用清理。观察到主要差别为组织答复能把公开规则追溯到已发布 K3/K2；personal 模型本身也知道部分公开知识。随后对不同问题 #7“30 天模板是否套用到 classic PAT”新建持久化 live 配对 `gmwlu4d3ajam9`，organization 检索 K3/K1/K2、引用 K3/K2，personal 无引用；组织稿按记忆区分 fine-grained 模板、classic PAT、组织上限和未使用清理，页面已打开。现在 #7 有 4 条运行、#8 有 6 条运行；两单均 sample/open、0 审核。4186 仍载旧后端，本轮通过当前工作树代码直接写隔离副本，再由在线 API/前端读取；4182 与主库未动。样本量仍只支持可追溯性与局部迁移观察，不是准确率/业务成效。详见观察记录“匹配提示词的重复性与第二种问法”。
- 2026-11-18：对 #7 题目与固定 K3/K1/K2 来源再做两组 v4.0-matched 内存配对复跑（4 次 live、无 DB 写入）。两组 organization 均引用 K3/K2，并分别说明 fine-grained 30 天模板不可套用到 classic PAT、classic PAT 无强制过期要求及其他独立规则；两组 personal 虽无来源引用，也都正确区分模板 30 天与 classic PAT，没有泛化错误。该公开事实模型本身也能回答，组织记忆的主要可见增量是出处、适用范围和审计性。#7/#8 的人审仍待用户决定。详见观察记录新增的 #7 重复性复测。
- 2026-11-18：为避免代码版本与运行服务版本不一致时误生成旧提示词记录，`public/app.js` 新增 `UI_PROMPT_VERSION` 与 `/api/state.agent.promptVersion` 比对；不匹配时两个“生成建议”入口禁用，已保存运行仍可查看和审核，并显示恢复提示。4186 API 当前报告 `support-agent-v1`、页面期望 `support-agent-v4.0-matched`；UI 已实际显示“版本不匹配”并禁用按钮。静态语法检查通过，未提交运行或改动数据库。此为前端防错，不是 API 层防线；服务还需通过正常流程重启后加载 v4。观察记录见“服务端与页面提示词版本保护”。
- 2026-11-18：新增纯内存脚本 `research/scripts/demo-novel-synthetic-memory.mjs`，用 matched v4 提示词和 live 模型测试一条仅组织模式可读、仅为演示而随机编造的 K4（雾灯组、17 天、二号审核岗）。personal 无来源，答无法核实且不猜；organization 检索/引用 K4，给出两项事实并强调仅为虚构规则。脚本不导入数据库模块；API 复核 #7 4 次运行、#8 6 次运行、审核均 0、发布卡仍仅 K1–K3。该测试证明上下文中的新事实可进入回答，不证明真实组织收益；见观察记录“只存在于组织记忆中的新事实演示”。
- 2026-11-18 现状只读复核：4182 的 #3/#5/#6 分别有一条 human/adopt、human/adopt、human/edit（陈朋）；sample 已发布 K1/K2/K3，当前被引用计数分别为 5/3/1。原始 #7 仍 `sample/open`、2 条 `support-agent-v1` 运行、0 审核；组织运行检索 K3/K1/K2 并引用三者，但没有明确回答 K3 的“classic PAT 没有强制过期要求”，显示旧提示/旧摘录仍不足以证明复用成功。4186 临时副本 #7 为 4 条运行、#8 为 6 条运行，均含 v4 matched 结果、0 审核；K4 纯内存实验未持久化。4182 与 4186 服务端当前都报告旧版 v1；4186 前端已禁用生成以免写入旧版本。没有真实 pilot 数据。下一项必需的组织动作是由成员审核 #7/#8 的已保存 v4 答复，再决定是否采纳或修订；这些判断未代填。

- 2026-11-18：用户采纳 4186 隔离副本中的 #7 新版组织答复（run #10，group `gmwlu4d3ajam9`），已写入一条 `human/adopt` 审核，审核者陈朋；API 复核确认 `review_count=1`、来源 human。该记录只在 4186 sample 副本，未改 4182 或真实 pilot。#7 仍为 `sample/open`，没有链接到它的新知识草稿；当前 K1–K3 仍为已发布样本知识。此审核表示答案获认可，不等同于问题已解决或新知识已沉淀。当前 API 仅允许 `resolved` 工单生成草稿；是否将这个虚构信息问答记为模拟已解决，需要符合实际演练口径后再做。服务端仍报告 `support-agent-v1`，本轮没有生成新模型运行。
- 2026-11-18：只读检查 4186 #8 的 v4.0-matched 配对 `gmwltvzvtl65d`（organization run #7、personal run #8）：组织侧检索 K3/K1/K2、引用 K3/K2，回答明确分开个人到期日、一年未使用清理、组织最大有效期，并没有断言必须重新生成；个人侧 0 来源，也给出大体相同的核实结论。单组不能证明准确率优势；组织约 32.0 秒、个人约 42.9 秒，不作性能结论。#8 当前仍 0 审核。这个异问法比 #7 更能观察知识迁移，但事实仍属公开 GitHub 规则、虚构样本，不是内部制度。
- 2026-11-18：#7 经用户采纳后，仅在 4186 sample 副本标记为模拟问答已答复（不代表真实 token/组织处理），生成 card #4 `pending/sample`；其 `source_ref` 与 `applies_to` 为空，尚未发布。新草稿虽不进候选，查询接口确实从已解决案例集合返回 C7；对“PAT 14 个月未用、个人到期还在 8 个月后、组织上限 180 天”的新问法，fresh search 返回 K3/K1/C7/K2，未返回 pending card #4。
- 新增 `research/scripts/benchmark-human-reviewed-case-reuse.mjs`：用 fresh GET 搜索结果做 v4 matched 内存配对，person 23.2s / organization 32.0s，均 live、无数据库写入。organization 检索 K3/K1/C7/K2、引用 K3/K2，不引用 C7；personal 无来源且给出相近判断。因 C7 与 K3 内容重叠，此次证明了已采纳案例可被检索，未证明案例自身改变答案。card #4 草稿缺少来源 URL 和适用范围，暂不发布；下一项产品改进应让知识草稿保留被引用卡片的出处/范围，并由人工审核是否重复或仍适用。#8 配对仍待用户审核。
- 2026-11-18：用户批准 #8 v4 organization run #7（`gmwltvzvtl65d`）后，已写入 `human/adopt`，审核者陈朋；API 复核 `review_count=1`。4186 当前数据：#7 `sample/resolved`、4 runs、1 张 card #4 `pending/sample`；#8 `sample/open`、6 runs、该组织运行有 1 条 human review、尚无知识草稿；K1–K3 仍 published/sample。服务仍报告 `support-agent-v1`。
- 来源追踪缺口已在代码中修复：新增纯逻辑 `server/draft-lineage.js`；`draftKnowledgeCard` 只从本次组织答复明确引用且与工单同 scope 的已发布卡片带入 URL、原适用范围和来源运行号，并提示审核者检查是否有新增步骤或与既有知识重复；pending/跨 scope/未引用卡片不带入。`node --check` 与基于 4186 当前运行 #10 / 卡片的内存校验通过（K3/K2 被带入、K1 未引用故排除、pending #4 排除）。这是源代码验证，尚未在服务端实际生成新草稿。
- 尝试仅重启 4186 以加载新代码时，自动执行策略拒绝了 stop/start 命令（工具返回 `blocked by policy`）；未改用其他方式。重启后只读复核确认 API 数据仍完好，上述卡片/审核计数不变；没有新模型运行。本轮代码变更尚未被在线进程加载。
- 2026-11-18 追加验证：将知识草稿逻辑独立为 config-free `server/knowledge-draft.js`；`server/store.js` 改从纯时间模块 `server/time.js` 取时间，保持 `db.js` 的 `nowIso` 导出兼容。新增 `research/scripts/preview-human-reviewed-draft.mjs`：对 4186 做 SQLite `VACUUM INTO` 一致性快照，在快照副本把 #8 人工采纳问答标为模拟已答复并运行当前草稿函数。生成 card #5 `pending/sample`，只带入被答复引用的 K3/K2 官方 URL 与各自适用范围，标注来源运行 R7，并提示审核是否重复；pending #5 未进入检索。全程未读取 .env、未调用模型、未改 4186 源库。语法检查及此完整离线流程通过。快照在 `%TEMP%\io-draft-lineage-preview-N6X8oK\app.db`，不由在线 UI 提供。
- 为供人工判断，新增 `research/observations/2026-11-card-5-review-preview.md`，内容由临时 SQLite 快照中的 card #5 原样导出，标明 pending/sample、来源工单与 K3/K2 的来源和适用范围；不在应用中，也未发布。初步观察：步骤清单和 K3/K2 已有核查要求高度重叠，建议先不要作为新事实卡发布，可由审核者决定拒绝或后续把确有价值的清单编辑进现有卡。

## 4186 #9/#10 人工反馈与记忆贡献（2026-11-18）
- #9 组织 R11 已由用户选择人工采纳（review #3，陈朋），随后按用户明确确认标为虚构模拟问答已答复：`sample/resolved`、`outcome=answered`。只读相似检索现已包含 C9。未创建或发布知识卡。
- 新建 #10 虚构问题并在线配对：旧服务 R14/R13 均 live、`support-agent-v1`。组织检索 C9/K3/K2/C7，最终只引用 K3/K2；个人无引用。组织答复后经用户人工采纳（review #4，陈朋），#10 仍 open，未自动成为可检索案例或生成知识卡。
- 新增并运行 `research/scripts/benchmark-memory-ablation.mjs`：当前工作区 v4 `runAgent` 对 C9 only、K3+K2 only、C9+K3+K2、无记忆个人模式做同题内存对照。C9 only 能组织问题但不能提供组织期限政策；规则卡条件明确引用政策事实；组合条件仍只引用 K3/K2，未显示案例独立增量。四次模型调用均 live；脚本只 GET 应用数据并用内存 store，不写在线库。复核 #10 在线状态仍 2 个 v1 runs、1 条人工审核、0 知识卡。
- 当前认识：相似案例提供处理情境参考，已审核规则卡支撑可核查事实；审核采纳并不自动等于解决或案例入库。样本为 GitHub 公开规则模拟问题，不能推导企业内政策或业务成效。4186 仍载旧 v1，v4 证据仅来自内存对照；不把二者混称端到端新版验证。

## 本地快速判断模型初测（升级前，2026-11-18）
- 新增 `research/scripts/benchmark-local-fast-judge.mjs`：只请求 LM Studio 本机 chat API，不写应用数据库。Qwen2-VL-2B-Instruct 对同一虚构 K19 的 10 项相关性判断，单请求批量用时 8.581s、匹配自拟标签 4/10；逐项 10 请求共 10.326s、中位数 1.005s、匹配 6/10。当前模型不能承担自动检索闸门。
- 初测阶段的本机版本为 LM Studio 0.4.12；`POST /v1/systemone` 返回 `Unexpected endpoint or method`，Kev-0.8B-Artemis Q6_K 在 llama.cpp 2.14.0 报 `wrong number of tensors; expected 322, got 320`。初测时尚未更新软件；用户随后明确授权升级，结果见下节。
- 曾尝试以临时 `OLLAMA_MODELS` 目录交叉验证；自动执行策略拒绝了本地服务启动命令，未尝试绕过。初测时删除了导入副本，保留原始权重。
- #10 已由用户人工采纳组织答复（review #4，陈朋），但仍 `sample/open`；未获单独结案确认，不把它计为已解决案例。

## LM Studio 升级与 Kev 实测（2026-11-18）
- 按用户授权安装官方 LM Studio 0.4.28+2；签名有效（Element Labs Inc.）。当前 Vulkan llama.cpp runtime 为 2.67.0，`turintech/kev-0.8b-artemis` 被识别为 Decision 模型并能加载；冷加载 24.29s。官方 System One endpoint 可用，未接入工单服务。
- 新增/更新 `research/scripts/benchmark-local-systemone.mjs`，比较一次 10 项批量请求与 10 个并发单题请求。Kev 三次批量：15.219s / 8/10、热态 5.879s / 8/10、热态 6.084s / 8/10；复测批量 5.362s / 8/10；10 并发单题墙钟 7.604s / 8/10（模型 parallel=4）。10 项概率全部低于 0.8 且高于 0.2，均为“不确定”；0.5 阈值下漏掉两项相关事实。
- 当前结论：本地协议链路可用，但本机 Kev 没有显示出速度或质量优势；同标签历史 TypeSafe 远程 10 项测试为 10/10、均值 334ms（不同请求形态，仅方向参考）。不自动过滤记忆，保持人工审核；批处理比并发单题更快。4186 数据库未写入模型测试结果。
- 官方依据：LM Studio Windows 下载页、更新日志与 System One 文档（研究记录含链接）。测试收尾时已卸载 Kev 并停止本机 1234 服务；LM Studio 0.4.28+2 保留安装，原始 Kev 权重保留，临时安装包已删除。4186 API 仍在线，#10 仍 `sample/open`、`human/adopt`（陈朋），仅 2 条原运行、1 条审核。

## 知识生命周期只读核对（2026-11-18）
- 只读检查 4182 与 4186 API：两者是独立的 sample 数据库，服务端均报告 `support-agent-v1`。4182 为 7 张工单 / 12 次运行 / 3 条人工审核（#3 adopt、#5 adopt、#6 edit，审核者均为陈朋）/ 3 张已发布卡，所有工单仍 open。4186 为 10 张工单 / 14 次运行 / 4 条人工审核（#7/#8/#9/#10 组织稿均 adopt，审核者均为陈朋）/ 3 张已发布卡 + 1 张 pending 卡；#7/#9 resolved，#8/#10 open。审核没有评分，也没有第二位审核者。
- 4186 #10 R14 检索 C9/K3/K2/C7，最终仅引用 K3/K2；个人 R13 无组织来源。#7/#9 已作为虚构问答 resolved，案例可入候选；#8/#10 仍 open，不作为已解决案例。检索命中不等于引用，更不等于对答复产生独立贡献。
- #7 的 card #4 仍为 `pending/sample`，`source_kind=unknown` 且来源链接、适用范围为空；离线快照的 card #5 不在在线库。保持未发布。K1–K3 都是 GitHub 公开规则 sample 卡，非内部制度，也未获 pilot 批准。
- 观察结论与下一步人工审阅方案见 `research/observations/2026-11-knowledge-lifecycle-audit.md`：先将 card #4 与 K3/K2 逐条标成重复/新增/待核来源，再决定拒绝、并入已有知识或暂缓；之后才能盲测更新是否改变正确步骤或可追溯性。Kev 当前没有自动筛选价值，不接入检索链路。

## 企业级知识边界迁移小测（2026-11-18）
- 新增 `research/scripts/benchmark-enterprise-policy-transfer.mjs` 与 `research/observations/2026-11-enterprise-policy-transfer-benchmark.md`。用 Node SQLite `readOnly:true` 从已有 4186 快照读取已发布 K2/K3，在同一合成 holdout、同一 `deepseek-flash` 与 `support-agent-v4.0-matched` `runAgent` 路径下，比较现有 K2/K3 与在 K3 内存增补 GitHub Enterprise Cloud 规则；候选仍是假设上下文，未写回或发布。
- 每条件尝试 3 次；两条件各 2 次 live、1 次安全 fallback（超时约 45 秒）；未重试失败项。成功样本中，基线 2/2 对企业/组织优先级和企业检查时点明确 abstain，增补版 2/2 正确说出企业 60 天优先于组织 90 天，并说出 classic PAT 使用/SSO 检查时点；两组均能区分组织访问受阻与 token 撤销/停用，并指出个人仓库可用不证明组织可用。仅支持“有来源增补补上了这道题的知识缺口”，不支持总体正确率或速度结论。
- 来源核对：GitHub Enterprise Cloud 文档说明企业上限高于组织配置、classic PAT 在使用或 SSO 授权时执行、不合规成员 token 会被挡在组织外且不因此撤销/停用，并说明符合期限的后续提示。来源链接见观察文档。模型配置由 `server/config.js` 读取以执行该合成实验；密钥未输出、未写入数据库。没有在线工单、审核或知识卡写入。
- 运行状态更正：本轮实测 4173、4182、4186 均为 `ECONNREFUSED`，当前没有对应本地服务监听。之前记作“4186 API 仍在线”是上一时点的状态，不能代表当前；不要为这次内存实验擅自启动服务。
- 当时待办是等待人工审核；随后用户批准增补并已完成 K3 v3 更新，状态见下节。card #4 仍保持 pending 未发布。

## K3 v3 写入 4186 模拟记忆并复核（2026-11-18）
- 用户批准将企业级增补作为 K3 新版本写入 4186 sample。先核对目标副本为 `C:\Users\yuesh\AppData\Local\Temp\io-retrieval-preview-20261118-150508\app.db`（10 工单 / 14 运行 / 4 工单审核 / 4 卡 / 20 知识使用），确认 K3 ID 3 为已发布 v2、sample、7 次既有使用、未批准 pilot；写入前通过只读快照备份保存了 v2。
- 事务中将 K3 从 v2 更新为 v3 并发布；审核记录 `publish / 陈朋`。来源链接新增企业级 PAT 政策，并保留组织、个人 PAT 与过期撤销来源；适用范围注明分别核实组织/企业策略。事件记录保存 v2/v3 正文和元数据差异。复核：卡片仍 `published/sample/guide`、`pilot_approved=0`；工单/运行/审核/卡片/知识使用数均未变，SQLite `integrity_check=ok`。更新前备份位于 `%TEMP%\io-k3-enterprise-preupdate-0IqkNM\app.db`。
- 更新后用只读 `store.searchApprovedMemory` 检索同一企业级问题，K3 v3 排名第一（score 45.46），实际摘录含企业上限和 classic PAT 使用/SSO 检查段落；这一步没有模型调用或知识使用写入。完整对照与限制见 `research/observations/2026-11-enterprise-policy-transfer-benchmark.md`。
- 新增 `research/scripts/benchmark-enterprise-policy-postpublish.mjs`：只读打开更新后的 4186 库，用实际 `store.searchApprovedMemory` + 当前工作区 `runAgent`，以 `createRun` 内存桩执行一条 live 生成。检索 K3 v3/K2/C9/C7，答复引用 K3/K2；预设五项全部覆盖，明确企业 60 天优先、组织访问拦截与 token 状态分开、classic PAT 使用/SSO 检查，并拒绝从个人仓库可用推断组织可用。模型 `deepseek-flash`，`support-agent-v4.0-matched`，30,043ms。工单/运行/审核/卡片/知识使用数前后相同；单次输出不代表重复稳定性或真实组织收益。
- 已创建可直接打开的静态预览 `research/observations/2026-11-k3-v3-preview.html`。在线 4186 服务未启动：后台启动命令被执行策略拒绝（`blocked by policy`），没有尝试其他启动方式；所以检索结果已验证，浏览器 UI 端到端仍待后续验证。
- 2026-11-18 增加负向迁移检查：用一条虚构 fine-grained PAT 题目在同一只读 4186 数据库运行实际检索和 `runAgent`。K1 v2 与 K3 v3 同时入选；DeepSeek Flash live 23,765ms，引用 K1/K3。答复没有把 K3 的 classic PAT 使用/SSO 检查时点套给 fine-grained，且指出假设下企业 60 天不能被组织 90 天放宽。工单 10 / 运行 14 / 审核 4 / 卡 4 / 知识使用 20 前后不变。
- 反测也发现 K1 v2 把 fine-grained 策略执行时点宽泛写成“创建、重新生成或使用时可能生效”，模型沿用了该模糊措辞。官方 Enterprise Cloud 文档将 fine-grained 创建时已知目标组织、期限须不超过策略上限，与 classic PAT 使用/SSO 检查分开说明。已准备 `research/drafts/K1-fine-grained-PAT-enterprise-policy-boundary.md` 修订候选，以及静态结果页 `research/observations/2026-11-enterprise-policy-type-boundary-preview.html` 和 JSON 记录；K1 候选**未写入 4186、未发布**，等人工核对。观察详情见 `research/observations/2026-11-enterprise-policy-transfer-benchmark.md`。
- 随后以相同 holdout 对 K1 v2 和未发布 K1 v3 候选做 2 次/条件的内存 A/B。v2：1/2 明确企业 60 天高于组织 90 天，0/2 清楚说明 fine-grained 创建期限应符合上限；候选：2/2 都明确这两点，且 2/2 将 classic 使用/SSO 时点限定在 classic。四次均 live；42,174/28,145ms 对 14,159/20,247ms，不据小样本宣称速度变化。候选文本只替换内存检索片段，数据库工单 10 / 运行 14 / 审核 4 / 卡 4 / 知识使用 20 前后不变。详情见观察报告的“K1 v2 与 v3 候选的内存对照”。
- 为检查是否只记住 60/90 示例，又用企业 45 天、组织 120 天做 2 次/条件 holdout。K1 v2 两次都没能仅凭 fine-grained 来源清楚给出层级结论：一次借 K3 推断后仍提示需核实，一次保守 abstain。K1 v3 候选 2/2 将通用规则迁移到新值，结论为组织 120 天不能放宽企业 45 天，创建期限不超过 45 天，引用 K1。四次均 live；基线 35,787/27,569ms、候选 35,228/22,806ms，不推断速度变化。只读数据库计数不变。JSON 和脚本分别为 `research/observations/2026-11-k1-v3-number-transfer-result.json` 与 `research/scripts/benchmark-k1-v3-number-transfer.mjs`。K1 v3 仍仅是待人工审核候选。
- 4186 真实副本仍不直接用于 UI 会话；为可见复核，把当前 4186 sample 数据用 SQLite 只读备份复制到临时目录 `C:\Users\yuesh\AppData\Local\Temp\io-visible-k1-review-Rpf2nx`，校验计数与原副本一致（10 工单 / 14 运行 / 4 审核 / 4 卡 / 20 知识使用），`integrity_check=ok`，K1 仍 v2、K3 仍 v3、两者均 `pilot_approved=0`。当前服务监听 `127.0.0.1:4186`，`DATA_DIR` 指向该临时副本；首页 HTTP 200，`/api/health` 为 ok，`/api/metrics` 显示 10 张 sample 工单、3 条 published 卡、0 张 pilot-approved。Chrome 已实际显示 `http://127.0.0.1:4186/#/memory`，可见 K3 v3 卡片与来源/审批信息。任何 UI 写入只会落到此临时副本，不会改 4186 原副本或真实业务库。
- 在该临时 UI 副本经 API 创建虚构 sample 工单 #11（企业 fine-grained PAT 45 天、组织 120 天），并实际生成 personal/organization 两条 live 运行；当前副本计数变为 11 工单 / 16 运行 / 4 审核 / 4 卡 / 22 知识使用。组织模式 top-4 为 K3/C9/K2/C7，未召回 K1 v2；答复明确缺少 fine-grained 层级依据而要求核实。
- 为定位召回原因，从 UI 副本再 `VACUUM INTO` 创建一次性候选 DB，仅更新该副本的 K1 内容/来源/范围为未发布 v3 草稿。实际 #11 查询下，K1 v3 排名升至第一（score 96.68），再接 K3/C9/C7；生产 `runAgent` live 34,833ms，引用 K1/K3，明确 45 天企业上限不可由 120 天组织上限放宽，并说明 classic PAT 检查时点不适用 fine-grained。策略是否在真实组织当前生效仍列待核实。源 UI 副本计数前后不变、完整性 `ok`；候选运行仅使用内存 `createRun`，未写入源库。详细 JSON/脚本：`research/observations/2026-11-k1-candidate-actual-ticket-retrieval-result.json` / `research/scripts/benchmark-k1-candidate-actual-ticket-retrieval.mjs`。此结果把缺口定位为“发布前 K1 未被召回”，不等于发布授权。
- 之后在 4186 可视化隔离副本创建虚构 sample 工单 #12（classic PAT；企业 45 天、组织 120 天、token 90 天；个人仓库可用、组织 API 因期限被拒），实际运行新配对 `gmwm708jz2jkq`（个人 R17 / 组织 R18）。两条均 live，`deepseek-flash / support-agent-v4.0-matched`；个人无检索来源但答得相近，组织检索 K3/C9/K2/C7、引用 K3/K2，明确区分企业/组织上限、组织访问被挡与 token 被撤销，并说明 classic PAT 使用/SSO 检查时点。当前副本计数 12 sample 工单 / 18 sample 运行 / 4 sample 卡 / 24 知识使用 / 4 既有人审；#12 仍 open、0 审核、无新卡，pilot-approved 仍为 0。可见入口 `http://127.0.0.1:4186/#/t/12?g=gmwm708jz2jkq`。本组体现来源追溯，不证明准确率提升或真实业务收益；详见 `research/observations/2026-11-enterprise-policy-transfer-benchmark.md`。
- #12 同一配对实测延迟：personal 30.162 秒、organization 34.254 秒。组织侧单次多约 4.1 秒，样本不足以当作固定检索开销或普遍速度差异。
- 对 #12 做了助手辅助来源核对（未写入人工审核）：45/120 天层级、组织访问拦截与 token 撤销区分、classic PAT 使用/SSO 检查时点均有 GitHub 文档支持；组织答复引用 K3/K2、未索取凭证，给出的只读检查安全但较保守。若人工认为需要，可编辑时补充仅在确认策略适用且 GitHub 错误提示要求时按提示调整期限/生成合规 token。#12 目前仍 open、0 人工审核；详见观察记录“#12 答复来源核对”。
- 为让人工审核更能留下组织学习线索，详情页理由栏增加“事实 / 来源 / 下一步”提示，仍保持可选，并提醒勿写 token 明文。仅改 `public/app.js` 文案，无 API/数据库变更；4186 `/app.js` 已返回新版提示。复核期间 #12 仍 2 条运行、0 审核，sample 总数保持 12 工单 / 18 运行；未提交审核、未调用模型。
- 新增通俗版阶段总结 `research/observations/2026-11-practice-in-plain-language.md`：当前证明的是已审核公开知识能被新问题检索并追溯来源；尚未证明准确率优势、团队共识或真实业务收益。#12 组织答复已由用户采纳；后续仍需另行决定模拟结案，并在条件允许时加入第二位独立审核者与后续结果记录。
- 用户已采纳 #12 组织运行 R18：新增 review #5，`human/adopt`、审核者陈朋；未填写理由或评分。复核确认工单仍 `sample/open`，2 条运行；样本库共 12 工单 / 18 运行 / 5 条 human review / 4 张卡，pilot-approved 0。没有自动结案、生成新卡或改写 K3。采纳与模拟问答已解决仍是两个独立动作；详见企业级策略观察记录。
- 2026-11-18：用户确认 #12 组织运行 R18 作为模拟问答已答复；工单改为 `sample/resolved / answered`，无知识卡自动生成。新建 #13 后运行配对 `gmwma8bzhi0s4`：个人 R19 live 34,856ms、无来源；组织 R20 live 39,132ms，检索 C12/K3/K2/C9，但只引用 K3/K2。两模式核心结论相近，因此只证明 C12 可进检索候选，未证明案例改变回答。#13 仍 open、0 审核；当前副本 13 sample 工单 / 20 sample 运行 / 4 卡 / 5 人工审核 / 26 知识使用 / 0 pilot-approved。配对页 `http://127.0.0.1:4186/#/t/13?g=gmwma8bzhi0s4`。下一步可由用户审核 #13，记录新的独立人工判断。
- 2026-11-19：用户采纳 #13 组织运行 R20，新增 review #6 `human/adopt`、审核者陈朋，无理由/评分；#13 仍 sample/open，未结案、未生成新卡。当前可视化副本 13 sample 工单 / 20 运行 / 4 卡 / 6 human review / 26 知识使用 / 0 pilot-approved。详情见 2026-11 企业级策略观察记录“#13 人工采纳记录”。
- 2026-11-19：对 #13 用同题内存对照保留/移除 C12，固定 K3/K2/C9；每条件 4 次请求，其中各 2 次 live、2 次因无效响应/超时兜底。四条有效答复核心结论相同，都引用 K3/K2、不引用 C12；期限检查细节在两条件下各出现 1/2 次，未观察到稳定增量。最后一对只在实验进程内将超时上限调为 90 秒；应用数据库计数不变，#13 仍 open、2 条已存运行、1 条人工采纳。详见 `research/observations/2026-11-enterprise-policy-transfer-benchmark.md` 与 `research/observations/2026-11-case-13-ablation-result.json`。
- 2026-11-19：追查 C12 案例上下文后发现，检索正文只有工单描述与 outcome，不包含人工采纳的 R18 答复。用同题内存对照给 C12 加入 R18 答复，两条件各 2 次 live；四答复都引用 K3/K2、不引用 C12，核心判断相同。R18 主要复述现有规则卡，未观察到新增组织经验；因此不建议为增加案例数量而将 #13 标为已答复，#13 保持 open。数据库计数无变化。详情见 `research/observations/2026-11-enterprise-policy-transfer-benchmark.md`、`research/observations/2026-11-case-13-reviewed-answer-ablation-result.json`。
- 为检验多成员判断，准备了工单 #13 的匿名模式独立评审单 `research/observations/2026-11-independent-review-packet-case-13.md`。未联系或提交给任何人；等待用户安排另一位实际评审者。评审单不自动写入应用审核记录。
- 2026-11-19：重新核对 K1 v3 候选引用的 GitHub Enterprise Cloud 官方规则：fine-grained PAT 企业/组织 366 天默认上限、组织不可覆盖企业上限、策略不合规 token 的组织访问拦截，以及 fine-grained 创建检查与 classic 使用/SSO 检查的类型区别均获当前文档支持。K1 仍为 4186 中 published/sample v2，v3 未写入或发布，pilot-approved 仍为 0；这不是发布授权。详见企业策略观察记录末尾“官方来源复核”。
- 为推进候选的人审，准备 `research/observations/2026-11-k1-v3-sample-review.md`：汇总 v2/v3 两组内存对照、新数值 holdout、#11 隔离检索复测和官方来源。随后在工作区实现受控的 sample 卡片修订流程：从当前发布版本创建独立待审版本；发布新版本时原版本标记为已替代并退出检索，历史引用与审批记录保留；真实 pilot 卡片不开放此流程。涉及 `server/db.js`、`server/store.js`、`server/analytics.js`、`server/api.js`、`public/app.js`。全部改动文件 `node --check` 通过，未跑自动化测试。
- 上述自动重启受策略阻止后，用户在本机重新启动 4186。新进程 health 正常，`/api/state.cardRevisionWorkflow=1`、`promptVersion=support-agent-v4.0-matched`，仍指向隔离 sample 副本 `C:\Users\yuesh\AppData\Local\Temp\io-visible-k1-review-Rpf2nx`。运行 `research/scripts/stage-k1-v3-review-draft.mjs` 后，新增 K5 pending/sample/v3，明确 `supersedes_card_id=1`、`supersedes_version=2`；K1 v2 仍 published 且未被替代，K5 无人工审核、未发布、`pilot_approved=0`。复核时 13 张 sample 工单、5 条 sample 卡记录、3 条 active published、pilot-approved 0；没有调用模型。当前可直接在 `http://127.0.0.1:4186/#/memory` 的“待审核”查看 K5。发布仍须人工明确决定。
- 2026-11-19：用户把总目标明确为“建成一个智能组织”。新路线图 `research/04-intelligent-organization-build-roadmap.md` 将完成条件定义为任务协作、知识治理、结果反馈与跨成员迁移；把现有客服/RAG应用标为实验台，而非智能组织本身。首个组织范围与真实任务流待用户确定；在范围确认前不把虚构 GitHub 工单当作真实业务。
- 2026-11-19：新增临时工作单元运行约定 `research/05-first-workcell-operating-charter.md`，暂按“用户 + AI 共同建设当前项目”定义角色、任务记录、审查权、结果反馈和首期指标；明确这不是多 Agent 团队，组织范围待用户确认。当前首个组织建设行动是确定组织边界和一条重复任务流。
- 2026-11-19：建立运行项 `research/operations/IO-001-first-work-unit.md`，把“建成一个智能组织”拆成首个可验收任务闭环；当前范围确认中，尚未把模拟工单计作组织成果。
- 2026-11-19：新增根目录 `AGENTS.md`，把“用户 + AI 项目团队”的任务闭环、职责边界、知识证据标记和结果衡量规则设为仓库持续运行约定。IO-001 当前暂定首条重复工作流为软件交付；用户可调整为真实团队或客户产品团队。

## 2026-11-19：产品方向更新

用户已明确选择把 intelligent_organization 做成给其他团队使用的产品。第一版暂定小型客服 / IT 支持团队为切入口；这属于可调整假设，不代表已有客户验证。产品定义与建设阶段见 research/06-product-v1-definition.md。首批建议每个客户独立环境和数据库、一个组织内邀请多位成员。作出该方向决定时，现有单机实验台尚无真实身份登录、团队角色和数据隔离；其产品化状态已在下方“单客户团队版产品模式底座”更新。GitHub 虚构样本仅作演示，不算客户验证或组织成效。

## 2026-11-19：单客户团队版产品模式底座

- 新增 `APP_MODE=product` 代码路径：OIDC Authorization Code + PKCE、受邀邮箱准入、服务端会话与角色检查（admin/member/viewer）、管理员邀请和停用成员；登录成员 ID 进入工单、运行、审核、知识编辑与审批事件。
- 产品模式首次启动不载入演示种子；需要模型和 OIDC 配置、HTTPS 公网来源及显式专用 `DATA_DIR`，并拒绝包含 sample 工单、知识卡或成员的数据。现有 demo/4186 环境未重启、未改库。
- 产品模式只生成组织建议；模型故障不会回退成本地演示回答。页面按产品团队流程显示，隐藏对照实验统计；只读角色在页面隐藏写操作、API 仍服务端拒绝写入。负责人只能分派给启用成员。
- 完成本轮静态修正：修复生成建议接口请求对象变量名；交接、知识草稿事件补操作者关联；产品模式知识批准界面使用登录身份；首页改为团队概况而非个人/组织实验对照；只读成员不显示写操作；负责人必须是启用成员；工单的“数据授权人”保留填写值，不会被登录操作者覆盖；停用成员时撤销现有会话。
- 新增管理员 JSON 数据导出：包括成员（不含 OIDC subject）、工单、运行、审核、知识、引用和事件；不导出会话 token hash 或登录流程数据。导出操作自身写入团队事件；只允许 product 模式管理员调用。2026-11-19 在隔离恢复库上先用测试身份替身验证实际 HTTP 路由，再在真实 `createAuth` 会话链中验证；未登录、非管理员、错误 Origin 均被拒，管理员导出成功并留下事件，subject/session cookie/token hash/OIDC flow 均不进入导出。尚未用图形浏览器下载或客户真实 IdP 验收。
- 新增 product-only 只读“团队复盘”页和 `GET /api/team-learning`：显示工单结果记录、人工审核、重开/升级、交接等待和知识跨任务迁移；复用统计来自每次组织运行实际检索到的上下文，同时覆盖知识卡和已解决工单案例，并依据该次运行的受校验引用区分“命中未引用”。另展示当前已解决工单从创建到最近结案的日历周期中位数与有效样本数，以及已接收交接的等待中位数/样本数和当前待接收数量。新建工单在产品模式强制从 open 开始；将工单标为 resolved 时必须填写实际结果说明。页面明确提示这些活动数字不是因果成效证明。2026-11-19 在本地模拟 OIDC 的隔离 product 实例里经实际 HTTP 路由验证：一条虚构已结案任务显示 1 已解决、1 有结果、1 次已接收交接；没有调用模型。
- 工单详情新增产品模式交接闭环：负责人改派后，成员可保存当前组织建议派生的交接摘要；只有当前指派的接手人能确认，改派或工单状态变化会让旧待确认交接失效；确认时间写入现有事件表并用于等待中位数。产品模式不允许把只读角色分派为负责人。2026-11-19 本地 OIDC 模拟环境中由两个不同会话通过实际 HTTP 路由完成指派、交接准备与接收；非接手者确认被拒。模型建议用明确标记的 fixture 运行，没有调用模型。
- 新增 `scripts/workspace-data.js` 产品工作区运维命令：SQLite 在线备份、SHA-256 与完整性校验、备份验证、恢复到新/空 DATA_DIR 和确认式删除；拒绝 sample 演示数据、覆盖和项目目录内的备份/恢复目标；备份副本排除登录会话与临时 OIDC 流程。备份文件未加密，部署方需使用加密存储；密钥环境变量须单独保管。提升 Node 最低版本至 22.16（Node 官方 `node:sqlite` 在线备份 API 的引入版本）。2026-11-19 已在无 `.env` 的临时副本和临时 SQLite 库上人工演练：1 工单/1 运行/1 知识卡/1 成员/1 反馈备份、SHA-256 与完整性校验及恢复成功；源库 1 条会话/1 条 OIDC 流程，恢复库均为 0；源与恢复库 `integrity_check=ok`。随后用精确确认词删除隔离源库 app.db，独立备份与恢复库仍保留，备份复验成功。未触碰项目数据、4182/4186 样本库或任何正在运行的产品服务。
- 产品安全静态检查修正 `server/index.js` 静态文件路径校验：解码 URL 路径后用 `path.relative` 限制访问范围，拒绝非法转义和 NUL 字符，并给静态响应加 `X-Content-Type-Options: nosniff`。仅静态审阅与语法检查，未跑 HTTP 攻击用例或浏览器验证。
- 同文件增加 product 启动只读预检：先验证显式 product 配置，再只读检查既有 SQLite 结构与 sample 记录，确认无演示数据后才调用 `openDb()` 做迁移；数据含 sample、结构不完整或无法确认边界时在迁移前退出。全新空 `DATA_DIR` 的启动预检已随隔离 product 实例验证；含 sample、旧结构/边界不明数据库的拒绝分支仍只做静态检查。
- 新增产品工作区进程锁：product 服务在 `DATA_DIR/app.lock` 独占记录 PID 和随机令牌；避免同一目录并发启动，删除命令拒绝仍活跃的 PID，只接受人工确认过期的锁。2026-11-19 在临时虚构副本验证删除活跃/陈旧锁分支；同日另在实际隔离 product 服务进程中验证活跃锁拒绝第二实例、第一实例继续健康、正常关机移除锁。没有触碰项目现有服务或 4182/4186 样本库。
- 双实例数据隔离：2026-11-19 用当前 server 代码（关键文件哈希与工作区一致）启动两套独立 product 进程，分别配置不同 `DATA_DIR`、组织名与 HTTPS 入口。为专测边界，在各自 DB 中直接建立相同 OIDC 主体的虚构成员和独立会话；跨实例会话得到未认证，工单列表与管理员导出只包含各自唯一工单/组织名。两库完整性均为 `ok`，退出后会话为 0，两个锁都正常释放；测试数据库已删除，临时应用副本和 TLS 证书因清理命令被策略拦截，仍待清理。真实主机服务账号/文件 ACL 隔离和客户部署仍待验收。
- 2026-11-19：新增单团队 Docker 部署底座 `Dockerfile` / `compose.yaml`、受保护部署环境变量模板与 `.dockerignore`；容器非 root、只读根文件系统、loopback 端口、Compose 命名数据卷、宿主备份目录及 Docker secret 文件。`server/config.js` 增加模型密钥和 OIDC client secret 的 `_FILE` 读取，含糊的“直接值+文件”双配置会 fail closed。基于 Node 24.22.1 的镜像构建成功；镜像中 `.env` 不存在，运行用户为 UID 1000；实际 Compose secret 文件挂载可由应用配置读取。隔离 Compose product 容器连接本地合成 OIDC issuer 后达到健康态，`/api/ready` 返回 product/ready、数据库 `ok`、模型配置已设置。关闭后隔离库 `integrity_check=ok`、工单数 0、`app.lock` 已释放；无登录、工单写入或模型调用。`node --check server/config.js` 与 `docker compose config -q` 通过，未运行自动化测试。
- 本次临时环境清理受本机策略阻拦：本地 OIDC 容器已停并因 `--rm` 移除；产品容器处于 Exited (0)，测试数据卷/网络仍留在 Docker 项目 `io-product-smoke-7b542528`，临时合成证书/私钥、假模型 key、env 配置及空备份目录仍留在 `C:\Users\yuesh\AppData\Local\Temp\io-container-smoke-f56ccb4882`。镜像保留为 `intelligent-organization-product:build-check`。这些都不是客户数据或真实凭据。清理命令被拒后未尝试绕过。真实 Linux 主机/服务账号 ACL、客户 IdP/反向代理、备份恢复实跑与安全评审仍待验收；该配置仍是单客户单实例受控试用底座，不是生产发布包。
- 新增首个团队部署与验收手册 `research/operations/product-first-team-onboarding.md`：按当前 OIDC 代码明确 issuer、回调、PKCE、已验证邮箱、首次管理员和普通成员邀请，并列出双成员协作、跨工作区隔离、知识治理、结果闭环、导出与备份恢复验收。它是待执行方案，不是客户/生产验证。
- 初始管理员邀请现在设为 7 天；若有效/待邀请管理员为零，过期的初始管理员邀请会在服务启动时续期 7 天。若配置邮箱已有停用或非管理员成员记录，启动明确失败，不自动提升或启用。已在本地模拟 OIDC 环境中验证初始管理员激活、邀请成员和未验证邮箱拒绝；真实 IdP 仍待验收。
- 空白 product 工作区首页新增第一条任务流引导，提示数据授权、成员邀请、人工审核、结果记录与跨成员知识复用；管理员按钮直达设置中的成员邀请区域；不生成演示数据、不触发模型调用。曾用只读虚构 API 预览渲染，未连接数据库、模型或真实 product 服务。
- 知识生命周期新增主动停用和到期复核：当前生效的发布卡需填写原因方可停用，事务内写入 `retired` 状态、卡片审核历史和 `card_retired` 事件；未来检索不再候选，历史运行与引用保留。同来源工单草稿去重包含 retired 状态。有效期统一为 UTC 日期当天结束后失效；非法日期不能通过试点批准接口，既有非法日期按过期处理。组织记忆页显示到期提醒、“过期待复核”列表及停用操作；product API 复用登录身份/CSRF/只读角色防护。隔离虚构 DB 实际检索核对确认停用卡退出候选；到期边界纯逻辑核对通过。本机 4191 交互预览展示已发布与已过期卡片；知识停用的 product 登录态 HTTP 持久化仍未端到端验收。
- **状态：本地受控试用链路已端到端跑通，真实团队验收未完成。** 2026-11-19 在独立 DATA_DIR、本机 HTTPS 代理和本地模拟 OIDC 提供方下，真实 `openid-client` 通过授权码/PKCE/签名验证；双成员工单、交接、结果、viewer 限权、停用撤销会话、导出和复盘均经实际 HTTP 路由验证；另用双实例确认独立数据库、会话、工单和导出不串数据；锁、重复实例和正常关机也通过。测试数据已删除，未调用模型。仍缺客户真实 OIDC 测试租户、团队控制的 HTTPS 域名、真实浏览器/反向代理验收、真实数据授权、两位实际测试成员和主机文件权限隔离验收。持续监控告警、邀请邮件和上线安全评审仍未实现。不得把 4186 样本数据库切到 product 模式。

## 2026-11-19：首次团队学习闭环引导

- 首页引导不再随第一张工单创建而消失；`GET /api/team-learning` 的只读汇总增加四项进度：至少两位启用的 admin/member、带实际结果的已解决工单、源工单有结果且曾发布的经验，以及另一位登录成员在不同工单实际引用该经验且该工单已记录结果。
- 首页按这些记录显示 `x/4` 进度；发布知识这一步要求来源工单 AI 建议发起成员以外的另一位登录成员审核发布；跨成员复用还要求不同成员在另一工单实际引用并记录结果。只有四项都能由记录核对时才收起引导，并显示团队复盘入口。数据授权和模型数据边界仍是团队负责人必须人工确认的前置条件，进度聚合不会替人作出授权判断。
- `node --check server/team-learning.js`、`node --check public/app.js` 通过。未启动或重启正式 product 服务、未读取数据库、未调用模型、未执行自动化测试；页面/API 行为尚待隔离 product 环境复核。
- 隔离 UI 预览已开在 `http://127.0.0.1:4192/?stage=2#/`（PID 155284）：脚本 `research/scripts/preview-onboarding-progress.mjs` 用虚构内存数据调用真实 `buildTeamLearning()`，可切换 0/4 到 4/4，所有写请求返回 405。页面 HTTP 200、0/4 与 4/4 聚合、写入拒绝均已手工核对；Edge 预览 2/4 的实际页面后发现并修复空事件流竖排问题。它不连接正式数据库、OIDC 或模型，不能证明真实 product API/数据库链路；当前正式服务未重启。

## 2026-11-19：设置页模型数据流说明

- 设置页新增“生成建议时，哪些内容会发给模型”：列出主模型提示词中的工单字段、组织记忆摘录上限、接收端、服务端脱敏闸门和模型服务协议需由管理员核验的边界；明确数据来源/授权人/脱敏状态不作为提示词字段，但标题/描述仍可能包含个人信息，系统不自动清除。
- `modelStatus()` 仅新增非敏感布尔值 `sampleShadowCheckEnabled`，使演示设置页能说明 TypeSafe/JEV 旁路当前是否启用。产品模式明确显示不把真实工单发送给该旁路；演示模式说明该旁路仅对有候选记忆的 sample 组织运行发送工单摘要与候选摘录，结果不改变主模型输入。
- 此项仅为静态代码与文档修改；正式服务未重启，未读取 `.env`、未调用模型、未访问或修改数据库，也未运行自动化测试。页面显示内容尚待隔离产品环境预览。
- 隔离预览脚本补齐设置页所需只读数据，并用 `.invalid` 虚构端点展示“产品模式已配置模型”的页面状态；预览横幅明确不调用模型，写请求仍返回 405。该预览需用单独端口启动，不能代表真实产品服务或模型连接状态。

## 2026-11-19：新团队开始前清单

- 产品模式“设置”页新增准备清单：模型只按配置存在与否显示状态，不声称端点已连通；成员数只统计 active admin/member 账号，不推断成员已实际登录；数据授权、脱敏规则和保留期限保持为团队负责人的人工确认事项，不创建虚假的授权状态。
- 清单链接到现有模型信息、成员设置和模型数据流说明；与首页的任务学习闭环引导分开呈现。清单仅在产品模式显示。
- 成员管理列表读取失败时只在成员面板显示错误，设置页其余区块保持可用；这样只读界面预览的 mock API 缺少成员管理路由时仍能展示其余设置。
- `node --check public/app.js` 通过；未运行自动化测试、未读取 `.env`、未访问或修改数据库、未调用模型、未重启服务。实际 product 模式浏览器预览与首批团队可用性仍待核对。

## 2026-11-19：管理员手动模型连通性检查

- 产品模式设置页管理员可主动发送固定虚构 JSON 请求检查模型；只返回成功状态、模型名与耗时，错误响应不包含供应商原始正文或密钥。请求不包含工单/知识，不写运行记录；点击可能产生供应商费用。后续增加的请求用量审计只记录操作者、时间和用途。
- API 仅产品模式开放，依赖现有登录、CSRF 与管理员权限；单实例并发互斥并设 30 秒冷却。请求超时最多 15 秒。检查不自动运行，也不调用 TypeSafe/JEV。
- 本轮只做源代码和文档修改；没有点击或调用接口、没有读取 `.env`、没有访问数据库、没有重启服务、没有运行自动化测试。需要在隔离产品环境由管理员手动点击复核端点兼容性、权限和错误呈现。

## 2026-11-19：主模型单次输出上限

- `MODEL_MAX_OUTPUT_TOKENS` 默认为 4096，配置范围 1024–8192；非整数或超界值会在启动配置解析时明确报错。主模型调用把此值作为 `max_tokens`，设置页显示当前限制。
- 文案明确说明这是单次输出长度限制，不是总费用上限；输入量、调用频率和供应商价格仍需单独治理。连通性检查保留固定的 32-token 上限。
- `node --check server/config.js`、`node --check server/llm.js`、`node --check public/app.js` 均通过；未读 `.env`、未调用模型、未访问数据库、未重启服务、未运行自动化测试。

## 2026-11-19：产品模式团队模型请求上限

- `MODEL_MAX_CALLS_PER_HOUR` 默认 60，范围 1–10000。产品模式工单建议与手动连接检查都在请求前核对同一团队最近 60 分钟的持久事件计数；超过上限返回 429，不调用模型。失败请求也计数，避免反复失败调用绕过限制。
- 请求预留写入现有事件表，保存操作者、时间、用途及可选工单关联，不保存提示词、模型回复或密钥；新增 `(kind, created_at)` 索引以支持滚动窗口查询。设置页显示当前用量/上限。
- 该限制按请求数，不是金额/Token 输入费用上限；不提供美元计费查询或自动告警。`node --check server/config.js`、`server/db.js`、`server/api.js`、`server/llm.js`、`public/app.js` 均通过；未读取 `.env`、未调用模型、未访问数据库、未重启服务、未运行自动化测试。

## 2026-11-19：管理员维护团队显示名称

- 新增 `workspace_profile` 单行表；`ORG_NAME` 作为初始/回退名称。设置页仅管理员可修改，API 校验非空、80 字符和控制字符，并依赖产品模式现有登录、CSRF 与管理员权限。
- 新名称经事务写入团队独立数据库，变更记入团队事件；登录页 `/api/auth/status`、`/api/state` 和管理员 JSON 导出读取持久名称。JSON 导出增加 `workspace_profile`。名称不改变 OIDC、域名、DATA_DIR 或团队隔离边界。
- `node --check` 对 `server/db.js`、`server/store.js`、`server/auth.js`、`server/api.js`、`server/index.js`、`public/app.js` 均通过。未读取 `.env`、未访问当前数据库、未重启服务或运行自动化测试；真实产品页与导出仍需隔离环境核对。

## 2026-11-19：登录页首次使用说明

- Product 模式登录页明确邀请制、需要管理员确认受邀邮箱、系统不代发邀请邮件；并以三步说明团队使用流程：确认数据边界、共同处理并记录结果、审核后再复用共享经验。
- `node --check public/app.js` 通过。未启动服务、访问数据库、读取 `.env`、调用模型或运行自动化测试。真实登录页外观与流程仍待浏览器验收。

## 2026-11-19：首次使用登录页隔离预览

- `research/scripts/preview-onboarding-progress.mjs` 新增 `?view=login`：模拟未登录状态以呈现真实 `public/app.js` 的登录页；页面仍明确标记虚构预览，登录按钮不连接身份提供方，预览 API 只接受 GET。
- 当前只读预览为 `http://127.0.0.1:4192/?view=login`，PID 137388。HTTP 页面返回 200，所需说明已由当前 `app.js` 提供，`/api/auth/me` 预览响应为未认证。
- 本次只重启了原有 loopback 预览进程，没有接触产品服务、数据库、`.env` 或模型；`node --check` 对预览脚本和 `public/app.js` 均通过。它展示页面，不代表真实 OIDC 登录验收。

## 2026-11-19：团队名称显示在产品侧栏

- 登录成功后，侧栏使用 `/api/auth/status` 返回的持久团队名；管理员保存新名字时，表单、内存状态和侧栏同步更新，无需刷新。名称设置仍只影响展示，不更改实例或数据隔离。
- 侧栏名称最多显示两行，完整名称保留在 `title` 属性中。`node --check public/app.js` 通过；4192 隔离预览现已从当前脚本提供此行为，真实登录下保存后的浏览器表现仍待验收。

## 2026-11-19：第一次团队试用准备卡

- 新增 `research/operations/team-first-session-worksheet.md`，以通俗问题帮助团队选定重复任务、定义解决/升级标准、分清 AI 与成员责任、由负责人讨论数据边界，并记录两件相似任务的处理结果和经验复用情况。
- 明确准备卡不是公司政策或授权证明；不清楚真实数据边界时不提交真实工单；两件任务只用于检查流程能否跑通，不能证明业务效果。已从部署手册和 README 增加入口，并同步产品定义。
- 本次只改文档，没有访问数据库、读取 `.env`、重启服务、调用模型或运行测试。

## 2026-11-19：产品内可打印的首次试用指南

- 新增 `public/first-session.html` 与 `public/first-session.css`，提供选题、解决标准、AI/成员责任、数据边界和两件相似任务复盘的可打印静态页面；不含表单、网络提交或本地保存。
- Product 登录页与首页未完成学习闭环时均可打开该页；保留面向部署/负责人版本的 Markdown 准备卡作为详细讨论材料。
- `node --check public/app.js` 通过；4192 隔离预览返回 `/first-session.html` 和 `/first-session.css` 均 HTTP 200，页面含准备卡内容且无表单。未访问数据库、读取 `.env`、重启正式产品服务、调用模型或运行自动化测试；真实打印版式仍待浏览器验收。

## 2026-11-19：模型调用前复核试点记录

- `server/api.js` 用同一个 `pilotRunGate` 给工单详情返回只读拦截原因，并在 `POST /api/tickets/:id/run` 调用模型前硬性拦截缺少来源/授权人记录，或脱敏为“部分脱敏/未声明”的试点工单；`public/app.js` 用该服务端原因禁用生成按钮并展示提示，模拟工单行为不变。
- 新工单表单说明来源、授权人、脱敏状态是手工记录，不能代替负责人真实授权，也不能证明脱敏充分。系统不声称能核验授权真实性。
- `node --check server/api.js`、`node --check public/app.js` 通过。未访问数据库、读取 `.env`、重启服务、调用模型或运行自动化测试；尚未通过隔离数据库/API链路复核。

## 2026-11-19：区分工单存储与模型发送授权

- 新工单提示与首次使用准备页分别说明两件事：团队是否允许把工单保存在本地工作区，以及是否允许把必要内容发送给模型。选择“部分脱敏”时可仅供人工处理，服务端仍会拦截模型调用；本地存储本身也须先获准。
- 明确来源、授权人、脱敏状态为手工记录，不是系统核验。准备卡和产品定义同步了这个边界。
- `node --check public/app.js` 通过；4192 隔离预览提供更新后的静态指南并返回 HTTP 200。未访问数据库、读取 `.env`、重启服务、调用模型或运行自动化测试。

## 2026-11-19：模型发送确认单独登记并设为调用闸门

- `tickets` 增加 `model_authorized_by`，由幂等启动迁移补列；旧工单默认为空，不从原“授权人”字段推断已同意发送给模型。
- 服务端模型调用闸门在来源、工作区存储确认、脱敏检查之外，要求该字段非空；产品模式仅管理员可创建时登记或通过工单详情登记/撤销。撤销后后续模型调用会被拦截。事件流记录登记/撤销动作及字段有无变化，不复制姓名到事件载荷。
- 新建表单和工单详情分别显示两种确认；试点闭环列表也显示模型发送确认人。事件流把登记/撤销显示为中文人工操作；建单时一并登记也会单独留事件。所有姓名均是手工记录，不是登录身份或授权核验。
- 新增虚构只读界面预览，当前 PID `121680`、端口 `4193`：无确认 `http://127.0.0.1:4193/?view=model-gate#/t/901`；确认且目标匹配 `http://127.0.0.1:4193/?view=model-gate&consent=recorded#/t/901`；确认后目标已更换 `http://127.0.0.1:4193/?view=model-gate&consent=old-target#/t/901`。三个页面 HTTP 200；只读 GET 核对分别为被拦截、目标匹配放行、目标不匹配拦截。旧目标事件快照可读，详情页面加载当前 `eventSummary` 渲染逻辑。写请求仍由预览服务拒绝，不连接产品数据库、OIDC 或模型。停止命令：`Stop-Process -Id 121680`。既有 4192 进度预览 PID `137388` 仍在运行；其脚本没有 `/api/health`，health 路由 404 不能代表进程已停止。
- `node --check` 对 7 个 JavaScript 文件通过。未访问产品数据库、读取 `.env`、调用模型或运行自动化测试。实际产品服务没有重启，服务端硬闸门和数据库迁移要在目标产品实例下次启动后才生效；真实产品库内存量工单将保持未确认，需负责人真实确认后由管理员逐单登记。

## 2026-11-19：把用户提供的智能组织原则映射到产品路线

- 在产品定义中把三项设计原则对应到任务协作、经验治理和结果闭环，并明确区分产品已有能力与仍需真实团队验证的效果。
- 用户提供材料中的企业数据仅作为背景，不作为本产品的成效证据；客服/IT 支持仍是待验证的窄入口，更多 Agent 或自动化编排要由真实流程瓶颈驱动。
- 本轮为文档修改；未外部核验演讲事实，也未将其数据写作产品验证结果。

## 2026-11-19：模型发送确认绑定到目标服务

- `tickets` 增加幂等迁移列 `model_authorized_base_url`、`model_authorized_model`。新建时的确认快照和详情页登记均由服务端读取当前模型状态，不能由浏览器提交一个伪造目标；模型配置目标变化后服务端闸门拒绝后续调用。
- 管理员详情显示当前目标与上次确认目标；需负责人对新目标重新确认后才能重新登记。事件历史保存前后端点/模型快照并在页面时间线显示；不复制确认人姓名或密钥到事件载荷。试点闭环列也显示登记目标。
- 4193 只读预览新增“目标已更换”状态；HTTP/API 手工核对确认旧目标被拦截。`node --check` 对全部 7 个 JavaScript 文件通过；未访问产品数据库、读取 `.env`、调用模型、运行自动化测试或重启产品服务。端点/模型名相同不代表服务方的数据条款未变，仍需部署管理员按实际协议核查。

## 2026-11-19：限制模型端点中的凭证写法

- 模型端点会显示在设置、工单详情和模型发送确认事件历史。`server/config.js` 现在拒绝含用户名/密码、查询参数或片段的 `MODEL_BASE_URL`，同时只接受 HTTP(S)；凭证应单独使用服务端 `MODEL_API_KEY` 或 `MODEL_API_KEY_FILE`。
- README 和 IO-002 工作项已记录配置边界。仅计划做语法解析检查；未读取 `.env` 或密钥、未访问产品数据库、未重启产品服务、未调用模型、未运行自动化测试。真实 product 实例仍未验收。
- 首个团队部署手册同步要求模型 URL 不含凭证，并提醒不要把秘密编码进路径或模型名。只读确认 4192 首次使用进度预览（PID `137388`）和 4193 模型发送闸门预览（PID `121680`）仍在运行，四个页面均返回 HTTP 200；两者都只是虚构只读预览，不是 product 工作区验收。IO-001 下一步据此明确区分预览与真实 product 验收。
- 进一步只读 GET 核对 4192 `/api/team-learning` 阶段 0–4 的引导为 `0/4 → 1/4 → 2/4 → 3/4 → 4/4`，4/4 的完成标志为 true；4193 工单 901 在无确认/旧目标时均被拦截、目标匹配时无前端闸门理由。尝试启动仅含虚构配置的独立 product 实例做服务端闸门核对时，执行环境策略在启动前拒绝了组合命令；命令没有执行。事后确认端口 4194/9443 未监听，没有启动临时实例，也未重试绕过。隔离 product 工作区的服务端实测仍待完成。

## 2026-11-19：首次学习闭环进度按事件先后判定

- 首次闭环原来把来源工单上所有历史 AI 参与者都用于判断跨成员，其中未来才发生的参与也可能影响历史里程碑；同时未强制结果、发布、复用、后续结果的先后顺序。`server/team-learning.js` 改为只计来源 AI 运行早于来源结果、且早于知识发布的参与者；要求来源任务记录结果后再发布、后续任务在发布后创建、组织建议引用该卡、目标任务在建议后记录解决结果；仅计 product pilot 范围。
- `public/app.js` 的首页第一项改为“有两位已启用的处理成员账号”，并说明这不证明成员已实际参与任务。`preview-onboarding-progress.mjs` 的虚构时间戳调整为符合先后关系。`research/06-product-v1-definition.md` 写入对应产品验收口径。三个 JS 文件语法解析通过；未运行自动化测试、未启动/重启服务、未访问数据库、未调用模型。4192 预览进程仍加载旧模块，需后续安全重启后才能看到新时间口径；真实 product 验收未完成。

## 2026-11-19：模型请求固定在已确认端点

- 主模型建议、管理员固定虚构连通性检查，以及 TypeSafe 样本影子请求均将 HTTP redirect mode 设为 `error`。Fetch 默认会跟随重定向；现在重定向会按网络错误处理，避免任务正文继续发往配置目标之外的主机。
- 主模型错误不再把供应商响应正文或原始网络异常文本回传给成员，只返回 HTTP 状态码或通用连接错误。README、首个团队部署手册和 IO-002 同步要求配置最终服务地址。
- 依据 [WHATWG Fetch Standard](https://fetch.spec.whatwg.org/#concept-request-redirect-mode) 中的 redirect mode 定义。`node --check server/llm.js`、`node --check server/typesafe-gate.js` 通过；未运行自动化测试、未重启服务、未调用模型、未访问数据库或读取 `.env`。实际端点重定向行为待隔离服务端核对。

## 2026-11-19：产品远程模型连接要求 HTTPS

- `server/config.js` 的产品配置校验现在要求远程 `MODEL_BASE_URL` 使用 HTTPS；仅 `localhost`、`127.0.0.0/8` 和 `::1` 可使用 HTTP，支持同机本地模型，同时避免把工单和模型密钥经远程明文连接发送。README、首个团队部署手册与 IO-002 已同步。
- `node --check server/config.js` 通过；未导入配置模块（避免其读取 `.env`）、未访问数据库、未启动/重启服务、未调用模型或运行自动化测试。产品启动校验分支尚未在隔离 product 环境验证。

## 2026-11-20：先验证产品假设，再继续扩展功能

- 新增 `research/operations/customer-discovery-interview-guide.md`，用于访谈小型客服 / IT 支持团队的一线成员和负责人。脚本先询问近期实际任务、重复频率、交接返工、当前替代办法、可观察影响和数据边界，不先推销 AI 产品。
- 访谈仍未执行，首版切入口仍是假设。AI 不联系外部人员；未经授权的访谈笔记不上传模型或产品工作区。先整理 3 次不同角色、尽量覆盖两种团队类型的匿名访谈，只用于发现和修正问题，不作为市场验证或业务成效证据。
- 路线图与 IO-001 已指向访谈指南。仅修改研究文档；未联系任何人、未处理真实团队数据、未访问数据库或服务、未读取 `.env`、未调用模型、未运行测试。

## 2026-11-20：初查客服工具的竞争基线

- 查阅 Atlassian、Zendesk、Freshdesk、Intercom 官方产品资料，并新增 `research/07-support-tools-competitive-baseline.md`。公开资料已经列出知识检索、AI 答案、历史案例建议、人工交接、结果观察等能力；这些功能本身不足以支持本产品的差异化主张。
- 候选价值暂定为“跨成员、跨任务的判断与结果形成可追溯且验证过的复用闭环”，但这仍是假设。已把现有工具是否实际启用、独立新系统增加的工作、替换/并用意愿补进访谈指南。
- 限制：这是厂商官方功能资料的桌面初查，不是独立评测或客户需求证据；没有比较价格、安全条款和用户实际采用情况。

## 2026-11-20：改进团队成员邀请说明

- 设置页创建成员邀请后会打开可复制消息，含工作区、角色、受邀邮箱、登录地址和 7 天有效期；管理员仍通过团队批准的渠道转发，不触发邮件发送。README 与首个团队部署手册已同步。
- `node --check public/app.js` 语法解析通过。未运行自动化测试、未重启服务、未访问数据库。浏览器交互效果仍需实际 product 登录态验收。

## 2026-11-20：补充公开使用反馈线索

- 竞争基线加入一条公开 r/msp 讨论和一篇 ChannelPro / ITPro 行业文章，提到排障知识散落、任务升级后重复诊断与上下文缺失。来源有自选和媒体/厂商分析限制，仅用于提出访谈问题；不作为市场需求、普遍程度或成效证据。
- 下一轮真实团队访谈应比较小型 MSP / IT 支持和一般客服，重点问最近一次交接后重复排查的实际经历，以及新工具会不会增加双重录入。

## 2026-11-20：交接摘要包含当前处理进展

- 当前工单已有处理备注字段，但交接摘要原先没有读取该字段；处理中更新备注也可能没有事件记录。现在摘要单独显示工单当前处理记录，并明确后续建议尚未执行；备注新增、更新或清除都会写入带登录操作者的时间线事件，状态或结论变化时也记录。
- 前端入口改为“记录进展 / 结果”，部署验收增加“检查记录进展和 AI 建议是否分开”的条件。无需数据库迁移；`node --check server/store.js`、`server/demo-brain.js`、`public/app.js` 通过。未运行自动化测试、未启动服务或访问数据库；浏览器与真实成员交接仍待验证。

## 2026-11-20：提供交接流程可见预览

- 新增 `research/scripts/preview-handoff-flow.mjs`：在 `127.0.0.1:4195` 用当前产品 `public/` 界面展示一张虚构 VPN 工单，摘要由当前纯函数 `prepareHandoff()` 生成。页面标注虚构只读；脚本只提供 GET 接口，写请求在代码中拒绝；不连接数据库、OIDC 或模型。
- `server/demo-brain.js` 的交接摘要现在补入审核后实际采纳的原稿或修订稿；若建议被拒绝，明确写出不能作为已批准答复。虚构预览补齐一条组织建议与人工编辑审核，使时间线、运行卡片和审核记录一致。产品定义与团队验收同步要求接手人能看到实际采纳内容。
- `public/app.js` 顶部状态栏识别 `previewOnly`，显示“无模型连接”且不亮 live 绿灯。预览页的写入按钮和表单控件已禁用，只保留“查看交接摘要”和关闭按钮可操作；提示仍由服务端只读路由兜底。
- 预览事件时间按当前时间生成，避免把交接显示成未来事件；进入工单后自动展开交接摘要。独立 Edge headless 截图能读到人工结论、审核后实际采纳的答复、已记录进展、尚未执行建议和待确认事项；写入操作呈禁用状态。截图在临时目录 `C:\Users\yuesh\AppData\Local\Temp\io-handoff-preview-4195.png`。
- `node --check server/demo-brain.js`、`node --check research/scripts/preview-handoff-flow.mjs` 通过；详情 API 返回 1 条组织运行、审核决定 `edit`，交接摘要含采纳修订稿。当前预览服务 PID 125624，监听 `127.0.0.1:4195`；页面与详情 API 均返回 HTTP 200。它是虚构 UI 演示，不是正式 product 服务验收、客户验证或业务成效证据。
- 未读取 `.env`、未调模型、未访问数据库或现有业务服务、未运行自动化测试。

## 2026-11-20：访谈指南增加 15 分钟短版

- 在 `research/operations/customer-discovery-interview-guide.md` 增加适合首次短谈的时间安排与直接提问：先复盘最近真实交接，再了解当前工具、频率和数据边界；只有对方愿意时才展示虚构预览。
- 明确不先推销 AI、不问购买/使用意愿、不录入真实工单；把愿意看演示与试用承诺区分开。访谈仍未执行，需要用户决定访谈对象和是否联系。

## 2026-11-20：预览跨工单经验复用

- 虚构预览补入来源工单 #901：模拟任务解决后，成员审核发布模拟知识卡 K1；后续工单 #902 通过组织模式引用 K1、经成员编辑后交接。K1 在页面和来源元数据中均标为模拟样本，当前工单仍为处理中，未虚构其最终结果。
- 只读预览的 `/api/memory` 同时展示 K1 与来源案例 #901；详情 API 返回 1 条组织运行和 1 条知识引用，交接摘要保留 K1 来源及审核后采纳的答复。Edge headless 核对了工单交接摘要与组织记忆页，后者显示 K1 已发布、被引用 1 次、来源 #901、案例结果“VPN 已恢复”。
- `node --check research/scripts/preview-handoff-flow.mjs` 通过。当前服务 PID 125760，监听 `127.0.0.1:4195`。页面仅用内存虚构数据，不连接数据库、OIDC 或模型；未读取 `.env`、未访问真实服务、未运行自动化测试。该演示只证明 UI 流程可见，不是正式产品验收、真实团队验证或成效证据。
- 截图：`C:\Users\yuesh\AppData\Local\Temp\io-handoff-preview-4195.png` 与 `C:\Users\yuesh\AppData\Local\Temp\io-memory-preview-4195.png`。
- 这是当前 UI 与内存样例的演示，不是正式 product 服务验收、客户验证或业务成效证据。未读取 `.env`、未调模型、未访问数据库或现有服务、未运行自动化测试。

## 2026-11-20：收敛首次访谈邀请

- 访谈指南中的邀请短讯与 15 分钟访谈流程统一：说明这是面向客服 / IT 支持团队的早期产品研究，免准备材料、不索取工单或敏感信息，并将虚构演示设为可选。未联系任何外部人员；访谈仍待用户自行安排。

## 2026-11-20：调整访谈招募渠道判断

- 公开检索显示 ITPUB 的 IT 服务管理版面最后可见发帖时间为 2025-10-23，暂不作为首选。SRE 创新联合体有官网加入页并称其组织线上交流，但当前联系方式、活动与成员适配度及招募许可待核实；OpenCSG 2026-09-12 活动已结束；华为云社区有近期运维文章，但样本页面偏产品内容，不能证明目标用户可触达。访谈指南已补充先询问管理员是否允许发布的短讯和 90 秒虚构演示顺序；当前本机演示 API 经只读 GET 核对仍有 #902、K1 和来源 #901。近期活动搜索请求无响应后终止，不据此判断没有活动。来源、限制和未联系外部人员的记录见 `research/operations/IO-001-first-work-unit.md`。

## 2026-11-20：找到一场近期运维交流会

- 亚马逊云科技 User Group 活动页列出当日深圳 AIOps / AgentOps 交流会（13:30）；联谱详情页给出 13:00–18:30、深圳南山区华润置地大厦 B 座 15 楼和扫码报名，开始时间存在冲突，需以主办方报名页确认。活动议程含 18:00–18:30 自由交流；尚未报名、联系主办方或参会者。受众是否包含目标 IT 支持团队未知，详见 `research/operations/IO-001-first-work-unit.md`。

## 2026-11-20：准备活动现场筛选话术

- 访谈指南补充两分钟活动现场筛选问题，以确认参会者是否亲自处理或管理工单，避免把厂商观点当成目标用户证据。未联系或登记活动。

## 2026-11-20：再次核对交接演示

- 本机预览 `127.0.0.1:4195` 的只读 GET 返回 200；#902 仍处理中、1 条组织运行，交接含 K1；记忆卡 K1 来自 #901，记录 1 次引用。此结果仅确认虚构演示运行正常，不是客户验证或业务成效。

## 2026-11-20：补充下周深圳活动线索

- Lianpu 活动详情页列出 2026-11-28 IT 部落 CIO 峰会，深圳、扫码报名、具体地点报名后可知。主题更偏决策者 / 企业 AI 应用，不代表能接触目标 IT 支持团队；未报名或联系任何人。记录见 `research/operations/IO-001-first-work-unit.md`。

## 2026-11-20：按成都居住地调整访谈渠道

- 用户在成都，无法前往深圳；深圳活动不再作为本轮可执行选项。
- 成都 AWS User Group 社区页说明其服务西南地区并开放加入，但列出的最近一场成都活动是 2026-10-31，已过去；目前没有核实到近期可参加的成都目标用户活动。社区成员与小型客服 / IT 支持团队的匹配度、招募许可待确认。
- 访谈改为优先线上：可向成都社区管理员询问是否允许招募，也可约其他城市的目标用户视频访谈；虚构预览可屏幕共享，`127.0.0.1:4195` 不能直接供远程受访者访问。未联系社区或受访者。证据、限制和下一步见 `research/operations/IO-001-first-work-unit.md`。

## 2026-11-20：架构设计包评审确认与第一批实施（P1+P2+P3）

- 架构设计包 `research/architecture/`（①现状审计②目标架构③10条流程④数据与API⑤性能⑥安全运维⑦9条ADR⑧路线图P1–P7⑨连接器与执行闭环）经用户评审：领域边界修正（通用 WorkItem 根模型 + 场景适配层，ADR-008）确认，D-0…D-6 全部通过，ADR-001…008 转为已接受；ADR-009（工具连接器）为新增提议待评审。详见 `research/architecture/README.md` 决策表与 `research/operations/IO-003-architecture-implementation-batch1.md`。
- **已实现（P1 安全加固 7 项）**：错误响应规范化（500 固定文案+errorId、SQLite 故障 503）、AI actor 写断言（分发层 x-actor 头 + PATCH body.actor 拦截 + `agent_write_rejected` 审计事件）、提示词版本一致性启动断言（新共享常量 `public/app-version.js`）、事件 kind 单点化 + payload 白名单（新 `server/event-kinds.js`，28 kind，写入点抛错）、UI 事件标签同步断言、运行去重 90 秒（409）、updated_at 乐观并发（409 STALE_WRITE，旧调用兼容）。
- **已实现（P2 记忆闭环 6 项）**：knowledge_uses 幂等加列（adopted/adopted_review_id/helpful/helpful_note/helpful_by_member_id/helpful_recorded_at + 2 索引）、权威审核回写（adopt/edit→1，reject/改判→0，最大 review id 为权威）、`POST /api/uses/:id/helpfulness` 三态标注 + `use_helpfulness_recorded` 事件、工单详情三态标注 UI 与知识卡计数展示、runs 加 path/path_reason/gate_ms/retrieve_ms/model_ms/prompt_tokens/completion_tokens、派生统计 useOutcome（helpfulRate 分母只算已标注，三态互不推断）。
- **已实现（P3 领域核心演进 E1–E4）**：E1 概念重命名仅语义层（DB 列名/表名/API 路径冻结）；E2 新 `server/work-items.js` 类型描述对象 + `tickets.work_item_type` 列 + 服务端按类型校验词表 + UI 下拉从词表渲染；E3 `GET /api/work-items` 读模型路由（type/status/parent 过滤 + typeLabel 中文标签）；E4 pilot_prep 第二类型 + `tickets.parent_ticket_id` 跨类型父子 + 新建对话框按类型渲染。评审四问之三验收达成：+1 类型行 +2 列，零新表、零机制分支。
- **架构已设计（执行域）**：新文档 ⑨——目标解析、九态运行状态机、external_actions 审批生命周期（payload_hash 审批绑定、幂等键、outcome_uncertain 禁止自动重试）、周报/邮件两用例走查、SSE/轮询取舍；④§11 runs 状态列与 external_actions DDL（只设计，⑧P7 排期，依赖 D-7 连接器决策）。
- **验证边界（诚实分级）**：全部改动文件 `node --check` 通过；事件 kind 全仓扫描无未注册项；迁移与核心路径在**一次性临时 DATA_DIR 探针**逐项验证（迁移幂等、回写/改判、三态标注/清除、乐观并发冲突+放行、白名单拦截、E4 跨类型父子 + 子项走同一运行管道、旧路径默认 support_ticket 回归安全）。**smoke 未运行**（D-5：运行时机由用户指定）——P1/P2/P3 的通过条件【本机已验证】尚未正式达成；`scripts/smoke.js` 已扩展（5b/5c/5d 段）只写未跑。
- 未触碰：`data/*.db`（迁移幂等，待服务重启生效）、运行中的服务（4173/4182/4186/4192/4193/4195）、`.env`/凭证；未调用模型、未运行自动化测试、未修改任何既有事件/审核记录。探针数据全部在 `%TEMP%/dsh-ior-*` 已删除。
- 待用户决定：smoke 运行时机（D-5）、ADR-009 评审、D-7 连接器提供商（P7 前置）、迁移生效时机（下次重启自动完成）。

## 2026-11-20：三项决策落定 + smoke 全绿（P1/P2/P3 验收完成）

- 用户三项决策（2026-11-20）：**① D-5 授权立即运行 smoke**；**② ADR-009（工具连接器三原则）接受**——至此 9 条 ADR 全部已接受；**③ D-7 决定连接器提供商暂不接、接口先行**——连接器接口与 external_actions 设计保持就绪，P7 执行闭环推迟至真实需求出现。
- **smoke 结果：39 通过 / 0 失败**（`node --no-warnings scripts/smoke.js`，临时实例 4199 + 一次性 DATA_DIR，用后自清理）。覆盖：演示数据载入、双模式运行与引用校验、沉淀→复用主线、P2 记忆闭环全链（审核采纳回写 use 行、三态标注落库/清除/非法值拒绝、派生统计）、P1 断言（90s 重复运行 409、过期 updated_at 409、最新值写入成功、AI 身份写请求 403、词表外类别 400）、P3（pilot_prep 第二类型、跨类型父子、E3 按类型/按父查询与未知类型拒绝、第二类型子项走同一运行管道、无效父 400）、关键事件落库断言（含 use_helpfulness_recorded、agent_write_rejected）。
- smoke 首轮 3 处失败均为**测试脚本侧**问题（旧断言缺显式 `reviewer` 参数——服务端契约本就要求；预期失败调用误用抛错型 call），修复 `scripts/smoke.js`（新增 tryCall 辅助 + 3 处 reviewer 补参）后重跑通过；**业务代码零改动**。
- P1/P2/P3 通过条件正式达成【本机已验证】；路线图下一阶段为 P4 延迟分层（routeRequest/缓存快路径，⑤§2）。文档已同步：README 决策表 D-0…D-7 全部落定、⑦ 9 条 ADR 全部已接受、⑧ 状态行、④§10.4、IO-003 状态与收尾记录。
- 仍未做（如实）：真实库迁移未生效（幂等，随服务重启）；P4–P7 未实施；真实团队验证仍为 0 项。本轮运行 smoke 前已获用户明确授权（D-5），运行实例为临时 4199 端口 + 独立 DATA_DIR，运行中的正式服务（4173/4182/4186/4192/4193/4195）全程未触碰。

## 2026-11-20：P4 延迟分层与可靠性实施（smoke 42/0）

- **P4-1/P4-2 路由决策 + 缓存快路径**（`server/agent.js`）：新 `routeRequest()`——仅组织模式、标题+描述完全相同、来源工单已解决且组织建议已人工采纳/编辑才命中 `fast_cached`；来源工单重开/无审核/不同题一律回 `main`。命中时落 `origin=cached / path=fast_cached` 运行记录，output 带 `fast_path_note`（明示「来自已解决工单 #N 的已审建议，不是新模型运行」），UI 徽标「缓存复用（历史已审建议）」+ notice 块；单点开关在 runPair（demo 对照实验恒走主模型，产品模式才允许）。
- **P4-3 输出校验失败 1 次同参重试**（agent.js）：结构缺失/JSON 解析失败重试一次，toolCalls 留 `output_retry` 痕迹；网络/超时错误不自动重试（费用不可控），维持显式失败。
- **P4-4 并发模型调用上限**（server/api.js）：进程内信号量 >5 → 429 `MODEL_BUSY`（预留额度失败同样计数，防绕过）。
- **P4-5 连续失败提示**（api.js + app.js）：进程内连续失败计数（成功即清零），`/api/state.modelHealth` 暴露，UI toast「模型服务异常：已连续 N 次失败」——只提示不阻断。
- **P4-7 四元组报表**（server/analytics.js）：`metrics.quadruple`——latencyByPath（按 path/mode 分桶 avg/avgModelMs）、pathCounts、escalationRate（AI 升级建议占比 vs 人工升级，质量信号）、tokens 汇总；全部只读派生、无数据为 null 不伪造数字。
- **验证**：探针（临时 DATA_DIR）覆盖路由命中/不同题 miss/来源重开回退 main/cached 落库字段/报表无 NaN；smoke 扩展 5e 段（四元组存在/path 落库/modelHealth 暴露）后 **42 通过 / 0 失败**。语法检查全部通过；未触碰真实库与运行中服务；模型调用均为 demo 规则生成（无密钥），未调用付费模型。
- 如实边界：mock 端点延迟阈值验证（快路径 <200ms 暂定阈值）与真实模型延迟分布属 P6（真实试点数据）；本机验证的是机制正确性（路由条件、落库、显式提示、429、报表），不是延迟性能数字。
- 文档同步：⑧ P4 实现状态块 + 状态行（下一阶段 P5 部署验收包）、IO-003。

## 2026-11-20：P5 部署验收包落地（acceptance 14/0）

- **P5-1/P5-4 备份恢复演练脚本化 + 端到端验收**：新 `scripts/acceptance.js`——临时实例（4198 端口 + 系统临时目录 DATA_DIR）从零启动 → 迁移 → 沉淀→复用→标注闭环 → **backup/verify/restore 演练** → 指标与审计事件断言。**14 通过 / 0 失败**。备份演练借应用真实迁移器（openDb + 幂等迁移）生成无 sample 的替身库，符合 workspace-data.js 的产品工作区边界（它正确拒绝了手工残缺 schema——工具防线按设计生效）。
- **P5-2 备份新鲜度提示**：`server/config.js` 新增 `BACKUP_DIR`（产品模式可选配置）；`/api/state.backupFreshness` 读备份目录清单报告距上次成功备份天数（超 7 天 = stale，暂定阈值）；设置页准备清单新增第 4 项「备份工作区数据并保持新鲜」+ 过期/从未备份时告警条；未配置时不显示（不猜测部署策略）。只读目录清单，不读备份内容。
- **P5-3 升级回退手册**：新 `deploy/UPGRADE.md`——前置检查（备份+verify 强制）、升级步骤（compose 逐实例）、回退步骤（幂等加列 = 旧镜像可跑新库的核心保证；数据库损坏才走 restore 全新 DATA_DIR）、回退判定点、多实例逐台升级清单、漂移检查命令。
- **P5-5 SLO 数据采集**：按设计不提前实现——属 P6 只读分析（试点批次 latency 数据在库，等用户授权时做汇总）。
- **验证**：`node --check` 全过；acceptance.js 在一次性临时目录演练（用后自清理）；未触碰真实库与运行中服务；未调用付费模型。脚本开发中修复的 4 处失败均为**测试脚本侧**（备份父目录需预建、rmSync 需 force、Windows ESM 需 file:/// URL、config.js 加载时固化 DATA_DIR 需先设 env 再 import），业务代码零改动。
- 文档同步：⑧ P5 实现状态块 + 状态行（下一阶段 P6，用户主导）、⑥§3 由设计转已实现、IO-003。
- **路线图收束：P1–P5 全部完成【本机已验证】。剩余 P6（真实团队试点，用户主导启动：真实 IdP、真实工单、团队授权）与 P7（执行闭环，D-7 已决定推迟）。**

## 2026-11-20：性能基线补全（⑤§7 三项待实施 → 已实施；发现 ADR-007 实测重评依据）

- 新 `scripts/perf-baseline.js`（临时实例 4197 + 本地 mock OpenAI 兼容端点 4196，全部合成数据，零付费模型调用），**11 通过 / 0 失败**。覆盖 ⑤§7 原标「待实施」的三项：
- **应用层基线**：非模型 API（列表+指标）p50 = 4ms（SLO 草案 <300ms 大幅达标）【本机已验证】。
- **检索包络（合成中文语料，5 轮中位）**：1k 卡 p50=133ms（SLO <500ms 达标）；**5k 卡 p50≈28s；10k 卡 p50≈110s**。结论：当前 BM25 无预索引（每次检索全量重 tokenize），>1k 卡即超可用阈值并阻塞单进程事件循环。**试点规模（<100 卡）余量充足不触发；语料接近 1k 卡前必须做预索引或启动 ADR-007 C 路线评估——重评从量级预测变为已有实测依据**（已写入 ⑤§7 与 ⑦ ADR-007）。
- **延迟拆分 + mock live 路径**：gate_ms/retrieve_ms/model_ms 三列落库自洽（mock ≈0ms：gate=0 retrieve=0 model=4 total=4）、tokens 落库正确（100/50）。**如实边界**：demo 实例并发不受限是设计行为（无真实成本）；产品模式 429 的端到端验证需 product 实例 + OIDC，列入 P6 前置核对清单。
- 脚本首轮 4 处失败为口径问题（检索阈值未对齐 ⑤ SLO、5k/10k 应为记录型而非失败、demo 并发口径），修正后全绿；检索包络数据本身是**真实测量结果**，不是测试缺陷。
- 未触碰真实库与运行中服务；临时目录/端口用后即清。文档同步：⑤§7 验证计划表、⑦ ADR-007 实测补充段、IO-003。

## 2026-11-20：全库文档一致性收尾（最终核对，零代码改动）

- 清除 ②③④⑤⑥ 中全部已实施范围的【本设计】标记（改为「已实现 + 日期 + 阶段 + 证据」）；核查确认 ⑨ 执行域 7 处【本设计】**如实保留**（P7 推迟中，标记体系诚实）。
- 根 `README.md`：scripts/ 清单补齐（smoke 42 / acceptance 14 / perf 11）+「验证与运维脚本纪律」块；「当前限制」补检索实测包络（>1k 卡超阈值，5k≈28s、10k≈110s → ADR-007）。
- `research/architecture/README.md`：状态行更新为最终口径（P1–P5、42/0 + 14/0 + 11/0）；决策表 D-3/D-5 保留历史「决策时 39/0」原文并补「后扩至 42/0」指向，消除误读。
- 最终扫描：「待实施」0 处残留；`04-data-and-api.md` L375 的 39/0 为带日期历史证据，保留。全库当前口径唯一：P1–P5 全部完成【本机已验证】，P6 用户主导、P7 推迟（D-7），AI 侧无待办。

## 2026-11-20：建立 git 版本控制基线（用户确认后执行）

- `git init` + 首次提交 `9861994`（188 个文件：架构设计包 ①–⑨、验证脚本、server/public 代码、deploy 文档、research 全量、PROJECT_STATE）；随后 `d236880` 将 ACL 修复工具的本机备份产物（`research/operations/acl-recovery/`）加入忽略。
- 安全核验：`.env`、`data/`（真实库）、`node_modules/` 均未进入暂存区；`deploy/product.env.example` 逐行确认只含占位符与仓库外密钥文件路径（`*_FILE`），无真实凭证入库。
- 全程只做初始化与提交，未改动任何业务文件；运行服务与真实数据照旧未触碰。

## 2026-11-20：运行实例实测核对（只读，无服务存续）

- 实测（GET /api/state + Get-NetTCPConnection）：此前记录的六个实例（4173/4182/4186/4192/4193/4195）与临时测试端口（4196/4197）**当前均无监听、无响应**——运行实例清单已过时，全部停止。本机其余 24 个 node 进程属其他负载，未触碰。
- 结论：迁移是否曾在线应用无法确认，但 `openDb()` 幂等迁移保证下次启动自动补齐（列存在则跳过），无风险；下次启动实例即为新代码。「运行中服务」边界自此解除（无服务可触碰），重启后如需只读复查随时可做。此后 P6 的配置与代码变更可回退。

## 2026-11-20：P6 材料链补全 + 演练遗留清理（git 标签后收尾）

- 为基线提交 `9861994` 打注释标签 `baseline-p1-p5`——P6 期间回退/对照用具名引用，不再依赖哈希。
- P6 手册缺口补全（`f409f4f`）：`product-first-team-onboarding.md` 追加「2026-11-20 实施更新」节——验收观察项补入 P1–P5 五个新能力（工单类型/父子工单、三态有效性标注、缓存复用与延迟拆分、429/409 可靠性行为、备份新鲜度告警）；原 11-19 验收表通过条件不变。MVP_PLAN.md 复核为规划文档，无需同步。
- 演练遗留清理（用户批准）：删除 2026-11-19 演练遗留的三个临时目录（`io-product-ops-drill-dvzUbi`、`io-product-tenant-isolation`、`io-container-smoke-f56ccb4882`——均为虚构测试材料：测试库、临时应用副本、自签证书/假密钥/测试 env），精确字面路径 + 前缀防护，逐目录复验。清理记录入手册（`b4ac110`）。
- 剩余两项如实待办：Docker 遗留（停止态容器 + 专用卷/网络 + `build-check` 镜像，实测守护进程未运行，待用户启动 Docker Desktop 后清理）；`output/preview-product-onboarding/tenant-isolation-app` 副本去留（版本控制内容，独立决定）。提交链现 6 条，工作区干净。

## 2026-11-20：Docker 演练遗留清理（用户批准方案延续，AI 启动 Docker Desktop）

- 启动 Docker Desktop（本机开发工具，非项目服务），引擎就绪（server 29.1.3）；逐项只读盘点与手册记录一致（1 停止容器 Exited(0)、镜像 385MB、专用卷/网络各 1，卷创建于 2026-11-19）。
- 删除：容器 `io-product-smoke-7b542528-app-1`、卷 `io-product-smoke-7b542528_product-data`、网络 `io-product-smoke-7b542528_default`、镜像 `intelligent-organization-product:build-check`（释放 385MB）；四类残留复验为空（提交 `e134ffb` 更新手册记录）。
- 演练遗留物至此全部清零；唯一剩余决定项 = 仓库内 `output/preview-product-onboarding/tenant-isolation-app` 副本去留（用户决定，删除会产生新提交且历史保留）。提交链现 8 条。

## 2026-11-20：演练副本删除 + 远程推送 GitHub（用户逐项批准）

- `output/preview-product-onboarding` 演练副本经用户批准删除（`git rm -r` + 提交 `86dc289`）：磁盘复核不存在、索引残留 0；`output/imagegen/` 等其他内容未动。演练遗留清单至此**全部清零**。
- Docker Desktop 优雅退出（`docker desktop stop`，引擎停止响应核验，进程随后退出）——为清理遗留临时启动，用后即退。
- 远程推送：先误配 `shpey/intelligent_organization`（403 denied to chenxuyaun ×4，协作者邀请路径排除），经用户更正为本人仓库 `chenxuyaun/intelligent_organization` 后 `remote set-url` 重推——**master 全部 10 条提交推送成功并建立跟踪**（新远程分支）。本地 `baseline-p1-p5` 标签未随推（需要时补 `git push origin baseline-p1-p5`）。提交链现 10 条，工作区干净。

## 2026-11-20：开源化收尾（标签上云 + LICENSE + 全库公开合规审计）

- 用户确认项目为**有意开源**，撤销此前"建议转私有"选项；仓库保持 Public。
- `baseline-p1-p5` 标签推送远程（`ls-remote` 核验 `9861994^{}` 解引用正确）——基线本地+远端双留存。
- 发现并补齐开源合规缺口：仓库根无 LICENSE（保留所有权利状态）→ 新增 **MIT LICENSE**（`2b14a3a`，版权人 chenxuyaun，2026）。
- **全库公开合规审计（七组目录全过，纯只读）**：根文档诚实边界 ✅；①–⑨ 验证等级声明 ✅；operations 手册演练边界 ✅；observations 14 文件——205 处虚构/模拟标注、零 PII/路径/凭证（「真实工单」字样均指实验口径非真实数据；人名陈朋/林可为模拟审核角色）✅；.workbuddy 隐私 ✅；.design 截图（演示模式标注、无密钥值）✅；LICENSE/代码/deploy ✅。
- 提交链终态 **13 条**（`9861994`…`2b14a3a`），本地=origin/master 零偏离（fetch 核验）；工作区干净。剩余可选：Apache-2.0 替换、实例启动只读复查、P6 试点。
- 日志补记上云（`1ddaf74`）后追加两项**匿名公网只读核验**（未登录状态，仓库此前从未验证过公开可见性）：
  - `https://github.com/chenxuyaun/intelligent_organization` 匿名 HTTP 200，页面含 "Sign in … logged out" 头——**仓库公开可见确认**（推送成功≠公开可见，此项此前是假设，现为实测事实）。
  - `https://raw.githubusercontent.com/.../master/LICENSE` 匿名 HTTP 200，正文完整返回 MIT 全文（Copyright (c) 2026 chenxuyaun）——**许可证公开链路可读确认**。
  - 结论：开源化收尾全链路（本地→远程→公网→许可证）闭环，无遗留缺口。
