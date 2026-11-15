# 视频脚本：DSH 能直接调用 Codex 当子 Agent 了？CLI Worker 带你看完整过程

| 项目 | 内容 |
|---|---|
| 暂定标题 | DeepSeek Harness 能把 Codex 当子 Agent 了！但只看结果够吗？ |
| 备选标题 | ① 让 Codex 照着人设图做 DeepSeek 蓝色大肥鱼 GIF，再用 Computer Use 插入 Word 文档：DSH × CLI Worker 实测 ② DSH 0.2.2 新功能 subagent_oar 实测，和 CLI Worker 差在哪 |
| 时长 | 约 5 分钟（旁白约 1400 字含标点，TTS 1.1 倍速约 4 分 40 秒，另含演示停留时间） |
| 画幅 | 16:9 横屏录屏，1920×1080；DSH Desktop 主窗口，右侧栏打开 CLI Worker |
| 节奏 | 惊喜（官方新功能）→ 落差（只看得到结果）→ 解法（CLI Worker 全过程）→ 你以为这就结束了？→ 高潮（Codex 参考人设图生成 GIF + Codex Computer Use 插入 Word 文档） |

> 「画面 / 操作」列是录屏动作，「旁白」列是 TTS 文本（纯净版见 [narration.txt](narration.txt)），「字幕 / 标注」列是后期叠加的文字。界面文字按你提供的三张截图核对过。方括号 `[ ]` 中的数字要按实际录屏结果替换。

---

## 0. 录制前准备

1. **DSH Desktop 0.2.2-rc.1**，已启用实验性 `subagent_oar`，配置了 `codex` 运行时（启用方式见文末附录）。
2. **CLI Worker 预览包**（含「DSH 子 Agent 汇入」，第 4 段用；这部分还没正式发布，版本号暂写 v0.8.7，需你确认）。
3. **Codex CLI** 已登录，账号能用 `gpt-6.1-sol` 和 image gen；本机有 Python Pillow 或 ffmpeg，用来合成 GIF。Codex 的 Computer Use 已获得 macOS 辅助功能与屏幕录制权限。
4. 新建演示项目 `~/demo/dsh-video`，把 [人设图](assets/blue-fish-character.png) 复制到项目的 `assets/ref/blue-fish-character.png`；在项目里新建一个空白 Word 文档 `DSH 演示.docx`。
5. 用于演示的 Codex Worker 档位选「自动审批」（截图中的默认档位）。这样 Computer Use 请求操作 Microsoft Word 时，主对话会弹出授权卡片，正好拍到。
6. **第 4 段必须先彩排**：Codex 参考人设图生图、合成 GIF、把 GIF 插入 Word 文档，这几步都还没在本插件里真实跑通过（见文末核对表）。先私下跑一遍，确认能稳定完成再正式录。
7. 关闭通知，Word 只保留演示文档一个窗口，不要录到其他文档或个人内容。
8. 准备片尾素材：项目图标、项目地址、插件讨论群二维码（已裁好，见 `assets/qq-group-qr.png`）。

---

## 1. 开场：DSH 居然能调 Codex 了（0:00–0:25）

| 画面 / 操作 | 旁白 | 字幕 / 标注 |
|---|---|---|
| 官方 Release 页，高亮「新增实验性 subagent_oar 工具插件，可将独立任务交给本机 Codex 或 Claude CLI」 | DeepSeek Harness 零点二点二 RC 一，带来了一个很特别的新功能：subagent_oar。 | DSH 0.2.2-rc.1 新增：subagent_oar（实验性） |
| 镜头推近这一行 | 它能把本机的 Codex 和 Claude Code 命令行，直接当成 DSH 的子 Agent 来用。 | Codex / Claude Code → DSH 子 Agent |
| 切到 DSH 主界面 | 下面实际测试它的效果。 | — |

---

## 2. 落差：只能看到结果（0:25–1:10）

| 画面 / 操作 | 旁白 | 字幕 / 标注 |
|---|---|---|
| 新建会话，输入：「用 subagent_oar 调用 codex，用 gpt-6.1-sol high 和我说你好。」 | 第一个测试很简单：让主 Agent 用 subagent_oar 调用 Codex，回复一句你好。 | — |
| 展开过程，拍到 `subagent_oar` 工具卡和返回的 `started subagent …`；等待段落 3 倍速 | 主 Agent 调用 subagent_oar，获得一个子任务编号，然后进入等待。 | 工具卡：subagent_oar |
| 结果出现：「已完成，用时 [36] 秒」，引用块「你好 👋」（类似图一） | 十几秒后，主对话收到结果：一句「你好」。 | 已完成，用时 [36] 秒 |
| 鼠标在回复区上下划动，停在底部「用量 [117K] tok」 | 但是，这期间 Codex 执行的命令和调用的工具，主对话里都没有显示。 | 看不到过程 |
| 圈出底部用量 | 底部的用量只统计主 Agent 自身的消耗，Codex 的 token 用量和上下文占用同样无法查看。 | 只看得到主 Agent 的用量 |
| 字卡：官方文档要点 | 官方文档也说明，subagent_oar 只返回 Codex 的最后一段文字，推理和工具事件不会进入 DSH；每次调用都是一次性任务，无法继续追问。 | 官方 README：只返回最终文本 · 无续聊 / 进度流 |

---

## 3. 解法：CLI Worker 展示完整过程（1:10–2:45）

| 画面 / 操作 | 旁白 | 字幕 / 标注 |
|---|---|---|
| 新建会话，打开右侧 CLI Worker 窗口；输入：「用 codex cli 和我说你好。」 | 接下来用我们的插件 CLI Worker 完成同一个任务。 | dsh-cliworker-now |
| 主对话回复「已派出 Codex CLI Worker（codex-1，模型 gpt-6-luna）」；右侧出现 Codex 分组和卡片「向用户说你好 · codex-1 \| gpt-6-luna · Low」（图二） | 主 Agent 派出名为 codex-1 的 Worker。右侧 CLI Worker 窗口随即出现任务卡片，卡片上显示所用的模型和思考强度。 | 有名字的 Worker · 模型 / 强度可见 |
| 点开卡片，进入「codex-1 \| 向用户说你好」子会话（图三） | 点开卡片，可以看到 Codex 的完整会话，包括主 Agent 发出的任务和 Codex 的回复。 | Codex 完整会话 |
| 镜头停在底部统计栏：「1 轮 1 步 · 24.7K tok · 缓存命中 51% · 10%」，逐项高亮 | 底部统计栏显示 Codex 自身的轮次、步骤、token 用量、缓存命中率和上下文占用。 | 轮次 / 步骤 · token · 缓存命中 · 上下文 |
| 镜头扫过输入区「自动审批」和「GPT-6-Luna Low」 | 输入区可以直接切换权限档位和模型。 | 权限档位 · 模型切换 |
| 在子会话输入框输入：「再用一句英文打个招呼。」发送，新增一轮 | 在侧栏输入框发送消息，即可继续对话，Codex 会保留之前的上下文。 | 侧栏直接续聊 |
| 回主对话输入：「让 codex-1 再用日语打个招呼。」主 Agent 调用 `cliworker_followup`，同一张卡片新增一轮 | 在主对话中按名字指定 codex-1，主 Agent 会调用同一个 Worker 继续执行，无需重新创建任务。 | 按名字二次调用 |
| 快切：CLI 连接设置页，展示 CLI 列表 | 除了 Codex，插件还支持 Claude Code、Antigravity、Kimi、Grok 等 13 种 CLI，每种 CLI 都通过自己的原生协议接入。 | 13 种 CLI · 原生协议 |
| 主对话输入：「用你自己的子 Agent 统计项目里的文件数量。」CLI Worker 窗口出现「DSH」分组；点开后是同样的子会话窗口；输入一句追问并收到回复 | 在新版本中，DSH 原生子 Agent 也会显示在这个窗口。点开后是同样的会话视图，并且支持直接续聊。该功能不接管 DSH 原有的子 Agent 流程，DSH 原生入口照常可用。 | 新功能（待发布）：DSH 子 Agent 也能在这里看、续聊 |

---

## 4. 高潮：你以为这就结束了？Codex 生成 GIF + Computer Use 插入 Word 文档（2:45–4:45）

**参考图**：[assets/blue-fish-character.png](assets/blue-fish-character.png)（DeepSeek 蓝色大肥鱼人设图，1440×1080）。录制前复制到演示项目的 `assets/ref/blue-fish-character.png`。

**演示提示词**（在主对话一次发出）：
> 调用 Codex CLI，用 gpt-6.1-sol high：参考项目里 `assets/ref/blue-fish-character.png` 这张 DeepSeek 蓝色大肥鱼的人设图，用 image gen 生成一组连贯的动作帧（比如挥手打招呼，6～8 帧，角色外观和人设图保持一致），再把这些帧合成一个循环播放的 GIF 动图，保存为 `assets/blue-fish-wave.gif`；然后用 Codex 的 Computer Use 在 Microsoft Word 中打开项目里的 `DSH 演示.docx`，把这个 GIF 插入文档并保存。

| 画面 / 操作 | 旁白 | 字幕 / 标注 |
|---|---|---|
| 黑底白字停 1 秒 | 你以为这就结束了？ | 你以为这就结束了？ |
| 回到 CLI Worker | CLI Worker 接入的是各个 CLI 的原生会话。CLI 自带的工具和 skill 可以照常调用，DSH 独有的 MCP 和技能也可以作为备选提供给 CLI。 | CLI 原生工具优先 + DSH 工具作为备选 |
| 在 DSH 文件预览中打开人设图，停 2 秒 | 下面让 Codex 参考这张 DeepSeek 蓝色大肥鱼人设图，完成一个复合任务。 | DeepSeek 蓝色大肥鱼人设图 |
| 输入上面的提示词 | 任务分为两步：先用 image gen 生成动作图并合成 GIF 动图，再用 Codex 的 Computer Use 把动图插入 Microsoft Word 文档。 | 两步：image gen 生成动作图并合成 GIF → Computer Use 插入 Word 文档 |
| 选型卡片：选择 gpt-6.1-sol、high，确认（如已关闭「调用前询问模型」则跳过） | 派遣前选择模型 GPT 六点一 sol 和思考强度 high，选项读取自 Codex 当前账号的模型目录。 | Codex · gpt-6.1-sol · high · 选项来自 Codex 模型目录 |
| 子会话依次出现：读取参考图、多次生图；生成段落 3～4 倍速 | Codex 读取人设图后，调用 image gen 生成多张动作图，每次工具调用都显示在子会话中。 | 读取人设图 → image gen 生成动作图 |
| 子会话出现合成 GIF 的命令行，展开给特写 | image gen 只输出静态图片，Codex 随后执行命令，将这些图片合成为 GIF。 | 执行命令：合成 GIF |
| 在 DSH 文件预览（或访达快速查看）中打开 `assets/blue-fish-wave.gif`，循环播放 3 秒 | GIF 动图已保存到项目的 assets 目录。 | 产物：assets/blue-fish-wave.gif |
| 主对话弹出授权卡片「允许 Computer Use 使用应用：Microsoft Word」，点「允许一次」 | Codex 通过 Computer Use 操作 Word 之前，会先请求应用授权。CLI Worker 将请求转交 DSH，由用户在主对话中批准。 | Codex Computer Use · 授权由你决定 |
| 画中画：左侧 Word 被自动打开 `DSH 演示.docx`、GIF 出现在文档中；右侧子会话里 Codex Computer Use 的工具调用逐条出现，点开一两条给特写 | 左侧是 Codex 对 Word 文档的实际操作，右侧是对应的工具调用记录，展开后可以查看参数和返回结果。 | 真实操作 · 每一步工具调用可追溯 |
| 镜头停在 Word 文档里循环播放的 GIF；再切回子会话底部统计栏 | GIF 动图已插入 Word 文档并保存。子会话底部记录了本次任务的轮次、步骤和 token 用量。 | 用量：[ ] tok · [ ] 步 |

**彩排时重点确认**
- **参考图怎么交给 image gen**：Codex 能否把本地图片直接作为 image gen 的参考输入，要以实测为准。如果不能，Codex 会先看图、再把外观写进生图描述，那样各帧的一致性会差一些。可以在提示词里加一句「每一帧都严格对照人设图的发色、女仆装、鲸鱼尾巴和蓝色蝴蝶结」。
- **帧间一致性**：逐帧生成容易出现角色走形。彩排时如果效果不稳，可以减到 4 帧，或改成「生成一张角色图，再用命令做轻微的位移、缩放动画」。
- **合成 GIF 的工具**：合成要靠本机命令（如 Python Pillow 或 ffmpeg），彩排前确认 Codex 运行环境里有其一。
- **Word 里的 GIF**：Microsoft 365 版 Word 可以播放动态 GIF，录制前确认本机 Word 插入后会动；如果只显示首帧，改用访达快速查看来展示动图。
- **防止绕过 Computer Use**：文档在项目目录里，Codex 可能改用脚本（如 python-docx）直接写入 docx。提示词已写明用 Computer Use 在 Word 中操作；彩排时如果它仍走脚本，可以在提示词末尾加一句「不要用脚本修改 docx 文件」。
- **Word 的操作路径**：插入图片可以走「插入 → 图片 → 来自文件」菜单，也可能是拖拽，Codex 未必一次成功。另外要确认保存时没有弹出格式转换或兼容性对话框，有的话 Codex 需要处理。

---

## 5. 收尾（4:45–5:05）

| 画面 / 操作 | 旁白 | 字幕 / 标注 |
|---|---|---|
| 并排：左边 subagent_oar 的「你好」结果，右边 Word 文档里循环播放的大肥鱼 GIF | subagent_oar 适合只需要结果的一次性小任务。需要查看执行过程、随时续聊，或者使用 Codex 的 image gen 和 Computer Use 时，可以选择 CLI Worker。 | 一次性小任务 → subagent_oar；查看过程、续聊、原生能力 → CLI Worker |
| 片尾卡（停留 5～6 秒，版式见下） | 插件项目地址显示在屏幕上，也附在视频简介中。欢迎下载使用 dsh-cliworker-now。交流使用心得或反馈问题，可以扫码加入插件讨论群。 | 见下方片尾卡版式 |

**片尾卡版式**（16:9，浅色背景，沿用 DSH 主题色）

| 位置 | 内容 |
|---|---|
| 左侧上方 | 项目图标 + 项目名称 **dsh-cliworker-now**（DSH 内显示为 CLI Worker Now） |
| 左侧中部 | 项目地址：`https://github.com/SuperWheel/dsh-cliworker-now` |
| 左侧下方 | 一句话：欢迎下载使用 dsh-cliworker-now |
| 右侧 | 插件讨论群二维码 [assets/qq-group-qr.png](assets/qq-group-qr.png)，下方小字「扫码加入插件讨论群」 |

- 项目图标用当前正式版 `doc/assets/project-icon/official-v4/cliworker-now.png`。
- 二维码图片 `assets/qq-group-qr.png`（950×950）从「cliworker插件交流群」的 QQ 群名片裁出，只保留二维码，四周留了白边。用 macOS Vision 识别结果与原图一致，都指向同一个 QQ 加群链接。
- 放进画面时，二维码边长不小于画面高度的 1/3（1080p 下约 360 像素），方便观众暂停后直接扫码。
- QQ 群二维码一般长期有效，但群主重置后旧码就会失效。发布前再用手机扫一次确认。

---

## 6. TTS 制作建议

- 文本直接用 [narration.txt](narration.txt)。版本号已写成「零点二点二 RC 一」，模型写成「GPT 六点一 sol」。
- `subagent_oar` 先试听：读成一个词的话，改写成「sub agent O A R」。
- 「你以为这就结束了？」单独生成一条，语调可以上扬，前后各留 0.8 秒停顿。
- 语速 1.0～1.1 倍。等待类镜头（subagent_oar 等结果、生图）先让旁白说完，再 3～4 倍速快进。
- 先生成各段音频，再按音频长度剪录屏。

---

## 7. 录制注意

- **图一不要直接当 subagent_oar 的素材**：图一里的回复写的是 `codex exec … -s read-only` 命令，主 Agent 还把 `auth.json` 复制进了工作区来绕过沙箱。这更像是主 Agent 自己在终端里跑了 Codex，而不是调用了 `subagent_oar` 工具。正式录制时请在过程里拍到 `subagent_oar` 工具卡，否则「这就是 subagent_oar 的效果」这句话站不住。另外，复制凭据这一步不要出现在视频里。
- 图二、图三的界面和数据可以直接用；正式录制时以实际数字为准。

---

## 8. 事实核对表

| 脚本中的说法 | 依据 | 状态 |
|---|---|---|
| subagent_oar 可把独立任务交给本机 Codex 或 Claude CLI | 官方 Release `dsh-v0.2.2-rc.1` | 已核对 |
| 只返回 Codex 最后一段文字；推理、工具事件不进入 DSH；一次性，无续聊和进度流 | 官方源码 `packages/experimental/subagent-oar/README.zh.md`「理解实现」「已知限制」 | 已核对 |
| 子任务的 token 由 Codex 自己承担，DSH 里看不到 | 同上「Token 影响」 | 已核对 |
| CLI Worker 子会话显示轮次、步骤、token、缓存命中、上下文占用 | 你提供的图三 | 已核对 |
| 侧栏续聊；主 Agent 按名字二次调用（`cliworker_followup` + `worker_name`） | README；`src/host/index.ts` | 已发布 |
| 13 种 CLI，各走原生协议 | README「支持的 CLI」 | 已核对 |
| CLI 原生工具和 skill 优先，DSH 独有的 MCP 和技能经 `dsh_worker_tools` 作为备选，每次执行经 DSH 权限审批 | README「原生工具优先，DSH 工具作为备选」 | 已发布；边界见下一行 |
| 「兼容 DSH 的所有工具」 | README：与 CLI 重叠的 DSH 工具不再交给 CLI；ZCode 的工具桥暂不提供；OMP、Hermes 和隔离副本任务不接工具桥 | **不准确，旁白已改为「DSH 独有的 MCP 和技能可以作为备选」** |
| Computer Use 应用授权转交 DSH，在主对话弹出 | README；`openspec/changes/archive/2026-10-31-relay-codex-computer-use-approvals/` | 只在 Windows 实测过「拒绝」，「允许一次」只有模拟测试，录制时是第一次真实验证 |
| Codex 用 image gen 参考人设图生成多帧，再合成 GIF | 插件能识别 Codex 的 `imageGeneration` 事件（`src/host/native-codex.mjs`）；GIF 需要靠本机命令合成 | **没有真实验收记录，录制前必须彩排**；参考图能否直接作为生图输入、帧间一致性都要实测 |
| Codex 用 Computer Use 把 GIF 插入 Word 文档并保存 | 无记录 | **没有验证过，录制前必须彩排**；插入可能要靠菜单或拖拽，Codex 未必一次成功；Word 里 GIF 是否会动也要确认 |
| DSH 子 Agent 出现在 CLI Worker 窗口、可续聊、不接管原生流程 | `openspec/changes/add-sibling-dispatch-unified-subagents/tasks.md` 5.2、6.5 | 预览包已实测，未发布 |

---

## 附：subagent_oar 启用方式（官方 README 示例，只保留 Codex）

```yaml
- insert:
    - id: experimental-subagent-oar-codex
      name: '@deepseek-ai/dsh-experimental-subagent-oar'
      config:
        runtime: codex
        providerName: oar-codex
        launchArgs:
          - -c
          - sandbox_mode="workspace-write"
    - id: tool-subagent-oar
      name: '@deepseek-ai/dsh-experimental-tool-subagent-oar'
      config:
        providers:
          codex: oar-codex
```

官方示例没有指定模型。要让它用 `gpt-6.1-sol` high，需要在 provider 的 `config` 里加 `model` 和 `effort`。这正是第 2 段可以顺带一提的区别：subagent_oar 的模型写在配置里，CLI Worker 每次派遣都可以选。
