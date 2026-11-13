# Spec Delta

## ADDED Requirements

### Requirement: 市场安装的宿主 peer 可见范围
插件声明的必选宿主单例 peer（`react`、`react-dom`、`@deepseek-ai/*`）SHALL 限于从 Harness app manifest 沿 dependencies 与 peerDependencies 按声明者位置解析得到的宿主可见闭包。仅由官方开发依赖提供的本地状态工具 MUST 随客户端交付，不得作为宿主外部导入或用可选 peer 掩盖缺失；React、React DOM、Cordis 和 UI primitives SHALL 继续复用宿主单例。

#### Scenario: 市场安装器执行必选 peer 校验
- **WHEN** 市场安装器在依赖安装后校验插件必选宿主单例 peer
- **THEN** 每个必选 peer 都在 Harness 宿主可见闭包中可解析，不因 `@deepseek-ai/dsh-client-store` 缺失而拒绝 generation

#### Scenario: 官方开发依赖不在宿主闭包
- **WHEN** 官方包仅通过 devDependencies 引用 snapshot store，且宿主闭包不包含该包
- **THEN** 插件不声明该包为必选或可选 peer，客户端使用随包交付的实现，模型目录的同步快照、订阅和取消行为保持

#### Scenario: 单例保持外部依赖
- **WHEN** 构建插件客户端并交付本地状态工具
- **THEN** React、React DOM、Cordis 与 UI primitives 的运行时引用仍由宿主提供，不向插件内打入第二份 React
