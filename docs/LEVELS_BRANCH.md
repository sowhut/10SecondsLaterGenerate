# `levels` 分支：正式关卡与 production 发布

`main` 保存公开编辑器、Schema、校验与发布工具；受保护的 `levels` 分支额外保存已经决定上线的
正式关卡。该分支仍然公开，未发布草稿必须留在 gitignored 的 `.private/` 目录。

## 一次性创建分支

先合入包含本文件和 `.github/workflows/levels.yml` 的 `main`，再执行：

```sh
git switch main
git pull --ff-only
git switch -c levels

mkdir -p levels/official
cp /path/to/current/L*.json levels/official/
cp /path/to/current/playtest-approvals.json levels/

pnpm install
pnpm levels:release
git add levels
git commit -m "feat(levels): publish initial official levels"
git push -u origin levels
```

第一次 push 前保持仓库变量 `DEPLOY_LEVELS_ENABLED=false`，此时 Actions 只校验和生成 artifact，
不会访问服务器。确认 `Production Levels / Validate production levels` 成功后再开放部署。

日常建议用第二个 worktree，避免频繁切换 `main`：

```sh
git fetch origin
git worktree add ../10SecondsLaterGenerate-levels levels
```

## GitHub 分支规则

首次 push 创建分支后，进入：

`Repository → Settings → Rules → Rulesets → New ruleset → New branch ruleset`

建议配置：

1. Ruleset name：`Protect levels`，Enforcement status：`Active`。
2. Target branches：`Include by pattern`，填写 `levels`。
3. 开启 `Restrict deletions` 和 `Block force pushes`。
4. 开启 `Require a pull request before merging`。
5. 只有一个维护者时 Required approvals 设为 `0`；有第二位维护者后再改为 `1`。
6. 开启 `Require status checks to pass`，添加：`Validate production levels`。
7. 建议开启 `Require conversation resolution` 和 `Require linear history`。
8. 管理员保留紧急 bypass，日常仍通过 PR；不要启用允许普通协作者直接 push。

如果 Required status 列表还找不到 `Validate production levels`，先让首次 push 的 workflow 跑完，
刷新 Ruleset 页面后再添加。

## GitHub Actions 与 production Environment

进入 `Settings → Actions → General → Workflow permissions`：

- 选择 `Read repository contents and packages permissions`；
- 本工作流不需要写仓库权限。

进入 `Settings → Environments → production`：

1. Deployment branches 选择 `Selected branches and tags`，允许 `main` 与 `levels`。
2. 建议增加 Required reviewer，使每次真正上传关卡前还有一次人工确认。
3. 如果只有你自己，不要开启 `Prevent self-review`，否则会无法批准自己的发布。
4. Environment Secrets 保持：
   - `DEPLOY_HOST`
   - `DEPLOY_PORT`（默认 22 可留空）
   - `DEPLOY_USER`
   - `DEPLOY_SSH_KEY`
   - `DEPLOY_KNOWN_HOSTS`

进入 `Settings → Secrets and variables → Actions → Variables`：

- `DEPLOY_LEVELS_ENABLED=false`：首次分支验证阶段；
- Nginx 和服务器目录确认完成后改为 `true`；
- 原有官网变量 `DEPLOY_ENABLED` 独立保留。

服务器必须已有 `/var/www/10secslater-levels`，并应用
`deploy/nginx/10secslater.com.locations.conf`。工作流先上传不可变 hash 文件，最后原子替换
`manifest.json`，且不会删除旧 hash 文件，便于回滚。

## 日常发布

从 `levels` 建工作分支：

```sh
git switch levels
git pull --ff-only
git switch -c level/L08

# 编辑已有 JSON，或采纳编辑器导出的 LevelDef / LevelEnvelope
pnpm levels:adopt -- /path/to/export.json L08
pnpm levels:validate

# 在真实 Cocos 中通关后
pnpm levels:approve -- L08
pnpm levels:release

git add levels
git commit -m "feat(levels): add L08"
git push -u origin level/L08
```

在 GitHub 创建 PR，base 必须选 `levels`。合并后 Actions 自动生成 hash JSON；
`DEPLOY_LEVELS_ENABLED=true` 时进入 production Environment 审批并发布。

社区贡献仍向 `main` 提交 PR。你决定采纳后，在自己的 `levels` 工作分支运行
`pnpm levels:adopt`，完成真实 Cocos 通关和审批，再提交到 `levels`。

## 更新 Schema 或发布工具

当 `main` 修改 `packages/schema`、`tools/levels.mjs` 或 production workflow 后，创建一个
`main → levels` 的同步 PR。该 PR 通过完整 CI 后再合并，避免 `levels` 长期使用旧校验器。

## 回滚

Revert `levels` 上导致问题的关卡提交并合并。发布器会生成新的 manifest，重新指向回滚后的
hash 文件；服务器保留旧内容体，因此不需要重新上传小游戏包。
