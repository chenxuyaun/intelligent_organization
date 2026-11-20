# K1 v3 sample 候选审核单

## 当前状态

- 当前 4186 模拟记忆中的 K1 v2（K1，ID 1）仍是已发布并生效版本。
- K1 v3 候选已作为 **K5 / pending / sample / v3** 存入模拟库，基于 K1 v2。尚无人审核或发布，因此 K1 v2 仍是唯一生效版本；真实试点批准数为 0。
- 完整候选正文见 [`K1 v3 修订候选`](../drafts/K1-fine-grained-PAT-enterprise-policy-boundary.md)。

## 这次修订解决什么

K1 v2 把 fine-grained PAT 的策略时点写成“创建、重新生成或使用 token 时可能生效”，模型会重复这句，无法清楚解释 fine-grained 与 classic PAT 的执行边界。K1 v3 拆开三件事：

1. 新 fine-grained PAT 创建时，目标组织已确定，期限不能超过实际适用上限。
2. 组织/企业可以要求期限；组织不能放宽企业上限。策略后来变化使已有 token 不合规时，组织访问可能被拦，但 token 不会仅因设置策略而被撤销。
3. “使用 token 或尝试 SSO 时检查”只用于 classic PAT，不套用给 fine-grained PAT。

## 实测证据

- **60 天企业上限 / 90 天组织设置**：K1 v2 两次中，0/2 清楚说明 fine-grained 创建期限须不超过有效上限；K1 v3 候选 2/2 都明确 60 天不能被 90 天放宽，并区分 classic PAT 的使用/SSO 检查。
- **新数值 holdout：45 / 120 天**：K1 v2 两次都未能仅凭 fine-grained 来源稳定说明层级；K1 v3 候选 2/2 都把同一规则迁移到新数字，回答组织 120 天不能越过企业 45 天、创建期限不超过 45 天。
- **实际检索副本中的 #11**：当前 K1 v2 没有进入 top-4，组织答复只能说 fine-grained 层级依据不足；一次性数据库副本里只把 K1 替换成候选 v3 后，K1 排名第一，live 答复引用 K1/K3 并给出明确判断。候选没有写回在线副本。

三组都使用虚构问题和 GitHub 公开规则。它们支持的是这条规则边界在小样本中的表达与召回改善，不证明总体准确率、真实业务收益或公司制度适用性。原始结果见 [`60/90 对照`](2026-11-k1-v3-boundary-compare-result.json)、[`45/120 holdout`](2026-11-k1-v3-number-transfer-result.json) 与 [`#11 实际检索对照`](2026-11-k1-candidate-actual-ticket-retrieval-result.json)。

## 官方来源复核

GitHub Enterprise Cloud 当前文档说明：企业可以设置 fine-grained PAT 最长期限；旗下组织可进一步收紧但不能越过企业上限；默认最大期限为 366 天。文档还区分 classic PAT 的使用/SSO 检查与 fine-grained PAT 在创建时已知目标组织、创建期限须符合策略上限。[企业 PAT 政策](https://docs.github.com/en/enterprise-cloud@latest/admin/enforcing-policies/enforcing-policies-for-your-enterprise/enforcing-policies-for-personal-access-tokens-in-your-enterprise)、[组织 PAT 政策](https://docs.github.com/en/enterprise-cloud@latest/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization)、[创建 fine-grained PAT](https://docs.github.com/en/enterprise-cloud@latest/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)。

## 在页面审核

打开 [4186 组织记忆页](http://127.0.0.1:4186/#/memory)，切换到“待审核”，检查 K5 的正文和来源。页面中的“编辑草稿”可修改后继续待审；“发布”会让 K5 v3 替代 K1 v2 并进入模拟检索；“驳回”会保留 K1 v2，不让 K5 进入检索。

当前系统已加载修订流程，候选只进入 sample 范围。它总结 GitHub 公开规则，不代表公司制度已核实，也没有真实试点批准。K1 v2 在你审核发布 K5 前仍继续参与模拟检索。
