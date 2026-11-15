## 1. 定位与修复 〔后端｜2h〕

- [x] 1.1 核对原生候选、凭据 provider、账号查询及 Pi 差异
  - Mac OMP 18.20.2，真实插件账号只复制到 0700 临时目录；只查询 provider/type/数量，不输出凭据值。有效 deepseek/api_key 1 条；原生与刷新后候选均 4 个，snapshot 均 4 个；原账号过滤 HTTP 调用 0 次、输出 0 个。
  - 4 个原生 ID：deepseek-flash、deepseek-v4-flash、deepseek-v4-flash-vision-exp、deepseek-v4-pro；均缺 baseUrl/api，thinking 为 low/high/max。
  - 根因：builtinAPI 漏掉 deepseek，accountSupportedChoices 在路由分组时跳过；不是 provider ID 不匹配、远端拒绝或 effort/parseCatalog 丢弃。安装版 OMP 原生 registry 的 DeepSeek 地址及环境变量名已核对。
  - Pi 1.5.2 安装 SDK + 模拟凭据/列表：deepseek 候选 2 个，均含 baseUrl/api；原过滤请求 1 次、输出 2 个。deepseek-flash 为 low/high/max，deepseek-v4-pro 为 high/max；没有真实 Pi 账号调用。仅环境变量凭据的默认 key 识别也随共享表补齐。
- [x] 1.2 补齐 DeepSeek 默认路由并保留路由优先级与交集
  - src/host/pi-native-catalog.mjs 增加 deepseek 的原生默认路由及 DEEPSEEK_API_KEY；模型 ID 不硬编码，默认路由不覆盖 SDK 或自定义路由。
- [x] 1.3 同步规格及使用文档
  - README.md、README.en.md、doc/design.md 和 cli-model-discovery 增量记录账号交集、原生强度及验收边界。

## 2. 验证 〔测试｜2h｜前置 1〕

所有 pnpm 命令均使用 `env pnpm_config_verify_deps_before_run=false corepack pnpm` 前缀；保留代理环境变量。

- [x] 2.1 模拟回归与关联 vitest
  - 新增 9 项明确标记 simulated 的回归：无 models.yml 登录、原生/远端 ID 交集、原生强度、Pi/OMP 路由优先级、自定义 provider 路由、认证拒绝/网络失败/无效响应关闭、无凭据不查询及环境凭据识别。
  - 修复前 pi-account-availability.test.ts 22 项中 6 失败（请求 0 次及空列表），修复后通过。
  - `test tests/pi-account-availability.test.ts tests/pi-omp-adapter.test.ts tests/account-models.test.ts tests/native-spawn.test.ts`：4 文件、184 项通过，82.26 秒。首轮沙箱 listen EPERM 导致 adapter 130 项失败；获准沙箱外重跑通过，没有修改测试规避限制。
  - 最后调整 Pi 环境凭据 fixture 保留真实 SDK 的 baseUrl/api 形状，并格式化测试；单独复跑 pi-account-availability.test.ts 22 项通过。
- [x] 2.2 typecheck、隔离 preview 构建与 diff 检查
  - `typecheck`：Host/Client 对 DSH 0.2.2-rc.3 通过。
  - `build:preview`：.cache/preview-package 构建通过；正式 Desktop 安装未更新。构建提示现有 CommonJS 建议，不影响退出码 0。
  - `/Library/Developer/CommandLineTools/usr/bin/git diff --check` 通过。
- [x] 2.3 隔离账号副本的真实目录查询及完整两阶段解析读回
  - 首次联网在沙箱内为 ENOTFOUND，保持空目录；获准沙箱外只读重跑，修复后普通/刷新原生目录各 4 个，分别调用一次账号列表 HTTP 200，各返回交集 2 个，authenticationDenied=0。
  - 独立 discoverPiOmp 使用临时 accountRoot/stateDirectory 与空 nativeHome，confirmedCatalog/bridge 的 native-candidates=4、account-scope=2；最终 parseCatalog 输出 deepseek/deepseek-flash、deepseek/deepseek-v4-pro，efforts 均 low/high/max。子进程退出 0。
  - 仅 /models 元数据，没有推理、真实账号目录写入或全局 ~/.omp 修改；诊断脚本仅打印计数、ID、强度与状态码。用户已有 scripts/.omp-cat.tmp.mts 未改动，也未以新仓库脚本替代；本次临时诊断目录、账号副本与指针已清理。
- [x] 2.4 严格规格校验与归档条件核对
  - `spec validate --all --strict --no-interactive`：41 项通过、0 失败；现有其他变更的旧格式告警保留。
  - 实现、模拟测试及隔离真实目录结果与增量一致；范围外验证保留在下方跟进。
  - `spec archive vnext-omp-deepseek-catalog-leeyl --yes` 成功，cli-model-discovery 主规格新增 1 项需求；归档后严格校验 40 项通过、0 失败，最终 diff --check 通过。

## 跟进

- Mac/Windows Desktop 下拉框未验证；不安装构建到 Desktop，当前已运行实例不会自动获得本次源码修复。
- 真实模型推理按本次禁止要求保持 0 次；目录 HTTP 200 不证明推理额度或调用成功。
- Pi 仅安装 SDK + 模拟账号列表核对，没有真实 DeepSeek Pi 登录联网验证。
- 没有提交、推送或版本号变更。
