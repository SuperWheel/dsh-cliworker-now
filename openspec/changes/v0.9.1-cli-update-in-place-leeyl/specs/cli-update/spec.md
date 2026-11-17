## ADDED Requirements

### Requirement: 已有安装只在原安装上更新或修复
Host SHALL 把安装判为不存在、存在但归属未核实、归属已核实三种状态；只有不存在时才允许按默认方式首次安装。已有安装的更新、重新安装与修复，结果 MUST 落在原安装的 root、prefix 或 appPath。下载与执行的渠道不限（官方更新器、npm 安装包、镜像、插件接管），但 MUST NOT 在其他位置另装一份，MUST NOT 把插件的路径记录改到其他根目录。无法确认能在原安装上完成时，Host SHALL 说明原安装的位置和管理渠道并拒绝；损坏的安装 MUST NOT 被当作不存在。

#### Scenario: Windows 托管 Pi 更新
- **WHEN** Pi 的官方托管安装位于 `~\.pi\agent`，版本 1.1.0，用户在「更新 CLI」页更新到 1.5.2
- **THEN** 无论经官方 `pi update --self`、插件接管还是以 npm 安装包为来源，新版本都写入 `~\.pi\agent`；npm 全局目录中不出现新的 Pi，插件记录仍指向原托管安装

#### Scenario: Pi 托管安装损坏
- **WHEN** Pi 的 managed-install.json、current-version 或 releases 存在，但入口损坏
- **THEN** Host SHALL 保留托管安装身份，经官方更新器、同目录接管或以 npm 安装包为来源，把修复结果写回原托管目录；无法写回原目录时拒绝并说明，MUST NOT 在 npm 全局或其他位置另装一份

#### Scenario: npm 安装在非默认前缀
- **WHEN** Windows npm 位于 `C:/tools/lib/node_modules`，入口为 `.cmd` 或其内层 JS
- **THEN** Host SHALL 保留 `C:/tools/lib` 前缀，执行前包根必须等于该前缀下的 node_modules 白名单包；只有 POSIX 才使用 `lib/node_modules`

#### Scenario: 原生、brew 或无法核实的安装
- **WHEN** 已有 CodeBuddy 原生安装、brew 安装或来源无法核实的安装，用户点「重新安装」
- **THEN** Host SHALL 用原更新器或同前缀 brew 修复，或者明确拒绝，MUST NOT 另装到默认的 npm 全局前缀

#### Scenario: 官方脚本不能指定目录
- **WHEN** 官方脚本只能装到默认根目录，而现有安装不在默认根目录
- **THEN** Host SHALL 使用已核实的同目录接管或拒绝，MUST NOT 猜测脚本参数，也 MUST NOT 装到默认根目录

#### Scenario: 没有已有安装
- **WHEN** 该 CLI 在 PATH、插件记录与已知目录中都不存在
- **THEN** Host 按该 CLI 的默认方式全新安装，并写入路径记录

### Requirement: 路径记录在安装身份复核后提交
管理页的安装发现 SHALL 不写路径记录。更新或修复 SHALL 先核实仍是同一 owner、root、prefix 或 appPath，且版本与完整性正确，然后才提交路径记录；失败时 MUST 保持记录和 revision 不变。

#### Scenario: 更新后发现是另一份安装
- **WHEN** 更新命令成功退出，但核对时识别到另一个根目录或另一个管理器
- **THEN** Host SHALL 报告失败，保留原记录及 revision

#### Scenario: Windows 安装向导装到了别处
- **WHEN** 可见的官方安装程序整个进程范围退出后，注册表或应用查找指向 X，而原 appPath 为 Y
- **THEN** Host SHALL 报告「安装程序把新版本装到了 X，原安装 Y 未更新」，不改路径记录；窗口可见与退出确认规则不变
