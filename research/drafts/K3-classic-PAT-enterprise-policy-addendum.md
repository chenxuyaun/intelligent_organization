# K3 后续修订候选 · GitHub Enterprise Cloud 策略层级

状态：已发布 K3 的后续修订候选；尚未写入 4182、未经人工审核、未发布，不代表任何公司内部制度。

## 正文

适用范围：GitHub.com personal access tokens (classic) 的公开规则。实际处理还要看目标组织是否受企业级策略管理。

**classic PAT 默认过期**：GitHub 组织 PAT 政策文档说明，classic PAT 没有必须设置过期时间的要求；创建者仍可为单张 token 选择过期日期。因此“没有强制过期要求”不等于“每张 token 都永不过期”。

**组织级最大期限**：组织 owner 可以为 classic PAT 设置最大有效期，但不能越过企业级上限。如果 token 属于该组织成员且生命周期超过当前组织上限，它会被阻止访问该组织；设置策略本身不会撤销或停用 token。组织级说明说，用户会在调用组织 API 被拒时发现不合规，但没有把某一种恢复步骤规定为所有组织都相同。应核实策略层级、token 类型、所有者/成员关系与具体错误，不要只凭页面显示的到期日下结论。

**企业级策略补充**：GitHub Enterprise Cloud 的企业政策文档对 classic PAT 另有执行细节：期限会在使用 token 或尝试 SSO 授权时检查；错误会提示用户调整期限，超限时会提示生成符合期限要求的新 token。这是企业级策略说明，不应直接套用到仅由组织配置的策略。先确认该组织是否受企业策略及上级限制。

**类型边界**：组织/企业资源下 fine-grained PAT 的默认最大有效期为 366 天；这条规则不适用于 classic PAT。个人 PAT 文档中“expires_in 未提供时默认 30 天”的说明位于 fine-grained PAT URL 模板章节，不能据此推断 classic PAT 的默认期限。

**未使用清理**：GitHub 会因 personal access token 一年未使用而自动撤销/移除它。这是按最近使用时间触发的独立清理，不等同于 token 自设过期日，也不等同于组织阻止该 token 访问组织。页面仍显示未来的过期日，不足以证明 token 仍存在或仍能访问组织；遇到久未使用的 token，应查看其当前状态与最近使用时间，并让组织 owner 核实当前策略。不要在缺少具体错误信息时断言它一定已被清理或一定需要重新生成。

不要在工单中粘贴 token 明文。

## 官方来源

- [组织级 PAT 策略](https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization)
- [GitHub Enterprise Cloud 企业级 PAT 策略](https://docs.github.com/en/enterprise-cloud@latest/admin/enforcing-policies/enforcing-policies-for-your-enterprise/enforcing-policies-for-personal-access-tokens-in-your-enterprise)
- [个人 PAT 类型、创建与未使用清理](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [Token expiration and revocation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation?apiVersion=2022-11-28)

## 建议改动

补充企业级期限策略与组织级策略的执行差异；把“恢复路径没有统一规定”限定到组织级说明，避免暗示所有情形都不需要重新生成 token。加入一年未使用自动撤销/移除的双文档表述，避免将“未到个人过期日”误当成仍存在或仍可访问的证据。此候选未写入已发布 K3，仍需人工审核后才能决定是否替换。

## 审核摘要（2026-11-18）

| 对比项 | 当前已发布 K2/K3 | 此增补候选 |
|---|---|---|
| classic PAT 默认过期与组织最大期限 | 已覆盖 | 保留现有内容 |
| 企业上限与下属组织上限的关系 | 未覆盖；相关问题上模型会说明来源不足 | 明确企业上限优先，组织只能进一步收紧 |
| classic PAT 企业期限执行时点 | 未覆盖；相关问题上模型会说明来源不足 | 补充使用 token 或尝试 SSO 授权时检查 |
| 企业策略不合规提示 | 未覆盖 | 补充错误会提示调整生命周期，并提示生成符合期限的 token |
| token 状态边界 | K2/K3 已说明组织访问可被阻止，但策略本身不撤销/停用 token | 保留并与企业策略条件结合说明 |

这份差异通过了一个未见过的合成问题内存对照：现有卡片的 2 条成功答复都安全地指出企业/组织优先级及检查时点缺少来源；增补版的 2 条成功答复都从 K3 引用企业 60 天高于组织 90 天，并给出 classic PAT 的使用/SSO 检查时点。每个条件还各有 1 次模型超时安全回退，未计入答复判断。完整方法与结果见 [`企业级 PAT 知识迁移小测`](../observations/2026-11-enterprise-policy-transfer-benchmark.md)。

**待人工决定**：将增补作为 K3 新版本送审 / 保持候选不变 / 驳回。模型对照只证明这段公开来源可补足该测试题的知识缺口，不构成发布批准，也不代表任何公司内部制度。

