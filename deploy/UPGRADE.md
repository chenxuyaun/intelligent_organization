# 单实例升级与回退手册（P5-3，⑥§7 落地）

- **适用范围：** 每客户独立部署的单实例（ADR-001）。多实例逐台升级见文末清单模板。
- **核心保证：** 全部数据库迁移是**幂等加列/加表**（旧镜像可读新库——新列被旧代码忽略），所以「升级失败 → 换回旧镜像启动」永远可行；没有任何迁移会删除或改写既有数据。
- **纪律：** 升级前必须先有通过 `verify` 的备份；没有备份就不升级。

---

## 0. 前置检查（每次升级前）

```bash
# 1. 确认当前版本与运行状态
docker compose ps                      # 容器健康（healthy）
curl -fsS https://<your-host>/api/ready   # {"ok":true,"ready":true,...}

# 2. 停止写入窗口前创建备份（服务运行中也可备份：node:sqlite backup API 在线快照）
node scripts/workspace-data.js backup <DATA_DIR> <BACKUP_DIR>/<date>-pre-upgrade
node scripts/workspace-data.js verify  <BACKUP_DIR>/<date>-pre-upgrade
# 输出必须包含「完整性与 SHA-256 校验通过」；否则停止升级，先解决备份。
```

## 1. 升级步骤

```bash
# 1. 拉取新镜像（或重建）
docker compose build --pull app        # 或 docker pull <registry>/<image>:<new-tag>

# 2. 逐实例替换（单实例直接 up -d）
docker compose up -d app

# 3. 启动即自动迁移：openDb() 依次执行幂等迁移（加列/加表），重复执行无副作用
# 4. 验证
curl -fsS https://<your-host>/api/ready        # ready=true、database=ok
curl -fsS https://<your-host>/api/state | head # org/model/metrics 正常返回
```

应用内验证（管理员浏览器）：设置页准备清单 5 项无异常告警；新建/审核/检索各走一次（演示或虚构工单）。

## 2. 回退步骤（升级失败或行为异常时）

```bash
# 1. 停新镜像
docker compose stop app

# 2. 换回旧镜像（迁移是幂等加列，旧代码忽略新列；数据无损）
#    compose.yaml: image: <old-tag>  然后先在本机核验旧镜像能启动新库：
docker compose up -d app

# 3. 验证 ready + 一次冒烟（scripts/smoke.js 只能对新实例跑，回退验证用人工 checklist：
#    登录 → 工单列表 → 详情 → 审核一条 → /api/ready 200）

# 4. 若数据库本身损坏（极罕见，WAL 保护之外的事故）：恢复备份到全新 DATA_DIR 再启动
node scripts/workspace-data.js restore <BACKUP_DIR>/<date>-pre-upgrade <RESTORED_DATA_DIR>
# 用 RESTORED_DATA_DIR 作为 DATA_DIR 启动（旧目录保留不动）；成员需重新登录（备份不含会话）。
```

**回退判定点（出现任一即回退）：** /api/ready 持续 503（database=unavailable）；启动日志出现「产品模式拒绝升级结构不完整的既有数据库」以外的启动失败；核心流程（登录/工单/审核）任一不可用。

## 3. 多实例逐台升级清单（阶段 B，ADR-001）

| 步骤 | 实例 A | 实例 B | 实例 N |
|---|---|---|---|
| 备份 + verify | ☐ | ☐ | ☐ |
| up -d + ready 检查 | ☐ | ☐ | ☐ |
| 应用内冒烟（1 单全流程） | ☐ | ☐ | ☐ |
| 观察 ≥1 个工作日 | ☐ | ☐ | ☐ |
| 异常 → 按本手册回退该实例 | ☐ | ☐ | ☐ |

实例间互不影响（独立 DATA_DIR/容器/端口）；灰度 = 先升 A 观察，再逐台推进。

## 4. 漂移检查

升级后核对实例配置未被环境漂移污染：

```bash
# 关键环境变量核对（不读值，只确认存在性与形态）
docker compose exec app node -e "import('./server/config.js').then(m => {
  console.log('DATA_DIR set:', Boolean(process.env.DATA_DIR));
  console.log('APP_MODE:', m.APP_MODE);
  console.log('MODEL_BASE_URL scheme ok:', /^https:\/\/(?!.*@)/.test(process.env.MODEL_BASE_URL || '') || /^http:\/\/(localhost|127\.)/.test(process.env.MODEL_BASE_URL || ''));
})" 2>/dev/null || echo "（demo 模式跳过）"
```

数据目录漂移（误指向项目目录/共享目录）由启动预检直接拒绝（⑥§7 已有）；应用层无需额外检查。

---

**本手册边界：** 面向单客户受控试用；不含生产级蓝绿/滚动发布、镜像签名校验与自动告警接入（ADR-006 触发条件命中后另立）。所有命令假定操作者具备宿主 shell 权限；密钥永不落本手册。
