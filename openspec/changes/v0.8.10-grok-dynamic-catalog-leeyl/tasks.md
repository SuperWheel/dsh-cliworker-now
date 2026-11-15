## 1. Grok 根因与兼容修复 〔后端｜2h〕

- [x] 1.1 只读复现并核对原生能力
  - 2026-11-15 本机 Grok 1.0.77 (50ca579fa996)：隔离离线 ACP 返回 grok-4.6/4.5；当前账号 /settings、/models HTTP 200，账号仅 grok-4.7。原版 discoverGrok 重现「当前 CLI 未支持账号模型」。没有发 prompt，没有执行续期命令。
  - 安装版 + 明确模拟的 loopback /models：仅 GET /models，ACP initialize 返回模拟新 ID 和 xhigh/low，进程退出 0，临时目录删除。
- [x] 1.2 加入已验证构建并补模拟回归
  - Grok adapter 精确构建表加入 1.0.77 与 stable 标记；旧构建保留，未知构建不放宽。测试覆盖新旧 camelCase/snake_case、隐藏项、未知 revision/version。
- [x] 1.3 关联 vitest、typecheck、严格规格检查
  - 全部 pnpm 命令通过 argv 数组调用 corepack，环境包含 pnpm_config_verify_deps_before_run=false，保留代理变量。
  - 首轮 7 文件、230 项：229 通过；pi-omp-adapter 的取消测试在 fs.watch 报 EMFILE 后 15 秒超时。该文件其余 132 项通过；没有改测试规避环境限制。
  - 获准沙箱外精确重跑该取消测试：1 通过、132 跳过（977ms）。其余 6 文件独立复跑：97/97 通过（1.78s），包含新增 8 项「模拟」兼容回归。
  - `corepack pnpm typecheck`：Host/Client 对 DSH 0.2.2-rc.3 通过。变更严格规格校验及限定范围 git diff --check 通过。
  - 修复后的真实 discoverGrok 返回 grok-4.7，efforts=xhigh/high/medium/low。没有真实任务/续期请求，没有构建或提交。
- [ ] 1.4 主会话统一构建后 Desktop 复验及公共文档同步
  - 未执行：本次明确禁止构建；README/doc/design 为共享文件，不在本次编辑范围。需主会话汇总同步，不以只读目录成功替代派遣验收。

## 2. OMP 与 Codex 关联排查 〔测试｜2h〕

- [x] 2.1 复现 OMP 原生与两阶段目录探测
  - OMP 18.20.2，mtime 2026-11-14 23:45:45 UTC；与今日先前 DeepSeek 修复验收版本一致。通过插件 snapshot 接口生成私有副本，原生候选 4 个，账号范围返回 deepseek-flash / deepseek-v4-pro。
  - 完整 discoverPiOmp/bridge（私有 accountRoot/stateDirectory、空 nativeHome）：native-candidates 4095ms/4 个，account-scope 2456ms/2 个，authenticationDenied=0，两进程退出 0。临时副本清理；不修改真实账号，不读出任何凭据值。
  - Desktop 自带 Electron/Node 24.21.0 + private-launch 再验：两阶段 5162ms/2178ms，4/2 个模型，两个 DeepSeek 模型强度均 low/high/max；进程退出 0。只读元数据成功不等于 Desktop 状态已恢复。
  - 当前没有重现 Desktop 通用目录错误，不能据此确认其原故障根因，也不改 OMP 实现。34133b9 的私有 TMP/TEMP helper 仅 Windows 接入；777fb33 的 Pi/OMP 差异为补传 Windows 程序目录变量。
- [x] 2.2 核对 Codex app-server 只读协议
  - Codex 0.169.0；原生 help 仍明确支持 --stdio。初次诊断沙箱阻止原生 SQLite 状态初始化，退出 1，属本次诊断环境限制。
  - 获准沙箱外原样 initialize/initialized/account/read(refreshToken=false)：initialize 517ms，account/read 1237ms，account.type=chatgpt；字段名 email/planType/workspaceName，仅输出字段名，没有身份值或凭据。退出 0、stderr 0 字节。
  - 再通过源码 readCodexAccount + DSH 0.2.2-rc.3 的 spawnSubprocess（保留其环境过滤和进程组清理）验证：2473ms，authenticated/oauth/verification=cli，已完成 waitForExit。没有发模型请求、登录或刷新请求。
  - 暂无证据证明 Desktop 原故障是账号过期、协议变更或 4 秒超时；保持源码不变，需主会话 Desktop 复验。
