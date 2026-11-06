# Evidence and handoff

## 复现与证据边界（2026-11-06）

- Mac：当前 Pi 1.0.4，另有已安装 Pi SDK 1.1.0；OMP 16.4.4。Windows 只读确认 Pi 1.1.0、OMP 18.8.7。
- 原 Pi helper 在 Mac 两个版本及 Desktop Electron 的 Node 模式均成功，未复现用户的 Pi 报错，不能提供不存在的现场报错原文。改动前初始化完整 session/InteractiveMode，改为只使用原生 ModelRuntime 凭据 API，消除不相关启动依赖；这是经过隔离验证的修复路径，不是已确认的 Windows 根因。
- 修复后的 Pi helper：隔离 HOME、合成 auth.json，删除 `zai-coding-cn`、保留 `zai`，1.0.4/1.1.0 均 exit=0，原文 `已移除该服务商的凭据。`；不存在目标 exit=1，不报成功。
- OMP 16.4.4：隔离 HOME/agent.db 两条合成 `zhipu-coding-plan`，原生 `/logout zhipu-coding-plan` 选择 #1，原文 `Successfully logged out API key #1 from zhipu-coding-plan`。原生采用软删除：id=1 的 disabled_cause 变成 `deleted by user`；id=2 仍启用。该 PTY 探针人工脚本输入，不是 Desktop/完整 Host 流程验收。
- OMP 18.x 原生 OverlayPanel 在高亮行尾加 `│`；旧 `stored API key #id\s*$` 无法识别，自动退出停留在选择器。已以同布局模拟画面复现并修复；Windows 18.8.7 真实退出画面没有采集，不能把模拟或 upstream 18.0.5 源码当作 18.8.7 实采。原生源码参考：[logout-account-selector.ts](https://app.unpkg.com/@oh-my-pi/pi-coding-agent@18.0.5/files/src/modes/components/logout-account-selector.ts)。
- 原确认依赖可用账号列表；过期/禁用凭据可能被列表过滤，不能证明已移除。新增按来源/provider/原生 id 检查存储存在性；OMP 仅 `deleted by user` 算原生删除，认证错误/暂时封锁仍算存在；成功消息延后至进程清理确认。
- OMP 16 无账号 RPC 原文：`No models available. Use /login or set an API key environment variable. Then use /model to select a model.` 新发现 helper 清理继承环境，使用隔离 HOME 和 SYNTHETIC 占位 OPENAI_API_KEY，只发 `get_login_providers`，EOF 由原生退出；不发模型 prompt，不登录；本轮未做网络抓包，不声称原生启动绝无网络访问。
- Windows 仅 SSH 读取 help、版本、安装 SDK/插件、结构字段和原生注册表；没有真实登录/退出，没有修改 agent.db。Pi SDK getProviders 返回 42 项；Windows OMP 的完整 get_login_providers 响应尚未执行，18.8.7 精确数量仍待主会话验证。

## Pi/OMP 原生选项逐项对照

旧固定表 Pi 16 项、OMP 10 项。现在按当前安装发现，不把另一个 CLI 的 ID 移植过来。原固定表根因位置为修改前 `src/host/account-guide/providers.ts:62`（Pi）、`:82`（OMP）；当前动态入口在 `src/host/native-login-providers.ts:39` 与 `src/host/native-login-providers.mjs:21`。Pi 国内 ID 为 zai-coding-cn，OMP 为 zhipu-coding-plan；两者国际站均为 zai。

### Pi：42 项；旧列表遗漏 26 项

Mac Pi 1.0.4/1.1.0 与 Windows Pi 1.1.0 的原生集合一致。

| 原生 ID | 旧插件列表 |
| --- | --- |
| `amazon-bedrock` | 遗漏，本次动态补齐 |
| `ant-ling` | 遗漏，本次动态补齐 |
| `anthropic` | 已有 |
| `azure` | 遗漏，本次动态补齐 |
| `baseten` | 遗漏，本次动态补齐 |
| `cerebras` | 遗漏，本次动态补齐 |
| `cloudflare-ai-gateway` | 遗漏，本次动态补齐 |
| `cloudflare-workers-ai` | 遗漏，本次动态补齐 |
| `deepseek` | 已有 |
| `fireworks` | 遗漏，本次动态补齐 |
| `github-copilot` | 已有 |
| `google` | 已有 |
| `google-vertex` | 遗漏，本次动态补齐 |
| `groq` | 遗漏，本次动态补齐 |
| `huggingface` | 遗漏，本次动态补齐 |
| `kimi-coding` | 已有 |
| `meta` | 遗漏，本次动态补齐 |
| `minimax` | 已有 |
| `minimax-cn` | 已有 |
| `mistral` | 遗漏，本次动态补齐 |
| `moonshotai` | 已有 |
| `moonshotai-cn` | 已有 |
| `nvidia` | 遗漏，本次动态补齐 |
| `openai` | 已有 |
| `openai-codex` | 已有 |
| `opencode` | 遗漏，本次动态补齐 |
| `opencode-go` | 遗漏，本次动态补齐 |
| `openrouter` | 已有 |
| `qwen-token-plan` | 遗漏，本次动态补齐 |
| `qwen-token-plan-cn` | 遗漏，本次动态补齐 |
| `qwen-token-plan-individual` | 遗漏，本次动态补齐 |
| `radius` | 遗漏，本次动态补齐 |
| `together` | 遗漏，本次动态补齐 |
| `typesafe` | 遗漏，本次动态补齐 |
| `vercel-ai-gateway` | 遗漏，本次动态补齐 |
| `xai` | 已有 |
| `xiaomi` | 已有 |
| `xiaomi-token-plan-ams` | 遗漏，本次动态补齐 |
| `xiaomi-token-plan-cn` | 遗漏，本次动态补齐 |
| `xiaomi-token-plan-sgp` | 遗漏，本次动态补齐 |
| `zai` | 已有 |
| `zai-coding-cn` | 已有 |
### OMP：57 项；旧列表遗漏 47 项

以下为 Mac OMP 16.4.4 实测；Windows 不复用此快照，运行时查询 18.8.7 自身注册表。

| 原生 ID | 旧插件列表 |
| --- | --- |
| `openai-codex` | 已有 |
| `anthropic` | 已有 |
| `zai` | 遗漏，本次动态补齐 |
| `kimi-code` | 已有 |
| `openrouter` | 已有 |
| `github-copilot` | 已有 |
| `cursor` | 遗漏，本次动态补齐 |
| `devin` | 遗漏，本次动态补齐 |
| `google-antigravity` | 遗漏，本次动态补齐 |
| `google-gemini-cli` | 遗漏，本次动态补齐 |
| `openai-codex-device` | 已有 |
| `xai-oauth` | 遗漏，本次动态补齐 |
| `gitlab-duo` | 遗漏，本次动态补齐 |
| `gitlab-duo-agent` | 遗漏，本次动态补齐 |
| `alibaba-coding-plan` | 遗漏，本次动态补齐 |
| `zhipu-coding-plan` | 遗漏，本次动态补齐 |
| `umans` | 遗漏，本次动态补齐 |
| `qwen-portal` | 遗漏，本次动态补齐 |
| `sakana` | 遗漏，本次动态补齐 |
| `minimax-code` | 已有 |
| `minimax-code-cn` | 已有 |
| `xiaomi` | 遗漏，本次动态补齐 |
| `xiaomi-token-plan-sgp` | 遗漏，本次动态补齐 |
| `xiaomi-token-plan-ams` | 遗漏，本次动态补齐 |
| `xiaomi-token-plan-cn` | 遗漏，本次动态补齐 |
| `firepass` | 遗漏，本次动态补齐 |
| `deepseek` | 已有 |
| `moonshot` | 已有 |
| `cerebras` | 遗漏，本次动态补齐 |
| `baseten` | 遗漏，本次动态补齐 |
| `fireworks` | 遗漏，本次动态补齐 |
| `together` | 遗漏，本次动态补齐 |
| `nvidia` | 遗漏，本次动态补齐 |
| `novita` | 遗漏，本次动态补齐 |
| `huggingface` | 遗漏，本次动态补齐 |
| `perplexity` | 遗漏，本次动态补齐 |
| `qianfan` | 遗漏，本次动态补齐 |
| `venice` | 遗漏，本次动态补齐 |
| `synthetic` | 遗漏，本次动态补齐 |
| `nanogpt` | 遗漏，本次动态补齐 |
| `wafer-serverless` | 遗漏，本次动态补齐 |
| `coreweave` | 遗漏，本次动态补齐 |
| `vercel-ai-gateway` | 遗漏，本次动态补齐 |
| `cloudflare-ai-gateway` | 遗漏，本次动态补齐 |
| `litellm` | 遗漏，本次动态补齐 |
| `kilo` | 遗漏，本次动态补齐 |
| `zenmux` | 遗漏，本次动态补齐 |
| `opencode-zen` | 遗漏，本次动态补齐 |
| `opencode-go` | 遗漏，本次动态补齐 |
| `tavily` | 遗漏，本次动态补齐 |
| `kagi` | 遗漏，本次动态补齐 |
| `parallel` | 遗漏，本次动态补齐 |
| `ollama` | 遗漏，本次动态补齐 |
| `ollama-cloud` | 遗漏，本次动态补齐 |
| `lm-studio` | 遗漏，本次动态补齐 |
| `llama.cpp` | 遗漏，本次动态补齐 |
| `vllm` | 遗漏，本次动态补齐 |

## 其他 CLI 审计

- **OpenCode 1.19.0**：原生 `auth login --help` 支持 `-p/--provider` 与 `-m/--method`，插件固定 19 个 provider，未提供 method 级选择（后续在原生步骤选择）。本机 models.dev 缓存有 232 个 provider，其中 213 个不在插件列表。这是目录候选差集，不代表每个已验证可登录；鉴权插件、动态隐藏和用户自定义来源应通过 OpenCode 自身接口发现，不能把缓存全部直接塞进登录表。包括 GitHub Copilot、NVIDIA、Cerebras、Hugging Face、小米和多个 Coding Plan；本次只报告，没有改变其登录协议。

候选差集：

`302ai`, `abacus`, `abliteration-ai`, `above`, `agentrouter`, `agnes`, `ai-router`, `ai21`, `aiand`, `aihubmix`, `aimlapi`, `ainetcafe`, `aixy`, `aki-io`, `alibaba-coding-plan`, `alibaba-coding-plan-cn`, `alibaba-token-plan`, `alibaba-token-plan-cn`, `amazon-bedrock`, `ambient`, `amd`, `anyapi`, `arcee`, `atomic-chat`, `auriko`, `azure`, `azure-cognitive-services`, `bailing`, `baseten`, `bee`, `berget`, `blueclaw`, `bothub`, `boundless`, `cerebras`, `chutes`, `clarifai`, `claudinio`, `cline-pass`, `cloudferro-sherlock`, `cloudflare-ai-gateway`, `cloudflare-workers-ai`, `cohere`, `commandcode`, `coralbricks`, `cortecs`, `crof`, `crossmodel`, `crusoe`, `daoxe`, `databricks`, `deepinfra`, `digitalocean`, `dinference`, `drun`, `ebcloud`, `echo`, `edenai`, `empiriolabs`, `engy`, `evroc`, `fastrouter`, `fireworks-ai`, `freemodel`, `friendli`, `frogbot`, `github-copilot`, `gitlab`, `gmicloud`, `google-vertex`, `google-vertex-anthropic`, `greenpt`, `helicone`, `hetzner`, `hpc-ai`, `huggingface`, `hyper`, `iflowcn`, `impossibl`, `inception`, `inceptron`, `inco`, `infer`, `inference`, `inferx`, `infomaniak`, `io-net`, `iteracompute`, `jalapeno`, `jiekou`, `kenari`, `kilo`, `kimi-code-plan-cn`, `kimi-code-plan-global`, `klokintegration`, `kosmik`, `kuae-cloud-coding-plan`, `lilac`, `llama`, `llmgateway`, `llmgateway-providers`, `llmtech`, `llmtr`, `lmstudio`, `longcat`, `lowrouter`, `lucidquery`, `lynkr`, `meganova`, `melious`, `merge-gateway`, `meta`, `minimax-cn-coding-plan`, `minimax-coding-plan`, `mixlayer`, `moark`, `modal`, `model-oracle-ai`, `modelis`, `modelscope`, `morph`, `nan`, `nano-gpt`, `nearai`, `nebius`, `neon`, `neosmith`, `neuralwatt`, `nova`, `novita-ai`, `nvidia`, `oci`, `ofox`, `ollama-cloud`, `opencode`, `opencode-go`, `openreason`, `opper`, `orcarouter`, `ovhcloud`, `pareto`, `pendra`, `perplexity`, `perplexity-agent`, `pioneer`, `poe`, `poolside`, `prime`, `privatemode-ai`, `qihang-ai`, `qiniu-ai`, `qvac`, `reflection`, `regolo-ai`, `requesty`, `routing-run`, `runinfra`, `sakana`, `salad-cloud`, `sambanova`, `sap-ai-core`, `sarvam`, `scaleway`, `scnet-token-plan`, `scx-ai`, `sensenova`, `siliconflow-cn`, `snowflake-cortex`, `stackit`, `standardcompute`, `stepfun`, `stepfun-ai`, `stepfun-ai-step-plan`, `stepfun-step-plan`, `subconscious`, `submodel`, `synthetic`, `tempr`, `tencent-coding-plan`, `tencent-token-plan`, `tencent-tokenhub`, `tensorx`, `the-grid-ai`, `thinkingmachines`, `tinfoil`, `togetherai`, `tokengo`, `tokenrouter`, `trustedrouter`, `umans-ai`, `umans-ai-coding-plan`, `unorouter`, `upstage`, `vancine`, `venice`, `vercel`, `vispark`, `vivgrid`, `volcengine`, `volcengine-coding-plan`, `vultr`, `wafer.ai`, `wallaby`, `wandb`, `watsonx`, `xiaomi`, `xiaomi-token-plan-ams`, `xiaomi-token-plan-cn`, `xiaomi-token-plan-sgp`, `xpersona`, `zeldoc`, `zenifra`, `zenmux`。

- **Hermes**：本机已安装源码 `_REGISTRY_ROWS` 37 个内置 provider，插件 14 个（含额外 openrouter）。原生 Known providers 根据注册表再过滤 unlisted，并可能加入插件 provider；至少应进一步核对以下 24 个内置差集。本次不冒充已逐个登录，也不越过原生隐藏规则补写静态项：`actual`, `ai-gateway`, `alibaba`, `alibaba-coding-plan`, `arcee`, `azure-foundry`, `bedrock`, `copilot`, `copilot-acp`, `gmi`, `kilocode`, `lmstudio`, `minimax-oauth`, `nvidia`, `ollama-cloud`, `openai-codex`, `opencode-go`, `opencode-zen`, `qwen-oauth`, `stepfun`, `tencent-tokenhub`, `tencent-tokenplan`, `vertex`, `xai-oauth`。

- **Kimi**：插件只显式提供 kimi.com/kimi.ai 两个原生登录区域；原生自定义 API provider 配置属于原生终端入口，未做自绘 provider 配置表单。
- **MiMo**：现有原生菜单适配只自动选 MiMo；MiMo Auto 和其他 Provider 留在原生终端，属于自绘入口覆盖缺口。
- **ZCode**：插件 bigmodel/zai 两站与当前适配一致；本机 PATH 没有 ZCode，未新增实机核验。
- **Codex、Claude、Grok、Qoder、Antigravity**：现有 flow 面向各自原生账号入口，不是 Pi/OMP 式任意 provider 注册表。未发现同形固定 provider 表；API token、云平台或授权模式不等于新增 provider。本轮未对这些 CLI 做跨平台全量原生选项枚举，不能称已完全审计。

## 认证失败与交集规则：供用户决定

不改 `pi-native-catalog.mjs` 及多凭据取交集规则。建议由模型目录缺陷负责 agent 将“暂无可用模型”改为“智谱 Coding 的一条凭据认证失败（401/1000）；另一条凭据验证成功。当前规则需要所有账号验证通过，暂不能生成共同模型列表。请在账号窗口退出失效凭据或替换后重试。”显示来源/provider/安全条目标识，不显示 key；可跳转账号窗口但不自动删除。若用户希望仅成功凭据参与交集，需另行决定模型选择/轮换语义，本次未实施。

## 改动定位

- `src/host/pi-login.mjs:18`：指定 Pi 凭据走纯原生凭据 API；避免完整 UI 初始化。
- `src/host/account-guide/omp-flow.ts:118`：带边框选择器按原生 ID 匹配。
- `src/host/pi-omp-native.ts:422`、`src/host/accounts.ts:1233`：存储存在性确认，认证失效不代表删除。
- `src/host/accounts.ts:1264`、`:1473`：退出成功延后至进程清理完成。
- `src/client/account-login/accounts-window.tsx`：展示原生凭据号，退出/替换传原始完整 handle；标签使用中英 i18n。
- 构建 helper 清单、关联测试、README 两语言与 doc/design.md 同步；未改模型目录脚本。

## 主会话 Windows 验收与回滚

1. 本 agent 只产出预览包，不安装。主会话先确认没有活动 Worker、账号窗口或 CLI 读写，再保存当前 v0.8.7 插件目录/发布包及其 SHA256。预览包使用同版本号 0.8.7；安装会覆盖当前已装发布包，必须按文件 SHA 区分。
2. 通过既有 Desktop 插件安装流程导入预览 tgz。确认插件可加载，并核对 Pi/OMP 登录选项含本机对应的国内/国际智谱 ID。Desktop 界面和 Windows 元数据发现仍是待验收项。
3. 从账号窗口选择 **OMP → 插件目录 → zhipu-coding-plan → 原生凭据 id=1（created_at=0）**。退出前用安全只读查询确认唯一目标；若 UI 不能区分 #1/#2，停止，不能按显示顺序猜测。
4. 只退出该条旧凭据。原生选择器必须定位 #1，绝不能选择 #2、整个 provider 或其他 CLI。等待窗口显示退出成功及进程清理完成；再安全回读 agent.db，确认 id=1 已消失或按原生语义标为 deleted by user，id=2（created_at=1793975825）及其他凭据保持不变。校验可在远端内存比较 key 字段/记录摘要，仅输出相等布尔值和非敏感标识，不打印密钥或摘要。
5. 再读模型目录，分别记录认证错误是否消失、模型数；不能把账号移除直接等同于模型目录修复。真实登录新 key 不在本次操作范围。
6. 软件回滚：停留在无活动任务状态，将备份发布包/插件目录恢复并验证哈希。凭据退出不通过软件降级撤销；用户授权删除的是失效旧 key，无需恢复它。不要整库恢复 agent.db（会危及新 id=2 和并发写入），不要手工写回旧 key。若需恢复账号，另用原生登录并获得新的明确指示。

## Preview artifact

预览目录 `.cache/preview-package`；安装归档 `.cache/account-preview-artifacts/dsh-cliworker-now-0.8.7-pi-omp-accounts-preview.tgz`（18,944,770 字节）。SHA256：`50338926150d8f72a4594d7ef3b03c46c2d93ae3ba1acf69e11d94d440b87199`。包仍为 0.8.7，安装会覆盖 Windows 当前发布包；本 agent 未执行安装。详细检查结果见 tasks.md。
