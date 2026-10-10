# 手机号验证码登录

支持中国大陆手机号（固定 `+86`），保留原有邮箱登录，已通过本机和线上真实号码登录验收。手机号和邮箱各自为独立账号，暂不支持绑定；试用与付费资格按账号独立保存。生产发布流程见 [PostgreSQL 登录部署](postgresql-deployment.md)。

2026-10-10 本机及香港服务器均使用 `SMS_MODE=aliyun-pnvs`，用户分别确认真实短信验证码送达并登录成功。使用网站专用 RAM 账号与平台预置签名、模板；密钥只保存在被 Git 忽略的私密文件中。两套环境各自的上限均为 `SMS_DAILY_LIMIT=10`，共用短信套餐；下述 development 步骤用于需要不发短信的离线开发，不代表当前运行模式。

## 本地预览

1. 执行 `npm run db:migrate`，迁移为旧用户表补充手机号并建立手机验证码记录，保留邮箱用户、会话及产品资格。
2. 本机私密 `.env` 设置 `SMS_MODE=development`，保持 `NODE_ENV=development`、`HOST=127.0.0.1`、`APP_ORIGIN=http://127.0.0.1:4174`。
3. 执行 `npm run build`、`npm start`，访问 [本机预览](http://127.0.0.1:4174/home)。
4. 点击 **Log in → Phone → Send code**。到 `tmp/dev-sms/` 打开 JSON，确认 `phone` 对应输入号码，将 `code` 填入页面登录。

本地模式不会调用短信服务商，不会发短信或产生短信费用。验证码不是固定演示码，会在 10 分钟后过期且只能成功使用一次。验证码文件包含测试号码及临时验证码，仅保存本机并被 Git 忽略，不要上传到公开目录。生产配置会拒绝启动 development 模式。

## 开通真实短信需要准备什么

建议使用 **阿里云号码认证服务 → 短信认证**（PNVS），API 接入点为 `dypnsapi.aliyuncs.com`。它和另一个“短信服务”产品使用不同的签名、模板及套餐，不能混用。

1. 在阿里云账号完成实名认证，然后按 [官方新手指引](https://help.aliyun.com/zh/pnvs/getting-started/sms-authentication-service-novice-guide) 开通短信认证。
2. 在该服务控制台选择平台预置的验证码签名及对应模板，取得签名名称 `SignName`、模板编号 `TemplateCode`。本方案发送参数为 `code` 和 `min`，选择与之匹配的验证码模板。
3. 创建专用于本网站短信发送的 RAM 访问凭据，仅授予 `dypns:SendSmsVerifyCode` 操作权限（该 API 的 Resource 为 `*`，见 [官方授权说明](https://help.aliyun.com/zh/pnvs/developer-reference/api-dypnsapi-2017-05-25-sendsmsverifycode)）；不要使用阿里云主账号的 AccessKey。AccessKey ID 和 Secret 只填私密 `.env`，不要发聊天、写前端或提交仓库。
4. 确认短信认证计费及可用余额/套餐。短信测试也会调用真实收费服务；先指定测试手机号，再进行少量送达验证。

私密配置对应 `.env.example`：

```dotenv
SMS_MODE=aliyun-pnvs
SMS_DAILY_LIMIT=100
ALIYUN_SMS_ACCESS_KEY_ID=
ALIYUN_SMS_ACCESS_KEY_SECRET=
ALIYUN_SMS_SIGN_NAME=
ALIYUN_SMS_TEMPLATE_CODE=
ALIYUN_SMS_SCHEME_NAME=
```

`ALIYUN_SMS_SCHEME_NAME` 可选。填写完成后重启应用。使用平台预置签名时，收件人看到的是平台签名，不保证显示 Arviva；若今后要求专属公司签名，需要另行核对服务选择和签名申请条件。

程序在服务器生成随机验证码并存储摘要，通过官方 SDK 发送自定义验证码；核验由本网站完成，不依赖前端保存状态。未配置时默认禁用短信发送，不会伪装为成功；发送失败时该验证码不可用于登录。真实运营商送达仍需配置后实测。

## 限制与上线前核对

- 同手机号最少间隔 60 秒、每小时最多 5 次；IP 限流跨邮箱和短信共享。每个验证码最多尝试 5 次。
- `SMS_DAILY_LIMIT` 默认每天 100 次，按 UTC 日期计数。这是全站发送尝试上限，包含失败发送的预留次数，不是人民币预算。按照需求调整，并在供应商控制台配置额度和监控。
- SDK 禁用自动重发，避免超时导致重复发送。失败结果不向浏览器泄露供应商响应或密钥。
- 发布时执行服务器数据库迁移，并单独配置真实短信模式与凭据，不能复制本机 development 配置或验证码文件。首次生产发布沿用 `SMS_DAILY_LIMIT=10`；后续按实际使用调整。
- 原 QQ SMTP 继续向用户输入的邮箱投递，没有仅允许发信邮箱本人登录的限制。

官方参考：[短信认证新手指引](https://help.aliyun.com/zh/pnvs/getting-started/sms-authentication-service-novice-guide)、[短信认证接入与预置资源说明](https://help.aliyun.com/zh/pnvs/use-cases/sms-verify-for-individual-developers)。
