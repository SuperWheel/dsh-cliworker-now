# TRAE CLI CN 图标

## 当前运行图（2026-11-09 起）

用户要求：浅色主题用 TRAE 白底黑线的标识，暗色主题用原来的绿色标识，两者都去掉底板，像其他 CLI 一样只显示图形。

- 图形来源：本机 Trae CN 桌面应用 3.4.15 自带的 `Contents/Resources/app/out/media/trae-logo.svg`（SHA-256 `9e61457b3b9d82afd409a5016cb13fc78b064799295d30648eada3eec6e0b2e7`）。它是 16×16 的近黑色圆角方块（`#1A1B1D`）加绿色（`#32F08C`）标识；同一应用的 Dock 图标（`Trae CN.icns`）是白色圆角底加纯黑（`#000000`）同形标识，即“白底黑线”版本。
- 处理方式：只取 SVG 中两条标识路径（外框与两个菱形），去掉方块底板；用 Pillow 按路径坐标以 128 倍超采样绘制多边形，LANCZOS 缩到 256×256 透明 PNG。画布按标识宽度取正方形（x 2.758–13.235，标识垂直居中）。没有重新设计图形，只改了底板与颜色。
  - [traecn-light.png](traecn-light.png)：纯黑 `#000000`，取自 Dock 图标的标识颜色，用于浅色主题。
  - [traecn-dark.png](traecn-dark.png)：`#32F08C`，取自 SVG 原色，用于暗色主题。
  - 与运行资源 `src/client/assets/traecn-light.png`、`traecn-dark.png` 字节一致。SHA-256：light `10126532c4c1531f46e4d87bd8e2b75eed0a519d24a31aedfe681461cbeefd83`，dark `29c811d467411c7e078bfb43ee24237cbf773a71e7c9cb8ec469920b586f7fc2`。
- 接入：`BrandIcon` 的 `themed` 表与 Kimi 相同，按 `body[data-ds-dark-theme]` 切换 `cwn-icon-light` / `cwn-icon-dark` 两张图，不用 `invert(1)`；光学缩放 0.82、居中，`tests/brand-icons.test.tsx` 覆盖。
- [preview-themed.png](preview-themed.png)：PIL 在白底与 `#18181B` 底上按 22、32、64px 合成，标识清晰、无底板。Desktop 内的实际渲染见 [TRAE 接入任务](../../../../openspec/archives/add-traecn-cli/tasks.md)。

## 旧运行图（2026-11-07 至 11-09，已不再使用）

- [官方原始 PNG](https://lf-cdn.trae.com.cn/obj/trae-com-cn/trae_website_prod_cn/favicon.png)：TRAE 中国官网 favicon，48 × 48，绿色标识在不透明近黑色方块上，原样作为运行图 `src/client/assets/traecn.png`（已删除）。
- [trae.png](trae.png)：该下载原件，SHA-256 `49d523938a22af5a70dd79923725df38674823026e2f917e76337319969f4af4`；[manifest.json](manifest.json) 中 `previous` 字段保留其测量记录，[preview.html](preview.html) / [preview.png](preview.png) 为旧图预览。
- 停用原因：方块底板在浅色主题下像一圈深色边框，与其他 CLI 的透明图形不一致（2026-11-09 用户反馈）。

品牌权利归原权利方。
