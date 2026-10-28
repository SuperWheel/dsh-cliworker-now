## MODIFIED Requirements

### Requirement: Pi 命令执行跟随权限预设
Pi Worker 的原生 bash SHALL 仅在本轮实际档位为完全权限时启用；中档（自动批准编辑）MUST NOT 启用 Pi 原生 bash，命令执行由 DSH 备选工具经宿主沙箱与审批提供；第一项（只读）只开放读类工具。OMP 第一项 SHALL 以原生 `always-ask` 运行并开放 bash，每次编辑与命令的原生确认经 DSH 审批后回复 OMP；中档以原生 `write` 运行，编辑自动批准、命令询问；完全权限以原生 `yolo` 运行。

#### Scenario: 完全权限下的 Pi
- **WHEN** 本轮实际档位为完全权限，派遣 Pi 写任务
- **THEN** Pi 的原生工具集包含 bash

#### Scenario: 自动批准编辑下的 Pi
- **WHEN** 本轮实际档位为中档，Pi 需要执行命令
- **THEN** Pi 原生工具集不含 bash，Pi 通过 DSH 备选命令工具执行，每次经宿主沙箱与审批

#### Scenario: 只读下的 Pi
- **WHEN** 本轮实际档位为第一项，Pi 要修改文件
- **THEN** Pi 没有写入工具，文件不被修改

#### Scenario: 询问档的 OMP
- **WHEN** 本轮实际档位为第一项，OMP 要编辑文件或执行命令
- **THEN** OMP 每次原生确认经 DSH 审批后回复，拒绝时 OMP 不执行该操作
