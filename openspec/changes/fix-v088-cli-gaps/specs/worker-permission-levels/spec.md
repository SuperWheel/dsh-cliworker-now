## ADDED Requirements

### Requirement: 派遣结果写明实际档位
主 Agent 通过 `cliworker_start` 或 `cliworker_followup` 派遣或续聊 Worker 时，Host SHALL 在返回结果与完成结果中写明本轮实际生效的权限档位名称（按该 CLI 的档位命名）以及来源：规划模式、跟随主对话权限预设（Worker 未选过档位），或用户为该 Worker 选定的档位。写明的档位 SHALL 是任务受理时实际采用的档位，MUST NOT 改变档位的判定规则。

#### Scenario: 未选过档位的 Worker
- **WHEN** 主 Agent 派遣一个用户从未选过档位的 Worker
- **THEN** 结果写明本轮档位跟随主对话权限预设，以及对应的档位名称

#### Scenario: 用户选过档位
- **WHEN** 用户已为该 Worker 选定一个高于主对话预设的档位，主 Agent 续聊
- **THEN** 结果写明本轮按用户为此 Worker 选定的档位运行

#### Scenario: 规划模式
- **WHEN** 主对话处于规划模式时派遣 Worker
- **THEN** 结果写明本轮为规划模式（只读）
