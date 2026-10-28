## ADDED Requirements

### Requirement: OpenCode 与 MiMo 不读入未核验配置及其他 CLI 数据
OpenCode 的模型发现、Worker 与插件内登录 SHALL 只合并插件私有配置目录、插件写入的配置和插件已核验的账号档案；用户主目录下的 `.opencode` 配置目录 MUST 不参与配置合并、命令/agent 加载或依赖安装。MiMo 的模型发现、Worker 与插件内登录 MUST 不把其他 CLI 的会话记录导入 MiMo 数据库。MiMo 自身的全局、主目录与项目配置 SHALL 保持为其账号和模型来源，不因本隔离改变。用户自己的 OpenCode 与 MiMo skill SHALL 仍可被 CLI 发现和使用。

#### Scenario: 主目录 .opencode 定义了 provider 或 MCP
- **WHEN** 用户主目录的 `.opencode/opencode.json` 为所选 provider 设置了其他 `apiKey` 或 `baseURL`，或定义了 MCP 服务器
- **THEN** OpenCode Worker 与模型发现仍按插件核验的账号档案执行，所选 provider 的地址与凭据不被覆盖，该 MCP 不被加载

#### Scenario: 主目录 .opencode 中的 skill
- **WHEN** 用户把 skill 放在主目录 `.opencode/skills` 或 `.opencode/skill`
- **THEN** 该 skill 仍出现在 OpenCode Worker 可用 skill 中，且 CLI 不在该目录写文件或安装依赖

#### Scenario: Claude Code 会话记录存在
- **WHEN** 用户主目录有 Claude Code 会话记录，插件为 MiMo 运行模型发现、派遣 Worker 或打开登录
- **THEN** MiMo 数据库不新增来自 Claude Code 的导入会话；此前已导入的会话保留不动

#### Scenario: MiMo 自身配置
- **WHEN** 用户的 MiMo 全局配置、`~/.mimocode` 或项目 `mimocode.json` 定义了 MiMo 自身 provider 与模型
- **THEN** 模型发现与 Worker 继续使用这些来源，已有的配置检查（外部引用、远程配置拒绝）照常生效

#### Scenario: Worker 中运行的命令
- **WHEN** OpenCode Worker 通过原生 shell 工具运行命令
- **THEN** 命令看到的仍是用户真实的 `HOME`，Git、SSH 等用户工具配置不受隔离影响
