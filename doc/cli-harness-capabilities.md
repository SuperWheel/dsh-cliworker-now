# CLI 附件、Harness Skill 与 MCP 接入

适用开发版本 v0.8.1，更新于 2026-10-18。下表描述当前代码的接入口，实际运行证据另见 `tasks.md`，不能用协议支持代替真实模型验收。

## 1. 逐 CLI 接入

桌面端普通文件统一采用原生草稿引用语义，把用户选定的真实路径交给 CLI。下表的内容块列描述 Host 已经准入附件时的转换；不能据此宣称 rc.2 子会话已接受浏览器普通文件上传回执。

| CLI | 文件输入 | 图片输入 | Harness Skill / MCP 工具桥 |
| --- | --- | --- | --- |
| Antigravity | 原生文本中的文件路径 | 图片路径，依赖 CLI 自身读取工具 | 本轮私有 `agy-tools` 工作区的 MCP + PreToolUse Hook；真实工具验收未完成 |
| Codex | 文件路径提示 | app-server `localImage` | 临时 stdio MCP；Host 执行权限链保留 |
| Claude Code | 文件路径提示 | stream-json 原生 base64 图片块 | 临时 `--mcp-config`，仅专属 server 准入 |
| Kimi | ACP `resource_link` 与路径提示 | ACP 公示 image 能力时用图片块，否则图片路径 | stdio MCP；只对结构化、精确命名的桥工具回复 `allow_once` |
| 官方 MiMo Code | 原生 HTTP data URL file part | 同原生 file part | 本轮 `MIMOCODE_CONFIG_CONTENT` 中合并专属 MCP |
| ZCode | 原生消息中的文件路径 | 图片路径，依赖 CLI 自身读取工具 | 执行尚未核验，2026-10-28 起不注入目录 |
| Grok Build | ACP `resource_link` 与路径提示 | ACP 公示 image 能力时用图片块，否则图片路径 | stdio MCP；与 Kimi 相同的精确准入 |
| OMP | RPC prompt 中的文件路径 | 图片路径，依赖 CLI 自身读取工具 | 当前安装版在 `--no-extensions` 下忽略显式扩展，保留限制 |
| Pi | RPC prompt 中的文件路径 | RPC `images` 原生图片块 | 只加载本轮显式扩展并注册获准工具 |
| Hermes | 原生 HTTP input 中的文件路径 | 图片路径，依赖 CLI 自身读取工具 | 当前隔离运行暂无经验证的临时工具注入入口 |
| OpenCode | 原生 HTTP data URL file part | 同原生 file part | 本轮 `OPENCODE_CONFIG_CONTENT` 中合并专属 MCP |
| Qoder | ACP `resource_link` 与路径提示 | ACP 公示 image 能力时用图片块，否则图片路径 | stdio MCP；与 Kimi 相同的精确准入 |
| Qoder CN | 同品牌 ACP `resource_link` 与路径提示 | 同品牌 ACP 公示 image 能力时用图片块，否则图片路径 | 独立品牌绑定的 stdio MCP，精确准入；真实模型未验收 |

2026-10-28 起工具桥只提供 CLI 原生未覆盖的 DSH 工具作为备选，见 [native-harness-tools.md](native-harness-tools.md)「原生工具优先」。

路径输入表示 CLI 使用自身工具按需读取，不等同于图片已直接送达视觉模型。模型能否理解特定图片/文档，继续由该 CLI 的真实能力决定。旧 `legacy` 会话不开放附件，也不能靠新增附件切换原生会话身份。

## 2. 附件链路

CLI 子会话加号菜单增加“添加文件”和“添加图片”。macOS / Windows Desktop 的普通文件沿用原生桌面文件引用语义：通过宿主 preload 提供的 `__DSH_HOST_PATHS__.pathFor` 取得用户实际选择的路径，以公开 `SessionInput.insertReference` 和 source codec 写入原生草稿，发送时由原生输入机和 Inbox 接管；不新增一套上传队列。引用保留原始绝对路径，CLI 按自身权限读取。CLI 绑定通过可选 `childImageUploads` 显式启用随插件分发的原生图片选择控件，默认原生子会话不变；图片通过公开指令 adjudication 调用 Harness 原生 File action，上传、持久化及历史仍由原生 attachments 服务管理。当前 rc.2 子会话不接收普通文件上传回执，Web 端因此只开放图片，不把缺少真实路径的浏览器文件冒充桌面引用。

对已经准入的原生附件块，Host 只消费本会话真实附件引用，通过 `imageHostPath/fileHostPath` 与当前 child scope 的 `fs.processPathFromHostPath` 得到执行路径，不接受浏览器提供的任意路径。后端无本机路径映射、附件失效或类型不支持时明确拒绝。

私有 `cliworker-native` 路由按已实现的附件转换能力声明输入可含图片，使原生输入准入不再把转发路由误判为仅文本模型。该声明不表示下游模型拥有视觉；ACP 只有在 initialize 明确公布 image prompt 能力时才发送图片块，其他情况使用校验后的图片路径。

`harness-attachments.ts` 分离用户文本、原生附件引用和回执摘要。相同 RPC 身份必须连同附件身份一致；纯文本旧回执保持兼容。生成期间的附件留在真实 Inbox，不转成当前轮纯文本引导。首轮、合批、冷恢复不重新执行已接收输入，原生消息历史保留完整附件块。

`native-attachments.mjs` 统一校验文件身份、图片字节类型及取消信号，再按上表转换。Windows 路径、中文、空格和 URI 由 Node 原生路径 API 处理，文件名作为数据转义，不构造 shell 命令。不改写或删除宿主原附件；本轮私有请求文件仍随受管进程清理。

内联图片单张上限 20 MiB、合计 32 MiB；一次最多 20 个附件。HTTP 内联文件和图片合计上限 32 MiB。路径形式普通文件不读取整份文件到插件内存。超限返回具体错误，不截断文件后声称成功。原生协议原有的单帧和整轮输出上限仍生效，真实大图片、长会话及所有模型视觉能力未纳入本次最小验收。

## 3. 技能与工具的权限归属

复用 `native-harness-tools.ts`，从真实子 Agent 的公开 `tools.schemas` 读取普通工具及已配置 MCP，调用进入 `tools.execute`；不复制 MCP 服务凭据或用户全局配置。运行、父子身份、撤销、重复调用、取消和清理继续受现有桥约束。原生 CLI 已执行的工具只投影，不二次执行。

`dsh_list_skills`、`dsh_read_skill`、`dsh_read_skill_resource` 通过 child scope 的技能服务按需读取获准摘要、正文及相对资源，不一次性复制所有 Skill。技能存在不代表其所有依赖均可用；未声明依赖仍标为未验证，已声明但不可用的依赖拒绝加载。

ACP 仅接受 Provider 结构化报告的工具名与本轮桥实时目录完全匹配，且只有原生 `allow_once` 选项时才准入。标题、描述和 `rawInput` 不构成权限证明；任意命名空间前缀本身也不是授权。CLI 侧允许抵达专属桥后，宿主依然逐次执行真实审批。陌生工具、当前会话不符或目录已撤销时继续拒绝。

递归派遣、额外 DSH 模型生成和尚未忠实适配的非文本工具输出继续受限。第三方 MCP 服务端的内部行为由该服务负责，不能将通用工具桥称作所有外部服务均已验收。

## 4. 参考与验收

参考 Codingns4DSH `27b4c95065e9f3ae01d513c60673a871487257f3` 的附件存储解析及按协议转换经验，自主实现；不照搬其对子代理/Team 的专用 MCP 桥作为整个 Harness 工具目录。

- [原生工具桥及此前证据](native-harness-tools.md)
- [原生会话与界面](native-conversation-ui.md)
- [实际最小验收记录](tasks.md)

macOS / Windows 使用同一转换及去重模块；本轮桌面验收只在 Windows 进行。模拟 CLI、安装版元数据和真实模型调用分别记录，未运行的项目保留未验证。


## 5. 2026-10-18 最小验收

Windows Qoder 1.1.73 在同一已选模型和原会话中完成文件 + PNG 续聊：两次 Harness MCP 桥文件读取、一份获准 Skill 目录和 office 正文均有完成事件；文件中的随机标识两次一致。最终客户端连续添加两个不同文件不覆盖，冷启动保留旧历史，验收草稿清除。其他 CLI 的本轮证据是源码/协议及关联回归，不等于真实模型逐个通过；第三方 MCP 服务端没有额外实测。

macOS 关联初始 404/404、路由 141/141、最终客户端 30/30；Windows 对应 401/404（3 平台跳过）、140/141（1 平台跳过）、30/30。原生输入 120、侧栏 18 项另行通过，分组不相加。两端类型检查和隔离构建通过，实际桌面仅 Windows。具体安装、数据变化及未验证范围见 tasks.md 本阶段。
