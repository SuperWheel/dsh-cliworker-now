## ADDED Requirements

### Requirement: Windows 账号登录窗口的终端解析
登录窗口的引导 SHALL 按账号终端的「当前屏幕」判断步骤：解释光标移动、擦除、折行与备用屏幕，屏幕行数和列数有上限；登录链接 SHALL 取自当前屏幕上完整的网址或 OSC 8 链接目标，且只接受该 CLI 在共享白名单中登记的登录域名；设备码 MUST 是当前屏幕上完整的一段，MUST NOT 把被分块输出截断的前缀当作验证码。客户端隐藏的终端 SHALL 按 Host 返回的尺寸初始化，尺寸变化 SHALL 同步给引导。CLI 尚未画出任何文字时，引导 MUST NOT 判定为需要改用原生终端。

#### Scenario: 链接被折行或缩短显示
- **WHEN** Pi 或 OMP 在 ConPTY 中把 OAuth 链接折成多行，或用 OSC 8 只显示缩短的文字
- **THEN** 登录窗口打开的是完整链接，且该链接位于此 CLI 登记的登录域名下

#### Scenario: 设备码分块到达
- **WHEN** Kimi 的 `enter code:` 行在一次读取中只到达验证码前半段
- **THEN** 登录窗口不显示该前缀，直到整行完整后才显示验证码

#### Scenario: OpenCode 与 Hermes Nous 的登录页
- **WHEN** OpenCode 选择 ChatGPT 浏览器登录，或 Hermes 选择 Nous 设备登录
- **THEN** 登录窗口显示并可打开 `auth.openai.com`、`portal.nousresearch.com` 上的页面；其他域名不显示为可打开的链接

### Requirement: Windows 账号终端启动
Windows 账号终端 SHALL 在 CLI 启动前完成控制台归属与父进程校验；父进程校验 SHALL 持有被校验进程的句柄，读取失败、进程已退出或父进程不是 Host 时 MUST 拒绝启动。ConPTY 在客户端接上之前发出的首个主设备属性查询 SHALL 由 Host 以账号窗口终端的身份回应一次，并从回放给客户端的输出中去掉该查询；之后的查询与其他字节 MUST 原样传递。

#### Scenario: 打开登录窗口
- **WHEN** 用户在 Windows 上打开任一 CLI 的登录窗口
- **THEN** 引导脚本不必等待客户端回应设备属性查询即开始执行，CLI 只收到一次回应

#### Scenario: 父进程校验失败
- **WHEN** 控制台宿主进程已退出或其父进程不是 Host
- **THEN** 账号终端启动失败并清理已启动的进程，不运行 CLI

### Requirement: 各 CLI 登录步骤与原生提示一致
登录窗口 SHALL 按已安装 CLI 实际打印的提示推进，MUST 在 CLI 确认保存后才进入「确认登录」，MUST NOT 回显原生错误或请求网址。

#### Scenario: Hermes 先问 Key 后问名称
- **WHEN** Hermes `auth add <provider> --type api-key` 在粘贴 Key 后询问可选名称
- **THEN** 插件回车保留原生默认名称，看到 `Added … credential #N` 后才确认登录

#### Scenario: Grok 回调未自动完成
- **WHEN** Grok 提示粘贴浏览器跳转网址
- **THEN** 输入框标为「回调网址」，提示粘贴浏览器最后跳转的完整网址

#### Scenario: Grok 连不上登录服务
- **WHEN** Grok 在打印网址前报告请求超时或 TCP 连接失败
- **THEN** 登录窗口结束并提示检查网络或代理，不显示原生错误原文

#### Scenario: OpenCode 的 OpenAI 登录方式
- **WHEN** OpenCode 为 OpenAI 显示登录方式菜单
- **THEN** 登录窗口提供浏览器、设备码、API Key 三种选择；其他服务商的方式菜单交给原生终端

#### Scenario: OpenCode 退出单个服务商
- **WHEN** 用户在账号窗口退出 OpenCode 的某个服务商，且该服务商只在一处 `auth.json` 中有凭据
- **THEN** 插件用 OpenCode 自己的 `auth logout` 作用于那一处凭据；凭据同时存在于多处或来自 `opencode.json` 时拒绝并说明请在原生配置中管理

#### Scenario: OMP 18.x 授权码输入框
- **WHEN** OMP 18.x 在登录对话框中等待授权码或完整跳转网址
- **THEN** 登录窗口提供粘贴框，粘贴后提交给该输入框，并继续观察登录结果

#### Scenario: ZCode 账号绑定未确认
- **WHEN** ZCode 插件凭据目录中只有身份或令牌、无法确认账号绑定
- **THEN** 摘要提示「账号绑定未确认，请重新登录」，不显示为已登录
