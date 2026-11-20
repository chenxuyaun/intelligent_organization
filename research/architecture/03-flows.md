# ③ 核心流程图与时序图（Flows & Sequences）

- **日期：** 2026-11-20
- **状态：** 设计稿；每张图标注【现状：已实现 / 本设计：新增 / 两者混合】
- **约定：** 时序图中的参与者均为真实代码模块或明确规划的组件；不虚构不存在的服务。

---

## 流程 1：任务 → AI 建议 → 人工判断 → 执行 → 结果（主闭环）

【现状：已实现（smoke.js 全程验证过【本机】）】

```mermaid
sequenceDiagram
  autonumber
  actor M as 成员（member）
  participant UI as SPA 前端
  participant API as api.js
  participant AG as agent.js（建议域）
  participant RET as searchApprovedMemory（记忆域）
  participant LLM as llm.js → 模型端点
  participant DB as store（SQLite）

  M->>UI: 填写工单（标题/描述/类别/紧急度）
  UI->>API: POST /api/tickets
  API->>DB: createTicket + event(ticket_created)
  M->>UI: 点击「生成建议」
  UI->>API: POST /api/tickets/:id/run
  API->>API: pilotRunGate 六项检查（scope/source_ref/存储确认/脱敏/授权登记/目标匹配）
  alt 任一项未通过
    API-->>UI: 显式错误（无模型调用，速率额度不扣）
  end
  API->>AG: runPair / 组织模式运行
  AG->>RET: searchApprovedMemory(工单, excludeTicketId=自身)
  RET-->>AG: 已发布卡片+已解决案例（scope 匹配，排除驳回/停用/替代/过期）
  AG->>LLM: completeJson(系统提示词 v4.0 + 检索上下文)
  LLM-->>AG: 10 键 JSON
  AG->>AG: 输出硬校验（缺键/类型错误→重试失败即 fallback）
  AG->>DB: createRun（runs + knowledge_uses 命中行 + events agent_run/memory_cited）
  AG-->>UI: 建议（draft_reply/citations/uncertainties/handoff_summary…）
  M->>UI: 审核：采纳 / 编辑后采纳 / 拒绝（+理由+评分）
  UI->>API: POST /api/runs/:id/review
  API->>DB: addReview（最新 id 为权威，历史保留）
  M->>UI: 执行处理（人工对客回复，AI 不参与）→ 记录结果
  UI->>API: PATCH /api/tickets/:id（status/outcome/outcomeNote）
  API->>DB: updateTicket + event(ticket_status/outcome_recorded)
```

**边界声明：** 步骤 10–13 之间，AI 对客回复永远不发生；`draft_reply` 只是建议文本，采纳记录在 reviews，真实回复由成员在工单外完成并回填结果。【现状：代码强制】

---

## 流程 2：交接 / 接收 / 退回 / 升级

【现状：已实现（prepare/accept 路由 + team-learning.js 验证规则）】

```mermaid
sequenceDiagram
  autonumber
  actor A as 处理人 A
  participant API as api.js
  participant DB as store/events
  actor B as 接手人 B

  A->>API: POST /tickets/:id/handoff（to=B, 交接摘要）
  API->>DB: handoffView 校验（指派人/状态未被并发改动）
  API->>DB: event(handoff_prepared, payload{recipient, prepared_event_id})
  B->>API: POST /tickets/:id/handoff/accept
  API->>API: 服务端验证：actor==接收人、时间顺序、prepared_event_id 去重
  alt 校验失败（非本人/重复/已失效）
    API-->>B: 显式拒绝（交接无效，不写事件）
  end
  API->>DB: event(handoff_accepted)
  opt A 或 B 判断超出能力/影响面
    A->>API: PATCH /tickets/:id（status=escalated + 说明）
    API->>DB: event(ticket_status, status_to=escalated)
  end
  opt 接手人发现问题属误派
    B->>API: 重新 handoff（新 prepared 事件）或退回指派（assignee_changed）
  end
```

**有效性规则（防"纸面交接"）：** team-learning.js 只统计同时满足 actor==接收者、acceptedAt ≥ preparedAt、prepared_event_id 未重复的交接；等待时长 = accept − prepare。【现状：代码】

---

## 流程 3：经验草稿 → 审核 → 发布 → 后续检索采用 → 结果反馈

【现状：前半已实现；"结果反馈"环节 = 本设计（R1 主修复）】

```mermaid
flowchart TB
  T1[工单 resolved 且已审运行] --> G1{draft-gate：<br/>最新组织运行 + adopt/edit 人工审核？}
  G1 -->|reject / 未审 / 非人工| X1[拒绝起草]
  G1 -->|通过| DR[draftKnowledgeCard：<br/>正文模板 + draft-lineage 同 scope 谱系]
  DR --> P[卡片 pending + tool_call 事件]
  P --> RV{另一位成员审核<br/>publish / reject / retire / pilot-approve}
  RV -->|publish| PUB[卡片 published（版本+1，<br/>旧卡 superseded_by 指向新卡）]
  RV -->|reject| REJ[rejected：永不进入检索]
  PUB --> S1{下一张工单运行检索}
  S1 -->|scope 匹配 + BM25 ≥ 1.2 + 非自来源| HIT[knowledge_uses 命中行<br/>+ memory_cited 事件]
  S1 -->|不匹配| MISS[不进入上下文]
  HIT -.->|现状止步于此| GAP[缺口：采用/有效未记录]
  GAP -.->|本设计| AD[审核 adopt/edit 时回写 uses.adopted]
  AD --> EF[工单 resolved 后人工标注 helpful / not_helpful]
  EF --> REV[复核视图：连续无效果 → 提示人工复审/停用/替代]
```

**文字说明（适用阶段：试点即生效）**
- 命中/采用/有效三层互不推断：`hit`（进入上下文）≠ `adopted`（权威审核采纳了引用此卡的建议，回写 use 行）≠ `helpful`（成员三态标注确认有帮助）。【已实现 2026-11-20，P2：④§6 的 knowledge_uses 增列方案，smoke 42/0】
- 复核触发是**提示**不是自动动作：停用/替代永远由人工执行（权限阶梯第 4 级）。
- 过期知识（valid_until 过期、fail-closed）不出现在任何检索结果，但保留在库中可审计。【现状：analytics L165】

---

## 流程 4：延迟分层路径（快速路径 / 本地模型 / 主模型 / 人工升级）

【已实现（主模型路径 + 错误规范化）；路由决策与快路径已实现（P4，⑤ 详设，demo 恒 main）；本地小模型暂缓（ADR-5）】

```mermaid
flowchart TB
  IN[POST /tickets/:id/run 通过授权闸门] --> C{routeRequest<br/>（建议域新组件）}
  C -->|kind=分类/提取/去重 且历史命中| F1[快速路径 A：确定性规则<br/>demo-brain 同源逻辑 / 重复工单缓存命中<br/>目标 &lt; 200ms]
  C -->|kind=分类/提取 且规则不确定| F2[快速路径 B：本地小模型<br/>（暂缓：待主路径延迟数据 + ADR-5 评估）]
  C -->|kind=综合建议| M1[主模型路径：llm.js<br/>预算 45s 超时，实际 P95 暂定假设]
  F1 --> V[统一 10 键校验]
  F2 --> V
  M1 --> V
  V -->|失败| FB[live-fallback 显式无回答（零引用）]
  V -->|通过| W[(runs 落库，path 字段记录路径)]
  W --> H{低置信 / 权限不足 / 安全信号 /<br/>escalation_needed=true}
  H -->|是| ESC[人工升级提示：UI 标注 + 事件记录]
  H -->|否| NORM[正常人工审核流程（流程 1 的 10–13 步）]
```

**对比表（决策依据，数字均为暂定假设，无实测；①审计 R2/R3 是动机）：**

| 路径 | 端到端延迟 | 单次成本 | 失败率 | 数据暴露 | 质量 |
|---|---|---|---|---|---|
| 串行（现状） | 模型总时长（实测值待采） | 全额 | 超时即失败 | 全文送远程 | 基准 |
| demo 并行对（现状） | max(两模型) | 2× | 单边失败仍出另一边 | 2× | 对照观察用 |
| 快速路径（规则） | &lt;200ms（暂定） | 0 | 极低 | 不出本地 | 仅限窄任务 |
| 本地小模型（暂缓） | 秒级（暂定） | 低 | 需降级预案 | 不出本地 | 分类/提取可用 |
| 人工升级 | 人工时长 | 0 | 0 | 不出本地 | 最高 |

**规则：** 快速路径的输出与主模型输出**同构同校验**；`runs.path` 记录选择原因；快速路径永不处理 escalation 或涉及授权边界的工单。

---

## 流程 5：模型调用前的数据授权与目标校验（pilotRunGate 时序）

【现状：已实现，api.js pilotRunGate】

```mermaid
sequenceDiagram
  autonumber
  participant UI as SPA 前端
  participant API as api.js
  participant CFG as config.modelStatus()
  participant DB as store
  participant LLM as llm.js

  UI->>API: POST /tickets/:id/run
  API->>DB: 工单是 pilot 范围？
  alt 非试点范围
    API-->>UI: 显式错误（样本数据不送远程模型）
  end
  API->>DB: source_ref 已登记？authorized_by 已确认工作区存储？
  API->>DB: desensitization ∈ {done, not_needed}？
  API->>DB: model_authorized_by 已由 admin 登记？
  API->>CFG: 当前活跃模型 base_url + model
  API->>API: 工单授权快照（model_authorized_base_url/model）<br/>与当前活跃配置逐字符匹配（尾斜杠归一）
  alt 目标已更换而未重新授权
    API-->>UI: 错误：授权目标与当前模型配置不一致，需管理员重新确认
  end
  API->>API: 滚动 1 小时计数 < MODEL_MAX_CALLS_PER_HOUR？
  alt 超限
    API-->>UI: 429（不发生模型调用）
  end
  API->>LLM: 放行，发起 chat/completions
  LLM-->>DB: 运行记录 model/base_url 快照落库
```

**关键不变量：** 「存储授权」与「发送授权」是两次独立确认（工单上分别有 authorized_by 与 model_authorized_by 字段）；换模型端点 = 全部旧授权失效，必须重新人工确认。【现状：代码 + 迁移列】

---

## 流程 6：模型或数据库失败时的用户可见行为

【现状：模型失败路径已实现；数据库失败语义 = 本设计明确化】

```mermaid
sequenceDiagram
  autonumber
  participant UI as SPA 前端
  participant API as api.js
  participant LLM as llm.js
  participant DB as SQLite

  UI->>API: POST /tickets/:id/run
  API->>LLM: completeJson
  alt 模型超时（AbortController 45s）
    LLM-->>API: ModelUnavailableError('模型响应超时…')
  else 连接失败/HTTP 非 200
    LLM-->>API: ModelUnavailableError（不回显提供商错误正文）
  else 输出结构非法
    API-->>UI: 校验失败 → 重试预算内失败（agent.js 输出硬校验）
  end
  API-->>UI: live-fallback 显式无回答：<br/>「本次未能生成建议（原因）」，零引用、不冒充内容
  API->>DB: 运行记录照常落库（origin 标记失败，不写 knowledge_uses）
  Note over UI: 用户永远看到失败原因与可重试操作；<br/>工单流程不阻塞（人工路径照常）

  UI->>API: 任意写请求
  alt 数据库损坏/磁盘满
    API-->>UI: 503 + 「数据库暂不可用，请勿重复提交」<br/>（已实现 2026-11-20 P1：SQLite 错误 → 503 固定文案）
    Note over API: 健康检查 /api/ready 转 503，<br/>compose 自动重启，数据由 WAL 恢复
  end
```

**边界声明：** 模型失败时**绝不降级为演示生成器**（product 模式无 demo 回退，config.modelStatus 明文）；demo-brain 只属于 demo 模式。数据库失败时模型调用自然失败（无写库即无记录），不产生"看不到结果但模型已扣费"的静默损失——运行记录与模型调用在同一请求内完成，失败则两者都不可见。【现状代码 + 本设计错误码规范】

---

## 流程 7（补充）：知识卡片版本替代

【现状：已实现（store.js L421–575 createCardRevision/setSupersededBy）】

```mermaid
flowchart LR
  A[published 卡 K3] -->|人工发起 revision-draft| B[新草稿 pending<br/>supersedes_card_id=K3, 版本+1]
  B -->|审核 publish| C[K3 → superseded_by=新卡<br/>检索立即排除 K3，指向新卡]
  B -->|审核 reject| D[新草稿 rejected；K3 继续生效]
  C --> E[旧版全文保留可审计，不删除]
```

**文字说明：** 替代是"指针翻转"而非删除：旧卡状态变 superseded、superseded_by_card_id 指向新卡，检索条件 `status='published' AND superseded_by_card_id IS NULL` 自动排除；全部历史版本与 card_reviews 保留。【现状：代码】

---

## 流程 8（补充）：AI actor 写请求的服务端断言（已实现，P1）

【已实现 2026-11-20：把权限阶梯从约定升级为代码——分发层 x-actor 头 + PATCH body.actor 双拦截，smoke 断言「AI 身份写请求被拒（403）」通过】

```mermaid
flowchart LR
  REQ[任意写请求 POST/PATCH] --> AUTH{认证+CSRF+角色}
  AUTH -->|通过| ACT{actor 是 agent:*？}
  ACT -->|是| DENY[403：AI 无执行/组织状态写权<br/>+ 审计事件记录尝试]
  ACT -->|否| WRITE[业务域写入]
```

**文字说明：** 现状 AI 只通过内部函数（agent.js 直接调 store）写 runs/events，不经过 HTTP；该断言保证未来任何误配置（如把模型响应直通某写路由）会在分发层被拦截并留下审计痕迹。**已实现（2026-11-20，P1）：api.js 分发层 x-actor 头检查 + PATCH body.actor 拦截 + `agent_write_rejected` 审计事件；smoke 断言「AI 身份写请求被拒（403）」通过（42/0）。**

---

## 流程 9（执行域）：自然语言目标 → 周报草稿（⑨§6.1，P7 启用）

```mermaid
sequenceDiagram
  participant M as 成员
  participant UI as SPA 前端
  participant API as 服务端
  participant CONN as 只读连接器（docs_readonly）

  M->>UI: 「整理本周项目进展，写一份周报」
  UI->>API: 创建 objective 工作项 + 运行
  API->>API: 目标解析（结构化抽取草稿：预期结果/范围/对象）
  API-->>UI: 解析草稿 → 用户确认/修正
  API->>CONN: 读取授权范围数据（只读 scope，内容标注来源）
  API->>API: 生成周报草稿（事实/总结/推断分层，缺失标待补充）
  API-->>UI: 可编辑草稿 + 每个事实的来源引用
  M->>UI: 确认/修改后定稿
  API-->>M: 写入工作项历史（若外发 → 走流程 10 审批链）
```

## 流程 10（执行域）：邮件草稿 → 人工审批 → 连接器发送 → 结果记录（⑨§6.2，P7 启用）

```mermaid
sequenceDiagram
  participant M as 有权限的审批人
  participant UI as SPA 前端
  participant API as 服务端
  participant CONN as 邮件连接器
  participant DB as external_actions + events

  API->>DB: external_action(prepared, payload_hash, 幂等键)
  M->>UI: 预览全部外发内容（收件人/正文/附件）并批准
  UI->>API: POST 批准（绑定 payload_hash）
  API->>API: 重验：身份/权限/哈希一致/连接器健康
  alt 重验通过
    API->>CONN: 执行发送（幂等键随附）
    CONN-->>API: succeeded + message_id
    API->>DB: status=succeeded，事件含操作者=批准人
  else 超时且无法确认
    API->>DB: status=outcome_uncertain（禁止自动重试）
    API-->>UI: 明示「结果待确认，请勿重复发送」
    M->>API: 人工核实后标记 succeeded/终止（留核实记录）
  else 重验失败（内容被改/权限变化）
    API->>DB: status=cancelled（审批失效，重新起草）
  end
```

---

## 附：流程与总纲映射

| 总纲§十一.3 要求 | 本文档流程 |
|---|---|
| 用户请求→Agent 规划→读取授权资料→起草周报 | 流程 9 |
| 邮件草稿→人工审批→连接器发送→记录结果 | 流程 10 |
| 组织知识审核→后续任务复用→结果反馈 | 流程 3 |
| 模型/连接器/队列失败时的恢复与人工接管 | 流程 6（模型/库）+ 流程 10 的 outcome_uncertain 分支（连接器）+ ⑨§7（断连/取消） |
