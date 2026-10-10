# PostgreSQL 登录部署

真实登录依赖 Node.js、PostgreSQL 与同源后端。`npm start` 默认监听本机 `127.0.0.1:4174`；`npm run dev` 的 `4173` 是旧静态演示，不用于正式登录。**不能仅上传 `dist/`，也不能让 Nginx 直接公开平台 HTML 来绕过 Node。**

本机已创建专用角色和 `arviva_website_dev`、`arviva_website_test`，配置保存在私密 `.env`。以下是新 Ubuntu 服务器的部署示例，尚未在目标服务器执行；示例域名 `example.com`、路径和证书位置需替换。

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
APP_ORIGIN=https://example.com
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

`SMTP_USER` 与 `SMTP_FROM` 都填写同一个完整 QQ 邮箱地址，`SMTP_PASSWORD` 填授权码，**不要填写 QQ 登录密码，也不要把授权码发在聊天里**。新环境填好前保持 `MAIL_MODE=development`，填好后改为 `MAIL_MODE=smtp` 并重启服务，再用实际收件邮箱验证送达。2026-10-10 本机已切换为 `smtp`，QQ SMTP TLS 连接、认证及验证码接口发送验证通过，用户随后确认收信并成功登录。新服务器仍需独立验证网络连接与邮件送达。

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

持续运行可创建 `/etc/systemd/system/arviva.service`；将 `/usr/bin/node` 替换为实际 Node.js 路径：

```ini
[Unit]
Description=Arviva website
After=network.target postgresql.service

[Service]
User=arviva
Group=arviva
WorkingDirectory=/srv/arviva
ExecStart=/usr/bin/node --env-file=/srv/arviva/.env /srv/arviva/scripts/start.mjs
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

结束手动启动进程后，执行 `sudo systemctl daemon-reload` 和 `sudo systemctl enable --now arviva`；通过 `sudo journalctl -u arviva` 查看启动错误，不要输出完整 `.env`。

## 5. HTTPS 与 Nginx 全路径反向代理

先为实际域名准备有效证书，确认 DNS 指向服务器，再配置 Nginx。以下配置将页面、资源、`/runtime-config.js` 与所有 `/api/` 请求统一转交 Node；转发指令可参见 [Nginx 官方代理文档](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)。

```nginx
server {
    listen 80;
    server_name example.com;
    return 301 https://example.com$request_uri;
}

server {
    listen 443 ssl;
    server_name example.com;
    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

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

自动认证测试应在独立环境设置 `TEST_DATABASE_URL` 后运行 `npm run test:auth`，不要指向生产库。SMTP 配置存在不代表真实收信已验证，需要使用实际邮箱检查送达。

当前没有在线支付、公开开通权限接口或完整产品功能。数据库与本地投递验证不能替代生产邮件、HTTPS、备份恢复及目标服务器检查；这些需要在实际部署环境完成。
