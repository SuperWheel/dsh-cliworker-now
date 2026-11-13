## Why

2026-10-26 Desktop 复验中，用户消息「请调用 1 次 CLI Worker 派遣工具，使用 Grok（Grok Build）…」没有派遣任何任务。离线复现：`invocationResolution` 把「调用」之后的「1 次」当作 CLI 名，`resolveCliName('1 次')` 返回 unknown，路由提示要求主 Agent「不启动、不猜测」，主 Agent 只回复了候选列表。同类说法「调用 2 次 CLI Worker」「请调用一次 CLI Worker 派遣工具，使用 Grok」也分别得到 unknown 或单候选 ambiguous。

## What Changes

- 路由识别明确调用时，先去掉紧跟调用动词的次数/数量词（阿拉伯数字或「一二两三四五六七八九十几多」加「次/个/回/遍」，不含「一次性」），再判断是否为插件自身调用或 CLI 名。
- 「调用 N 次 CLI Worker 派遣工具」按插件自身调用跳过，不再产生错误的未知 CLI 提示；同一句后续的「使用 Grok」等仍正常解析。「调用 2 次 codex cli」解析为 codex。

## Capabilities

### Modified Capabilities

- `worker-dispatch`：新增“调用次数不是 CLI 名称”。

## Impact

- Host：`src/host/routing.ts`。
- 测试：`tests/routing.test.ts`。
- 未处理：`使用 Grok（Grok Build）` 中名称后紧跟全角括号时仍不产生提示（主 Agent 自行判断，可正常派遣），不在本变更范围。
