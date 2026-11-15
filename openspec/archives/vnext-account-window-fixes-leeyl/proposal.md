# Proposal

## Why

2026-11-15 发布前，用户在 Mac 与 Windows 的 DSH Desktop 上试用 CLI 连接页的账号功能，报告了四个问题：

1. OMP 账号窗口选「DeepSeek」登录时，账号终端偶尔启动失败（试了几次，失败一两次）。登录成功后，账号窗口不显示新凭据，要等很久（例如去点退出时）才出现；OpenCode 也是这样。两个平台都出现，需要排查其他 CLI 是否有同样问题。
2. Pi 无法退出凭据：退出「智谱 BigModel Coding（中国） API 登录」时提示「未能确认已退出，请查看原生终端中的提示。」。点击 Pi 的「账号」也无法正确打开图形化登录窗口，可能与 Pi 1.5 更新有关。
3. 用户经插件「其他服务商」表单自建的配置（OMP 的 api.po1nt9.me）被列在「其他配置 · 在原配置中管理」下，无法删除。
4. 已登录的凭据摘要与右侧「账号」「账号终端」按钮被挤到两行；应保持同一行，超出部分用「…」截断。

## What Changes

- 找出账号终端偶发启动失败的根因并修复，不靠单纯加大超时。
- 登录（终端或引导窗口）结束后，Host 作废该 CLI 的账号缓存，Client 立即重新读取，账号窗口和连接页摘要及时显示新凭据；按同一规则检查所有带账号窗口的 CLI。
- Pi 1.5 下的定向退出可以确认完成；Pi「账号」可以打开图形化登录窗口。
- 插件表单写入的自定义服务商可以识别为插件创建的条目，在账号窗口中用现有的「退出 → 确认退出」删除，只删除该条目；用户手写的原生配置和环境变量仍只读。
- 多条凭据的账号摘要与按钮始终同排，摘要超出时以「…」截断，悬停显示完整列表。

## Capabilities

### Modified Capabilities

- 账号窗口与账号终端（登录、退出、刷新、自建配置删除、账号行布局）。

## Impact

- Host：`src/host/accounts.ts`、`src/host/account-guide/*`、`src/host/pi-omp-*`、`src/host/pi-login.mjs`、`src/host/custom-provider*.ts`、Windows 账号终端托管。
- Client：`src/client/account-login/*`、`src/client/account-terminal.tsx`、`src/client/settings-dialog.tsx`、`src/client/styles.ts`。
- 文档：`doc/settings-ui-design.md`（账号行同排截断规则）、README（如行为说明有变）。
