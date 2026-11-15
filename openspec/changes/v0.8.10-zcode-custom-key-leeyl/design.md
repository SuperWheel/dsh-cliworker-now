# Design

## Context
本设计依据以下来源：

- 本机已安装的 ZCode Desktop CLI 0.17.1（`/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`）。
- 插件缓存的 0.16.9（`~/.local/share/cliworker-now/runtimes/zcode/cli/zcode.cjs`）。
- 现有 Host 实现。

对两份 schema 只做静态读取，不运行 CLI。

读取用户全局 `provider_config.json` 时，只按结构脱敏检查字段形状，不输出密钥。

## Goals / Non-Goals
- 目标：订阅过期后能用自有 API Key 派遣 ZCode；兼容 0.16.9／旧版本／0.17.1；不改全局配置；密钥只进 0600 文件。
- 非目标：验证密钥或模型可用性；代管 ZCode 桌面端的服务商；接入 Coding Plan 密钥的新路由。

## Decisions

### 决定 1：按已安装入口的 schema 决定工作流字段位置
- 最终决定：
  - `zcode-schema-probe.ts` 读取 `.cjs/.mjs/.js` 入口（至多 128MB，latin1 解码），找到同时含 `nativeSearchEnhancementsEnabled`、`memoryEnabled` 和 `askUserQuestionAutoResolutionEnabled` 的 `object({…}).strict()`。其中含 `dynamicWorkflowMode` 判为 `preferences`。
  - 否则，若 `offPeakToolEnabled` 后紧跟可选的 `dynamicWorkflowEnabled`、`dynamicWorkflowMode`，判为 `session`。
  - 其余情况判为 `none`。
  - 结果按 realpath、dev、ino、size、mtime 缓存。
  - Host 通过 `CLIWORKER_ZCODE_WORKFLOW_SURFACE` 告知桥接。桥接（`consumeZcodeWorkflowSurface`）读取后同时从配置环境和 `process.env` 删除，CLI 进程看不到该变量。
- 放弃的方案：
  - 按版本号判断。原因：Desktop 内置 CLI 不一定暴露可靠版本，而字段形状才是被拒绝的直接原因。
  - 运行 `--version` 或握手试探。原因：多一次进程启动，且失败代价是整轮派遣失败。
- 影响：所有已知 schema 都是 `.strict()`。省略可选键总能通过，所以未知时选择省略：0.16.9 使用 ZCode 自身默认值，与修改前 0.16.9 实际接受的字段一致。

### 决定 2：404/405 的配置候选只开放给用户自有 api-key 服务商
- 最终决定：
  - 仅当分组为 `standard-personal`、`access.type` 为 `api-key`、目录状态为 unknown 且 `catalogUnavailable`（404/405）时，列出 `personalModelIds`。标签为「（名称 · 本机配置，未核实）」，cost 为 unknown。
  - 401/403 计为 rejected 并隐藏。
  - 其他失败沿用原隐藏规则。
- 放弃的方案：放宽到所有分组。原因：账号绑定路由（zhipu-account 等）必须以订阅为证据，Coding Plan 密钥也属于订阅权益。
- 已知边界：`/models` 返回 200 但未列出某个声明模型时，该模型仍隐藏（保持原行为）。

### 决定 3：仅在自有 api-key 路由上镜像自定义请求头
- 最终决定：
  - `zcodeRouteHeaders` 校验通过的请求头作为 `extraHeaders` 传给只读目录探测，按 AI SDK 的合并顺序覆盖同名认证头。
  - 以下情况都跳过该路由并计入提示：头名不是合法 token、名称重复（不区分大小写）、值超过 8192 字符或含控制字符、数量超过 32、属于禁止项（host、content-length、connection、transfer-encoding、upgrade、te、trailer、keep-alive、proxy-authorization、proxy-connection），或访问方式不是 api-key。
  - 泄漏检查同时覆盖密钥和长度不小于 8 的请求头值。
- 放弃的方案：继续整体排除。原因：很多网关依赖自定义头，排除后用户无法使用自有服务商。
- 影响：账号绑定路由上的请求头可能改变凭据语义，仍然排除；现有 `zcode-account-models` 测试保持这一边界。

### 决定 4：表单只写插件账号目录，沿用归属记录
- 最终决定：
  - 新增 `zcode-custom-provider.ts`。写入 `<zcodeAuthDirectory>/.zcode/v2/provider_config.json`，这是所有 Worker 已合并的第二个个人配置来源。格式与 ZCode 桌面端自定义服务商一致。
  - 借用 Pi/OMP 的 `cliworker-created-providers.json` 归属记录（内容的 sha256 指纹）判断哪些条目可删。
  - 写入与删除都走 `commitNativeFiles`：原子替换、0600、回读核对、失败回滚。
  - 表单票据有效期 10 分钟，并绑定入口与目标路径。
- 放弃的方案：
  - 写全局文件。原因：违反「不改用户全局配置」，而且会影响 ZCode 桌面端。
  - 新建插件专用格式。原因：Worker 已原样合并该目录，桌面端格式能直接生效。
- 影响：全局与插件两个文件都参与查重，内置目录也参与，因为桌面端会把内置服务商显示为同名项。

### 决定 5：账号窗口的 ZCode 行与状态
- 最终决定：
  - `withZCodeProviderRows` 合并账号行。订阅登录有效时，保留「BigModel / Z.AI」行（引导式退出），并在其后追加 API Key 行；订阅失效但有自有密钥时，状态改为 configured，摘要显示「已配置 ZCode API；<原摘要>」。
  - Client 端：
    - 没有句柄的 ZCode API 行只读，标注「在 ZCode 桌面端管理」。
    - 插件创建的行按「删除」处理，调用 `deleteAccountConfiguration`。
    - 「其他服务商」只在 Host 返回表单时出现，没有原生终端备选。
- 放弃的方案：为 ZCode API 行新建账号窗口组件。原因：通用模板与现有分组足够，符合 settings-ui-design 的复用规则。

### 决定 6：内置模板预填
- 最终决定：
  - Host 从内置目录的 `templateRules` 选出 api-key、接口类型受支持且无请求头的模板（至多 64 个），去掉停用的模板模型。
  - Client 在表单顶部用同一 `NativeChoice` 渲染「从内置模板预填」，只写入非秘密且表单存在的字段，选择本身不提交。
- 影响：`CustomProviderForm.presets` 为可选字段，旧 Client 会忽略。

### 决定 7：按 requestId 合并 0.17.1 重发的授权请求（2026-11-16 复测问题）
- 背景：Mac 真实 Desktop 复测（Worker 8db3254a…，0.17.1，自有 Key 的 deepseek-v4-flash，「仅工作区编辑」）中，同一 Bash 命令的授权请求出现 17 次（server-3…server-19，requestId 均为同一个 `perm_…`），主页面审批卡反复重建，用户的选择不生效。
- 根因（已安装 0.17.1 源码静态核对）：`requestPermission` 用 `withInteractionRequestRecovery` 给 `requestClient` 设 `reannounceIntervalMs=1000`，等待期间以新 `server-N` id 重发同一请求，间隔翻倍、上限 10 秒。所有 id 都登记在同一个待决请求的 `requestKeys` 中，答复任一 id 即可结束等待。答复 schema `V4` 仍是 `{decision, reason?, modifiedInput?, permissionUpdates?}` 严格对象，插件的答复本身被接受，并不是答复格式的问题。
- 最终决定：`native-zcode.mjs` 按 `requestId` 记录待决授权。重发只更新最新 id，不再调用 `io.approval`。决定后回复最新 id；迟到的重发直接用已记录的结果答复。没有 requestId 的旧版请求保持逐条处理。
- 放弃的方案：只答复第一个 id。原因：任一 id 都有效，但回复最新 id 不依赖 ZCode 是否清理旧 id，行为更稳。

## Risks / Trade-offs
- 静态判定依赖打包后的标识形状。未来版本改名时会落到 `none`（安全，只是工作流设置不生效）。合成片段与本机两个版本的测试锁定当前形状。
- 404/405 候选可能实际不可用，标签和目录提示已明确「未核实」、费用未知。
- 真实订阅过期 + 自有密钥的 Desktop 派遣（headless 与 app-server）未执行，需要模型调用授权。
