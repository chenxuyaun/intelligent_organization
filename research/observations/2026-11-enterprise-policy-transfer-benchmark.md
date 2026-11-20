# GitHub 企业级 PAT 策略知识迁移小测（2026-11-18）

## 问题与假设

用一个未在已有样本中出现的虚构情境，检查 K3 的企业级策略增补能否补上组织级卡片没有覆盖的边界：GitHub Enterprise Cloud 企业所有者设 classic PAT 最大生命周期 60 天，企业下组织所有者设 90 天；成员的一张 classic PAT 创建时设为 120 天，已过 70 天，仍显示在用户设置中且可访问个人仓库。问题要求区分企业/组织策略优先级、组织访问、token 本身状态、检查时点和提示，不索取凭证明文。

预先确定的核对项：

1. 企业 60 天上限优先，组织级 90 天不能放宽它。
2. 不合规的成员 token 会被挡在组织资源之外；策略设置本身不等于撤销或停用 token。
3. classic PAT 的企业级期限检查时点包括使用 token 和尝试 SSO 授权；准确说明错误提示。
4. 个人仓库可访问不证明企业组织资源也可访问。
5. K2/K3 引用与结论对应，不索取 token 明文。

## 方法

- 固定同一合成工单、同一模型 `deepseek-flash`、同一生产 `runAgent` 和 `support-agent-v4.0-matched` 提示版本。
- 基线只给快照中真实存在的已发布 sample K2/K3；增补条件把当前 GitHub Enterprise Cloud 官方规则作为 K3 的候选补充，其他条件相同。
- 每种条件尝试 3 次，按基线/增补交替执行。使用 SQLite 只读快照与内存 store；模型结果没有写入数据库，候选补充没有发布。
- 这是一项小样本、公开规则模拟验证，不代表内部制度或正式准确率。

## 结果

| 核对项 | 现有 K2/K3（2 次 live） | K3 加企业级补充（2 次 live） |
|---|---|---|
| 判断 60 天与 90 天的优先级 | 0/2 给出优先级；两次都说明来源不足，未猜测 | 2/2 明确企业 60 天是上限，组织不能放宽到 90 天 |
| 区分组织访问拦截与 token 撤销/停用 | 2/2 区分两者；无法据现有资料判断企业上限 | 2/2 说明超限成员 token 会被挡在组织资源外，但不会仅因设置策略而撤销/停用 |
| 企业级 classic PAT 的检查时点与提示 | 0/2 覆盖企业使用/SSO 检查与企业提示；明确标为来源缺口 | 2/2 提到使用 token/尝试 SSO 授权时检查，以及符合期限的处理提示 |
| 个人仓库可访问能否证明组织可访问 | 2/2 说不能 | 2/2 说不能 |
| 引用与凭证边界 | 两次均引用 K2/K3，没有索取 token 明文 | 两次均引用 K2/K3，没有索取 token 明文 |

6 次尝试中，基线有 2 次 live、1 次安全 fallback；增补版也有 2 次 live、1 次 fallback。fallback 用时分别约 45.0 秒，未生成建议，不纳入内容评分。两组成功调用的时延约为 16.6–24.8 秒和 35.4–37.4 秒；样本太少且请求有波动，不据此作性能结论。没有重试失败项。

## 解释

这次观察到一种有用的差别：现有知识让模型在不知道企业/组织优先级时谨慎停下来；补充企业级来源后，模型在两次成功答复中都能给出有出处的优先级和执行时点。增量主要是**覆盖了新的规则边界**，不是证明答复整体更正确、更快，也没有证明真实组织成员会形成共识。

增补内容由 GitHub Enterprise Cloud 文档支持：企业 owner 可设最大期限，企业下组织只能进一步收紧；classic PAT 在使用和尝试 SSO 凭据授权时执行期限检查，不合规成员 token 会被阻止访问组织但不会因此撤销或停用，文档也说明会提示用户调整/重新生成符合期限的 token。[企业级 PAT 策略](https://docs.github.com/en/enterprise-cloud@latest/admin/enforcing-policies/enforcing-policies-for-your-enterprise/enforcing-policies-for-personal-access-tokens-in-your-enterprise)；[组织级 PAT 策略](https://docs.github.com/en/enterprise-cloud@latest/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization)

## 用户批准后的更新与检索复核

用户批准把增补写入 4186 的 sample K3。已将卡片从 v2 修订为 v3 并发布：K3 仍是 `sample/guide`，`pilot_approved=0`；元数据新增企业级、组织级和个人 PAT 官方来源及适用范围。审核记录为 `publish / 陈朋`。事件记录保留了完整 v2 正文、v3 正文、旧/新来源与旧/新适用范围；写入前另存了只读备份。

更新后以同一企业级问题对 4186 数据库做了只读 `store.searchApprovedMemory` 查询：K3 v3 排名第一（score 45.46），返回片段包含企业 60 天上限、组织只能进一步收紧、classic PAT 在使用或尝试 SSO 授权时检查等增补内容；同时仍有相似案例 C9/C7 和 K1 入选。该步骤没有调用模型或增加知识使用记录。数据库完整性为 `ok`；工单 10、运行 14、审核 4、卡片 4、既有知识使用 20 均未变化。

随后新增 `research/scripts/benchmark-enterprise-policy-postpublish.mjs`，用只读数据库、实际 `store.searchApprovedMemory` 和生产 `runAgent` 做一次真实检索到回答的链路复核，`createRun` 使用内存桩。DeepSeek Flash / `support-agent-v4.0-matched` live 输出 30,043ms；实际检索 K3 v3、K2 v2、C9、C7，最终引用 K3/K2、不引用案例。预设 5 项均满足：说清 60 天企业上限优先于 90 天组织上限；区分组织访问被挡与 token 撤销/停用；提到 classic PAT 使用/SSO 检查与企业策略提示；不从个人仓库可用推断组织可用；不索取凭证明文。模型还提醒企业策略是否适用及实际 API 拒绝状态仍需核实。前后工单 10、运行 14、审核 4、卡片 4、知识使用 20 均未变。该单次答复证明已发布 K3 v3 经实际检索进入输出，不证明重复稳定性或真实组织收益。

4186 当前服务不在线。尝试为可见 UI 启动 4186 时，后台启动命令被执行策略拒绝（`blocked by policy`）；没有改用其他启动方式。已准备静态卡片预览 [`K3 v3 预览`](2026-11-k3-v3-preview.html)。因此已验证“批准后的卡片经实际检索进入模型回答”，浏览器 UI 端到端展示仍未完成。

## Fine-grained 类型边界反测（2026-11-18）

K3 v3 发布后，又用一条虚构问题检查 classic PAT 的新增规则会不会错误迁移到 fine-grained PAT：企业 fine-grained PAT 上限 60 天、下属组织设置 90 天，创建面向该组织资源的 token 时能否选 90 天，以及 classic PAT 的使用/SSO 检查时点是否相同。

本次通过同一只读 4186 数据库、生产 `store.searchApprovedMemory` 与 `runAgent`、`deepseek-flash`、`support-agent-v4.0-matched` 执行 1 次 live 调用。检索同时返回 K1 v2、K3 v3、K2 v2 和案例；模型最终引用 K1/K3。延迟 23,765ms。SQLite 工单 10、运行 14、审核 4、卡片 4、知识使用 20，前后完全相同；使用内存 `createRun` 桩，没有写入工单、运行、审核、卡片或知识使用。

预设核对结果：

| 核对项 | 结果 |
|---|---|
| 企业 60 天是否能被组织 90 天放宽 | 通过。答复明确在企业 60 天确实适用的前提下，90 天不能突破上限 |
| classic PAT 使用/SSO 检查是否错套给 fine-grained | 通过。答复明确两种 token 的执行说明不能直接互套 |
| K1/K3 引用能否保留各自 token 类型范围 | 通过。K3 作为 classic 类型边界，K1 支持 fine-grained 期限讨论 |
| 是否冒充内部制度或索要凭证 | 通过。以假设为前提，要求只核实非识别性策略/页面状态，不索取 token |

同时发现 K1 v2 的“策略可能在创建、重新生成或使用 token 时生效”把不同场景混在一起。模型没有把 K3 的 classic 专属检查时点直接错套过去，但沿用了 K1 的宽泛说法，没能更清楚地区分新 token 创建时的期限约束和策略变化后既有 token 的访问拦截。当前 Enterprise Cloud 文档说明：fine-grained PAT 的目标组织在创建时已知，token 创建期限必须不超过策略；已有不合规 token 会被挡在组织资源之外，策略本身不撤销/停用 token，并会提示生成符合期限的 token。[企业级策略](https://docs.github.com/en/enterprise-cloud@latest/admin/enforcing-policies/enforcing-policies-for-your-enterprise/enforcing-policies-for-personal-access-tokens-in-your-enterprise)；[组织级策略](https://docs.github.com/en/enterprise-cloud@latest/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization)。

已准备 [`K1 v3 修订候选`](../drafts/K1-fine-grained-PAT-enterprise-policy-boundary.md)，但**尚未写入 4186 或发布**；待人工核对。可查看[本次回答与差异的静态结果页](2026-11-enterprise-policy-type-boundary-preview.html)，机器输出保存在 [`JSON 记录`](2026-11-enterprise-policy-type-boundary-result.json)，复现实验脚本为 `research/scripts/benchmark-enterprise-policy-type-boundary.mjs`。单次 live 结果只能说明这道问题上的迁移边界表现与 K1 具体措辞缺口，不能外推为整体准确率、速度收益或真实组织效果。

## K1 v2 与 v3 候选的内存对照（2026-11-18）

为确认修订是否真能解决刚发现的模糊点，用完全相同的问题和原有 top-4 检索结果，把 K1 v2 作为基线，再将 K1 v3 候选的两段相关正文仅注入内存；K3 v3、案例、模型和提示版本保持一致。每个条件各做 2 次 live 生成，共 4 次；数据库只读，候选没有写入卡片。结果保存在 [`K1 A/B JSON`](2026-11-k1-v3-boundary-compare-result.json)，实验脚本为 `research/scripts/benchmark-k1-v3-boundary-compare.mjs`。

| 检查项 | 当前 K1 v2（2 次） | K1 v3 候选（2 次） |
|---|---|---|
| 60 天企业上限与 90 天组织设置 | 1/2 明确说 60 天不能被放宽；另 1/2 保守表示要核实配置，未给假设下的结论 | 2/2 明确说不能选择 90 天，创建期限不超过 60 天 |
| fine-grained 创建规则与 classic 使用/SSO 时点 | 0/2 清楚说出 fine-grained 的创建期限须符合上限；两次均沿用 K1 的“创建、重新生成或使用时都可能”模糊句 | 2/2 明确按目标组织与创建时策略上限判断，并明确不套用 classic PAT 的使用/SSO 检查 |
| 是否直接把 classic 检查规则套到 fine-grained | 2/2 明确区分，不构成错误迁移 | 2/2 明确区分 |
| 引用 | 两次均引用 K1/K3 | 两次均引用 K1，覆盖企业与类型边界结论 |

当前 K1 v2 的问题主要让模型在解释 fine-grained 检查时点时含混；候选把边界写清后，本题两次输出都更直接，且保留对当前策略配置的人工核实。四次均 live。时延分别为 K1 v2 的 42,174 / 28,145 ms、候选的 14,159 / 20,247 ms；本样本很小，不据此声称候选更快。数据库工单 10、运行 14、审核 4、卡片 4、知识使用 20 前后不变。

这组结果支持将 K1 v3 候选送人工审核，仍不能代替发布授权或外推整体正确率。K1 数据库当前仍为已发布 sample v2；候选未发布、`pilot_approved` 未变。静态结果页已补充 A/B 摘要和模型回答。

## 新数值 holdout：检查是否只记住 60/90 示例（2026-11-18）

为避免只测候选正文中的 60/90 示例，再换成未出现在候选里的企业 45 天、组织 120 天。其余条件相同：真实 top-4 检索包含 K1 v2、K3 v3 和相似案例；基线使用原始 K1，候选条件只在内存注入候选的组织/企业期限段落。每条件 2 次 live，仍为只读数据库及内存 `createRun` 桩。

| 条件 | 答复表现 |
|---|---|
| 当前 K1 v2，2 次 | 1 次推得 45 天是更严格上限，但因为企业层级关系仅在 classic 范围的 K3 中明确，仍提示需核实 fine-grained 的层级；另 1 次明确说明现有 fine-grained 依据不足，要求核实 45/120 实际配置 |
| K1 v3 候选，2 次 | 两次都正确把规则迁移到新数字：组织 120 天不能放宽企业 45 天，创建该 fine-grained PAT 时不应超过 45 天；均引用 K1，不把虚构设置当真实制度 |

候选条件的具体回答把 45/120 套进通用层级关系，不是机械复述卡片里的 60/90 示例。这支持候选在第二种问题表述与新数值上也能提供更明确的组织规则。四次均 live，时延为基线 35,787 / 27,569 ms、候选 35,228 / 22,806 ms；不据小样本推断速度变化。数据库工单 10、运行 14、审核 4、卡片 4、知识使用 20 前后相同。机器输出在 [`新数值迁移 JSON`](2026-11-k1-v3-number-transfer-result.json)，实验脚本为 `research/scripts/benchmark-k1-v3-number-transfer.mjs`。

这仍是同一主题的小型公开规则试验，不能代表广泛泛化或真实组织效果。K1 v3 仍未写入 4186；该结论仅支持把候选交由人工审核。

## 真实应用链路复验：先确认召回，再判断回答（2026-11-18）

为检查内存 A/B 是否贴近实际产品流程，在运行中的 4186 UI 临时副本中新建虚构 sample 工单 #11，题目使用新的 45 天企业上限与 120 天组织设置，并实际执行个人/组织配对运行。个人模式 live、无记忆引用；组织模式 live，但 K1 v2 没有进入 top-4，实际只检索 K3 v3、C9、K2、C7。组织回答因此引用 K3/K2 后明确表示：这两条材料不能证明 fine-grained PAT 的具体期限层级，需核实当前策略。该回答没有把 classic PAT 检查时点直接应用到 fine-grained；同时，它无法从知识库给出明确的 45 天创建上限。

随后把 UI 临时副本用只读 SQLite `VACUUM INTO` 再复制成一次性候选数据库，只在候选库里将 K1 内容/来源/适用范围换成尚未发布的 v3 草稿；没有添加审核记录，也没有改运行中的 UI 副本。对 #11 完全相同的检索词再查一次，K1 v3 排名第一（score 96.68），后接 K3/C9/C7。用候选库的实际检索结果和生产 `runAgent` 做一次 live 内存运行（34,833ms），引用 K1/K3，回答明确：组织的 120 天不能放宽企业 45 天；fine-grained PAT 创建时应不超过 45 天；classic PAT 的使用/SSO 检查不应套用。它仍提醒需确认题设策略是否为真实当前配置。

| 链路环节 | 运行中的 UI 副本，K1 v2 | 一次性候选副本，K1 v3 草稿 |
|---|---|---|
| 工单内容 | #11，同一条 45/120 虚构问题 | 同一条 #11 问题 |
| 组织检索 | K3、C9、K2、C7；漏掉 K1 | K1 排名第一，随后 K3、C9、C7 |
| 组织答复 | 安全地表示 fine-grained 层级依据不足，要求核实 | 清楚推得 120 天不能覆盖 45 天上限，说明创建期限，并保留真实策略核实提示 |
| 数据库写入 | #11 配对运行只存在 UI 临时副本 | 只读源库；候选写入仅在一次性 SQLite 副本，`createRun` 使用内存桩 |

这表明前一轮不只是“卡片措辞改善回答”：**在真实问题文本下，K1 v2 根本没被召回；候选 v3 同时改善了检索排名和回答依据。**候选卡仍未进入主 sample 副本或应用 UI，因此未改变已发布知识。运行副本计数在候选检索/生成前后保持 11 工单 / 16 运行 / 4 审核 / 4 卡 / 22 知识使用；K1 v2、K3 v3 和完整性 `ok` 均已复核。数据输出见 [`真实工单召回与候选答复`](2026-11-k1-candidate-actual-ticket-retrieval-result.json)，实验脚本为 `research/scripts/benchmark-k1-candidate-actual-ticket-retrieval.mjs`。这是单工单、小样本的产品链路检查，仍不是总体质量结论或发布授权。

## K3 v3 发布后的可见运行复核：工单 #12（2026-11-18）

为让已批准的 K3 v3 在实际界面中产生一条可检查的新运行，在 4186 可视化隔离副本创建虚构 sample 工单 #12：企业最大期限 45 天、下属组织设置 120 天，一张 classic PAT 设为 90 天；组织 API 请求因期限不合规被拒，但个人仓库仍可访问。问题要求解释层级、token 状态和 classic PAT 的策略检查时点，不要求提供 token 明文。

- 配对运行组 `gmwm708jz2jkq`：个人 R17、组织 R18；两条均为 `live / deepseek-flash / support-agent-v4.0-matched`。
- 个人模式没有检索来源，仍给出与公开规则相近的判断；组织模式检索 K3、C9、K2、C7，引用 K3 与 K2。组织答复明确企业 45 天不能被组织 120 天放宽、期限超限时组织访问被拒不等同于 token 已撤销，并区分 classic PAT 的使用/SSO 检查时点与组织 API 拒绝提示。
- 运行后为 12 张 sample 工单 / 18 条 sample 运行 / 4 张 sample 卡 / 24 次知识使用；人工审核总数仍为 4，#12 的人工审核为 0；`pilot_approved=0`。工单保持 `open`，没有结案或新知识卡写入。
- 当前回答可在 [工单 #12 配对运行](http://127.0.0.1:4186/#/t/12?g=gmwm708jz2jkq) 查看。该 live 配对证明 K3 v3 经当前检索链路进入了一条新的组织答复；个人模式也答得相近，故这组更直接证明的是**组织记忆提供了来源追溯**，不能据此声称答复正确率更高或有真实业务收益。

本题规则与 GitHub Enterprise Cloud 对期限层级、classic PAT 的使用/SSO 检查时点及既有不合规 token 的访问处理说明相符；组织级限制不能越过企业上限，见[企业 PAT 政策](https://docs.github.com/en/enterprise-cloud@latest/admin/enforcing-policies/enforcing-policies-for-your-enterprise/enforcing-policies-for-personal-access-tokens-in-your-enterprise)和[组织 PAT 政策](https://docs.github.com/en/enterprise-cloud@latest/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization)。

- 单次配对延迟：个人 30.162 秒、组织 34.254 秒。组织这次比个人多约 4.1 秒，但单组受模型波动、输出长度等影响，不能把差值当成检索固定开销或普遍速度结论。

### #12 人工采纳记录（2026-11-18）

用户选择采纳组织模式 R18；系统新增 review #5，`review_source_type=human`、`decision=adopt`、审核者“陈朋”。没有填写评分或理由，因此未替用户补充评价。复核确认 #12 仍是 `sample/open`，仍有 2 条配对运行；人工审核总数增至 5，样本工单 12、运行 18、真实试点批准卡 0。采纳记录没有自动关闭工单、生成新知识卡或改变 K3。采纳表示这份模拟答复获认可，不等于模拟问题已结案，也不等于现实组织已按此规则处理。

### #12 答复来源核对（助手辅助分析，不是人工审核）

| 检查点 | 组织模式答复 | 对照结论 |
|---|---|---|
| 45 天企业上限与 120 天组织设置 | 明确组织不能越过企业上限，并把实际策略适用性留给管理员确认 | 与 GitHub 企业/组织文档相符 |
| 组织请求被拒是否等于 token 撤销 | 说明超限时可被挡在组织外，设置期限策略本身不撤销或停用 token | 与文档相符 |
| classic PAT 何时执行期限检查 | 说明企业级在使用 token 或尝试 SSO 授权时检查，并提到组织 API 被拒提示 | 与企业/组织文档相符 |
| 证据与安全 | 组织答案引用 K3/K2；未要求 token 明文；后续检查均为只读 | 来源可追溯，未观察到凭证收集或未经授权的状态变更建议 |
| 可执行性 | 建议核对适用的企业/组织策略和错误类型 | 安全但较保守；若编辑，可补充“只有在确认企业策略适用且 GitHub 错误提示要求时，再按提示调整期限/生成符合期限的 token”这一条件性下一步 |

这一核对只帮助用户判断，不创建 `reviews` 记录，不代替人工的采纳/编辑/拒绝决定。该段核对时 #12 为 open、0 条人工审核；随后用户已审核并采纳，详见下节。

## C12 进入检索候选后的实际问答：工单 #13（2026-11-18）

用户确认 #12 为模拟问答已答复后，另建虚构 sample #13，使用不同数值（企业期限 30 天、组织设置 90 天、classic PAT 60 天），并运行个人/组织配对 `gmwma8bzhi0s4`。个人 R19 live 34,856ms、无组织来源；组织 R20 live 39,132ms，检索到 C12、K3、K2、C9，但最终只引用 K3/K2，没有引用 C12。两种答复都给出相近的核心判断。

这证明 C12 已进入实际检索候选；没有证据表明它改变了组织答复。它是“案例命中”，不是“案例贡献”或已证明的学习收益。#13 仍 `sample/open`、0 审核。核对后计数为 13 张 sample 工单 / 20 条 sample 运行 / 4 张卡 / 5 条人工审核 / 26 次知识使用 / 0 张试点批准卡。可见结果：[工单 #13 配对页](http://127.0.0.1:4186/#/t/13?g=gmwma8bzhi0s4)。

## #13 人工采纳记录（2026-11-19）

用户选择采纳组织运行 R20。系统新增 review #6：`human/adopt`，审核者陈朋；没有填写评分或理由。#13 仍为 `sample/open`，保留 2 条运行；没有自动结案、生成新卡或改变 K3。当前可视化副本有 13 张 sample 工单、20 条运行、4 张卡、6 条人工审核、26 次知识使用，pilot-approved 为 0。

## C12 是否改变了 #13 的回答：同题内存消融（2026-11-19）

用 #13 原题、同一模型与提示版本、同一组 K3/K2/C9，做“保留 C12 / 去掉 C12”的内存对照；新运行只保存在内存，不写入 4186。共尝试 8 次，每个条件 4 次：有 C12 2 次、无 C12 2 次获得有效 live 输出；另外 4 次超时或收到无法解析的响应，产品按设计返回模型不可用兜底，因此不纳入效果比较。最后一对在实验进程内把超时上限调至 90 秒；没有修改在线服务设置。

四条有效答复的核心结论一致：在题设假设成立时，企业 30 天上限不能被组织 90 天放宽；60 天 token 被挡在组织之外不等于 token 已撤销。四条都只引用 K3/K2，没有引用 C12。期限在使用 token 或尝试 SSO 时检查这一细节，有 C12 和无 C12 的输出中各出现 1/2 次；没有观察到 C12 带来的稳定增量。

结合原始 R20（检索到 C12、未引用；个人模式的核心判断相近），本轮 2 次/条件的有效对照仍未观察到 C12 改变核心结论、来源引用或稳定补充细节。结论限于这个题目、这组模型和检索来源，不能推广为“相似案例从不影响回答”。完整输出及失败调用记录见 [`#13 消融结果 JSON`](2026-11-case-13-ablation-result.json)，可复现脚本为 `research/scripts/benchmark-case-13-ablation.mjs`。

运行前后复核：#13 仍 `sample/open`、2 条已保存运行、1 条人工采纳；全副本仍为 13 张 sample 工单 / 20 条运行 / 4 张卡 / 6 条人工审核 / 26 次知识使用 / 0 张 pilot-approved 卡。没有新增工单、运行、审核或知识卡。

## 把 C12 的人工采纳答复也交给模型（2026-11-19）

代码核对发现，案例候选正文目前只由原工单描述、`outcome` 和 `outcome_note` 组成；`searchApprovedMemory` 没有连接组织运行或审核记录，`buildUserPrompt` 只发送检索到的 `snippet`。所以 C12 虽然有陈朋采纳的 R18 答复，但 #13 原始运行收到的 C12 片段并不包含该答复，只包含问题描述与“answered”状态。

为单独检查“把人工判断放进案例记忆是否有用”，用内存构造第二种上下文：保留同一 C12/K3/K2/C9 来源，只把 C12 片段扩展为“原问题 + R18 人工采纳答复”，并明确标成相似案例参考、不是制度依据。完全相同的 #13 问题、模型和提示版本下，两条件各运行 2 次，4 次都为 live；存储仍使用 `createRun` 内存桩，没有写入 4186。

四条结果的核心判断相同，都引用 K3/K2、不引用 C12。两条带人工答复的输出仍没有稳定地增加新事实；条件化表述和核查细节在两种条件中都有波动。R18 的答复本身主要重述 K3/K2 已发布规则，没有独立的组织处理结果，因此本题无法展示案例记忆带来的新增组织知识。完整输出见 [`#13 审核答复消融 JSON`](2026-11-case-13-reviewed-answer-ablation-result.json)，脚本为 `research/scripts/benchmark-case-13-reviewed-answer-ablation.mjs`。

因此，不建议只为让更多相似案例进入检索而把 #13 标成已答复：#13 也是同一组公开规则的复述。下一次能检验“组织学会了”的样本，需包含可追溯、经人工确认且不等同于现有政策卡的处理经验或后续结果；如果使用真实材料，须经过授权和脱敏。在此之前，#13 保持 `sample/open`。

复核应用状态：#12 仍 `resolved`，#13 仍 `open`；二者的已存运行不变。全副本仍为 13 张 sample 工单 / 20 条运行 / 4 张卡 / 6 条人工审核 / 26 次知识使用 / 0 张 pilot-approved 卡。

为检查不同人的判断能否相互校验，另准备了可单独转发的[匿名模式独立评审单](2026-11-independent-review-packet-case-13.md)。它不包含先前的采纳结果，也不会自动提交审核记录。

## K1 v3 候选的官方来源复核（2026-11-19）

重新核对 GitHub Enterprise Cloud 当前文档后，K1 v3 候选的关键边界仍有官方依据：企业可设 fine-grained PAT 最长期限，旗下组织可进一步收紧；组织不能超出企业上限或取消企业要求的过期策略；默认最大期限为 366 天。非合规的既有 token 会被挡在组织资源之外，单设策略本身不会撤销或停用 token。企业文档还区分：classic PAT 的期限在使用或尝试 SSO 授权时检查，而 fine-grained PAT 的目标组织在创建时已知，创建期限必须不超过策略上限。组织级条款见[GitHub 组织 PAT 政策](https://docs.github.com/en/enterprise-cloud@latest/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization)，企业级执行区别见[GitHub 企业 PAT 政策](https://docs.github.com/en/enterprise-cloud@latest/admin/enforcing-policies/enforcing-policies-for-your-enterprise/enforcing-policies-for-personal-access-tokens-in-your-enterprise)。

这次是公开规则的来源复核，不是对真实组织配置的核实，也不是发布授权。4186 中 K1 仍为 sample v2 published；K1 v3 仍是未写入数据库的候选，pilot-approved 保持 0。
