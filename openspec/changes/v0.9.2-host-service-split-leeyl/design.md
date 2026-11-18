# Design

## Context

- `src/host/index.ts`：3768 行。第 280 行起是 `CliWorkerService extends TypertRemoteService`，74 个 `@Remote` 方法从约第 1647 行开始；之前约 1370 行是构造、生命周期与内部辅助方法。
- `vitest.config.ts` 只对 `/src/host/index.ts` 做装饰器转换；`scripts/build.mjs` 的暂存清单以 `./src/host/index.ts` 为 Host 入口，Typert 生成器据此生成 `lib/typert.remote-client.d.ts`。
- 74 个 Remote 方法按名称大致分为：Harness 会话与 DSH 子 Agent（6）、历史、运行中消息设置与角色预设（6）、Worker 管理（改名、目标、删除、恢复、分叉，9）、通用设置与 CLI 启用（3）、CLI 管理与更新（11）、连接与账号（约 20）、模型目录、选型与权限（约 9）、消息发送与续聊队列（约 12）。精确归属在任务 1 中按 this 字段依赖核定。

## Goals / Non-Goals

**Goals：** index.ts 少于 1000 行；拆出的每个模块不超过 1000 行；远程契约逐字节不变；全量测试与 Desktop 行为不变。

**Non-Goals：** WorkerRuntime 拆分、目录化、改名、功能调整、修复存量 lint 警告（新代码不得新增）。

## Decisions

### 决定 1：Remote 门面留在 index.ts

装饰器转换和 Typert 生成都只认 `src/host/index.ts`。把 `@Remote` 方法留在原类中、方法体改为委托，契约与构建配置都不用改。备选方案（把 Remote 分散到多个类或改装饰器转换范围）需要改构建与契约生成，风险高，不采用。

### 决定 2：领域模块用普通类或函数，经上下文对象共享状态

领域模块不使用装饰器，构造时接收一个只读的上下文对象（运行时、存储、订阅、配置、日志等现有字段的引用）。不引入依赖注入框架和全局单例，避免改变初始化顺序与生命周期清理。

### 决定 3：逐领域拆分、每步可回退

每个领域单独一次本地提交，提交前类型检查与全量测试通过。出现行为差异时只回退该领域的提交。

### 决定 4：以产物对比证明契约不变

拆分前后各跑一次 `pnpm build:preview`，对比 `lib/typert.remote-client.d.ts` 与 `lib/` 文件清单；新增文件只能是新领域模块的编译产物。

## Risks / Trade-offs

- 隐式共享 `this` 状态遗漏 → 任务 1 先列出每个方法用到的字段；全量测试与 Desktop 实测兜底。
- 与其他改动冲突 → 拆分期间不并行修改 index.ts；进行中的 `vnext-plan-exit-agy-background-leeyl` 代码已完成，只剩一项待用户处理的验证。
- 0.9.2 为热修复版本 → 只做内部结构调整，用户行为不变。
