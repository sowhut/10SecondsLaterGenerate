# 10secslater.com 部署说明

本仓库产出一个纯静态站：

- `/`：个人项目首页；
- `/editor/`：关卡编辑器；
- `packages/editor/dist/`：构建产物，由 GitHub Actions 自动同步到腾讯云服务器。

部署流程是：`push main → lint/typecheck/test/build → 上传构建产物 → SSH + rsync → 腾讯云 Nginx`。
服务器不需要安装 Node.js，也不需要在生产机上拉 Git 仓库。

## 1. 服务器首次配置

下面以 Ubuntu 和独立的 `deploy` 用户为例。先登录腾讯云服务器：

```sh
sudo adduser --disabled-password --gecos "" deploy
sudo install -d -o deploy -g deploy /var/www/10secslater.com
```

在自己的电脑上创建一把只给 GitHub Actions 使用的密钥（不要在仓库目录内生成）：

```sh
ssh-keygen -t ed25519 -C "github-actions-10secslater" -f "$HOME/.ssh/github-actions-10secslater"
ssh-copy-id -i "$HOME/.ssh/github-actions-10secslater.pub" deploy@你的服务器公网IP
```

确认这把密钥可以登录：

```sh
ssh -i "$HOME/.ssh/github-actions-10secslater" deploy@你的服务器公网IP
```

## 2. Nginx 指向静态目录

域名和 HTTPS 已经可用，因此保留现有证书、80 → 443 跳转等配置，只修改 HTTPS 的
`server { ... }`。把 [`deploy/nginx/10secslater.com.locations.conf`](../deploy/nginx/10secslater.com.locations.conf)
中的内容放进该 `server` 块，并删除会冲突的旧 `root` 或 `location /`。

关键配置是：

```nginx
root /var/www/10secslater.com;
index index.html;

location = /editor {
    return 308 /editor/;
}

location / {
    try_files $uri $uri/ =404;
}
```

检查并重载：

```sh
sudo nginx -t
sudo systemctl reload nginx
```

## 3. 配置 GitHub Environment

打开 GitHub 仓库：`Settings → Environments → New environment`，创建 `production`。
在该 environment 中增加以下 Secrets：

| Secret | 内容 |
| --- | --- |
| `DEPLOY_HOST` | 腾讯云服务器公网 IP；不要填 CDN 地址 |
| `DEPLOY_PORT` | SSH 端口，默认 `22` 时也可以留空 |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | `$HOME/.ssh/github-actions-10secslater` 私钥的完整内容 |
| `DEPLOY_KNOWN_HOSTS` | 服务器 SSH host key，获取方式见下方 |

在可信网络上执行以下命令，复制完整输出到 `DEPLOY_KNOWN_HOSTS`：

```sh
ssh-keyscan -p 22 -H 你的服务器公网IP
```

最好将输出的公钥指纹与服务器 `/etc/ssh/ssh_host_ed25519_key.pub` 核对，避免把错误主机加入信任。

然后在仓库 `Settings → Secrets and variables → Actions → Variables` 增加这些构建变量：

| Variable | 用途 |
| --- | --- |
| `DEPLOY_ENABLED` | 完成服务器和 Secrets 配置后设为 `true`，用于开启生产部署 |
| `VITE_SPRITE_BASE_URL` | 托管贴图目录，例如 `https://www.10secslater.com/sprites` |
| `VITE_SANDBOX_URL` | 托管 Cocos 试玩页，例如 `https://play.10secslater.com/sandbox/` |
| `VITE_API_BASE_URL` | 投稿后端；尚未实现时留空 |

这些 `VITE_*` 值会被打进浏览器 JS，本来就是公开 URL，不要把密码或 token 放进去。

## 4. 首次发布与回滚

完成上述一次性配置并把 `DEPLOY_ENABLED` 设为 `true` 后，向 `main` 推送代码就会自动部署。也可以在仓库的
`Actions → CI/CD → Run workflow` 手动触发。

每次发布可在 GitHub Actions 的 `Deploy to Tencent Cloud` job 中查看记录。当前部署使用
`rsync --delete --delay-updates`，服务器目录始终与本次构建产物一致。

如果需要紧急回滚，在 GitHub 上对目标提交执行 Revert 并合入 `main`；CI 通过后会自动部署旧内容。

## 5. 上线检查

```sh
curl -I https://10secslater.com/
curl -I https://10secslater.com/editor/
```

同时人工确认：

- 首页按钮能进入 `/editor/`；
- 编辑器左上角项目名能返回首页；
- 页脚备案号为“京ICP备2025111566号”，点击后打开工信部备案系统；
- GitHub Actions 中 `check` 与 `deploy` 两个 job 都为绿色。
