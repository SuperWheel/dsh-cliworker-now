## Context
OMP 18.20.2 内嵌 startup-cwd.ts 接受 --cwd；Bash 使用显式参数 cwd 或 session.cwd，没有证据表明它自动改为 Git 根。真实事件显示模型显式传仓库根；read 仍以 Worker 子目录解析，因此是项目语义分歧。Pi 1.5.2 使用 process.cwd()/session cwd，没有同名 --cwd 选项。

## Goals / Non-Goals
明确 Worker 项目与祖先仓库的区别，保持原生权限；不引入 OS 沙箱，不阻止用户明确要求的跨目录操作，不改凭据或真实会话。

## Decisions
- OMP 传 --cwd，Pi 不套用不存在的参数；双方设置子进程 PWD 并追加项目说明，不替换原生系统提示。
- 在共享 Host 工具回执边界格式化失败对象，正常结果保持结构；转换中止对象并保留取消语义。
- 所有 CLI 内容保持纯文本；未知对象限制长度和深度，不渲染 HTML。

## Risks / Trade-offs
提示约束不等于权限隔离；真实 CLI 的主动跨目录和旧会话恢复仍需 Desktop 复验。未证明 Windows Claude 的实际错误链，仅用同一路径模拟取消回归覆盖。
