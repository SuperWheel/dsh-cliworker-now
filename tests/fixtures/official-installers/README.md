# 官方安装脚本只读证据（2026-11-17）

这些文件是从下列官方 HTTPS 地址只读下载的原始字节；未执行脚本。Pi 修复只执行匹配本次审阅 SHA-256 的官方下载文件，未来脚本变更须重新审阅，不自动接受旧目录语义。

| 文件 | 官方来源 | SHA-256 |
| --- | --- | --- |
| pi-install.ps1 | https://pi.dev/install.ps1 | 3ba23d3451e17649495bdee14414ec1f3616ad7ae7246b4edd2e7166e7b3af51 |
| pi-install.sh | https://pi.dev/install.sh | ff4ed7b1ea1c058f33249a44093863b50cf95224ab4ff654e722fcbbbdaa31df |
| codex-install.sh | https://releases.openai.com/codex/install.sh | 5a8eea5c3716b555fd8e539db7e5b0e7470bcee5693191b4758a0de373624a70 |

- `PI_LEGACY_INSTALL=0`：PS1 682–684、sh 829–831，只有值 1 才关闭 managed 模式。PS1 1742–1749 仅非 managed 分支调用全局 npm 安装。
- `PI_MANAGED_INSTALL_ROOT`：PS1 1133–1148 优先选择有有效标记的指定根；sh 896–913 同义。
- `PI_CODING_AGENT_DIR`：PS1 686–690 与 1148 控制上述选择器的兜底根；sh 912–913 同义。因此显式绑定这两个变量不会在标记异常时落回另一个默认根。
- PS1 2056–2090 重查 PATH，并可能将另一个 npm 安装识别为迁移来源；修复须排除该来源，优先原根 bin，并核验原根外的文件。
- PS1 1620–1640 从选定环境读取 managedRoot/managedAgentDir，并拒绝非迁移情形的其他根或无效标记；随后在该根 staging/releases 内安装（1655–1739）。
- `CODEX_INSTALL_DIR`：codex-install.sh 16–18；`CODEX_HOME`：19–24。分别决定启动器目录和 packages/standalone/release 根。

另在本机只读核对 `~/.pi/agent/install/releases/1.5.2/node_modules/@earendil-works/pi-coding-agent/dist/package-manager-cli.js`：25–46 依赖 PI_MANAGED_INSTALL_ROOT 且要求自身包属于其 releases；992–1019 为托管更新分支，1023–1052 为普通包管理器分支。缺少绑定时不能假定运行内层 JS 仍走托管更新。未读取用户设置或凭据，未执行已安装 Pi。

`dist/config.js` 271–275 与 `dist/package-manager-cli.js` 990–1004 还确认 PI_SELF_UPDATE_COMMAND / selfUpdateCommand 优先于托管更新。插件不能证明任意自定义命令的安装目标，故在执行前拒绝；只读取原根 settings.json 的该配置，不读取 auth.json 或凭据。
