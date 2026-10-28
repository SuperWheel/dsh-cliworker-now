## 1. 实施

- [x] 1.1 `cli-account-binding.ts`：自定义路由检测改为布尔判定（只看自身配置文件）；新增路线指纹来源，账号绑定在自定义路由时使用指纹。
- [x] 1.2 `codex-models.ts`：自定义路由时使用 Codex 原生 `model/list`，费用未知，前后核对指纹；`adapters.ts` 目录说明改为中转说明，设置页与 Claude 路由一样显示。
- [x] 1.3 `runtime.ts`：派遣与分支启动 Codex 时透传自身配置 `env_key` 指定的变量（模拟验收中发现净化环境缺少该变量）。
- [x] 1.4 `codex-models.ts:12`：`parseCodexNativeModels` 删除 `availabilityNux` 过滤。v0.7.8 只删了官方账号路径 `account-models.mjs:64` 的同类过滤；中转路径只靠原生列表，导致 gpt-6.1-sol 缺失（2026-10-28 中转用户反馈，其 `model/list` 中仅该模型带推广文案）。
  - 2026-10-28：已删除过滤，`hidden: true` 仍排除；加注释说明 `availabilityNux` 是推广文案而非不可用。

## 2. 自动检查

- [x] 2.1 单元测试：中转配置生成绑定、配置/env_key/auth 变化改变绑定、仅继承变量仍拒绝、不安全文件仍拒绝、env_key 透传范围、目录不访问官方查询且查询期间换路线报错、设置页显示中转说明。
- [x] 2.2 类型检查与关联测试、全量 `vitest run`。
- [x] 2.3 改写 `tests/codex-models.test.ts:101`：带 `availabilityNux` 的条目应保留，`hidden: true` 仍排除；确认撤掉 1.4 时该断言失败；跑 `pnpm typecheck` 与关联测试。
  - 2026-10-28：测试改为夹具含 `availabilityNux` 的 `promoted` 条目，期望 `allowed`、`promoted`、`other`；`pnpm test tests/codex-models.test.ts` 12/12 通过；临时恢复过滤后该用例失败（1 failed / 11 passed），已还原；`pnpm typecheck` 通过（DSH 0.2.1-rc.3）。关联测试仅此文件（`rg parseCodexNativeModels|discoverCodexModels|codex-models tests`）。

## 3. 本机模拟验收

- [x] 3.1 隔离 `CODEX_HOME` + 本机模拟中转：经插件 Host 读取模型目录、派遣一轮、续聊一轮、换密钥后续聊；`auth.json` 与 `env_key` 两种密钥形式均核对事件、退出状态及模拟中转请求日志（见 `doc/tasks.md`）。
- [ ] 3.2 真实中转站未验证（无账号），由反馈用户实测。

## 4. 文档

- [x] 4.1 同步 `doc/usage-details.md` 与 `doc/tasks.md`；README 无相关说明，未改。
- [ ] 4.2 1.4 的验证记录写在本文件对应任务下；由反馈用户在中转下确认设置页出现 gpt-6.1-sol。
  - 自动检查记录见 1.4、2.3；真实中转站下的设置页确认尚未进行（无账号，待反馈用户实测）。
