# PostgreSQL 登录部署

## 客户个人资料与头像菜单（2026-10-16）

邮箱登录成功后，资料未完善的客户可以选择前往 `/profile` 或稍后填写，不影响登录与产品访问。个人主页使用当前已验证邮箱，收集姓名/称呼、联系电话、单位/学校、研究领域；首次填写日期由服务端生成。已登录头像展开气泡菜单，提供个人主页与退出登录。

本功能必须先执行 `npm run db:migrate`，应用 `003_user_profiles.sql` 后再启动新版本。迁移仅新增 `arviva_user_profiles` 表，不改动现有用户、会话、短信登录号码或产品记录。保存时必须携带 `expectedEmail`，服务端在事务内与当前会话邮箱比较，避免其他标签页切换账号后误写旧表单。

发布前备份生产数据库和私密配置；测试仍只使用独立的 `arviva_website_test`。代码回滚可保留新增资料表，旧版本会忽略它；不要为回滚代码而删除客户资料或直接恢复整库。`/profile` 页面本身可公开加载，但资料接口只允许当前已登录的邮箱账号读取或保存，匿名请求返回 401。

## 2026-10-16 已发布变更

应用提交 `df5757e296fa2ce93a99a94862ae24629a75c1c0` 已推送至 `main` 并部署。`/intelligent` 两个模块仅检查有效登录。登录成功后关闭登录窗口、停留在当前页面并显示成功提示；再次点击模块才跳转。已登录用户点击 Research Platform 跳转至 `https://research.arvivatherap.com`，点击 Prediction Platform 跳转至 `https://thesis.arvivatherap.com`；本地 loopback 分别预览 `/research-demo.html` 和 `/research-demo.html?platform=prediction`。不再检查或消耗产品试用资格，无依赖或数据库迁移变化，原账号及历史数据保留。

阿里云新增的 `research` 和 `thesis` 两条 A 记录均指向 `47.82.97.195`（默认线路、TTL 600 秒、启用），两个产品站已通过 HTTPS 上线。独立 Nginx 配置为 `/etc/nginx/sites-available/arviva-products`，由 `sites-enabled/arviva-products` 链接启用；公开目录只包含 `/var/www/arviva-products/index.html`，来自 `src/research-demo.html`，按 hostname 区分产品。产品 HTTPS 只开放 `/` 和 `/index.html`，其他路径返回 404；HTTP 保留 ACME 验证路径，其余请求跳转 HTTPS。原有 Nginx 文件和链接快照、私密配置校验和保持不变。

产品站当前为公开静态 demo，没有跨域单点登录，也不接收官网会话令牌；未来产品服务需另行接入身份校验。真实官网登录依赖 Node.js、PostgreSQL 与同源后端。`npm start` 默认监听本机 `127.0.0.1:4174`；`npm run dev` 的 `4173` 是本机静态演示，不用于正式登录。**官网不能仅上传 `dist/`，旧产品入口仍必须经过 Node 登录校验。** 下方历史发布记录中的试用资格和旧产品页说明反映当时版本，不作为当前访问规则。

## 当前部署（2026-10-16）

- 新版地址：<https://new.arvivatherap.com/home>；产品演示站为 <https://research.arvivatherap.com> 和 <https://thesis.arvivatherap.com>。旧版 <https://arvivatherap.com/sy> 继续运行于原平台，原根域 CNAME、MX 及邮箱客户端记录未修改。
- 阿里云香港 Ubuntu 24.04，Node.js 24.21.0、PostgreSQL 16、Nginx 1.24。应用目录 `/srv/arviva`，以 `arviva` 系统用户和 `arviva.service` 运行并开机启动。
- 生产应用库 `arviva_website` 与测试库 `arviva_website_test` 使用不同的非管理员数据库角色和密码。本机用户数据未迁移。`.env`、`.env.test` 均为 `600` 权限，不进入 Git。
- `APP_ORIGIN=https://new.arvivatherap.com`，`NODE_ENV=production`，`MAIL_MODE=smtp`，`TRUST_PROXY=loopback`。Node `4174` 与 PostgreSQL `5432` 仅监听 `127.0.0.1`。
- HTTPS 证书由 Certbot 管理，沿用 `certbot.timer` 和校验、重载 Nginx 的续期部署钩子；ACME webroot 为 `/var/www/arviva-acme`。产品证书位于 `/etc/letsencrypt/live/arviva-products`，SAN 包含两个产品域名，到期时间为 `2027-01-14 03:04:45 UTC`。旧官网证书和新增产品证书均已通过续期演练；本次运行 `certbot renew --cert-name arviva-products --dry-run --run-deploy-hooks --no-random-sleep-on-renew` 成功，部署钩子通过 Nginx 校验并重载，`certbot.timer` 保持 active。
- 当前应用版本为 `df5757e`。本机和服务器各 152 项测试通过，服务器无失败、无跳过；公网 19 项检查通过。`arviva`、`nginx`、`postgresql` 均为 active；`.env`、`.env.test` 校验和及原有 Nginx 文件／链接快照不变。生产 session 显示 `mailReady`、`smsReady` 为 true，两个 development 标志为 false。本次未发送 OTP，未重新验证真实邮箱或短信收信。
- 生产已配置 `SMS_MODE=aliyun-pnvs` 与专用 RAM 凭据，`SMS_DAILY_LIMIT=10`。生产与本机限额分别计算，共用短信套餐；阿里云签名、模板及权限沿用已经开通的配置。

以下为重建新环境时的步骤；现有服务器已经配置完成，不要重复建库或覆盖 `.env`。本机开发库仍为 `arviva_website_dev`，与服务器独立。

邮箱迁移验证记录（2026-10-19）：本地已通过 `smtp.qiye.aliyun.com:465` 的 TLS 与 SMTP 认证，六项邮件配置已合并到私密 `.env`，206 项测试通过。服务器预检已通过同一端点的 TLS 连接及 EHLO；生产配置须在本地提交推送后单独更新并重新认证。上述检查均未发送邮件，不代表真实邮件已送达。下方推荐模板为阿里云企业邮箱 `BD@arvivatherap.com`，发布按第 3 节执行，线上配置与验收结果需实际核对。

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
SMTP_HOST=smtp.qiye.aliyun.com
SMTP_PORT=465
SMTP_USER=BD@arvivatherap.com
SMTP_FROM=BD@arvivatherap.com
TRUST_PROXY=loopback
```

其余值在服务器的私密 `.env` 中填写，不粘贴到公开文档或日志：

| 配置 | 内容 |
| --- | --- |
| `DATABASE_URL` | 指向本机 `arviva_website` 数据库的专用角色连接串；密码中的特殊字符需 URL 编码 |
| `AUTH_SECRET` | 至少 32 个字符的独立高强度随机密钥，妥善保存 |
| `SMTP_HOST` | 阿里邮箱通用 SMTP 地址 `smtp.qiye.aliyun.com` |
| `SMTP_PORT` | `465`，本项目在该端口启用 SSL/TLS |
| `SMTP_USER` | 完整阿里云企业邮箱地址 `BD@arvivatherap.com` |
| `SMTP_PASSWORD` | 该邮箱生成的三方客户端安全密码，仅保存在私密 `.env` |
| `SMTP_FROM` | 与 `SMTP_USER` 相同，为 `BD@arvivatherap.com` |

`APP_ORIGIN` 必须与浏览器访问的 HTTPS 来源完全一致，包含非默认端口时也要一致，不带路径。生产会话使用 Secure、HttpOnly、SameSite=Lax Cookie。只有本机 Nginx 覆盖 `X-Real-IP` 且 Node 不对公网监听时，才使用 `TRUST_PROXY=loopback`；直接本机开发使用 `none`。

## 3. 阿里云企业邮箱 SMTP 与迁移

本次目标是通过现有的 **阿里云企业邮箱** `BD@arvivatherap.com` 发送官网验证码。使用 `smtp.qiye.aliyun.com:465`（SSL/TLS），`SMTP_USER` 与 `SMTP_FROM` 均填写该完整邮箱地址，`SMTP_PASSWORD` 使用该邮箱生成的三方客户端安全密码。服务地址参考 [阿里邮箱官方客户端配置](https://help.aliyun.com/zh/document_detail/36576.html)。本次不需要改动数据库、现有用户或前端登录逻辑。

安全密码只保存在本机或服务器的私密配置中；本机暂存于被 Git 忽略的 `.env.smtp-update`，验证后再合并到 `.env`。不要写入 `.env.example`、Git、聊天、命令参数或日志。代码与配置模板通过 Git 同步；服务器密码须单独设置，不能用本机 `.env` 整体覆盖服务器配置。新生产环境配置完成前使用 `MAIL_MODE=disabled`；现有环境在切换验收前继续保留原邮件配置。

迁移按以下顺序执行，不能把“配置存在”或“认证成功”作为真实收信结果：

1. **本地准备和认证。** 在 Git 忽略的本地私密暂存文件 `.env.smtp-update` 中填写目标邮件配置和安全密码，现有 `.env` 先保持不变。使用暂存配置验证 TLS 连接及 SMTP 认证，验证过程不调用发信接口、不发送邮件，也不打印安全密码。认证成功后，在受限位置备份本机 `.env`，再仅合并 `MAIL_MODE`、`SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASSWORD`、`SMTP_FROM` 六项并重启本地服务。认证失败时保留错误类型供排查，停止后续发布。
2. **真实收信验收。** 如需发送测试邮件，先与用户确认实际测试收件邮箱及发送安排，再通过官网请求一次验证码；由用户确认发件人为 `BD@arvivatherap.com`、邮件送达并成功登录。认证检查无法证明最终投递成功；未发送测试邮件时，明确记录“认证通过，真实收信待验证”，不能将配置发布等同于投递验收。
3. **本地验证后提交。** 完成本地构建及相关测试，核对待提交内容不包含任何 `.env` 或密码，然后 commit/push 代码、配置模板和文档，记录已验证的提交 SHA。真实私密配置不进入提交。
4. **服务器备份与同步。** 记录线上原提交，备份私密 `.env` 和现有构建，限制备份访问权限；再拉取本地已验证并推送的同一提交，核对 SHA。按该提交安装、构建及测试，不以服务器临时修改代替仓库提交。
5. **仅更新服务器邮件配置。** 在服务器私密 `.env` 中仅更新上述六个邮件配置项，保留数据库、`AUTH_SECRET`、短信及其他配置。保持应用用户所有权和 `600` 权限，先以应用运行用户验证阿里邮箱 TLS 连接及 SMTP 认证，过程中不发送邮件。验证失败则恢复原邮件配置，不重启到未通过验证的配置。
6. **重启和健康检查。** 认证通过后重启 `arviva`，确认 `arviva`、`nginx`、`postgresql` 均为 active，检查 HTTPS 首页和 `/api/session`，并确认 `mailReady=true`、邮件 development 标志为 false。该健康状态只代表配置就绪；线上真实收信及登录需要另行确认测试发送并由用户验收，在此之前记录为“认证与健康检查通过，线上收信待验证”。
7. **失败恢复。** 配置、启动或健康检查失败时，从私密备份恢复原邮件配置项并重启；如代码更新引起故障，再恢复发布前提交和构建。重新检查服务及 HTTPS 健康状态，记录失败阶段与恢复结果。仅切换 SMTP 无需恢复数据库，不能覆盖其他配置或删除用户数据。

**历史验证记录（QQ 邮箱，2026-10-10）：** 当时本机与香港服务器使用 `smtp.qq.com:465`，`SMTP_USER` 与 `SMTP_FROM` 为同一完整 QQ 邮箱地址，密码使用 QQ 邮箱 SMTP 授权码。两套环境均通过 TLS 连接和认证，用户分别确认了本机及新版线上官网的验证码收信、登录成功。该历史结果不代表阿里邮箱已经完成认证、收信或上线验证。

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

执行 `sudo nginx -t`，通过后执行 `sudo systemctl reload nginx`，随后等待各域名严格 TLS 与内容检查通过；reload 返回不代表新 worker 已就绪。`new.arvivatherap.com` 不应增加指向 `dist/` 的 `root`、`alias` 或 `try_files`，旧 `/research-platform`、`/prediction-platform` 及其尾斜线、`index.html` 形式仍交给 Node 鉴权。两个产品子域名使用前述独立静态目录，不暴露仓库或 `dist/`。公网只需开放 HTTPS/HTTP 和受控的管理入口，4174 与 5432 留在本机。

## 6. 上线验证与限制

需要实测登录时，验证随机验证码收信、首次注册和退出后会话撤销，并确认登录成功后关闭弹窗、留在当前页面显示提示，再次点击模块才进入正确子域名。当前产品入口不检查付费、不扣试用。未登录访问旧 `/research-platform`、`/prediction-platform` 及其尾斜线、`index.html` 共 6 个地址应返回 302 至 `/intelligent`；两个 `/api/products/module-0[12]/enter` 的匿名 POST 应返回 401。公开产品子域名仅展示静态 demo，不代表产品服务已建立登录会话。

自动认证测试必须使用专用测试库。当前服务器单独保存 `.env.test`，运行全量测试时显式加载它，避免测试被跳过：

```bash
sudo -u arviva bash -c 'cd /srv/arviva && npm run build && node --env-file=.env --env-file=.env.test --test tests/*.test.mjs'
```

本机的 `TEST_DATABASE_URL` 在 `.env` 中，仍直接使用 `npm test`。SMTP 配置存在不代表收信已验证；后续更换邮箱服务或新服务器时仍应实际登录验收。

当前没有在线支付、公开开通权限接口或完整产品功能。邮箱与短信登录、两个产品的占位页面属于发布范围。

## 7. 日常更新与备份

### 2026-10-16：登录入口调整与两个产品子域名上线

提交 `df5757e296fa2ce93a99a94862ae24629a75c1c0` 已推送并部署。发布前备份位于 `/var/backups/arviva/releases/20261016-df5757e`，包含 `before.dump`、原 `.env` / `.env.test`、旧 `dist/`、Nginx 配置与原提交号。本次没有依赖或数据库迁移变化；新增独立 `arviva-products` 配置和证书，既有配置及私密环境文件保持不变。

首次执行成功签发产品证书，但 Nginx reload 后立即进行的首次 HTTPS 请求仍收到旧证书，触发主机名不匹配；脚本已验证回滚，尚未更新官网代码。恢复时确认磁盘证书 SAN 正确；首次严格本机 SNI 检查仍出现一次 curl 60，间隔 1 秒重试后通过，随后公网验证正常，确认问题来自 reload 生效时序。全程没有绕过 TLS 校验；产品 HTTPS 验证通过后才更新官网、构建、测试和重启。

本机和服务器各 152 项测试通过，服务器 0 失败、0 跳过。外网脚本 `tmp/verify-products-public-20261016.mjs` 的 19 项检查全部通过：官网、JS/CSS 与两个产品 HTML 经 LF 归一后的源码哈希一致；生产邮箱和短信配置就绪且未启用 development 模式；旧产品的 6 个路径匿名访问均返回 302 至 `/intelligent`，两个进入接口匿名 POST 均返回 401；旧官网 `/sy` 仍返回 200。服务均为 active。此次未发送真实 OTP，不把配置健康检查作为真实收信验证；新增产品证书续期 dry-run 与部署钩子演练已通过，日志保存在备份目录的 `renewal-dry-run.txt`。

浏览器实测两个 HTTPS demo 分别按 hostname 显示 Research / Prediction，返回官网 `/intelligent` 正常；未登录点击模块直接出现邮箱／短信登录窗口，没有试用或套餐弹窗。

以下保留历史发布记录，版本号、测试数量及试用规则均对应各次发布时的状态。

### 2026-10-12：AI 生物医药主题与双语发布

应用提交 `6f21fae` 已推送至 `main` 并部署。发布前备份保存在 `/var/backups/arviva/releases/20261012-6f21fae`，包含数据库、原 `.env` / `.env.test`、Nginx 配置、原提交号和旧 `dist/`。本次没有依赖或数据库迁移变化，服务器私密配置的校验和在发布前后保持一致。

本机和服务器均通过 127 项测试，无失败和跳过。公网 7 栏目、5 篇文章、主题样式、双语模块和首页新图片均与本地构建哈希一致；真实邮箱与短信服务配置就绪，产品访问保护和私密文件隔离通过检查。旧官网 `/sy` 仍返回 200；未更改 DNS、证书或 Nginx 配置。

此次本机 SSH 22 通道不稳定，Git 推送通过单次 SSH 443 参数完成，没有更改仓库远程地址或永久 SSH 设置；服务器更新通过已登录的阿里云命令助手执行。脚本先校验版本并备份，再更新、构建、测试及重启，失败时自动恢复原提交和构建页面。

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
