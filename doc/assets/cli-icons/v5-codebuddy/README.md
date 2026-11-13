# CodeBuddy Code 官方图标

2026-11-07，取自腾讯官方 npm 包 [`@tencent-ai/codebuddy-code`](https://www.npmjs.com/package/@tencent-ai/codebuddy-code) 2.181.0 自带的应用图标 `vendor/assets/icon.png`，原样接入插件。未重新绘制或生成图像；品牌权利归原权利方。

## 来源与文件

- [codebuddy.png](codebuddy.png)：上述包内文件原件，150 × 150，RGBA PNG；与运行资源 `src/client/assets/codebuddy.png` 字节一致。
- SHA-256：`3628c1891ff84443439bb1905b81a816367b3e994e9de4ee4a3baeb0bc9ab314`。
- [manifest.json](manifest.json) 记录来源、透明度、光学参数和校验值。

## 主题与接入

- 彩色圆角方块图标，明暗主题共用原图，不反色（`mono: false`），不需要单独的暗色版本。
- 主体铺满画布（alpha≥128 的包围盒为整幅），光学缩放 `0.78`，使主体约占图标槽的 78%，与 Codex、Claude Code 等图标的视觉大小接近。
- [preview.html](preview.html)／[preview.png](preview.png)：与 Codex、Qoder 在 22、24、32px 和明暗背景下的对照。preview.png 由 Pillow 按相同缩放合成，不是浏览器渲染。

## 实际验证

- 已核对包内原件与运行副本的 SHA-256。
- 四角 alpha 为 0，alpha 范围 0–255，圆角外为透明。
- 合成预览目视核对：明暗背景下无白底、无裁切，轮廓可辨。Desktop 内的设置列表、Worker 卡片与选择器尚未目视核对，记录在 `openspec/archives/add-codebuddy-cli/tasks.md`。
