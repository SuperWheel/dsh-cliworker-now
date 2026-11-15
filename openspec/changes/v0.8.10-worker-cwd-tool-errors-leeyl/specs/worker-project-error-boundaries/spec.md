## ADDED Requirements

### Requirement: Worker 项目目录保持一致
插件 SHALL 为 OMP 显式传原生 cwd 参数，并为 Pi/OMP 的进程 cwd、PWD 与追加系统提示使用同一 Worker 项目路径；祖先 Git 根不得自动替换 Worker 项目语义。

#### Scenario: 忽略的嵌套项目
- **WHEN** Worker 项目位于 Git 仓库的忽略子目录
- **THEN** OMP --cwd 与子进程 cwd、PWD 指向该子目录，Pi 使用其原生 cwd 机制，追加说明要求相对路径与默认工具 cwd 以该子目录为基准

### Requirement: 工具错误为可读纯文本
插件 SHALL 在工具失败和停止回执中优先使用 message/text/content 的文本，未知对象转为有界 JSON，避免隐式对象字符串转换且保持失败和取消语义。

#### Scenario: 结构化工具错误
- **WHEN** CLI 返回对象或文本块数组作为失败结果
- **THEN** 工具卡展示可读文本，未知结构的 JSON 有界且不作为 HTML 执行

#### Scenario: 停止时结构化中止原因
- **WHEN** 等待工具回执时收到结构化取消原因
- **THEN** 清理完成后展示可读取消信息，并保留取消而非成功状态
