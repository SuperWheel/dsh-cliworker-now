# harness-cli-tool-bridge Specification

## Purpose

约束 CLI 经工具桥调用 DSH 工具时的等待与撤回：调用不因等待 Host 响应过久而单方面放弃，只受任务时限、CLI 自身工具超时与取消约束；调用方放弃时撤回对应的授权询问。

## Requirements

### Requirement: 工具桥调用不设响应等待上限，调用方放弃即撤回
CLI 经工具桥调用 DSH 工具时，载体客户端 MUST NOT 因等待 Host 响应的时间过长而单方面放弃（例如等待用户授权超过 5 分钟）；调用时长 SHALL 只受任务时限、CLI 自身的工具超时和取消约束。调用方断开连接、且没有其他请求在等待同一调用时，Host SHALL 撤回该调用：正在等待的授权提问 SHALL 撤回，该工具 MUST NOT 在之后执行。

#### Scenario: 授权等待超过 5 分钟
- **WHEN** Pi 的 DSH 备选命令工具等待授权 6 分钟后，用户选择「允许一次」
- **THEN** 工具调用仍然有效，命令执行并把结果交给 Pi

#### Scenario: 调用方放弃
- **WHEN** 工具调用等待授权期间，调用方关闭了连接
- **THEN** 提问卡撤回，之后无法再允许，命令不执行

#### Scenario: 重放请求仍在等待
- **WHEN** 同一调用有两个请求在等待，其中一个断开
- **THEN** 调用继续，结果交给仍在等待的请求

### Requirement: Antigravity 工具桥私有工作区不承载任务文件
插件为 Antigravity 工具桥加入 `--add-dir` 的本轮私有目录只用于让 CLI 读取 MCP 与 Hook 配置。PreToolUse Hook SHALL 拒绝参数中出现该目录的任何原生工具调用（路径、URI、命令或 JSON 文本，Windows 上不区分大小写和分隔符），拒绝原因 MUST 指明这是私有目录并给出项目目录；不涉及该目录的原生工具 MUST 保持 CLI 原有策略，工具桥工具的准入规则不变。

#### Scenario: 模型把任务文件写到私有目录
- **WHEN** Antigravity 模型调用写文件工具，目标路径位于本轮工具桥私有目录
- **THEN** Hook 拒绝该调用，原因写明私有目录不属于项目并给出项目目录，文件不写入私有目录

#### Scenario: 写到项目目录
- **WHEN** 模型调用写文件工具，目标路径在项目目录内或与私有目录同名前缀的其他目录
- **THEN** Hook 不改变该调用的原生权限策略
