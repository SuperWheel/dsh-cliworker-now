# TRAE CLI CN 官方图标

2026-11-07，从 [TRAE 中国官网](https://www.trae.cn/) 的 `<link>` favicon 下载，原样接入插件。处理方式：无。未重新绘制、抠图、去底或生成图像；品牌权利归原权利方。

## 来源与文件

- [官方原始 PNG](https://lf-cdn.trae.com.cn/obj/trae-com-cn/trae_website_prod_cn/favicon.png)：48 × 48，RGBA PNG，绿色 TRAE 标识位于不透明近黑色方块上。
- [trae.png](trae.png)：下载原件；与运行资源 `src/client/assets/traecn.png` 字节一致。
- SHA-256：`49d523938a22af5a70dd79923725df38674823026e2f917e76337319969f4af4`。
- [manifest.json](manifest.json) 记录来源、透明度、光学参数和校验值；字段沿用 v4-qoder。

## 主题与接入

- 复用 `BrandIcon` 的本地 PNG 资源，`mono: false`，`dark_filter: none`；深色主题不使用 `invert(1)`。
- 不新增主题开关、远程资源请求或额外暗色图片。
- 原图没有透明边缘；alpha ≥ 128 的主体包围盒为 `[0, 0, 48, 48]`，包含整个底板，不能当作绿色标识的包围盒。沿用 v4-qoder 的 80% 图标槽目标，`scale = 0.8 × 48 / 48 = 0.8`，居中偏移 `x = y = 0%`。
- [preview.html](preview.html) 显示 TRAE 与现有 ZCode、Antigravity 在 22、24、32px 图标槽和明暗背景下的对照。近黑色底板属于原图，页面明暗背景不属于 PNG。

## 实际验证

- 来源 URL、下载日期由本次任务提供；本次未重新联网核对官网或下载原件。
- 已用 `python3` + Pillow 解码并测量：RGBA，四角均为 `(10, 11, 13, 255)`，alpha 范围 `[255, 255]`，完全透明像素 0 个、完全不透明像素 2,304 个。已核对原件与运行副本的 SHA-256 和字节一致性。
- `preview.png` 由 PIL 按 16/22/24/32/48 px 在浅色（#FFFFFF）与深色（#18181B）背景上合成（2026-11-07，协调会话目视核对）：两种背景下绿色标识清晰，无白底、无裁切；深色背景下近黑底板边缘不明显，属原件外观，不反色。Desktop 内的实际渲染尚未核验。
- 此目录只证明所供原图的透明度、光学测量、字节一致性和 HTML 预览内容；不代表已安装 Desktop 的设置列表、Worker 卡片或选择器验收。实际验证边界见 [TRAE 接入任务](../../../../openspec/changes/add-traecn-cli/tasks.md)。
