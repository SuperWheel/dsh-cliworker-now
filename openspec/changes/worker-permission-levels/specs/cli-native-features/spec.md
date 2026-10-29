## MODIFIED Requirements

### Requirement: Pi 命令执行跟随权限预设
Pi Worker 在三档下 SHALL 都开放原生 write、edit 与 bash，由插件每轮加载的私有确认扩展按档位拦截：第一项（询问）读类工具直接执行，写入、编辑与命令先经 DSH 询问；中档（自动批准编辑）写入与编辑直接执行，命令先询问；完全权限不加载确认扩展。确认扩展未就绪时 MUST NOT 开始本轮；安装版没有文档化的拦截或确认接口时，第一项 SHALL 只开放读类工具，中档 MUST NOT 开放原生 bash。OMP 第一项 SHALL 以原生 `always-ask` 运行并开放 bash，每次编辑与命令的原生确认经 DSH 审批后回复 OMP；中档以原生 `write` 运行，编辑自动批准、命令询问；完全权限以原生 `yolo` 运行。

#### Scenario: 完全权限下的 Pi
- **WHEN** 本轮实际档位为完全权限，派遣 Pi 写任务
- **THEN** Pi 的原生工具集包含 bash

#### Scenario: 自动批准编辑下的 Pi
- **WHEN** 本轮实际档位为中档，Pi 写文件后需要执行命令
- **THEN** 写文件不询问；执行命令前出现 DSH 询问，拒绝后命令不执行

#### Scenario: 询问档的 Pi
- **WHEN** 本轮实际档位为第一项，Pi 要修改文件
- **THEN** 出现 DSH 询问，用户拒绝后文件不被修改

#### Scenario: 确认扩展未就绪
- **WHEN** Pi 进程启动后没有报告确认扩展就绪
- **THEN** 本轮不发送提示，报错「Pi 权限确认扩展未加载，本轮未开始」

#### Scenario: 询问档的 OMP
- **WHEN** 本轮实际档位为第一项，OMP 要编辑文件或执行命令
- **THEN** OMP 每次原生确认经 DSH 审批后回复，拒绝时 OMP 不执行该操作
