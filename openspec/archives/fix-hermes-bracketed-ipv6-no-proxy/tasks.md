## 1. 实现

- [x] 1.1 `hermesNoProxyEnvironment`：改写带括号/端口/CIDR 的 IPv6 旁路为裸地址并去重；`hermesAccountEnvironment` 合入，覆盖账号终端、续期与任务运行。

## 2. 自动检查

- [x] 2.1 `tests/hermes-no-proxy.test.ts`：实测值改写、大小写两种变量、IPv4/域名不变、无需改写与通配符不覆盖、合入账号环境。
- [x] 2.2 Hermes/账号/绑定相关 44 个测试文件通过（957 通过、1 跳过）；`build:preview` 通过。
- [x] 2.3 Hermes 自带 Python：`[::1]` 复现 `Invalid port: ':1]'`，裸 `::1` 正常；DSH 代理变量下 Nous 凭据解析成功。

## 3. 真实验收

- [x] 3.1 Desktop 重启后：Hermes 状态不再显示“暂时无法续期”，账号终端选择 Nous Portal 不再报 `Invalid port`。
  - 2026-10-25 新 Host 15:38（e923fee）：账号终端进程环境 `NO_PROXY`/`no_proxy` 为 `localhost,127.0.0.1,::1,.local`（此前带 `[::1]`），代理地址不变；状态为「Nous账号登录」；选择 Nous Portal 后显示 Current model / Active provider 与模型列表，未出现 Could not verify credentials 或 Invalid port；未选模型即关闭，config.yaml 未变。
  - 说明：本次过期令牌的续期由主会话在干净环境中运行同一续期操作完成（回执 ready）；修复后由插件自身触发的续期尚未在真实过期场景复验（需等令牌再次过期）。
- [x] 3.2 设置页 Hermes 模型下拉曾持续显示「正在读取 Hermes Agent 模型…」：用户 2026-10-25 自行检查后确认没有问题，未改代码。
