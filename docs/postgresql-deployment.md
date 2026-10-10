# PostgreSQL 登录部署

真实登录依赖 Node.js、PostgreSQL 与同源后端。`npm start` 默认监听本机 `127.0.0.1:4174`；`npm run dev` 的 `4173` 是旧静态演示，不用于正式登录。**不能仅上传 `dist/`，也不能让 Nginx 直接公开平台 HTML 来绕过 Node。**

## 当前部署（2026-10-10）

- 新版地址：<https://new.arvivatherap.com/home>；旧版 <https://arvivatherap.com/sy> 继续运行于原平台。仅新增 `new` 的 A 记录，原根域 CNAME、MX 及邮箱客户端记录未修改。
- 阿里云香港 Ubuntu 24.04，Node.js 24.21.0、PostgreSQL 16、Nginx 1.24。应用目录 `/srv/arviva`，以 `arviva` 系统用户和 `arviva.service` 运行并开机启动。
- 生产应用库 `arviva_website` 与测试库 `arviva_website_test` 使用不同的非管理员数据库角色和密码。本机用户数据未迁移。`.env`、`.env.test` 均为 `600` 权限，不进入 Git。
- `APP_ORIGIN=https://new.arvivatherap.com`，`NODE_ENV=production`，`MAIL_MODE=smtp`，`TRUST_PROXY=loopback`。Node `4174` 与 PostgreSQL `5432` 仅监听 `127.0.0.1`。
- HTTPS 证书由 Certbot 管理，`certbot.timer` 自动续期，续期部署钩子会校验并重载 Nginx。HTTP 自动跳转 HTTPS；ACME 验证目录单独保留。`certbot renew --dry-run --run-deploy-hooks` 演练通过。
- 应用版本 `a39cbda` 已发布，服务器全量测试 116 项通过，无跳过；已核对未登录访问两个产品的普通地址、尾斜线、`index.html` 均受保护。邮箱登录状态在迁移后保留，用户已确认新版线上短信送达并登录成功。
- 生产已配置 `SMS_MODE=aliyun-pnvs` 与专用 RAM 凭据，`SMS_DAILY_LIMIT=10`。生产与本机限额分别计算，共用短信套餐；阿里云签名、模板及权限沿用已经开通的配置。

以下为重建新环境时的步骤；现有服务器已经配置完成，不要重复建库或覆盖 `.env`。本机开发库仍为 `arviva_website_dev`，与服务器独立。

## 1. 安装运行环境与数据库

安装 Node.js 22 或以上版本与 npm，并检查 `node --version`、`npm --version`。随后安装 Ubuntu 的 PostgreSQL 和 Nginx 软件包；版本来源可参考 [PostgreSQL Ubuntu 安装说明](https://www.postgresql.org/download/linux/ubuntu/)。

```bash
sudo apt update
sudo apt install postgresql nginx
sudo systemctl enable --now postgresql
sudo -u postgres psql
```

在 `psql` 中创建独立、非管理员角色和数据库，使用交互式密码提示，避免密码出现在命令历史中：

```sql
CREATE ROLE arviva_website LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
\password arviva_website
CREATE DATABASE arviva_website OWNER arviva_website;
REVOKE ALL ON DATABASE arviva_website FROM PUBLIC;
\connect arviva_website
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO arviva_website;
\quit
```

PostgreSQL 的 `listen_addresses` 保持 `localhost`，不向公网开放 5432。通过 `sudo -u postgres psql -c 'SHOW config_file;'` 和 `SHOW hba_file;` 查找实际配置文件；为应用保留类似规则，并保留已有的本机管理员规则：

```text
host  arviva_website  arviva_website  127.0.0.1/32  scram-sha-256
```

修改监听配置后重启 PostgreSQL。应用连接使用专用角色，不使用 `postgres` 超级用户。

## 2. 准备应用与私密配置

示例目录为 `/srv/arviva`，由独立系统用户运行：

```bash
sudo adduser --system --group --home /srv/arviva arviva
sudo install -d -o arviva -g arviva /srv/arviva
```

将项目放入该目录并交给 `arviva` 用户。应包含 `package.json`、`package-lock.json`、`server/`、`src/`、`scripts/`、`db/` 与构建好的 `dist/`；若在服务器构建，还需要 `backup/` 素材。不要把本机 `.env`、管理员配置或 `tmp/dev-mail/` 一并公开上传。

仅在新环境且 `.env` 尚不存在时，以 `.env.example` 为基础创建私密配置；现有环境应保留原配置。文件所有者设为应用用户，权限设为 `600`。

非敏感配置示例：

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=4174
APP_ORIGIN=https://new.arvivatherap.com
MAIL_MODE=smtp
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
TRUST_PROXY=loopback
```

其余值在服务器的私密 `.env` 中填写，不粘贴到公开文档或日志：

| 配置 | 内容 |
| --- | --- |
| `DATABASE_URL` | 指向本机 `arviva_website` 数据库的专用角色连接串；密码中的特殊字符需 URL 编码 |
| `AUTH_SECRET` | 至少 32 个字符的独立高强度随机密钥，妥善保存 |
| `SMTP_HOST` | 当前使用 `smtp.qq.com` |
| `SMTP_USER` | 完整 QQ 邮箱地址，如 `your-account@qq.com` |
| `SMTP_PASSWORD` | QQ 邮箱开启 SMTP 后生成的授权码，不是 QQ 登录密码 |
| `SMTP_FROM` | 与 `SMTP_USER` 相同的完整 QQ 邮箱地址 |

`APP_ORIGIN` 必须与浏览器访问的 HTTPS 来源完全一致，包含非默认端口时也要一致，不带路径。生产会话使用 Secure、HttpOnly、SameSite=Lax Cookie。只有本机 Nginx 覆盖 `X-Real-IP` 且 Node 不对公网监听时，才使用 `TRUST_PROXY=loopback`；直接本机开发使用 `none`。

## 3. QQ 邮箱发信与以后切换服务

当前先使用 **QQ 邮箱 SMTP**。在 QQ 邮箱设置中开启 SMTP 服务，按页面提示完成验证并取得授权码；在项目私密 `.env` 中填写上述配置。使用 `smtp.qq.com:465`，本项目会启用 SSL/TLS。授权码与服务器设置可参考 [腾讯官方邮箱配置说明](https://main.qcloudimg.com/raw/document/product/pdf/1270_46586_cn.pdf)。

`SMTP_USER` 与 `SMTP_FROM` 都填写同一个完整 QQ 邮箱地址，`SMTP_PASSWORD` 填授权码，**不要填写 QQ 登录密码，也不要把授权码发在聊天里**。新生产环境填好前使用 `MAIL_MODE=disabled`，填好后改为 `MAIL_MODE=smtp` 并重启服务，再用实际收件邮箱验证送达；`development` 仅可用于本机开发。2026-10-10 本机与香港服务器均通过 QQ SMTP TLS 连接和认证验证，用户分别确认了本机及新版线上官网的验证码收信、登录成功。

以后换 **阿里云邮件推送（DirectMail）**，数据库、现有用户与前端登录流程无需修改。完成 DirectMail 的发信域名 DNS 认证、建立发信地址并设置 SMTP 专用密码后，更新 `.env` 的 `SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASSWORD`、`SMTP_FROM`，保持 `MAIL_MODE=smtp`，重启服务并验证收信即可。DirectMail 发信地址与 SMTP 服务地域必须一致，参考 [DirectMail SMTP 服务接入点](https://www.alibabacloud.com/help/en/direct-mail/smtp-endpoints) 和 [SMTP 发信说明](https://help.aliyun.com/en/direct-mail/user-guide/send-emails-using-smtp)。

`MAIL_MODE=disabled` 会明确禁用验证码发送。`MAIL_MODE=development` 仅用于本机开发：随机验证码写入 `tmp/dev-mail/<小写并去除首尾空格的邮箱的 SHA-256>.json`，不发送邮件，生产配置会拒绝启动。开发投递文件包含测试邮箱与验证码，应保密，不作为正式邮件方案。

## 4. 安装、迁移与启动

在项目目录中，以应用用户执行：

```bash
npm ci
npm run db:migrate
npm run build
npm start
```

迁移按 `db/migrations/` 顺序执行并记录已应用版本，可重复运行。新服务器使用同一套迁移；迁移只建立结构，不会复制本机用户或数据。生产更新前应备份数据库。`npm start` 不自动构建或迁移。

持续运行可创建 `/etc/systemd/system/arviva.service`；当前 Node.js 路径为 `/usr/local/bin/node`，其他环境需按实际路径替换：

```ini
[Unit]
Description=Arviva website (new.arvivatherap.com)
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
User=arviva
Group=arviva
WorkingDirectory=/srv/arviva
ExecStart=/usr/local/bin/node --env-file=/srv/arviva/.env /srv/arviva/scripts/start.mjs
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

结束手动启动进程后，执行 `sudo systemctl daemon-reload` 和 `sudo systemctl enable --now arviva`；通过 `sudo journalctl -u arviva` 查看启动错误，不要输出完整 `.env`。

## 5. HTTPS 与 Nginx 全路径反向代理

先仅为新子域名添加 A 记录并准备有效证书；不要修改旧官网根域记录。当前配置位于 `/etc/nginx/sites-available/arviva`。以下配置将页面、资源、`/runtime-config.js` 与所有 `/api/` 请求统一转交 Node；转发指令可参见 [Nginx 官方代理文档](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)。

```nginx
server {
    listen 80;
    server_name new.arvivatherap.com;
    location /.well-known/acme-challenge/ {
        root /var/www/arviva-acme;
    }
    location / {
        return 301 https://new.arvivatherap.com$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name new.arvivatherap.com;
    ssl_certificate /etc/letsencrypt/live/new.arvivatherap.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/new.arvivatherap.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:ARVIVA_TLS:10m;

    location / {
        proxy_pass http://127.0.0.1:4174;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache off;
    }
}
```

执行 `sudo nginx -t`，通过后执行 `sudo systemctl reload nginx`。不要再配置指向 `dist/` 的 `root`、`alias`、`try_files` 或单独静态站点，以免 `/research-platform`、`/prediction-platform` 及其尾斜线、`index.html` 形式绕过鉴权。公网只需开放 HTTPS/HTTP 和受控的管理入口，4174 与 5432 留在本机。

## 6. 上线验证与限制

验证新邮箱随机验证码收信、首次注册、退出后会话撤销，以及每个产品独立的一次试用。未登录直接访问平台应被拒绝；平台获准进入后，同一会话可在 15 分钟内刷新。另测 `/research-platform/`、`/research-platform/index.html` 和 Prediction Platform 对应地址，确认没有静态旁路。

自动认证测试必须使用专用测试库。当前服务器单独保存 `.env.test`，运行全量测试时显式加载它，避免测试被跳过：

```bash
sudo -u arviva bash -c 'cd /srv/arviva && npm run build && node --env-file=.env --env-file=.env.test --test tests/*.test.mjs'
```

本机的 `TEST_DATABASE_URL` 在 `.env` 中，仍直接使用 `npm test`。SMTP 配置存在不代表收信已验证；后续更换邮箱服务或新服务器时仍应实际登录验收。

当前没有在线支付、公开开通权限接口或完整产品功能。邮箱与短信登录、两个产品的占位页面属于发布范围。

## 7. 日常更新与备份

### 短信登录、英文路径与 UI 优化的发布步骤

2026-10-10 用户已确认本机真实短信验证码可以登录，随后验收 UI 与英文路径，并授权一起提交、推送和发布。应用版本 `a39cbda` 已完成部署，本机及服务器全量测试各 116 项通过，无跳过；用户确认线上短信送达并登录成功。

本次发布已备份数据库、私密配置和 Nginx 配置，执行 `002_phone_auth.sql`，并在发布前后分别完成备份试恢复。迁移后原邮箱会话仍有效，原用户和产品资格保留；SMTP TLS 连接及认证通过（未额外发送邮件）。新栏目与新闻页面、旧路径 GET/HEAD 跳转和查询参数、产品鉴权、敏感文件隔离均通过检查。Nginx 配置、原站根域和邮箱 DNS 未修改，旧官网 `/sy` 仍返回 200。

发布时一并核对：

- 备份后更新依赖、执行 `002_phone_auth.sql` 迁移并构建；已有邮箱用户、会话及产品资格应保留。
- 在服务器私密 `.env` 单独配置 `SMS_MODE=aliyun-pnvs` 与网站专用 RAM 凭据、签名和模板；不要整体覆盖为本机 `.env`。首次生产发布沿用 `SMS_DAILY_LIMIT=10`，后续根据实际使用调整。
- 新栏目使用 `/about`、`/intelligent`、`/drug-design`、`/investors`、`/news`、`/contact`；新闻详情使用英文主题路径。旧链接由 Node 应用跳转，发布时验证 GET/HEAD、查询参数及产品登录保护。
- 核对实际 Nginx 仍将全路径转交 Node。若与本文件示例一致，栏目改名由应用完成；若实际存在单独路径规则，先备份、调整并通过 `nginx -t` 后再加载。不要增加绕过产品鉴权的静态文件入口。
- 核对阿里云短信套餐、账号授权及公网访问。路径改名本身不需要更改 DNS、安全组或证书；只有检查发现实际需要时才修改。付费、授权、密钥等敏感操作按用户要求停在操作页面，由用户完成。
- 发布后检查新官网邮箱和短信登录、产品资格和旧路径跳转；另检查原站 `arvivatherap.com/sy` 与企业邮箱 DNS 记录不受影响。

提交并推送代码不会自动更新服务器。在服务器执行以下命令，保留已有环境配置与数据库：

```bash
sudo systemctl start arviva-backup.service
sudo -u arviva bash -c 'cd /srv/arviva && git pull --ff-only origin main && npm ci --ignore-scripts && npm run db:migrate && npm run build'
sudo systemctl restart arviva
sudo systemctl is-active arviva nginx postgresql
curl --fail https://new.arvivatherap.com/api/session
```

每日北京时间 `03:15`，`arviva-backup.timer` 调用 `/usr/local/sbin/arviva-backup`，在 `/var/backups/arviva` 保存 PostgreSQL 自定义格式备份，并清理超过 7 天的备份。目录权限 `700`，文件权限 `600`；该目录同时保存最新私密应用配置。查看任务可使用 `systemctl list-timers arviva-backup.timer certbot.timer`。

首次备份已完整恢复到一次性独立数据库并验证迁移记录，临时数据库随后清理。备份目前在同一台服务器，不能防止整机或云盘丢失；后续应另行配置异地副本。恢复必须先在独立数据库验证，不要直接覆盖线上数据库。证书续期钩子在 `/etc/letsencrypt/renewal-hooks/deploy/arviva-nginx`，续期后会重载 Nginx。
