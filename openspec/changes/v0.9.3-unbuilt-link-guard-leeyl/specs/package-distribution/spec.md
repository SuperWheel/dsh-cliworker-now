## ADDED Requirements

### Requirement: 未构建的源码目录不得关闭官方界面

插件 SHALL 把构建最后一步生成的空补丁 `lib/build-complete.patch.yml` 声明为 `dsh.bundle.patch` 的必需文件，并且构建脚本 MUST 在核对 Host、Client、预检、协议与四个随包界面入口全部存在后才写入它；任一入口缺失时构建 MUST 失败且不写标记。没有该标记的插件目录（未构建的源码检出、源码压缩包、构建失败的目录）在 DSH 启用时 MUST 被拒绝，且 MUST NOT 关闭官方会话、对话、子 Agent、消息流界面；已被选中的此类目录在冷启动时 SHALL 整层跳过，官方界面恢复可用。npm 与 Release 预构建包 MUST 包含该标记。文档 SHALL 说明源码目录须先安装依赖并构建，以及误装后的恢复方式。

#### Scenario: 链接未构建的源码目录后启用

- **WHEN** 用户把未构建的源码目录作为本地插件安装，并在插件页启用
- **THEN** 启用被拒绝，profile 的启用列表不变，官方对话区和输入栏保持可用

#### Scenario: 之前已误选中的未构建目录

- **WHEN** profile 已选中一个缺少构建标记的插件目录，用户冷启动 DSH
- **THEN** 该插件整层跳过，官方会话、对话、子 Agent 与消息流界面正常显示

#### Scenario: 正常构建或预构建包

- **WHEN** 用户安装 npm 或 Release 预构建包，或在源码目录完成依赖安装与构建后链接安装
- **THEN** 构建标记存在，插件正常启用，随包界面替换官方界面

#### Scenario: 构建中途失败

- **WHEN** 构建在写出全部入口之前失败
- **THEN** 不生成构建标记，该目录不能被启用
