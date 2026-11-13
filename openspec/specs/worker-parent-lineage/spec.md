# worker-parent-lineage Specification

## Purpose

在 DS Bot 换段（主对话被切成新段）后，只依据可验证的段链把空闲 Worker 重新归入新段，并重建对应的显示子会话，避免 Worker 挂在已失效的父对话下。

## Requirements

### Requirement: 只承认可验证的段链
插件 SHALL 只从 DS Bot 状态文件（`<DSH_HOME 或 ~/.dsh>/bot/state.json`）只读识别段链：Bot 自己对话的 `id`、`sessionId` 与 `segments[].sessionId`，群聊成员的 `rooms[].sessions[botId]` 与 `rooms[].segments[botId][].sessionId`，群自身的 `rooms[].id`、`rooms[].sessionId` 与 `rooms[].parts[].sessionId` 各构成一条链，链的当前段为对应的 `sessionId`。文件不存在、无法读取、超过 64 MiB、不是 `version: 1` 或字段类型不符时 MUST 视为没有段链；同一会话 ID 出现在多条链中时 MUST 不使用这些链。插件 MUST NOT 写 DS Bot 的任何文件。

#### Scenario: 没有安装 DS Bot
- **WHEN** 状态文件不存在，用户在另一个会话里使用某 Worker 的 ID
- **THEN** 仍报「Worker does not belong to this conversation」

#### Scenario: 状态文件损坏
- **WHEN** 状态文件不是合法 JSON 或缺少段链字段
- **THEN** 按没有段链处理，所有跨会话访问照旧拒绝，不抛出新的错误

#### Scenario: 会话 ID 出现在两条链
- **WHEN** 同一个会话 ID 同时出现在两个 Bot 的段链里
- **THEN** 这两条链都不用于重绑

### Requirement: 换段后重绑空闲 Worker
父会话 P 调用插件的 Worker 入口（状态查询、快照、续聊、打开会话、改名、删除、恢复、派遣时的重名检查）时，若 P 是某条段链的当前段，插件 SHALL 把父会话为同链其他段的 Worker 改为 P，并把原父会话追加到该 Worker 的 `formerParentSessionIds`（最多 64 个）后持久化。正在运行、排队、准备、停止或有待投递续聊的 Worker MUST NOT 在此时改写，待其空闲后由下一次调用改写。P 不是任何链的当前段时 MUST NOT 改写任何 Worker。CLI 侧会话 ID MUST 保持不变。

#### Scenario: 换段后查询状态
- **WHEN** DS Bot 换段后，在新段用旧段 Worker 的 ID 调用 `cliworker_status`
- **THEN** 返回该 Worker 的真实状态，Worker 的父会话变为新段，原父会话记入 `formerParentSessionIds`

#### Scenario: 换段后无参快照
- **WHEN** 换段后在新段无参调用 `cliworker_status`
- **THEN** 快照包含同一段链上的历史 Worker，不包含其他会话的 Worker

#### Scenario: 换段后续聊
- **WHEN** 换段后在新段对旧段 Worker 续聊
- **THEN** CLI 用原会话 ID 恢复并运行本轮

#### Scenario: 用旧段身份访问
- **WHEN** Worker 已重绑到新段后，有请求仍以旧段作为父会话访问它
- **THEN** 报「Worker does not belong to this conversation」

#### Scenario: 无关会话
- **WHEN** 一个不在该段链上的会话使用该 Worker 的 ID
- **THEN** 报「Worker does not belong to this conversation」，Worker 不被改写

#### Scenario: 运行中的 Worker
- **WHEN** 换段时旧段有 Worker 正在运行，新段查询它
- **THEN** 本次仍按原归属拒绝；该 Worker 结束后新段再次调用时完成重绑

#### Scenario: 回到旧段
- **WHEN** 用户在 DS Bot 中把更早的段重新设为当前段，并在该段调用插件
- **THEN** 同链上的空闲 Worker 改到该段

### Requirement: 重绑后重建显示子会话
Worker 已改到父会话 P、而它的显示记录仍属于 `formerParentSessionIds` 中的旧父会话时，打开会话或投影本轮 SHALL 以旧记录为前身在 P 下重建显示子会话：旧显示子会话 ID 记入新记录的 `retiredSessionIds`，Worker 的 `harnessConversation` 改为新子会话与新父会话，旧记录同时从持久化存储与内存中删除。显示记录的父会话不在 `formerParentSessionIds` 中时 MUST 仍报「原生会话父身份不匹配」。重建 MUST NOT 重新发送 CLI 任务。

#### Scenario: 换段后打开会话
- **WHEN** 换段后在面板点击旧段 Worker 的「打开会话」
- **THEN** 打开在新段下重建的显示子会话，没有「不能跨父会话绑定 CLI 会话」报错，旧子会话 ID 记入 `retiredSessionIds`

#### Scenario: 连续两次打开
- **WHEN** 同一 Worker 重绑后连续两次打开会话
- **THEN** 两次都命中新记录，不出现「原生会话父身份不匹配」

#### Scenario: 重启后访问
- **WHEN** 重绑完成后 Harness 重启，再从新段访问该 Worker
- **THEN** 持久化的 Worker 与显示记录都属于新段，访问正常

#### Scenario: 非同链的旧记录
- **WHEN** Worker 的显示记录属于一个不在 `formerParentSessionIds` 中的父会话
- **THEN** 打开会话报「原生会话父身份不匹配」，不重建
