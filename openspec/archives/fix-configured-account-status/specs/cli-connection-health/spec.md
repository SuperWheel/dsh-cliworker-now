# Spec Delta

## MODIFIED Requirements

### Requirement: 简洁账号信息
所有 CLI 设置 SHALL 用一行必要状态、账号身份或短原因表达账号情况；正常状态 MUST 不附加重复的远端验证、凭据有效性或隐私免责声明。账号终端 SHALL 保留必要操作指导和短错误，不重复冗长声明；不能仅截断原有长段落来完成精简。configured 状态 SHALL 在导航状态说明与账号摘要保留 Host 提供的具体摘要，缺失摘要才回退「已配置」；绑定未确认、需检查登录、待续期或缺少有效凭据 MUST 不被泛化文字掩盖。短原因在空间不足时 SHALL 自然换行并沿用统一文字层级及中性状态。

#### Scenario: 正常设置
- **WHEN** CLI 已登录、已配置或未登录
- **THEN** 账号区只显示对应短状态及必要身份，不拼接第二段防御性说明

#### Scenario: 错误和终端
- **WHEN** 安装、认证、读取或关闭终端失败
- **THEN** 保留简短原因及必要重试动作，不删除实际错误或堆叠免责声明

#### Scenario: ZCode 退出后残留绑定
- **WHEN** OAuth 记录已清除但原生身份和对应绑定密钥仍在，Host 返回 configured 和绑定未确认提示
- **THEN** 设置导航状态说明与账号摘要显示需重新登录原因，不显示泛化「已配置」或已登录，不通过只读刷新删除绑定

#### Scenario: ZCode 退出后只剩 API 配置
- **WHEN** OAuth 已退出且仅剩明确的 API Key 配置或匹配指纹的原生 API 绑定
- **THEN** 设置显示「已配置 ZCode API」类摘要和中性灰点，不冒充 OAuth 登录，不删除 API 配置

#### Scenario: ZCode 退出后无绑定和 API
- **WHEN** OAuth、绑定与 API 配置均不存在
- **THEN** 设置显示未登录和灰点，账号窗口不保留旧账号行

#### Scenario: 其他 CLI 配置尚不可确认
- **WHEN** MiMo、Pi、OMP、OpenCode、Hermes 或其他 CLI 返回 configured 及检查登录、缺少凭据或等待续期的摘要
- **THEN** 导航与账号摘要一致保留该原因，不因模型目录成功而改写为泛化配置成功

#### Scenario: 旧 Host 缺少摘要
- **WHEN** configured 的摘要为空
- **THEN** 使用「已配置」作为回退，不显示空白状态
