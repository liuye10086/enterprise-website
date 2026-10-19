# Arviva Therapeutics 官网

根据原官网布局重建的独立网站，页面、图片、视频均从本项目加载。官网使用 Node.js 与 PostgreSQL，支持邮箱验证码与阿里云中国大陆手机号验证码登录。2026-10-16 已将提交 `df5757e` 发布到 <https://new.arvivatherap.com/home>，两个产品入口改为仅检查登录，Research 与 Prediction 子域名的 HTTPS 演示页已上线。本机和服务器各 152 项测试通过，服务器无失败或跳过，公网 19 项检查通过。产品功能仍在研发中，支付尚未接入。本次未发送真实邮箱或短信验证码；此前的收信验收记录保留在下文。

新版地址：[new.arvivatherap.com/home](https://new.arvivatherap.com/home)。旧版 [arvivatherap.com/sy](https://arvivatherap.com/sy) 继续由原建站平台提供，两站独立运行。新版首页及站内首页链接使用 `/home`，不会修改原官网。

## Git 仓库

仓库：[liuye10086/enterprise-website](https://github.com/liuye10086/enterprise-website)，默认分支 `main`。

```bash
git clone https://github.com/liuye10086/enterprise-website.git
cd enterprise-website
npm ci
npm run build
```

仓库包含源码、测试、数据库迁移与网站所需素材。`.env`、授权码、数据库数据、临时文件、云账号备份记录、内部验收截图和未使用的原始视频仅保留本机，不进入仓库。新电脑或服务器需要参考 `.env.example` 单独配置数据库与邮件服务；`git pull` 只更新代码，不会同步密码或数据库记录。

## 本地运行

需要 Node.js 22 或以上版本、npm 和 PostgreSQL。本机已为项目创建专用数据库角色及 `arviva_website_dev`、`arviva_website_test` 两个独立数据库；连接配置保存在私密的 `.env`，不要覆盖、提交或公开该文件。新环境按照 [PostgreSQL 部署说明](docs/postgresql-deployment.md) 配置。

```powershell
npm ci
npm run db:migrate
npm run build
npm start
```

打开 [真实登录版](http://127.0.0.1:4174/home)。`npm start` 读取 `.env` 并连接 PostgreSQL；修改 `src/` 后重新执行 `npm run build` 并刷新页面，修改后端或配置后重启服务。

可选的 `MAIL_MODE=development` 使用随机六位验证码：点击 **Send code** 后，验证码保存在 `tmp/dev-mail/<规范化邮箱的 SHA-256>.json`，文件中的 `email` 可用于确认收件地址。**这是本地测试投递，没有发送真实邮件**，不能使用固定演示码代替。该模式只允许本机开发，生产环境禁用；`MAIL_MODE=disabled` 不发送验证码。

**邮箱配置（2026-10-19）：** 官网验证码发件人配置为阿里云企业邮箱 `BD@arvivatherap.com`，使用 `MAIL_MODE=smtp`、`SMTP_HOST=smtp.qiye.aliyun.com`、`SMTP_PORT=465`（SSL/TLS），`SMTP_USER` 和 `SMTP_FROM` 均为 `BD@arvivatherap.com`。`SMTP_PASSWORD` 使用该邮箱生成的三方客户端安全密码，只保存在本机或服务器的私密配置中，不进入 Git、聊天或日志；本机先填入被 Git 忽略的 `.env.smtp-update`，验证后再合并到 `.env`。服务地址参考 [阿里邮箱官方客户端配置](https://help.aliyun.com/zh/document_detail/36576.html)。

本地已通过阿里邮箱 TLS 与 SMTP 认证，并将六项邮件配置合并到私密 `.env`，206 项测试通过；本次未发送邮件，真实收信待验证。发布按本地验证、commit/push、服务器拉取同一提交、单独更新邮件私密配置并验证重启的顺序执行，线上切换结果以实际部署验收为准。完整步骤和失败恢复见 [部署说明](docs/postgresql-deployment.md)。仓库只同步代码与配置模板，不会把本机密码同步到服务器。

历史验证记录（QQ 邮箱）：2026-10-10 已验证本机 QQ SMTP TLS 连接、认证及网站验证码接口发送，用户随后确认收信并成功登录；该记录不代表阿里邮箱已通过验证。

配置的邮箱只负责发信，不是唯一允许登录的账号。收件人来自访客在登录框输入的邮箱，其他 QQ 邮箱及其他格式有效的邮箱都可以申请验证码；实际投递结果仍取决于发信服务和收件方。

本机与香港服务器均使用 `SMS_MODE=aliyun-pnvs` 发送真实短信，用户于 2026-10-10 分别确认收信并登录成功；两套环境的每日发送尝试上限各为 10，共用网站专用 RAM 凭据与短信套餐。真实短信配置见 [短信登录说明](docs/sms-login.md)。

需要离线开发时，可手动切换为 `SMS_MODE=development` 并重启：登录框切换 **Phone / SMS**，输入中国大陆 11 位手机号，点击 **Send code**，再到 `tmp/dev-sms/` 中找到对应 `phone` 的 JSON 文件，将其中的 `code` 填回页面。此模式生成随机验证码，10 分钟有效，**不发送真实短信**。文件名为标准 `+86` 手机号的 SHA-256；生产环境和非本机访问都禁止使用此模式，未配置时默认为 `disabled`。

本次使用现有的阿里云企业邮箱 SMTP。邮件配置不绑定服务商，切换只涉及 `MAIL_MODE` 和 `SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASSWORD`、`SMTP_FROM`；数据库、已注册账号与前端登录流程无需修改。

旧版静态演示单独保留：

```powershell
npm run dev
```

打开 [静态演示版](http://127.0.0.1:4173/home)。此服务监视 `src/` 并自动构建，刷新即可查看改动；它使用演示状态，不连接真实账号数据。两个地址均仅供本机使用，停止终端进程即停止服务。

```powershell
npm test
npm run test:auth
```

认证集成测试使用 `.env` 中的 `TEST_DATABASE_URL`；必须指向专用测试库，不能指向生产库。`npm test` 同时包含页面、素材和原有演示回归。

## 登录与产品访问

顶部 **Log in** 支持邮箱或中国大陆手机号与六位验证码登录，首次验证成功自动注册，无需密码。验证码 10 分钟有效、最多尝试 5 次，同一目标发送间隔至少 60 秒；会话最长 7 天，退出会撤销服务端会话。数据库保存验证码和会话令牌的摘要，不保存其明文。

**2026-10-16 已发布：** `/intelligent` 的两个功能模块仅检查登录。未登录时直接打开登录窗口，验证成功后关闭窗口、停留在当前页面并显示登录成功提示；再次点击功能模块才进入对应产品站。已登录时点击模块直接进入：Research Platform 为 [research.arvivatherap.com](https://research.arvivatherap.com)，Prediction Platform 为 [thesis.arvivatherap.com](https://thesis.arvivatherap.com)。不再弹出试用或套餐窗口，不扣减试用次数，也不要求付费资格。手机号与邮箱仍创建独立账号，不自动合并。

现有账号、历史试用及付费字段保留，本次无需数据库迁移。旧产品入口仍由服务端验证有效登录后跳转。`/plans` 作为独立的支付界面预览保留，但不再出现在产品访问流程中，不能创建订单、收费或开通权限。

本机 loopback 访问使用 `/research-demo.html`（Research）及 `/research-demo.html?platform=prediction`（Prediction）代替外部域名。两个线上产品站共用源文件 `src/research-demo.html`，部署为 `/var/www/arviva-products/index.html`，按 hostname 展示对应的研发中产品卡片和中英切换。这是公开静态演示页；官网登录只负责入口校验，当前没有跨域单点登录。未来独立产品服务器需要另外接入自己的身份校验，不能将官网会话令牌拼入跳转 URL。

阿里云已于 2026-10-16 添加 `research` 和 `thesis` 两条 A 记录，指向 `47.82.97.195`（TTL 600 秒），两个子域名均已启用 HTTPS。产品站使用新增的独立 Nginx 配置 `arviva-products`；原有 Nginx 文件及链接、`.env` 和 `.env.test` 的发布前后校验结果一致。证书、备份、验证与回滚记录见 [部署说明](docs/postgresql-deployment.md)。未来迁往新服务器时再更换对应记录。

### 静态演示流程

仅在 `npm run dev` 的本机静态入口启用，并显示 Preview / Demo：

1. 输入格式有效的邮箱，点击 **Send code**，使用页面显示的 `123456` 演示登录，不会发邮件或创建真实账号。
2. 点击任一功能模块：未登录时显示登录框，登录成功后停留在当前页面并显示成功提示；再次点击模块才进入对应的本地 demo。已登录时点击模块直接进入。
3. 顶部 **Demo account** 可退出。演示登录不会消耗历史试用或创建支付记录。

演示使用同一个示例账号，`sessionStorage` 的 `arviva-access-preview-v1` 只保存演示登录标记与产品资格，不保存邮箱、验证码或令牌。它与 PostgreSQL 账号、试用额度完全独立，不作为生产鉴权。

## 文件位置

- `src/render.mjs`：栏目、导航、首页布局与联系信息。
- `src/routes.mjs`：栏目与新闻的固定英文地址、导航标签、旧地址跳转映射。
- `src/styles.css`：电脑与手机样式。
- `src/brand-theme.css`：全站 AI 生物医药主题；首页保留原有布局，轮播默认每 5 秒切换，手动切换后重新计时，后台页面或系统要求减少动态效果时暂停。
- `src/main.js`、`src/runtime-config.js`：页面交互与 live/demo 入口切换；真实服务器提供 live 配置。
- `src/access-live.js`：邮箱、手机号登录与服务端产品访问交互。
- `src/access.js`、`src/access-state.js`：静态演示逻辑及 `PRODUCTS` 产品名称、目标配置。
- `src/access-view.mjs`：产品卡片和登录窗口模板。
- `src/research-demo.html`：自包含的产品工作台 demo，构建后位于 `/research-demo.html`。
- `server/`：配置、邮件及短信投递、认证服务与 HTTP 路由。
- `db/migrations/`、`scripts/migrate.mjs`：PostgreSQL 迁移。
- `src/content.mjs`：读取备份文章并生成内容。
- `src/article-layout.json`：按原站 DOM 核实的文章图文位置；修改备份正文或图片时需同步核实映射，内容不匹配会报错。
- `backup/2026-10-10/`：分类素材与原文；含账号信息的备份校验记录仅留本机。
- `tests/`：页面、素材、交互、构建、服务与真实 PostgreSQL 认证检查。

`dist/` 是生成文件，修改页面请改 `src/`。构建通过清单管理旧产物，未登记文件不会自动删除。真实登录部署需要 Node.js、PostgreSQL、服务器配置和应用代码，**不能只上传 `dist/`**；详见 [部署说明](docs/postgresql-deployment.md)。

## 页面与素材范围

保留 7 个栏目和 5 篇新闻。栏目使用 `/home`、`/about`、`/intelligent`、`/drug-design`、`/investors`、`/news`、`/contact`，根路径 `/` 仍可打开首页。五篇新闻使用 `/news/<英文主题>`，固定地址和原文章 ID 的对应关系保存在 `src/routes.mjs`，原备份文件名、标题、正文和图片顺序保持不变。

本应用收到旧栏目 `/sy`、`/gywm`、`/kyfw`、`/ythpt`、`/tzzzq`、`/xwzx`、`/lxwm` 或五个旧 `/newsinfo/<ID>.html` 地址时，对 GET/HEAD 请求返回 308 跳转到对应新地址，并原样保留查询参数。栏目尾斜杠、`/index.html` 别名及新文章地址的相同别名也跳转到标准地址，不生成重复的旧内容页。新增文章需先在 `src/routes.mjs` 登记固定英文地址。跳转只作用于运行本应用的站点，不会更改原建站平台或域名配置。

`/intelligent` 为 **Super Intelligent Medicine**，两个入口使用 **Research Platform** 和 **Prediction Platform**，产品 ID 不变。当前线上版本仅检查登录并分别进入 Research 与 Prediction 产品站；旧 `/research-platform`、`/prediction-platform` 地址保留兼容处理。`/drug-design` 为 **Innovative Drug Design**，包含研发平台、总部与生产介绍。用户弃用的两张 About Us 背景未使用。

首页使用原来的 3 个本地 SD 视频。用户下载的 `AD 英.mp4` 已在本机归档为 `backup/2026-10-10/videos/ad-en-original.mp4`，不进入 Git 仓库且未加入首页；其编码为 HEVC、实际容器为 QuickTime/MOV，以后用于网页播放时应转换成兼容格式。

企业介绍、首页、平台介绍和合作文案集中维护在 `src/site-copy.mjs`，以 AI 赋能生物医药研发为主线。平台介绍描述研发方向，实际产品功能尚未开放。历史官网备份和五篇新闻正文保持原样；登录和访问状态提示由认证模块管理。

导航提供 English / 简体中文选择，首次访问默认英文，选择保存在浏览器 `arviva.language` 中。`src/i18n.js` 负责无刷新切换与动态提示翻译；`locale-site-zh.mjs`、`locale-access-zh.mjs`、`locale-articles-zh.mjs` 分别维护站点、登录/权限和文章的中文词典。新增英文文案需同步补充词条。URL、表单值、账号与权限状态保持不变，图片内文字和视频音轨保留原素材；禁用 JavaScript 时显示英文。导航中的手机号显示为 `138****8000`，短信登录仍使用中国大陆 +86 号码格式。

联系表单仍会打开访客的邮件应用并生成草稿，需访客确认发送；验证码邮件服务不替代联系表单。目前没有服务端联系表单收件、后台管理或原平台表单服务。

历史首次部署记录（2026-10-10）：网站部署到阿里云香港服务器，使用独立的 `new.arvivatherap.com` 子域名和 HTTPS，当时仅新增 `new` 的 A 记录。服务器使用独立的 PostgreSQL 应用库与测试库，本机账号数据未导入；当时服务器 71 项测试通过，用户确认新版验证码收信及登录成功。后续版本和测试结果以上方当前说明及 [部署记录](docs/postgresql-deployment.md) 为准。当时原官网及企业邮箱记录保持原样。
