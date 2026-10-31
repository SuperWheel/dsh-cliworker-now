## ADDED Requirements

### Requirement: Antigravity 工具桥私有工作区不承载任务文件
插件为 Antigravity 工具桥加入 `--add-dir` 的本轮私有目录只用于让 CLI 读取 MCP 与 Hook 配置。PreToolUse Hook SHALL 拒绝参数中出现该目录的任何原生工具调用（路径、URI、命令或 JSON 文本，Windows 上不区分大小写和分隔符），拒绝原因 MUST 指明这是私有目录并给出项目目录；不涉及该目录的原生工具 MUST 保持 CLI 原有策略，工具桥工具的准入规则不变。

#### Scenario: 模型把任务文件写到私有目录
- **WHEN** Antigravity 模型调用写文件工具，目标路径位于本轮工具桥私有目录
- **THEN** Hook 拒绝该调用，原因写明私有目录不属于项目并给出项目目录，文件不写入私有目录

#### Scenario: 写到项目目录
- **WHEN** 模型调用写文件工具，目标路径在项目目录内或与私有目录同名前缀的其他目录
- **THEN** Hook 不改变该调用的原生权限策略
