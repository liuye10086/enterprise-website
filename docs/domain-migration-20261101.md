# 官网主域名迁移记录（2026-11-01）

官网已迁移至 <https://arvivatherap.com/home>，`www` 跳转至主域名；用户实测主域名登录和 Research“开始科研”弹窗成功后，已移除 `new.arvivatherap.com` 的解析、Nginx 站点和证书。旧平台内容及迁移前备份保留，未取消旧平台服务。

## 实际变更

| 项目 | 迁移前 | 迁移后 |
| --- | --- | --- |
| `@` DNS | CNAME `arvivatherap.com.w.cdngslb.com` | A `47.82.97.195` |
| `www` DNS | AAAA `ff03:0:0:0:0:0:0:c1` | A `47.82.97.195`，HTTPS 308 至主域名 |
| `new` DNS | A `47.82.97.195` | 已删除 |
| `APP_ORIGIN` | `https://new.arvivatherap.com` | `https://arvivatherap.com` |
| Research 返回链接、iframe | `new` 域名 | 主域名 |
| 主站 Nginx | `sites-available/arviva` | `sites-available/arviva-main` |
| 主站证书 | `new.arvivatherap.com` | `arvivatherap.com`，SAN 包括 apex、`www` |

DNS TTL 为 600 秒。两条本次临时 ACME TXT（`_acme-challenge`、`_acme-challenge.www`）已删除。其余 12 条记录保留，包括两个产品 A 记录、三个 MX、邮箱客户端 CNAME 及原 verification TXT。

应用继续部署于阿里云香港服务器 `/srv/arviva`，由 `arviva.service` 运行。生产数据库及现有账号保留，本次没有数据库结构迁移；私密环境文件只修改生产 `APP_ORIGIN`，原邮件、短信、数据库和认证配置均保留。`src/research-demo.html` 的两处官网来源与对应测试已同步更新，构建的产品页已部署到 `/var/www/arviva-products/index.html`。

应用部署时的基线为 `1c719096822fef281e6817d086ff531c6b8583ea` 加两文件域名补丁。服务器源码中这两个文件保留现场修改；源码、测试和迁移文档维护在 `feat/domain-migration-20261101` 分支，尚未合并至 main。后续发布前须确认目标提交包含补丁并整合服务器工作树，不能丢弃服务器修改后直接部署原 main。本次 Git 提交范围仅为两份源码/测试文件及三份文档，不包含备份、私密配置和临时验证材料。

## 验证结果

- 本机及服务器各 **34/34** 项针对性测试通过，0 失败、0 跳过。覆盖 Research iframe、消息来源、访问权限和认证配置；服务器使用独立测试库。本次没有重跑全量回归。
- 构建成功，产出 21 个页面和 45 个媒体文件。
- 切换后 **54/54** 项公网检查通过：7 栏目、5 篇新闻及资源与本地构建一致，旧地址和查询参数跳转、视频 Range、匿名保护、私密路径隔离、生产配置及 API 来源校验正常；未通过自动脚本发送 OTP。
- 用户分别确认“我已手动登录，可以登录”和 Research“弹窗正常显示”。没有据此推断邮箱和短信两种方式均在本次重新验收；未额外领取试用或发起支付。
- 主域名证书的 DNS-01 签发成功后，使用 `certbot reconfigure --cert-name arvivatherap.com --authenticator webroot --webroot-path /var/www/arviva-acme --preferred-challenges http --run-deploy-hooks --non-interactive` 改为 HTTP-01 自动续期；模拟续期和 Nginx 部署钩子成功，timer 为 active。本次证书有效至 **2027-01-30 05:33:32 UTC**。
- 退役脚本确认有效 Nginx 配置不再引用 `new`，删除其 Certbot 证书后 `nginx -t` 成功；`arviva`、`nginx`、`postgresql`、`certbot.timer` 均为 active。
- 最终 **22/22** 项复核通过：主站、Research 入口、两个产品站、`www` 与旧首页跳转、生产配置正常；Google 与 Cloudflare 两个公共 DNS 均返回 `new` 及两条临时 ACME 名称 **NXDOMAIN**，主域名和 `www` A 记录正确、`www` 已无 AAAA、三个 MX 未变。

自动化浏览器曾遇到 Research iframe 超时及等待页面响应，用户在自己的浏览器手动验证弹窗正常，未为此放宽安全策略或修改超时时间。网络较慢时仍应等待页面加载；公共 DNS 的检查不代表所有终端的旧缓存同时消失。

## 备份与操作回执

服务器私密备份目录：`/var/backups/arviva/domain-migration-20261101`。备份目录权限为 700，备份归档为 600，不应公开或提交仓库。

- `before.dump`：迁移前 PostgreSQL 自定义格式备份；已用 `pg_restore -l` 检查清单，本次未执行数据库试恢复。
- `config-before.tar`：迁移前 Nginx、Certbot、systemd 与私密环境配置。
- `site-before.tar`：原源码、测试、构建与产品页。
- `pre-retirement.tar`、`retired-arviva.conf`：删除旧域名配置前的额外恢复副本。
- `server-tests.txt`、`certificate.log`、`retirement.log` 和完成标记记录服务器结果。
- 阿里云命令助手续期回执 `t-hk071rx4o3pz5z4`：2026-11-01 14:39:29–14:39:40（UTC+8），ExitCode 0。
- 退役回执 `t-hk071rxn832ymtc`：2026-11-01 14:45:16–14:45:17（UTC+8），ExitCode 0。

本地 `tmp/domain-migration-20261101/` 保存操作脚本、按控制台记录的 `dns-before.zone`、测试日志、`public-results.json`、`retirement-public-results.json` 和页面截图；该目录被 Git 忽略。仓库历史素材 `backup/2026-10-10/` 与旧平台内容保留。

## 恢复原则

先定位故障范围，优先保持主域名修复或回滚应用。配置和构建恢复使用上述私密备份中的具体文件，经过 `nginx -t`、服务重启与严格 TLS 检查后再切换流量；不要把所有历史配置不加区分地覆盖当前环境。

如果确需恢复原 `new` 入口，先恢复对应证书、Nginx、原 `APP_ORIGIN` 与产品页，在服务器本机严格验证后重建 `new A 47.82.97.195`。若主域名也要返回旧平台，可将 `@` 恢复为原 CNAME；`www` 可保持有效 HTTPS 跳转，**不要恢复原来无效的 multicast AAAA 地址**。证书已存在私密归档中，无需绕过证书校验。

此次没有数据库结构迁移，域名回退不应恢复整库或覆盖迁移后的账号活动。备份在同一台服务器，保留它们不等于已经完成异地灾备。旧平台服务及付费取消不属于本次迁移操作。
