## ADDED Requirements

### Requirement: Hermes 子进程的 IPv6 代理旁路
插件启动 Hermes（账号终端、续期、任务运行）时 SHALL 把 `NO_PROXY` / `no_proxy` 中带括号、带端口或 CIDR 形式的 IPv6 条目改写为裸地址并去重；IPv4、域名、通配符及无需改写的值 MUST 保持继承，插件 MUST NOT 新增、删除或改变代理地址。

#### Scenario: DSH 发布带括号的回环地址
- **WHEN** 继承环境 `NO_PROXY=localhost,127.0.0.1,::1,.local,[::1]`
- **THEN** Hermes 进程收到 `localhost,127.0.0.1,::1,.local`，Nous 凭据校验与续期不因代理旁路解析失败

#### Scenario: 无需改写
- **WHEN** 继承的 `NO_PROXY` 不含带括号或 CIDR 形式的 IPv6，或包含 `*`
- **THEN** 插件不覆盖该变量
