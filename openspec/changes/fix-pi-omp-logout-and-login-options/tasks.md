# Tasks

## 1. 证据与方案

- [ ] 1.1 用隔离 HOME/合成凭据核对 Mac Pi/OMP 退出，Windows 只读核对安装接口与登录选项；记录错误原文、来源和未复现项。
- [ ] 1.2 对照全部 CLI 登录入口，记录缺失项与原生能力边界。

## 2. 实施与关联回归

- [ ] 2.1 修复 Pi/OMP 指定凭据退出及确认，补充隔离原生、模拟 Windows 菜单和替换回归。
- [ ] 2.2 按安装发现 Pi/OMP 登录选项，补齐智谱地区文案与 i18n，测试平台/版本、别名、失败与取消。
- [ ] 2.3 同步 README、README.en.md、doc/design.md；记录认证失败提示建议，不修改交集规则。

## 3. 集成验证与交付

- [ ] 3.1 运行 corepack pnpm typecheck 与相关 vitest，记录准确数量和结果。
- [ ] 3.2 运行 corepack pnpm build:preview，打预览归档并记录 SHA256；不更新 Desktop。
- [ ] 3.3 严格校验本 change，按阶段本地提交，记录提交号和无推送。

## Workflow follow-up

- Windows 安装预览包及真实 OMP 旧凭据 id=1 退出由主会话在确认无活动任务后执行；id=2/其他 CLI 不得改动。本阶段未执行。
- Desktop UI、Windows 真实登录与 Pi 真实退出未验证；因此本 change 不归档，不以格式检查隐藏缺口。
