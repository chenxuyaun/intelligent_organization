# 组织智能工作台

当前默认启动的是本地演示/研究工作台。产品方向是做成给其他团队使用的工作台，第一版先聚焦小型客服 / IT 支持团队；产品方向仍需真实团队试用验证。

研究背景见 `MVP_PLAN.md` 与 `research/`。

## 两种运行模式

- **默认 `demo` 模式：** 本地演示数据，保留个人与组织建议对照、观察批次和重置功能。适合研发和研究，不适合录入真实客户数据。
- **`product` 模式：** 单个团队独立部署、多成员邀请登录；接入团队的 OIDC 身份提供方；管理员可邀请、改角色和停用成员；工单、审核和知识操作关联登录成员。产品模式只生成组织建议，模型故障时明确报错，不退回演示生成器。

产品模式目前是**受控试用底座，不是可直接公开上线的 SaaS 成品**：需要客户的 OIDC 配置、HTTPS 反向代理和独立数据目录；没有自助注册或邀请邮件服务，尚未完成客户真实 IdP、持续监控告警和完整安全评审。Docker 镜像和本地合成 OIDC 容器已成功构建并启动到 ready，但目标主机仍需验收。备份、校验、恢复和确认式删除已在隔离虚构数据目录演练，不等于真实团队环境验收。管理员导出路由已在隔离库验证，包含真实产品会话链路的权限检查；浏览器下载和客户环境仍待验收。每个客户使用独立部署与数据库，当前没有多租户共享数据库。

## 启动

要求 Node.js ≥ 22.16（用到内置 `node:sqlite` 和在线备份 API）。

```bash
npm install     # 安装 OIDC 客户端与图标库
npm start       # 启动 → http://127.0.0.1:4173
```

首次启动自动载入虚构演示数据（7 张问题单、4 条已发布知识、2 条待审草稿、2 组带人工审核的运行记录）。`npm run reset` 可随时重置。

### 运行状态检查

- `GET /api/health` 是进程存活检查，返回 `ok` 与运行秒数。
- `GET /api/ready` 是就绪检查：执行一次数据库只读查询，并返回模式、数据库状态及模型配置状态；它不会调用模型服务，所以“已配置”不代表模型端点当前可达。接口不返回密钥，适合部署探针做基础检查。
- 如果启动时报端口已占用，服务会说明可能已有实例运行，并退出；不会自动终止占用端口的进程。先检查现有服务状态或为新实例换一个 `PORT`。

## 环境变量（或写入项目根目录 `.env`）

| 变量 | 必填 | 说明 |
|---|---|---|
| `MODEL_API_KEY` | 否 | 不设则进入演示模式（界面明示，绝不冒充真实模型） |
| `MODEL_BASE_URL` | 否 | OpenAI 兼容的端点，默认 `https://api.deepseek.com/v1`；产品模式的远程端点必须使用 HTTPS，本机回环地址可用 HTTP；不能包含用户名、密码、查询参数或片段，密钥单独放在服务端 `MODEL_API_KEY` / `MODEL_API_KEY_FILE`；端点必须直达最终服务，模型请求不跟随重定向 |
| `MODEL_NAME` | 否 | 默认 `deepseek-chat` |
| `MODEL_TIMEOUT_MS` | 否 | 默认 45000 |
| `MODEL_MAX_OUTPUT_TOKENS` | 否 | 每次主模型回复上限，默认 4096；允许 1024–8192 |
| `MODEL_MAX_CALLS_PER_HOUR` | 否 | 产品模式每团队滚动 1 小时的请求上限，默认 60；允许 1–10000。失败请求和手动连接检查也计数 |
| `PORT` / `HOST` | 否 | 默认 `4173` / `127.0.0.1` |
| `DATA_DIR` | 否 | 默认 `./data`，SQLite 单文件 |

模型密钥只从服务端读取，不下发到浏览器。`MODEL_API_KEY_FILE` 与 `OIDC_CLIENT_SECRET_FILE` 可从受保护文件读取对应密钥；同一密钥不能同时配置直接值和 `_FILE` 路径。产品模式的 OIDC 客户端密钥同样只保存在服务端。

## 产品模式受控试用配置

只在**新的、独立于演示数据的部署目录**中启用。`DATA_DIR` 必须在项目目录之外；不要把 `APP_MODE=product` 指向现有演示数据库：服务会先只读检查 sample 数据，再运行数据库迁移；如果目录结构不完整、包含 sample 工单/知识/成员，或数据目录落在代码仓库中，就会在启动阶段退出。product 服务运行时会在 `DATA_DIR/app.lock` 留下进程锁，正常关闭时自动移除，用于阻止同一工作区被并发启动或删除。正式环境需由 TLS 反向代理提供 HTTPS，`APP_PUBLIC_URL` 填浏览器访问的站点来源；OIDC 客户端需把 `${APP_PUBLIC_URL}/api/auth/callback` 加入允许的回调地址。

首次部署、OIDC 提供方配置、首位管理员登录、双成员协作与备份恢复验收步骤见 [`research/operations/product-first-team-onboarding.md`](research/operations/product-first-team-onboarding.md)。该手册是待执行的验收方案，不代表已经完成真实团队验证。

团队负责人准备第一次业务讨论时，可直接使用[一页团队试用准备卡](research/operations/team-first-session-worksheet.md)：选一个重复问题，写清完成和升级条件，并把模型数据边界留给团队负责人确认。

### 单团队 Docker 部署

仓库提供 `Dockerfile` 与 `compose.yaml`，用于一台团队专属主机上的单团队试用。容器以非 root 用户运行，根文件系统只读，业务数据使用 Compose 命名卷，备份目录使用仓库外的主机路径；HTTP 端口只绑定 `127.0.0.1`，由同机 HTTPS 反向代理转发。此配置不把不同团队放进同一个应用实例；多个团队应有不同 Compose 项目名、数据卷、备份目录和端口，优先使用独立主机或独立服务账号。

1. 准备 Docker Engine 与 Docker Compose；创建该团队的备份目录及两份密钥文件。宿主机密钥文件应限制为必要管理员可读，并确保容器内 `node` 用户（UID 1000）能读取；备份目录也需让 UID 1000 可读写。备份含敏感数据，目录及其磁盘/快照需由运维加密保护。
2. 将 `deploy/product.env.example` 复制到仓库外的受保护路径（例如 `/etc/org-intelligence/team-a.env`），把 `PRODUCT_ENV_FILE` 改为该文件的绝对路径，填写 OIDC、模型配置、密钥文件路径和 `BACKUP_DIR`。环境文件只保存密钥路径，不保存密钥值；不要提交、打印或公开密钥文件。OIDC 回调必须精确设为 `${APP_PUBLIC_URL}/api/auth/callback`。
3. 从仓库根目录启动，项目名必须对该团队保持唯一且稳定：

   ```bash
   docker compose -p team-a --env-file /etc/org-intelligence/team-a.env config -q
   docker compose -p team-a --env-file /etc/org-intelligence/team-a.env up -d --build
   ```

   `config -q` 只校验配置，不打印渲染后的环境变量；不要用会输出密钥的 `docker compose config` 或 `docker inspect` 分享结果。TLS 反向代理可参考 [`deploy/nginx-support.example.conf`](deploy/nginx-support.example.conf)：替换域名和证书路径，用 `nginx -t` 检查后再 reload，并把 HTTPS 流量转到 `http://127.0.0.1:4173`。若更改 `HOST_PORT`，同步调整代理目标端口。
4. 检查 `docker compose ... ps` 显示服务健康，再从 HTTPS 站点检查 `/api/health`、`/api/ready` 并完成 OIDC 首次登录。`ready` 只检查数据库和配置，不会验证模型端点真实可用。

备份与恢复示例（日期目录须唯一；恢复前停服务，恢复后把 `DATA_DIR` 切到新子目录再启动）：

```bash
docker compose -p team-a --env-file /etc/org-intelligence/team-a.env --profile maintenance run --rm --no-deps maintenance scripts/workspace-data.js backup /var/lib/org-intelligence/current /var/backups/org-intelligence/2026-11-19
docker compose -p team-a --env-file /etc/org-intelligence/team-a.env --profile maintenance run --rm --no-deps maintenance scripts/workspace-data.js verify /var/backups/org-intelligence/2026-11-19
docker compose -p team-a --env-file /etc/org-intelligence/team-a.env stop app
docker compose -p team-a --env-file /etc/org-intelligence/team-a.env --profile maintenance run --rm --no-deps maintenance scripts/workspace-data.js restore /var/backups/org-intelligence/2026-11-19 /var/lib/org-intelligence/recovery-2026-11-19
```

恢复成功后，将受保护环境文件里的 `DATA_DIR` 改成 `/var/lib/org-intelligence/recovery-2026-11-19`，再执行同一项目名的 `up -d` 并核对数据；旧目录仍留在同一持久卷里，可用于回退。

本地合成 OIDC 下的容器构建和 `/api/ready` 已实测；目标 Linux 主机、真实反向代理和客户 IdP 尚未验收。Compose 项目名变化会创建另一组空数据卷；升级时沿用相同项目名，并使用新的 `IMAGE_TAG` 保留上一版镜像以便回退。宿主机 Docker 管理员能访问容器环境和卷，不应把同一台由互不信任团队共同管理的 Docker 主机误当作客户间安全边界。

在该部署的服务端环境变量中配置：

```env
APP_MODE=product
ORG_NAME=团队名称
DATA_DIR=D:/org-workspaces/team-a
APP_PUBLIC_URL=https://support.example.com
OIDC_ISSUER=https://identity.example.com
OIDC_CLIENT_ID=由身份提供方创建
OIDC_CLIENT_SECRET=由身份提供方创建
OIDC_BOOTSTRAP_ADMIN_EMAIL=admin@example.com
MODEL_API_KEY=服务端模型密钥
MODEL_BASE_URL=https://api.deepseek.com/v1
MODEL_NAME=deepseek-chat
MODEL_MAX_OUTPUT_TOKENS=4096
MODEL_MAX_CALLS_PER_HOUR=60
```

产品模式首次使用 `ORG_NAME` 作为团队显示名称；管理员之后可在“设置 → 团队资料”修改名称，修改值保存到独立工作区数据库，并随管理员导出。

没有有效管理员的首次启动会创建 7 天有效的待激活管理员邀请；邮箱必须与身份提供方验证过的邮箱一致。若初始邀请过期且仍没有有效管理员，重启服务会续期 7 天。管理员登录后可在“设置 → 团队成员”创建其他 7 天邀请；创建后可复制一段包含团队名、角色、登录说明和有效期的邀请消息，再通过团队批准的渠道发给成员。系统不会代发邮件。角色为管理员、成员和只读成员。

产品模式强制每张新工单填写数据来源、工作区存储确认人和脱敏状态；只有标为“已脱敏”或“无需脱敏”，且管理员已登记模型发送确认人，工单才能发送给模型。确认记录绑定到登记时的服务端点和模型名称；配置目标变化会拦截后续调用，负责人重新确认后管理员才能更新。清除此记录会阻止后续模型调用。姓名和脱敏状态只是手工记录，系统不验证身份、授权真实性或正文脱敏充分性；系统也不自动检查工单正文中的个人信息。端点/模型名称一致不代表服务协议内容未变；部署管理员仍需按实际协议核对模型服务方的数据处理方式。设置页说明主模型提示词包含的工单字段、组织记忆摘录、模型端点，以及 TypeSafe/JEV 影子旁路的启用条件和样本字段。首页会按实际成员、结果、知识审核发布和跨成员复用记录，持续显示首条团队学习闭环的进度；数据授权仍由团队负责人自行确认，不会被进度自动认定。知识卡片须人工审核后才能共享；真实试点知识过期后会退出检索，并出现在“过期待复核”列表；有效期按 UTC 日期计算，日期当天结束后失效。成员也可填写原因主动停用知识，停用动作会记录操作者并保留历史引用。登录成员可转派工单、准备留存交接摘要，由当前接手人确认接收；“团队复盘”汇总工单结果、审核、返工/升级、交接等待、跨任务记忆检索/引用和已解决工单日历周期中位数。这是一张流程观察页，不能单凭引用或采纳次数证明工作变好。设置页可提交站内问题/建议，成员只能看自己的反馈，管理员处理团队收件箱；目前不发邮件通知，提交和状态变化会进入事件流，反馈不会自动附加工单或 AI 内容，也不会外发给开发者，并随团队数据导出。当前为单客户隔离部署方案；上线前还需要按具体身份提供方和托管环境完成端到端验证与运维准备。

## 产品工作区备份与恢复

维护命令直接指定产品工作区目录，不读取 `.env`。备份可在服务运行时生成一致的 SQLite 快照；备份和恢复都会检查数据库完整性，并拒绝含 `sample` 演示数据的数据库。恢复只写入新目录或空目录，不覆盖现有文件；恢复后的成员需要重新登录。

```powershell
# DATA_DIR 是产品实例目录；备份路径父目录须存在，最终备份目录须尚不存在
node scripts/workspace-data.js backup D:/org-workspaces/team-a D:/secure-backups/team-a/2026-11-19
node scripts/workspace-data.js verify D:/secure-backups/team-a/2026-11-19

# 先恢复到新目录；确认可用后再由运维人员切换该实例的 DATA_DIR
node scripts/workspace-data.js restore D:/secure-backups/team-a/2026-11-19 D:/org-workspaces/team-a-restore
```

备份含团队工单、成员身份映射、审核、知识、事件和站内反馈等敏感数据；工具从备份中排除登录会话与临时 OIDC 登录流程，但**不加密备份文件**。备份位置必须由部署方使用加密磁盘或受控的加密备份存储保护；模型密钥、OIDC 密钥和其他环境变量不在数据库备份中，须通过独立的密钥管理方式保存。恢复到新目录已在隔离虚构数据库演练；真实工作区和 Docker 目标主机的恢复仍待验收。

备份/恢复目标的上级目录须预先创建；命令不会自动创建上级目录，也不会删除旧数据目录。恢复验证通过后，运维人员需停掉实例、把 `DATA_DIR` 指向恢复目录，再启动并核对团队数据；旧目录应保留到确认恢复无误。

## 产品工作区数据删除

删除由团队数据负责人和部署运维人员按团队保留规则执行。删除前先停止该工作区的服务，并传入 `--service-stopped`。对已使用工作区锁的版本，脚本还会检查 `app.lock` 中记录的 PID：进程仍在运行或锁内容无效时拒绝删除；没有锁文件时，仍依赖操作者确认（例如旧版本服务）。若服务异常退出留下锁，先人工确认锁中 PID 已不存在，再运行删除命令；命令会核验并随数据库一起删除陈旧锁。若要重新启动服务而非删除数据，则需确认 PID 已不存在后手动清理陈旧锁；服务不会自动抢锁。

```powershell
node scripts/workspace-data.js erase D:/org-workspaces/team-a --service-stopped --confirm "DELETE D:\org-workspaces\team-a"
```

确认文字必须与程序按规范路径给出的字符串完全一致；不一致时命令只提示正确文字，不删除。命令只接受有效、无 sample 数据的团队数据库，只删除 `app.db`、已知 SQLite sidecar 文件及已确认失效的 `app.lock`；若目录中有其他文件或链接，会停止且不删任何文件。它保留 `DATA_DIR` 目录本身，不触碰独立 JSON 导出、备份目录、云端快照或环境变量。之后重新启动该实例会建立空工作区，并按配置生成初始管理员邀请。存储介质的底层副本不保证被安全覆写；备份和快照需要按部署方的保留策略单独清理。2026-11-19 已在隔离虚构工作区验证：活跃 PID 锁使删除失败且数据库/锁保留；已退出 PID 的陈旧锁随数据库删除，备份复验有效。没有验证真实工作区或 product 服务实际启动/关闭的锁生命周期。

## 演示流程（约 3 分钟，对应 MVP_PLAN 第 3 节）

1. 打开问题单 **#5「换了新电脑后 VPN 还是连不上」**（或新建一张）。
2. 点 **「生成两种建议」**——同一张单分别跑个人模式与组织模式，并排显示。组织模式多出来的只有：检索到的知识、引用片段、交接摘要。
3. 对两个建议分别 **采纳 / 编辑后采纳 / 拒绝**，可打分并写理由（也可以只审一个）。
4. 点 **「记录处理结果」**，选「已解决」并写实际结论。
5. 点 **「生成知识卡片草稿」**——智能体只起草，状态是「待审核」。
6. 到 **组织记忆** 页审核：发布后卡片可被检索。
7. 新建一张相似问题单（例如「VPN 证书快到期了怎么续」），再跑两种模式：组织模式应引用刚发布的卡片，且引用次数 +1。
8. **工作台首页 / 事件页** 看两种模式的采纳率、评分、引用与复用次数；所有 AI 与人工动作都在事件时间线上。

## 两种模式的边界

- 两种模式**共用同一模型、同一提示词版本、同一输出 JSON 结构**（`summary / category / priority / draft_reply / next_actions / escalation_needed / handoff_summary / citations / uncertainties`）。
- 组织模式唯一的增量：可调用 `search_approved_memory`（检索已发布知识 + 已解决案例）与 `prepare_handoff`。
- 引用是硬校验的：模型返回了检索结果之外的来源编号会被丢弃并记录（`citation_audit`）。
- 必须人工确认的动作没有智能体直连入口：对客回复、正式分派、关闭问题单、发布或修改共享知识。

## 工程说明

```
server/
  index.js      HTTP 服务 + 静态文件（零框架）
  db.js         SQLite schema
  store.js      问题单 / 运行 / 审核 / 卡片 / 事件的数据访问
  analytics.js  观察面板与组织记忆检索（只读聚合）
  team-learning.js 产品团队复盘数据（只读聚合）
  retrieval.js  本地全文检索（CJK 二元组 + 词频加权；换向量检索只改这个文件）
  llm.js        OpenAI 兼容适配层
  agent.js      智能体主流程 + 输出校验
  demo-brain.js 演示模式生成器 + 交接摘要（纯函数）
  seed.js       演示数据
public/         单页前端（原生 ES Module，无框架）
scripts/
  smoke.js          端到端冒烟：npm run smoke（沉淀→复用主线 + P1/P2/P3/P4 断言，42 项）
  acceptance.js     端到端验收：node scripts/acceptance.js（新实例从零启动→迁移→全流程→备份恢复演练→指标断言，14 项）
  perf-baseline.js  性能基线：node scripts/perf-baseline.js（应用层延迟、检索包络 1k/5k/10k、mock 端点延迟拆分；合成数据，零付费模型调用）
  workspace-data.js 产品工作区备份/校验/恢复/确认式删除
  render.js         无头 Chrome 截图 + 几何测量：node scripts/render.js
```

## 验证与运维脚本纪律

- 三个验证脚本均自建临时实例（独立 DATA_DIR + 独立端口 4196–4199），不触碰运行中的服务与真实数据，结束时自清理；全部使用演示/合成数据，不调用付费模型。
- 检索包络实测（2026-11-20）：1k 卡 p50=133ms（SLO <500ms 达标）；5k≈28s、10k≈110s——无预索引 BM25 超过 1k 卡即超可用阈值，语料增长前需预索引或向量检索（见 `research/architecture/07-adr.md` ADR-007 实测补充）。
- 升级/回退手册：`deploy/UPGRADE.md`（迁移全部幂等加列，旧镜像可回退）。

## 当前限制

- 检索是本地全文匹配（标题/正文命中加权），不是向量检索；数据量大或语义相近但用词不同时会漏。**实测包络（2026-11-20）：>1k 卡单次检索即超秒级可用阈值（5k≈28s、10k≈110s），语料增长前需预索引或向量检索（ADR-007）。**
- 默认 `demo` 模式无登录鉴权，只适合本机或可信内网演示；`product` 模式有 OIDC 登录和角色控制，但真实身份提供方与部署环境仍待验收。
- 演示模式由本地规则生成，只用于走通流程；其输出质量不代表模型真实水平。
- 「带引用的运行 / 复用次数」反映活动量，不能单独作为组织变好的证据（MVP_PLAN 第 9 节）。
- 视觉门禁 VM21（真实照片 ≥4 张）对本工具不适用：工具界面不放营销照片，已豁免。
