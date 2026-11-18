## ADDED Requirements

### Requirement: Host 主服务按领域分模块

`src/host/index.ts` SHALL 只承担 Cordis 注册、`@Remote` 门面方法与 Host 生命周期；门面方法体 SHALL 委托给 `src/host/` 下按领域划分、不使用装饰器的模块，共享状态通过显式传入的上下文对象访问，MUST NOT 新增全局单例。`src/host/index.ts` SHALL 少于 1000 行，单个领域模块 SHALL 不超过 1000 行。拆分或新增接口 MUST NOT 改变 Typert 生成的远程契约中已有接口的名称、参数、返回类型与调用模式。

#### Scenario: 新增一个 Remote 接口

- **WHEN** 开发者为 Host 新增一个对外接口
- **THEN** `@Remote` 方法写在 `src/host/index.ts` 的门面类中，方法体放在对应领域模块，index.ts 仍少于 1000 行

#### Scenario: 拆分前后契约对比

- **WHEN** 拆分前后各执行一次 `pnpm build:preview`
- **THEN** `lib/typert.remote-client.d.ts` 逐字节一致，`lib/` 文件清单只新增领域模块的编译产物
