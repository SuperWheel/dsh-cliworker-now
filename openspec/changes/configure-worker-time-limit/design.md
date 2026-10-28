# Design: 任务时限

- 设置存储沿用通用设置页的持久化（与「同目录写任务并行」「调用前询问模型」同一 `general-settings.json`），新增 `taskTimeLimitMs`（1,000–86,400,000）与 `idleTimeLimitMs`（`0` 或 60,000–86,400,000，`0` 关闭）。以毫秒存储，与 Cordis `timeoutMs` 同单位；不用 `null` 表示不限制或关闭，因为通用设置补丁中的 `null` 已表示「恢复部署默认值」。
- 旧 Cordis `timeoutMs` 作为初始值来源，与「最高同时对话数」相同：未保存选择时有效总时限即配置值，Host 返回 `defaultTaskTimeLimitMs` 供界面标注「（默认）」；不向存储写入迁移值，用户选择后才保存。
- 「不限制」实现为 24 小时上限（schema 最大值 86,400,000 ms），避免计时器永不触发导致残留；界面文案写「不限制（最长 24 小时）」。
- Host 在任务第一次 `execute()` 时从当时的设置生成一次 `{ deadlineAt, totalMs, idleMs }` 并存在任务上：运行中修改设置只影响之后启动的任务；换号续接（carryover）沿用同一截止时间；因账号占用退回队列（未启动进程）时清除，重新入场时再生成。
- Host 总时限计时器读同一 `deadlineAt`；`deadlineAt`、`idleTimeoutMs` 与总时限 `timeoutMs`（兼容旧桥）写入桥请求。
- `native-bridge.mjs` 用 `native-time-limit.mjs` 计时：截止时间取请求的 `deadlineAt`（旧请求没有时从桥启动起按 `timeoutMs` 计）；启动时把 `config.timeoutMs` 改为剩余时间，各 runner 的 `waitFor`/`turn/start` 等超时因此按剩余时间计且不早于桥的截止时间，无需逐个改 runner。ZCode 私有账号材料的有效期改按 `deadlineAt` 判断，避免剩余时间被重复扣减。
- 空闲时限：桥对每条输出帧（session、event、native、result），以及 CLI 子进程的任何原始 stdout/stderr 输出续期（`createNativeIO` 的 `onNativeOutput` 只通知、不带内容，覆盖 Claude `keep_alive` 等被 runner 丢弃的心跳）；经 HTTP/SSE 接收而未转发的心跳不续期。超时以 `Native task idle timed out` 结束；总时限仍为 `Native task timed out`。Host 不对桥重复计空闲；不经 `native-bridge.mjs` 的通路（Pi/OMP RPC 桥与旧协议）由 Host 按子进程 stdout/stderr 输出续期。
- 停止与报告：桥超时后照常停止 runner、等子进程退出再写结果并退出；Host 识别这两个结果后按与自身计时器相同的方式中止本轮（`interrupted`，说明「任务超时：已达到总时限 2 小时」或「任务超时：连续 10 分钟没有收到 CLI 事件（空闲时限）」），并在 `waitForExit` 确认进程范围退出后才结束任务。Client 将两条说明映射为英文。
- agy `--print-timeout` 传剩余秒数（至少 1 秒）；不限制时为 24 小时。
- UI：通用设置页新增「任务时限」分组（位于「任务调度」之后），两个原生下拉（总时限：30 分钟/1/2/4/8 小时/不限制，另含部署默认值与当前值；空闲：不启用/5/10/30 分钟）。空闲关闭的选项文案用「不启用」，因「关闭」词条已表示关闭按钮（英文 Close）。控件与间距按 `doc/settings-ui-design.md`。
- 风险：时限放长后卡死任务占用并发槽更久。缓解：空闲时限、现有停止按钮。空闲期间若 CLI 在等待用户审批且无任何输出，也会按空闲超时停止（合并 `relay-native-approvals-to-host` 后已处理：桥在等待审批期间暂停空闲计时，总时限照常）。
- 回退：设置缺省即回到 Cordis `timeoutMs`（默认 30 分钟），空闲关闭。
