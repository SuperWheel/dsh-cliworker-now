## ADDED Requirements

### Requirement: 统一外部分发名称并保留安装界面
GitHub 仓库名、npm 包名、Release 标题与当前外部分发文档 SHALL 使用 `dsh-cliworker-now`。DSH 内插件界面 MUST 保留 CLI Worker / CLI Worker Now 的现有名称，运行时协议、工具、配置、会话与账号存储位置保持兼容。历史截图及已发布不可变包保持真实。

#### Scenario: 外部分发入口
- **WHEN** 用户打开当前仓库、Release 或推荐安装命令
- **THEN** 使用 dsh-cliworker-now 名称和新仓库地址，旧新 GitHub 下载入口取得同一已发布包

#### Scenario: 已安装的界面
- **WHEN** 用户打开 DSH 中的插件页签、侧栏或设置弹窗
- **THEN** 显示原有 CLI Worker / CLI Worker Now 名称，现有按钮提示、账号、会话和偏好保持不变

#### Scenario: 外部目录尚未迁移
- **WHEN** dshfind 改名映射提交而目录数据库迁移或统计采集尚未执行
- **THEN** 明确区分已提交补丁与公开页面生效，不伪造下载量、不把 PR 已提交视为目录已更新
