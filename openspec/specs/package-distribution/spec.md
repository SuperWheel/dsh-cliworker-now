# package-distribution Specification

## Purpose

让 macOS 和 Windows 用户从默认中文 GitHub 首页或完整英文页面获取准确的安装与能力说明，并用固定版本的一条命令安装完整的预构建插件包，发布资产能够通过远端下载和校验核对。

## Requirements

### Requirement: 双语首页与单行安装
README.md SHALL 默认提供中文首页，完整英文页有双向语言切换。推荐安装代码块 MUST 只含一条可执行命令，无上下注释；命令使用相同跨平台 dsh plugin 语法、明确profile和实际已发布的预构建 npm 包名及 `@latest` 选择器，保留GitHub Release预构建包作为备用来源。

#### Scenario: 打开仓库首页
- **WHEN** 用户打开 GitHub 默认分支首页
- **THEN** 默认显示中文，English 链接打开完整英文介绍，语言切换和图片路径有效

#### Scenario: 跨平台安装
- **WHEN** macOS 或 Windows 用户已配置 Desktop 的 dsh 命令并执行安装行，且安装器当前策略允许 npm latest 版本
- **THEN** 通过包名将执行时的 npm latest 版本安装到指定 profile，无需用户克隆、构建源码或批准插件prepare脚本；web/desktop profile 含义准确

#### Scenario: 主动升级已有安装
- **WHEN** 用户已有旧版插件并再次执行推荐的 `@latest` 安装命令，且安装器当前策略允许 npm latest 版本
- **THEN** 指定 profile 更新至执行时的 npm latest，文档明确只有执行更新命令才更新，不把宿主启动描述成自动更新

#### Scenario: 安装器暂缓刚发布版本
- **WHEN** npm 已公开新版本，但安装器的新版本等待策略仍选择旧版本
- **THEN** 安装说明明确等待规则及核对实际版本的方法，不把命令退出成功视为升级成功；保留已验证的固定预构建来源，不修改用户安装器保护配置，最新版本升级验收保持待办

#### Scenario: Registry未发布
- **WHEN** 对应npm版本尚未发布或发布失败
- **THEN** 不把不存在的短命令宣传为可安装；保留已验证的预构建Release来源及明确待办，不以源码简写冒充预构建安装

### Requirement: 发布证据与能力范围
Release SHALL 包含版本一致的完整预构建包和校验文件，npm和Release远端下载 MUST 与同一公开预构建包哈希一致，并验证独立 profile 的固定 npm 版本安装及通过 `@latest` 从旧版升级。能力说明 SHALL 区分平台运行层验证与第三方 CLI/模型实际调用，不能把 mock、安装成功或目录可读写作生成成功。

#### Scenario: 发布资产验证
- **WHEN** 新版 Release 上传并公开
- **THEN** 查询npm发布记录并下载实际registry及Release文件核对校验，确认 Host/Client/协议/辅助资产完整，不包含凭据或私有日志

#### Scenario: 第三方运行限制
- **WHEN** 某 CLI 在 Windows 没有可用原生安装或未获得调用授权
- **THEN** 保留对应依赖或未验证范围，不因插件可安装就声称该 CLI 和全部模型真实通过

### Requirement: GitHub 源码安装入口
分发文档 SHALL 提供 `github:SuperWheel/dsh-cliworker-now` 的 Desktop 和 Web 原生安装方式、必要构建工具，并说明未固定引用跟随仓库默认分支、固定 commit 对应特定源码。Git 源安装 MUST 在满足构建前置条件且安装器允许该依赖构建后生成完整 Host、Client、协议及辅助资产；未授权或构建失败不得称为安装完成。插件不得自动修改用户构建保护配置或系统工具环境。npm 与 Release 预构建包继续不含构建生命周期脚本，普通源码安装依赖不自动重建当前插件。

#### Scenario: 已允许目标源码构建
- **WHEN** 用户已准备文档要求的构建工具，并按安装器提示允许该确切源码依赖构建
- **THEN** 生成完整可加载产物并按实际包名注册，无需手动克隆和单独运行构建命令

#### Scenario: 尚未允许源码构建
- **WHEN** 安装器拒绝首次 Git 源依赖的构建
- **THEN** 保留原生错误和确切依赖标识，文档说明仅对对应来源授权后重试，不提供全局放开脚本的步骤，不伪报安装成功

#### Scenario: 缺少源码构建工具
- **WHEN** 安装器能下载源码，但构建时不能调用所需包管理器
- **THEN** 保留原生失败，文档指引准备构建工具后重试，不把下载成功称为安装完成，也不自动修改系统 PATH

#### Scenario: 指定源码提交
- **WHEN** 用户在 GitHub 简写后添加完整 commit 引用
- **THEN** 安装与该提交对应的源码产物，不把默认分支或同版本号的其他源码当作同一个安装来源

#### Scenario: 普通依赖安装与预构建分发
- **WHEN** 开发者在现有源码仓库安装依赖，或用户安装 npm/Release 预构建包
- **THEN** 不因为本次新增 Git 源安装钩子自动重建当前 Desktop 链接；已发布 v0.7.8 资产保持不变

### Requirement: 原生会话界面的完整安装交付
公开预构建包 SHALL 包含其原生子会话所必需的界面资源与许可，使用官方 profile bundle 接口接入，不依赖开发机的绝对路径或未分发覆盖。安装后的干净官方环境 MUST 能打开真实 Worker 子会话并接收公开过程和统计；存在不兼容或重复来源时须保留明确错误，不把 Host 加载成功写成完整安装成功。

#### Scenario: 干净跨平台安装
- **WHEN** macOS 或 Windows 用户向受支持的干净官方 profile 安装固定预构建包
- **THEN** 同一安装来源提供必需的界面资源，原生 Worker 子会话可打开，公开数据与未知值按原规格显示，无需手工填写开发机路径

#### Scenario: 保留用户配置和冲突边界
- **WHEN** 目标 profile 已有界面覆盖或相同模块来源
- **THEN** 只按官方层次和核验过的迁移处理已知插件项；不任意删除用户配置，不同时注册两个来源；不能安全接入时明确阻止并保留可回退状态

#### Scenario: 卸载与回退
- **WHEN** 用户卸载本插件或恢复上一已验证版本
- **THEN** 本插件的界面覆盖随所属 bundle 移除，官方入口可恢复，用户原配置、账号和会话数据保持，不改写官方应用文件

#### Scenario: 公开资产可复核
- **WHEN** 准备 npm、GitHub Release 或源码安装产物
- **THEN** 完整界面资产与固定官方基线、源码补丁、内容摘要和许可对应，不含私人路径、凭据或运行日志，预构建安装不执行构建钩子

### Requirement: 市场禁用不得占用宿主原生界面行
插件的 bundle 归属 SHALL 与宿主 stock UI 行分离。市场重放插件禁用状态或从 profile 移除本 bundle 后，宿主原生 UI MUST 保持可用；启用时每个官方客户端包身份 SHALL 只有一个活跃来源。

#### Scenario: 禁用记录重放
- **WHEN** 插件已安装且市场持久化禁用列表包含本插件，宿主重新启动
- **THEN** stock 会话、对话、子 Agent、聊天 UI 保持启用，插件客户端不出现在活跃清单中

#### Scenario: 启用插件
- **WHEN** 用户启用插件并完成所需重启
- **THEN** 经预检的内置界面成为唯一来源，仍发布为原有官方客户端包身份，插件客户端正常注册

### Requirement: 界面来源切换保持原生设置契约
替换原生界面来源 MUST 保留原有设置命名空间和持久化行为。既存按 stock id 写入的配置 SHALL 生效；界面修改、重置、重启及禁用插件后 SHALL 使用一致的设置值，不得静默丢弃配置或以仅模块加载成功代替设置验收。

#### Scenario: 既存原生配置
- **WHEN** profile 或 home patch 对 `ui-chat` 或 `ui-conversation` 配置了值
- **THEN** 启用插件后的原生界面读取相同的有效值，冲突来源仍有明确错误

#### Scenario: 原生设置编辑与恢复
- **WHEN** 用户在启用插件时通过原生设置修改聊天展示或忙时 Enter 行为，随后重启或禁用插件
- **THEN** 设置 API 可读写原命名空间，修改持久化且 stock 界面恢复后仍读取同一值

### Requirement: 随包界面升级保留目标宿主原生行为
随包原生 UI SHALL 基于可核验的目标官方源码与补丁构建，并保留目标版本的原生视图动作、草稿初始化、提交快照、推理显示语义与随包资源。随包 UI MUST NOT 引用目标宿主共享包已移除的导出。发布源码身份 MUST 与实际应用构建标记分别记录；兼容声明须区分隔离验证、正式客户端和真实模型验证。

#### Scenario: rc.3 原生行为
- **WHEN** 在 Harness 0.2.1-rc.3 启用插件
- **THEN** 保留 header views.actions、视图 pin、whenDraftExists 的 append/replace/keep 优先语义，以及 newSession/agentPreset 提交快照字段

#### Scenario: rc.5 推理显示文本
- **WHEN** 在 Harness 0.2.1-rc.5 启用插件，模型推理以 `<signature>…</signature>` 开头
- **THEN** 摘要、展开正文与实时过程摘要只显示签名之后的文本，全为签名时不显示推理行；`conversation.chat.reasoning.body` 同时收到 `rawText` 与显示用 `text`

#### Scenario: 0.2.2-rc.1 随包资源
- **WHEN** 在 Harness 0.2.2-rc.1 启用插件，ui-chat 显示运行中状态
- **THEN** 随包 ui-chat 通过 `./assets/*` 导出提供与官方逐字节相同的图片，宿主资源路由可读取，运行状态动画正常显示

#### Scenario: 0.2.2-rc.1 官方新行为与插件扩展并存
- **WHEN** 在 Harness 0.2.2-rc.1 启用插件
- **THEN** 官方的消息待接收时独立 Stop、断线暂停计时、`holding` 占位与统计药丸文本保持不变；插件的主会话呈现、外部请求状态、未知用量与积分统计仍生效

#### Scenario: 0.2.2-rc.2 共享包导出变化
- **WHEN** 在 Harness 0.2.2-rc.2 启用插件并打开含用量统计的会话
- **THEN** 输入栏上下文用量与轮次统计面板正常渲染，`conversation.composer.bar` 与 `conversation.chat.node` 不因调用 ui-primitives 已移除的 `useAnchoredPosition` 崩溃

#### Scenario: 宿主兼容与重复来源
- **WHEN** 在声明支持的宿主启用或禁用插件
- **THEN** 页面可启动，每个四包身份只有一个活跃来源，启用后原生设置仍可写回 canonical stock 行；不符合接口或来源约束时保留预检错误

#### Scenario: 来源可复核
- **WHEN** 重建或核对随包资源
- **THEN** 固定 tag、真实 Git commit、源码补丁、依赖清单和文件摘要可对应，不把应用短构建标记冒充 tag commit

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

### Requirement: 统一外部分发名称并保留安装界面
GitHub 仓库名、npm 包名、Release 标题与当前外部分发文档 SHALL 使用 `dsh-cliworker-now`。DSH 内插件界面 MUST 保留 CLI Worker / CLI Worker Now 的现有名称，运行时协议、工具、配置、会话与账号存储位置保持兼容。历史截图及已发布不可变包保持真实。

#### Scenario: 外部分发入口
- **WHEN** 用户打开当前仓库、Release 或推荐安装命令
- **THEN** 使用 dsh-cliworker-now 名称和新仓库地址，旧新 GitHub 下载入口取得同一已发布包

#### Scenario: 已安装的界面
- **WHEN** 用户打开 DSH 中的插件页签、侧栏或设置弹窗
- **THEN** 显示原有 CLI Worker / CLI Worker Now 名称，现有按钮提示、账号、会话和偏好保持不变

#### Scenario: 外部目录尚未迁移
- **WHEN** dshfind 改名映射提交而目录数据库迁移或统计采集尚未执行
- **THEN** 明确区分已提交补丁与公开页面生效，不伪造下载量、不把 PR 已提交视为目录已更新

### Requirement: 热切换后页面自动恢复
插件客户端 SHALL 识别热启用、热停用或界面来源替换造成的根节点崩溃（`#root` 已由 React 挂载但没有内容），并在宿主模块同步结束、确认仍为空后，优先重启 DSH 自己的应用挂载原地恢复，MUST NOT 另建 React 根。原地恢复不可用时，网页 SHALL 刷新一次且同一标签页 30 秒内 MUST NOT 再次自动刷新；DSH Desktop MUST NOT 刷新，SHALL 显示要求完全重启的纯文本提示。冷启动时 MUST NOT 触发；销毁后的观察 SHALL 有时限并自行结束。

#### Scenario: 热启用后白屏
- **WHEN** 用户在页面打开时启用插件，宿主热重载使页面白屏
- **THEN** 插件客户端在模块同步结束后重启 DSH 的应用挂载，页面不刷新即恢复，CLI Worker 可用

#### Scenario: 热停用后白屏
- **WHEN** 用户在页面打开时停用插件，原版界面回来前页面白屏
- **THEN** 插件客户端销毁时开始的观察在 60 秒内原地恢复页面，显示原版界面

#### Scenario: 原地恢复不可用
- **WHEN** 找不到唯一的 DSH 应用挂载，或模块同步失败、重挂后仍为空
- **THEN** 网页刷新一次；DSH Desktop 不刷新，显示「需要完全退出后重新打开」的提示

#### Scenario: 冷启动与正常页面
- **WHEN** 宿主冷启动加载插件，或页面在观察期内一直正常
- **THEN** 不做任何恢复动作，观察到期后结束

#### Scenario: 刷新后再次白屏
- **WHEN** 网页自动刷新后 30 秒内再次白屏且原地恢复不可用
- **THEN** 不再刷新，保留页面，并在控制台说明需要手动重启
