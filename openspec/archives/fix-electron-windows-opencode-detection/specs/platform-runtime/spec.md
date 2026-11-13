## ADDED Requirements

### Requirement: Electron 宿主中的物理安装识别
Windows CLI 安装识别 SHALL 依据磁盘中的实际文件类型、权限和内容，不因宿主将 ASAR 视作虚拟目录而拒绝有效 CLI。可选桌面归档标记缺失 MUST 不阻止普通独立 CLI；真实读取失败、损坏入口及显式桌面 GUI 仍须按既有边界报错。检查不得改变宿主全局归档行为。

#### Scenario: npm CLI 无桌面归档
- **WHEN** Electron 宿主发现有效 OpenCode npm 原生 CLI，旁侧不存在桌面 app.asar
- **THEN** 保留该 CLI 并自动记录路径，不因可选标记缺失报桌面入口不可用

#### Scenario: 桌面归档为物理文件
- **WHEN** PATH 命中 OpenCode 桌面 GUI，磁盘存在桌面归档与核验通过的独立 CLI
- **THEN** 自动解析该安装的独立 CLI；手动指定 GUI 时仍明确拒绝

#### Scenario: 真实文件错误
- **WHEN** 安装文件无读取权限、不是普通文件或 PE 内容损坏
- **THEN** 保留安装错误，不将其当作可选归档缺失，不静默换用其他 CLI
