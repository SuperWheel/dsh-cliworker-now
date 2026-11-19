# Design

## Context

沿用 rc.3 适配的宿主构建、随包分发和原生 profile 接入流程。`package.json` 的 `devDependencies.@deepseek-ai/dsh` 是开发 SDK 基线，`scripts/host-targets.json` 记录受支持的构建目标及 `vendorDefault`，`runtime-host/manifest.json` 记录实际随包资源的来源和摘要。[提案](proposal.md) · [rc.3 适配归档](../../archives/v0.9.0-dsh-rc3-adapt-leeyl/)

| 官方版本   | npm `@deepseek-ai/dsh` 发布时间（UTC） | 官方 tag          | Git commit                                 |
| ---------- | -------------------------------------- | ----------------- | ------------------------------------------ |
| 0.2.2-rc.3 | 本次对比基线                           | `dsh-v0.2.2-rc.3` | `38a6a5c965aa99ab525161efb7cc5cf1fe62fced` |
| 0.2.2-rc.4 | `2026-11-17T17:03:03Z`                 | `dsh-v0.2.2-rc.4` | `3f321d32bfe382212a8ed8785c1d47a5a300aa23` |
| 0.2.2-rc.5 | `2026-11-18T13:17:23Z`                 | `dsh-v0.2.2-rc.5` | `9c2670d3bce5275e0d1610272958121af87787bb` |

npm 发布信息取自需求资料，所列 `latest` 与 `next` 均为 0.2.2-rc.5。只读核对本地 `.cache/dsh-host-source-022rc2` 得到以上 tag commit，rc.4 和 rc.5 均为 rc.3 的后代。本机 `/Applications/DeepSeek Harness.app` 的 `CFBundleShortVersionString` 为 0.2.2-rc.5。Desktop 自带 `dsh` 版本和可取得的应用构建标记在实机验收时单独记录。[需求 PRD](../../../doc/prd/2026-11-19-v0.9.2-dsh-rc5-names-omp-PRD.md) · [REQ-0138 快照](../../../doc/prd/2026-11-19-v0.9.2-REQ-0138.md)

### rc.3 → rc.5 源码差异结论

两个 tag 之间共 448 个文件变更，多数为版本号或变更日志。下表以源码为证据，实际安装产物的复核结果见下节。

| 核对面                | 当前结论与依据                                                                                                                                                                                                                                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gateway               | 源码未见插件所用 `dsh-api-gateway` 接口变动，暂无需改动。逐包核对其公开导出、声明和运行入口。                                                                                                                                                                                                                                                      |
| Remote 与 Typert      | 源码未见插件所用 Remote、会话控制或 Typert 契约变动，暂无需改动。核对 `api-remotes`、`api-session-controller` 及 Typert 包的生成声明和运行入口。                                                                                                                                                                                                   |
| Cordis 扩展点         | 插件所用 slots、renderer、会话和子 Agent 扩展点未见源码变动。`bundle/base/cordis.patch.yml` 移除固定 `searchProvider`，保留 `fetchProvider: http`，`tool-cordis` 的 API 目录变化描述的是搜索选择机制。暂无需调整插件扩展点。                                                                                                                       |
| 主题 token 与共享组件 | `ui-theme`、`ui-primitives` 等插件所用主题和共享组件未见源码级导出变化，暂无需改动。核对 npm 包暴露的 token、组件、入口与类型。                                                                                                                                                                                                                    |
| 四个随包界面包        | `ui-session`、`ui-conversation`、`ui-subagent`、`ui-chat` 各自仅变更 `package.json` 中的版本号，现有补丁预计可迁移。按 rc.5 官方 npm 包核对继承的 Host、声明和资源。                                                                                                                                                                               |
| Cordis 版本           | 两个 tag 的 `vendor/cordis/package.json` 均为 `@deepseek-ai/cordis` 4.1.0，插件当前也锁定 4.1.0。暂无需改动，安装后复核版本及实际来源。                                                                                                                                                                                                            |
| 其他实质变动          | `web`、`web-search-deepseek`、`tool-web`、`ui-settings-web-search` 的默认搜索服务按模型路由选择，`WebSearchRequest` 新增可选 `llmProvider`。`llm-deepseek` 新增内容安全检查，`llm` 的 `LLM_FAILURE_CODES` 增加 `CONTENT_REFUSED`。实验性 `liveshare` 调整隧道的 Electron Node 启动。初步检索 `src/` 未见插件引用这些改动的接口或行为，暂无需接入。 |

### 两套已安装 npm 产物的逐包复核

从同一插件提交的 rc.3 冻结安装和 rc.5 冻结安装分别读取 pnpm 实体包。逐包比较 332 个 DSH 包和 Cordis 4.1.0。文件哈希排除 README、CHANGELOG、package.json、source map、.bin 及嵌套 node_modules；另外单独比较 manifest 的 exports、main、module、types、type、bin、dependencies、peerDependencies、optionalDependencies 和 dsh，先归一化 DSH 的版本 pin。333 个包的这些字段均一致。rc.3 有 11,102 个纳入比较的文件，rc.5 有 11,106 个。315 个包逐文件相同，其余 18 个包共有 47 个差异路径。

| 实际差异包（省略 `@deepseek-ai/`）                                                                           | 文件与契约                                                                                                                          | 插件结论                               |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| dsh                                                                                                          | 8 个中英文文档路径涉及配置、联网搜索与拒答升级指引                                                                                  | CLI 入口及导出相同，无需改动           |
| dsh-api-remotes                                                                                              | `lib/client.js` 中 web 服务的生成源码位置从第 152 行移到第 174 行，其余字节相同                                                     | Remote 调用与类型契约相同，无需改动    |
| dsh-client-modules、dsh-client-ui-settings-account、dsh-client-ui-settings-general、dsh-client-ui-sidebar    | 各有 1 个运行入口仅更新内嵌版本或前端短构建标记（`6b729fe` → `3f85d88`）                                                            | 扩展点及类型相同，无需改动             |
| dsh-llm、dsh-llm-deepseek、dsh-repeat-tool-reminder、dsh-session-persistence-jsonl、dsh-tmux-context         | llm 的源码、运行表和声明新增 `CONTENT_REFUSED`，DeepSeek 转译处理内容安全拒答，后三个包的编译输出带入新枚举值                       | 插件没有对该错误码做穷举分支，无需改动 |
| dsh-base、dsh-client-ui-settings-web-search、dsh-tool-cordis、dsh-tool-web、dsh-web、dsh-web-search-deepseek | 默认搜索服务按模型路由选择。配置、卡片与词条、工具说明、生成的 web Remote 及类型相应更新；`WebSearchRequest.llmProvider` 为可选字段 | 插件未调用这些搜索接口，无需改动       |
| dsh-experimental-liveshare                                                                                   | `src/host/tunnel-worker.ts` 及 `lib/index.js` 更改 Electron 下子进程启动                                                            | 插件未使用该隧道，无需改动             |

39 个精确 pin 中仅 dsh、dsh-api-remotes 和 dsh-llm 有上述差异。Gateway、会话控制、Typert 生成器／协议／注册器、主题 token、primitives、slots、renderer、四个原生 UI 包（含图片）、Cordis 的纳入文件均相同。完整逐包清单记在验收目录的 `sdk-comparison.json`，逐行列出两个版本、实际入口、文件数、变化路径及 manifest 结论。此次升级沿用现有 Host、Client 接入。

## Goals / Non-Goals

- 让同一 rc.5 发布身份贯穿 SDK、原生界面构建、预览包与实际宿主验证，保留历史目标的独立验证能力。[增量规格](specs/package-distribution/spec.md)
- 继续使用现有 Host/Client 分工、原生 Gateway/Remote、Cordis 扩展点和 bundle 生命周期。无用户数据迁移，现有会话、账号和设置沿用原存储。新增宿主功能、Agent 名称覆盖、原生派遣识别及 OMP 表单属于各自变更。

## Decisions

### 决定 1：固定官方来源并核对安装产物

- 最终决定：用 rc.5 tag commit 和精确 npm 版本固定来源。逐包对比两套实际安装的 SDK 及相关 DSH 包，清单记录包名、版本、实际入口与差异，重点核对 `exports`、依赖、类型声明、生成的 Remote 契约、运行输出和资源。版本号、变更日志、source map 等噪声可归类汇总，保留对运行有影响的 `package.json` 字段。
- 放弃的方案：只用源码 diff 判断兼容性 —— 原因：生成声明和打包输出可能出现源码差异清单无法体现的变更。
- 影响：每项按「需适配」或「无需改动」记录依据。发现插件实际依赖的契约破坏时，才修改相应接入代码并做关联回归。

### 决定 2：同步 SDK 与默认 vendor 目标

- 最终决定：更新全部 39 个 `@deepseek-ai/dsh*` 精确 pin、workspace 发布期限例外和根锁文件，复核非 DSH 锁文件包集合。通过 `host-targets.json` 增加 rc.5 目标并将 `vendorDefault` 指向它，沿用 `build-dependencies.mjs` 按 SDK 选取依赖、`build-host-extension.mjs` 按目标构建及 `vendor-host-extensions.mjs` 复核产物的入口。
- 放弃的方案：原位覆盖 rc.3 目标或扩大依赖升级范围 —— 原因：历史产物需要按各自来源复核，扩大依赖差异会增加定位回归的成本。
- 影响：原有构建目标保留。将使用当前默认目标的测试更新为 rc.5，历史目标继续独立核对。目标宿主版本与插件发布版本分别管理。

### 决定 3：单独迁移现有 48 文件补丁

- 最终决定：沿用 rc.3 的构建方式，从固定 rc.5 tag 建干净基线和补丁工作树，以三方方式迁移 `host-extensions/dsh-0.2.2-rc.3/source.patch`，导出到 `host-extensions/dsh-0.2.2-rc.5/`。以同一 Node、代理设置和冻结依赖对照运行上游四包 Vitest。有冲突时保留官方行为并叠加既有插件扩展，逐项记录补丁差异及原因。
- 放弃的方案：直接改旧构建的包版本号，或在迁移时一起加入页头名称覆盖 —— 原因：前者无法证明产物来自 rc.5，后者会将兼容迁移和并行功能变更的差异混入同一补丁。
- 影响：本变更交付现有 48 文件补丁的 rc.5 基线、冻结构建输入、校验产物和 `runtime-host/`。`v0.9.2-agent-name-sync-leeyl` 后续以该基线在 `ui-subagent` 增加页头列表名称覆盖，并随其变更重新导出补丁、构建、校验与 vendor。

### 决定 4：先隔离验证，再按平台验收

- 最终决定：在独立 worktree 中完成构建和回归，用 rc.5 Desktop 自带的 `dsh` 在隔离 `DSH_HOME` 安装、启动 `dsh web`，核对四包解析路径和界面。确认无活动 Worker 后，才在正式 Desktop 链接指向的仓库构建并冷启动验收。真实派遣依据主对话模型选型授权、余额和 CLI 登录状态执行。
- 放弃的方案：直接刷新日常 Desktop 链接后用一次实机启动验证全部结果 —— 原因：链接指向主仓库，活动任务和既有 profile 会影响回滚及证据判读。
- 影响：隔离 Web、正式 Desktop、真实调用分别留证。Windows 由用户安排，仅核对 rc.5 基础加载和派遣。正式发布验收另按 `development-workflow` 的平台与 CLI 范围执行。[开发流程规格](../../specs/development-workflow/spec.md)

## Risks / Trade-offs

- npm 生成产物可能出现额外变化 → 核对两个精确版本的实际安装树，再冻结适配结论；对异常的导出、类型、资源或运行差异单独复核。
- 独立依赖下载可能受代理或 DNS 影响 → 保留宿主代理环境，记录失败及重试结果，冻结安装与产物校验通过后再进入宿主验收。
- 补丁可能引入上游测试回归 → 四包分别记录补丁前后结果，追溯每个失败的根因和处理结果，保留尚未解决的验收缺口。
- Desktop 链接刷新可能影响活动任务，Windows rc.5 安装包或真实账号条件可能未就绪 → 刷新前核对活动 Worker，记录未执行的平台、账号、模型和具体原因。
- 同版本并行改动可能重叠 `ui-subagent` 或文档 → 以迁移后的 rc.5 补丁为集成基线，合入时复核最终摘要和四包来源。

## Migration Plan

在指定独立 worktree 安装冻结依赖并通过回归、构建及产物校验后，用隔离 profile 验证预览包。可使用构建脚本的 `--source` 指向规定测试目录下的上游补丁工作树，脚本生成的构建产物保留在 worktree 的 `artifacts/` 下。正式构建前确认无活动任务，按当前 profile 接入方式更新插件并冷启动；实机验收和文档核对的结果写入 [任务清单](tasks.md)。

隔离验证失败时保留失败证据和原安装。正式切换失败时，结束活动任务并退出宿主，经原生 profile 移除本插件覆盖以恢复官方界面，或恢复与目标宿主已验证兼容的上一完整插件构建。SDK 锁文件、补丁、随包四包与 manifest 按完整版本成套还原，避免混用 rc.3 与 rc.5 模块。沿用原会话、账号与设置，冷启动后核对唯一界面来源及设置可读性。
