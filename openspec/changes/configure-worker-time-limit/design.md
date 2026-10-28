# Design: 任务时限

- 设置存储沿用通用设置页的持久化（与「同目录写任务并行」「调用前询问模型」同一存储），新增 `taskTimeLimitMinutes`（`null` 表示不限制）与 `idleTimeLimitMinutes`（`null` 关闭）。旧 Cordis `timeoutMs` 作为初始值来源。
- 「不限制」实现为 24 小时上限（沿用 schema 最大值 86,400,000 ms），避免计时器永不触发导致残留；界面文案写「不限制（最长 24 小时）」。
- Host 在 `execute()` 开始时计算 `deadlineAt`，写入桥请求；`native-bridge.mjs` 用 `deadlineAt - now` 计时；runner 的 `waitFor`/`turn/start` 超时改为剩余时间。`runtime.ts:2167` 的计时改为同一 deadline。
- 空闲时限：桥在 `io.event`/`io.native` 出口重置空闲计时器；Host 侧不重复计时。
- agy `--print-timeout` 传剩余秒数；不限制时传 24 小时。
- UI：通用设置页新增「任务时限」分组，两个下拉（总时限：30 分钟/1/2/4/8 小时/不限制；空闲：关闭/5/10/30 分钟），控件与间距按 `doc/settings-ui-design.md`。
- 风险：时限放长后卡死任务占用并发槽更久。缓解：空闲时限、现有停止按钮。
- 回退：设置缺省即回到 30 分钟。
