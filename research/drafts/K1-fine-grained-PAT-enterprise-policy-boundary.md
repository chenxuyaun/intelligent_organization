# K1 v3 修订候选 · fine-grained PAT 企业/组织期限边界

状态：待人工审核；尚未写入 4186，也未发布。只总结 GitHub 公开规则，不代表公司内部制度。

## 为什么提出修订

K3 v3 已发布后，用一条 fine-grained PAT 负向迁移问题做复测。模型没有把 K3 的 classic PAT“使用/尝试 SSO 授权时检查”规则套给 fine-grained PAT，但按当前 K1 的“策略可能在创建、重新生成或使用 token 时生效”措辞，回答仍把 fine-grained 的执行时点说得过宽。GitHub Enterprise Cloud 当前文档区分两种 token：fine-grained PAT 的目标组织在创建时已知；classic PAT 才有使用 token/尝试 SSO 授权时检查的特定说明。

## 建议替换为以下正文

**适用范围：** GitHub.com fine-grained personal access token (PAT) 的公开期限规则。个人资源与组织/企业资源分开判断；实际有效上限取决于目标资源 owner 的现行设置。

**个人资源：** 可以创建无过期时间的 fine-grained PAT；仍需遵守账户和 GitHub 的当前限制。

**组织/企业资源：** 组织和企业的 fine-grained PAT 默认最大有效期为 366 天。企业 owner 可以设置最大期限；企业旗下组织可以进一步收紧，但不能超过企业上限，也不能取消企业要求的过期策略。若企业上限为 60 天、组织设置为 90 天，组织的 90 天不能放宽企业上限；创建面向该组织资源的 token 时，应选择不超过实际生效上限的期限。GitHub 文档说明，fine-grained PAT 的目标组织在创建时已知，并要求 token 的创建期限不超过策略上限。

**已有 token：** 如果之后设定的策略使成员现有 token 的期限不合规，该 token 会被阻止访问组织资源，但策略设置本身不会撤销或停用 token。GitHub 文档说明，不合规 token 会提示用户生成符合期限的 token。具体当前状态需通过只读页面状态或非敏感错误提示核实；不要仅凭列表中仍显示 token，就推断它还能访问组织。

**类型边界：** GitHub 对 classic PAT 的企业期限规则另有说明：期限在使用 token 或尝试 SSO 授权时检查。不要把这个 classic PAT 检查时点套给 fine-grained PAT。fine-grained PAT 应依据目标组织、企业上限及其创建时的策略校验来判断；如需讨论已有 token，再单独区分策略变更后的访问拦截与 token 本身是否被撤销。

**历史规则：** 2022 public beta 阶段要求 fine-grained PAT 设置期限，属于历史规则，不应直接套用到当前版本。URL 模板中未填写 `expires_in` 时的默认值只说明该模板参数的默认行为，不应泛化成所有 fine-grained PAT 的统一默认过期规则。

不要把 GitHub 公开规则表述为任何公司的内部制度；不要索取 token 明文、token 名称/ID、scope 清单或组织名称。

## 建议保留的卡片元数据

- 卡片：K1（ID 1），当前已发布 sample v2；候选为 v3。
- 来源类型：`guide`。
- 范围：GitHub.com fine-grained PAT；个人、组织与企业资源分开表述。
- 试点批准：保持 `pilot_approved = 0`。
- 建议来源：
  - [GitHub Enterprise Cloud：企业 PAT 策略与最长期限](https://docs.github.com/en/enterprise-cloud@latest/admin/enforcing-policies/enforcing-policies-for-your-enterprise/enforcing-policies-for-personal-access-tokens-in-your-enterprise)
  - [GitHub Enterprise Cloud：组织 PAT 政策](https://docs.github.com/en/enterprise-cloud@latest/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization)
  - [GitHub Enterprise Cloud：创建和管理个人 PAT](https://docs.github.com/en/enterprise-cloud@latest/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
  - [GitHub Blog：fine-grained PAT 过期选项与公开发布](https://github.blog/changelog/2024-10-18-new-pat-rotation-policies-preview-and-optional-expiration-for-fine-grained-pats/)

## 修订理由

删掉含混的“创建、重新生成或使用时都可能生效”总括句，改为区分：新 fine-grained PAT 在创建时已知目标组织且期限需符合上限；策略后来变化导致已有 token 不合规时，组织访问可能被挡、token 本身不会仅因设策略而撤销；classic PAT 的使用/SSO 检查时点只留在类型边界说明。

这是一份知识卡候选，不是发布请求的替代物。发布前需由人核对来源与正文，并明确审核者。
