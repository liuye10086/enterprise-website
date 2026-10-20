# Research 项目介绍素材与本地预览

2026-10-20 本地修订，尚未提交、推送或部署。保留六页，每个模块两页；页面加载完成并可见约 1 秒后弹出介绍，先让用户看到工作台。每页自动停留 3 秒，第六页结束后回到第一页循环播放；第六页点击右箭头也返回第一页，只有用户主动关闭（关闭按钮或 Esc）才退出并显示「开始科研」。鼠标移入展示框暂停、移出后重新计满 3 秒；以左右两侧箭头手动翻页，页码和分页进度居中。移除底部继续播放、上一页、下一页按钮。键盘聚焦图表出处时暂停，焦点离开内容后恢复；标签页隐藏时暂停计时。手动提前打开介绍会取消延时弹出，关闭后不会再次自动弹出。

展示框保持最大 1360×800px 及四周留白。内容区按展示框的可用高度布局：右侧先为图注预留空间，再将分析图与期刊封面等比例完整缩放到剩余区域；左侧字号、间距随可用空间调整。较宽桌面正文为 21–26px、标题为 32–46px，窄桌面进一步按宽高适配。手机使用上下布局并隐藏辅助关键词标签，保留完整标题、正文、图片与出处，侧边箭头及居中分页保持可用。

2026-10-20 适配验证：在浏览器实际 895×1012、1367×768、390×844 CSS 像素窗口逐页检查全部六页中英文内容，未出现内容区滚动溢出、文字重叠或图片/图注越界。图片使用 contain 保留全图，小屏细节随整图缩小。`npm test` 261 项全部通过。本地服务已重新启动供用户验收，尚未提交、推送或部署。

## 数据分析模块图表

原文：Raúl F. Pérez et al., **A multiomic atlas of the aging hippocampus reveals molecular changes in response to environmental enrichment**, Nature Communications (2024)。

- 论文与许可说明：https://www.nature.com/articles/s41467-024-49608-z
- DOI：10.1038/s41467-024-49608-z
- 许可：Creative Commons Attribution 4.0，https://creativecommons.org/licenses/by/4.0/
- 本地文件：`src/assets/research/atlas-figure-{1,2,4,6}.png`
- 当前使用：Fig. 6 → 第 1 页；Fig. 1 → 第 2 页。Fig. 2 和 Fig. 4 为旧版保留素材，第 5、6 页已改为下述毕业论文主题图。
- 原图地址模式：`https://media.springernature.com/lw685/springer-static/image/art%3A10.1038%2Fs41467-024-49608-z/MediaObjects/41467_2024_49608_Fig{N}_HTML.png`
- 图片完整保留，仅在网页按比例缩放；没有修改数据、裁切图中面板或改变标签。每页附作者、期刊、年份、图号、原图页面及许可链接，标明为已发表研究示例，不是本平台生成结果。

## 毕业论文模块主题图

2026-10-20 按用户反馈使用内置 imagegen 生图工具生成两张 1086×1448px 配图，并替换第 5、6 页原有数据图。图像使用绿色与米白色的学术桌面静物风格，与网站配色一致。页面图注及中英文替代文字明确标注为 AI 生成概念示意，非真实学位论文；不沿用旧论文图表的作者署名或 CC BY 许可。

- 第 5 页：`src/assets/research/thesis-draft.png`，论文封面、摘要、目录、参考文献及格式指南，对应学校规范与论文初稿组织。
- 第 6 页：`src/assets/research/thesis-revision.png`，评审批注、结构/表达/参考文献修改建议及修订稿，对应评审驱动的论文完善。
- 原始生成提示词：[research-thesis-image-prompts.md](research-thesis-image-prompts.md)。原图保存在生成目录，仓库内保留完整副本；网页仅等比例缩放。
- 替换后验证：`npm test` 261 项通过；浏览器在 1939×1090 与 390×844 CSS 像素窗口检查第 5、6 页中英文版本，图片加载正常，内容及图注没有溢出。已重启本地服务供验收，未提交、推送或部署。
- 发布优化：保留生成的 PNG 原图，网页改用同尺寸、质量 90 的 `thesis-draft.jpg` 和 `thesis-revision.jpg`。仅转换网页编码，两图合计从 5.20 MB 降为 0.67 MB，减少单 HTML 内嵌资源的下载量。优化后 261 项测试通过。

## SCI 模块期刊封面

| 文件 | 封面日期与内容 | 来源与署名 |
| --- | --- | --- |
| `nature-2026-10-15.png` | Nature，2026-10-15，Walk this way | [官方期刊目录](https://www.nature.com/nature/volumes/658/issues/8136)，封面 Maayan Harel；[图片](https://media.springernature.com/w440/springer-static/cover-hires/journal/41586/658/8136) |
| `science-2026-09-03.jpg` | Science，2026-09-03，Off the top | 用户本轮提供的封面原图；出版方 AAAS。没有将此封面标注为最新一期。 |
| `cell-2026-09-03.jpg` | Cell，Volume 189 / Number 18，2026-09-03，Male Fly Connectome | [Cell Press 官方账号的 2026 年 9 月封面汇总](https://m.thepaper.cn/newsDetail_forward_34252645)，2026-10-16 发布；封面 Philip Hubbard；[图片](https://imgpai.thepaper.cn/pphimage/20261015/bf2c190e-fb3a-4df1-88c1-4a9794546f76.jpg) |

封面均使用真实图片，没有生成或仿造期刊封面；当前作为本地设计预览。封面的商业网站公开展示授权未验证，不能将图表的 CC BY 许可套用于封面。公开部署前需确认封面使用许可或换成获授权素材。

## 构建与未来部署

源图片保存在 `src/assets/research/`，HTML 引用本地素材。`npm run build` 通过 `scripts/research-demo.mjs` 将图片嵌入 `dist/research-demo.html`，无需浏览器请求外部图床，也无需为产品服务器增加静态素材路径。

以后经用户确认部署产品站时，应使用构建后的 **`dist/research-demo.html`** 作为 `/var/www/arviva-products/index.html`，不要直接复制源文件 `src/research-demo.html`；源文件不包含内嵌图片。现有产品站只开放 `/` 与 `/index.html` 的策略可继续保留。本轮未改动线上服务器。
