## ADDED Requirements

### Requirement: Windows 系统代理继承
在 Windows 上，继承环境与启动参数都没有设置 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`（任意大小写，含显式删除）时，插件 SHALL 读取当前用户「Internet 选项」中已开启的单一 HTTP 代理，并给它启动的每个 CLI 进程和账号终端补 `HTTP_PROXY`、`HTTPS_PROXY` 与 `NO_PROXY`；`NO_PROXY` MUST 合并继承值、回环地址（`localhost`、`127.0.0.1`、`::1`）及能以主机或前导通配域名表达的代理例外，且只保留一种大小写拼写。Host 自身及其子进程（如 Pi/OMP 桥）对 CLI 账号与模型服务的 HTTPS 只读查询 SHALL 按 CLI 实际得到的代理（系统代理或用户导出的 http/https 代理变量）与例外建立隧道。读数 SHALL 在 15 秒后失效重读；读取失败、代理关闭、仅有 SOCKS 或地址无法识别时 MUST 视为没有代理，MUST NOT 沿用旧读数。macOS 与其他平台 MUST NOT 读取或注入系统代理。

#### Scenario: 只在「Internet 选项」开代理
- **WHEN** Windows 用户在「Internet 选项」开启 `127.0.0.1:<端口>` 代理，环境中没有任何代理变量，用户打开 Grok 登录窗口
- **THEN** Grok 进程收到指向该代理的 `HTTP_PROXY`/`HTTPS_PROXY`，`NO_PROXY` 包含回环地址，登录页面地址正常出现

#### Scenario: 已有代理设置
- **WHEN** 继承环境或某个 CLI 的启动参数已设置（或显式删除）任一代理变量
- **THEN** 插件不补、不改任何代理变量

#### Scenario: 关闭代理
- **WHEN** 用户关闭「Internet 选项」代理超过 15 秒后启动新的 CLI
- **THEN** 新进程不带插件补充的代理变量；已经运行的进程不受影响

#### Scenario: Host 查询模型目录
- **WHEN** Windows 上 Codex 已登录、系统代理开启且未被例外排除，设置页刷新模型
- **THEN** Host 对账号模型目录的 HTTPS 只读请求经该代理隧道发出，不因直连超时显示「无可用模型」

## MODIFIED Requirements

### Requirement: Hermes 子进程的 IPv6 代理旁路
插件启动 Hermes（账号终端、续期、任务运行）时 SHALL 把 `NO_PROXY` / `no_proxy` 中带括号、带端口或 CIDR 形式的 IPv6 条目改写为裸地址并去重；IPv4、域名、通配符及无需改写的值 MUST 保持继承，该改写本身 MUST NOT 新增、删除或改变代理地址。Windows 上补充系统代理时按「Windows 系统代理继承」处理，改写后的 `NO_PROXY` 作为其继承值合并。

#### Scenario: DSH 发布带括号的回环地址
- **WHEN** 继承环境 `NO_PROXY=localhost,127.0.0.1,::1,.local,[::1]`
- **THEN** Hermes 进程收到 `localhost,127.0.0.1,::1,.local`，Nous 凭据校验与续期不因代理旁路解析失败

#### Scenario: 无需改写
- **WHEN** 继承的 `NO_PROXY` 不含带括号或 CIDR 形式的 IPv6，或包含 `*`
- **THEN** 该改写不覆盖该变量；只有 Windows 补充系统代理时，按「Windows 系统代理继承」在其基础上合并回环地址与代理例外
