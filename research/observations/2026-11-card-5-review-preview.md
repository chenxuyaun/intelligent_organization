# 模拟知识草稿预览：card #5

> 仅来自 4186 数据库的临时快照，不在在线应用中；状态为待审，未发布，不会进入组织检索。情境为虚构 GitHub 规则问答，不代表任何公司制度。

- 标题：账号与权限：14个月没用的 classic PAT 还可访问组织吗？
- 状态：pending / sample
- 来源工单：#8（虚构问法；答复由陈朋采纳）
- 来源类型：guide
- 来源链接：https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization

## 来源卡的适用范围

K3《GitHub classic PAT 默认过期与组织上限》：GitHub.com classic personal access tokens；默认过期要求与目标组织自定义最大有效期策略需分开判断。
K2《GitHub 组织 PAT 上限收紧后的存量 token 影响（补充说明）》：GitHub.com 组织成员的 personal access token；仅在 token 生命周期超过该组织当前最大有效期策略时适用。

## 草稿正文

适用场景：账号与权限 · 14个月没用的 classic PAT 还可访问组织吗？

问题特征：虚构情境：一张 classic PAT 约两年前创建，创建者设置的过期日显示在 8 个月后；持有人已连续 14 个月没有使用它，且仍是某 GitHub 组织成员。组织现在设置的 PAT 最大有效期为 180 天。仅凭这些信息，能否判断这张 token 现在还存在、还能否访问组织？请分别说明个人设置的过期日、GitHub 一年未使用清理、组织最大有效期限制；列出要核实的状态，不要把重新生成说成必然，也不要索取 token 明文。

处理步骤：
1. 建议请提问者仅以只读方式确认：该 token 当前是否仍列出，以及最近一次使用的大致时间（不提供 token 名称/ID、截图或 scope）。
2. 建议由组织管理员核实目标组织当前 classic PAT 最大有效期策略，以及该成员 token 是否属于适用对象。
3. 结合“是否仍列出/最近使用时间”和“组织策略是否适用”两项结果，再判断 token 是否存在及是否会被阻止访问组织。
4. 若确认被组织策略阻止，按管理员指引处理；不要预设必须重新生成 token。

引用依据（从本次组织答复引用的已发布知识带入；发布前需人工核验）：
- K3《GitHub classic PAT 默认过期与组织上限》
  原适用范围：GitHub.com classic personal access tokens；默认过期要求与目标组织自定义最大有效期策略需分开判断。
  来源链接：https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization
- K2《GitHub 组织 PAT 上限收紧后的存量 token 影响（补充说明）》
  原适用范围：GitHub.com 组织成员的 personal access token；仅在 token 生命周期超过该组织当前最大有效期策略时适用。
  来源链接：https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization
来源组织运行：R7。请审核本草稿是否新增了可复用步骤，或与以上已发布知识重复。

最终结果：answered，仅为模拟规则问答：答复已采纳；未处理真实 token 或组织状态。

人工结论：直接采纳（用户审核选择采纳组织答复；仅用于隔离模拟样本。）

注意：本条由智能体根据处理过程起草，发布前请人工确认步骤是否仍适用于当前环境。
