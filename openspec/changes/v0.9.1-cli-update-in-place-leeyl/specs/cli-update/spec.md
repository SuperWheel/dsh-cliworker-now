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

### Requirement: ZCode Worker 运行桌面应用自带的 CLI
Host SHALL 把 ZCode 的自动入口解析为桌面应用自带的 `glm/zcode.cjs`，并用该应用自己的可执行文件以 `ELECTRON_RUN_AS_NODE=1` 启动、预加载插件的解析钩子；插件早期部署的独立 runtime 只作为最后一个候选，MUST NOT 优先于已安装的应用，Host MUST NOT 删除它。Worker 参数、`app-server`、`login`、`logout` 的其余参数、工作目录与宿主代理变量 MUST 保持不变。

#### Scenario: 自动入口的查找顺序
- **WHEN** 没有显式配置和路径记录
- **THEN** macOS 先取 `/Applications/ZCode.app`，再取 `~/Applications/ZCode.app`，Windows 取已核实安装目录下的 `resources\glm\zcode.cjs`；都没有时才使用独立 runtime

#### Scenario: 应用自带入口的启动参数
- **WHEN** Worker、账号登录或退出使用 `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`
- **THEN** argv 以 `<应用>/Contents/MacOS/ZCode --require <插件>/zcode-app-resolve.cjs <入口>` 开头（Windows 为 `<安装目录>\ZCode.exe`），其后参数与此前相同；环境变量增加 `ELECTRON_RUN_AS_NODE=1` 与资源目录变量，服务商配置取同一安装的 `config/provider/zcode-builtin.json`

#### Scenario: 应用运行环境没有通过启动检查
- **WHEN** 以上述方式执行 `--version` 失败或没有输出版本号
- **THEN** Host SHALL 改用宿主自带的 Node 运行同一入口，并在账号行与更新行显示提示；应用的可执行文件或入口变化后 SHALL 重新检查

#### Scenario: macOS 上的临时目录
- **WHEN** Host 在 macOS 启动任一 ZCode 进程（Worker、app-server、模型目录读取、`--version` 启动检查、更新页版本读取、`--help`、登录、退出、账号终端）
- **THEN** 该进程的 `TMPDIR`、`TMP`、`TEMP` SHALL 指向 `/tmp/cwn-XXXXXX` 形式的 0700 私有目录，使 ZCode 在其中创建的 Unix 套接字路径短于 104 字节；Windows 与 Linux 不改临时目录

#### Scenario: 启动检查期间路径被修改
- **WHEN** `--version` 启动检查进行中，CLI 路径记录的 revision 发生变化
- **THEN** Host SHALL 在检查结束后再比较 revision，本次解析报告路径已更新，MUST NOT 覆盖新的记录或把它报告为可用

#### Scenario: 账号终端入口
- **WHEN** 入口旁解析不到 `@zcode/tui`（桌面应用自带的 CLI）
- **THEN** 账号状态不提供「账号终端」动作，设置页隐藏该入口；登录与退出仍可用。能解析到该包的完整 runtime 保留账号终端

### Requirement: ZCode 解析钩子只补两个包
预加载的解析钩子 MUST 只在正常解析失败后，把 `@napi-rs/keyring` 与 `playwright-core` 两个包名改从同一安装的 `app.asar` 解析；MUST NOT 改写其他导入，MUST NOT 下载或写入文件。资源目录未给出、`app.asar` 不存在或运行环境不支持同步解析钩子时，钩子 SHALL 不生效。

#### Scenario: 其他包解析失败
- **WHEN** 自带 CLI 导入 `@zcode/tui` 或其他不在名单内的包而解析失败
- **THEN** 钩子保留 CLI 原本的错误，不做第二次解析

#### Scenario: 名单内的包
- **WHEN** 自带 CLI 导入 `@napi-rs/keyring` 或 `playwright-core`，按入口自身路径解析失败
- **THEN** 钩子改从同一安装的 `app.asar/node_modules` 解析；仍失败时报告 CLI 原本的错误

### Requirement: 插件 ZCode 账号目录使用文件密钥
插件自己的 ZCode 账号目录尚未选定密钥来源时，Host SHALL 在该目录创建权限 0600、内容为 32 个随机字节 base64url 的 `credential-secret` 文件，由 ZCode 按其原生规则读取。Host MUST NOT 同时提供两个密钥来源，MUST NOT 改写已有文件，MUST NOT 触碰用户自己的 `~/.zcode`。

#### Scenario: 尚未选定密钥来源
- **WHEN** 账号目录已存在，没有 `credential-source` 标记和 v2 记录，且未设置 `ZCODE_CREDENTIAL_SECRET` 或 `ZCODE_CREDENTIAL_SECRET_FILE`
- **THEN** Host 创建 `credential-secret`，不通过环境变量传递其内容

#### Scenario: 已有密钥来源
- **WHEN** 目录已固定到系统凭据库、已有 v2 记录、已设置任一变量或文件已存在
- **THEN** Host 不创建也不改写任何文件，原样传递用户设置的那一个变量

#### Scenario: 并发启动与中断
- **WHEN** 多个 ZCode 进程同时首次启动，或 Host 在写入密钥期间中断
- **THEN** Host SHALL 先把密钥写入同目录的 0600 临时文件并落盘，再以不覆盖已有文件的方式发布；其他启动只会看到没有密钥文件或完整的密钥文件，后到者沿用已发布的密钥

#### Scenario: 已有密钥文件不可用
- **WHEN** `credential-secret` 已存在但为空、短于 32 字节、长于 4096 字节或权限不是仅本人可读写
- **THEN** Host MUST NOT 覆盖该文件，也 MUST NOT 用它启动 ZCode；Worker 与账号入口 SHALL 返回指出该文件路径的错误

## MODIFIED Requirements

### Requirement: 自动入口与独立 runtime 的更新一致性
Host SHALL 保存自动发现的启动器或符号链接入口，每次使用时重新解析实体；旧 auto 记录命中已核实的托管版本目录时 SHALL 在前台重新发现入口，以 revision 比较写回，MUST NOT 修改 manual 记录。Pi 管理检查 SHALL 从入口重读 current-version，Worker MUST 保持原支持集合。指向插件早期独立 ZCode runtime 的 auto 记录 SHALL 在桌面应用的身份核对与 `--version` 启动检查都通过后，以同一 revision 比较改写为应用自带的入口；manual 记录与显式配置的 zcodeExecutable MUST 保持不变，检查未通过时 MUST 保留原记录并显示提示。

#### Scenario: Pi 更新切换版本指针
- **WHEN** Pi 自带更新将 current-version 从 1.0.4 改为 1.5.2，旧实体仍存在
- **THEN** 更新后检查读出 1.5.2，旧版本缓存失效；Worker 拒绝未适配 1.5.2，不回退旧实体

#### Scenario: ZCode 自动入口为应用自带的 CLI
- **WHEN** 自动入口位于已核实的 ZCode 桌面应用内
- **THEN** 更新对象为 desktop-app；检查行显示「应用 3.18.2 · CLI 0.17.1」，应用版本用于桌面更新，CLI 版本取自按启动方式执行的 `--version`，并随应用版本、入口大小与修改时间失效；不再显示独立 runtime 的说明

#### Scenario: ZCode 自动记录仍为独立 runtime
- **WHEN** auto 记录为插件早期的独立 ZCode runtime，且桌面应用的身份（macOS bundle id `dev.zcode.app`，Windows PE ProductName `ZCode` 与配套服务商文件）与启动检查均通过
- **THEN** Host SHALL 把记录改写为应用自带的入口，revision 加一，独立 runtime 的文件保持原样

#### Scenario: 更新核对期间不迁移 ZCode 记录
- **WHEN** 更新页的只读身份识别正在解析入口，或 ZCode 的安装、更新、修复操作占用中
- **THEN** Host MUST NOT 迁移独立 runtime 的 auto 记录，更新前后的身份识别 SHALL 得到同一入口；迁移留给操作结束后的下一次普通解析

#### Scenario: ZCode 自动入口为独立 runtime
- **WHEN** auto 记录为独立 runtime，但没有桌面应用、身份不符或 `--version` 启动检查失败
- **THEN** Host SHALL 保留原记录与 revision，继续以独立 runtime 运行；默认应用 bundle id 已核实时更新对象仍为 desktop-app 并读取应用版本，检查行及更新结果说明独立 runtime 未随桌面应用更新，并提示安装或修复 ZCode 桌面应用

#### Scenario: ZCode 应用身份不符
- **WHEN** 固定 runtime 对应的默认应用不存在或 bundle id 不符
- **THEN** 不将该 runtime 映射到桌面应用，不猜测版本或来源
