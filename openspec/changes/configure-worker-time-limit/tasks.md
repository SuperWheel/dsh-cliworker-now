# Tasks

## 1. 准备

- [ ] 1.1 阅读 `doc/settings-ui-design.md` 与通用设置页现有分组，确认新增分组位置与文案；与仍在进行的 `add-general-settings-page` 核对字段，避免冲突。

## 2. 实施

- [ ] 2.1 设置存储新增总时限与空闲时限，旧 Cordis `timeoutMs` 迁为初始值。
- [ ] 2.2 Host 计算统一 `deadlineAt` 并写入桥请求；`runtime.ts`、`native-bridge.mjs`、各 runner、agy `--print-timeout` 改用剩余时间。
- [ ] 2.3 桥实现空闲计时器，任何原生事件续期；超时说明区分总时限与空闲。
- [ ] 2.4 Client 通用设置页新增「任务时限」分组。

## 3. 自动检查

- [ ] 3.1 计时夹具：长于 30 分钟（假时钟）不超时、空闲超时、运行中改设置不影响当前任务、旧 `timeoutMs` 继承、超时后进程范围退出才报告。
- [ ] 3.2 设置页渲染与持久化测试；`pnpm typecheck`、关联测试、`pnpm build:preview`。

## 4. 验收

- [ ] 4.1 Desktop 实机核对设置页布局与保存（遵循 Desktop 测试授权）。
- [ ] 4.2 真实长任务验收需已有选型授权；未执行时在本任务下注明。

## 5. 文档

- [ ] 5.1 README（中英）与 `doc/settings-ui-design.md`（若新增设计参数）同步；验证记录写在本文件对应任务下。
