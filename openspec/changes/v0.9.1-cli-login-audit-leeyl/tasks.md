# Tasks

## 1. 排查方法与更新后重读 〔后端｜3h〕
- [x] 1.1 去掉更新与版本指纹变化时对账号和模型缓存的作废（用户 2026-11-17 决定）
  - 证据：`src/host/cli-management/service.ts` 删除版本指纹变化时的 `invalidateModels` 调用；更新收尾改为仅 `intent === 'install'` 时调用
  - 证据：规格增量改为修改「连接快照、过期更新与来源作废」，见 `specs/cli-update/spec.md`
- [x] 1.2 模拟测试：更新成功、失败、取消及之后版本指纹变化都不作废；安装完成作废一次
  - 证据：`tests/cli-management-admission.test.ts` 改写 3 项；`tests/cli-management-phase-b.test.ts`、`tests/cli-management-local-artifacts-windows.test.ts` 的更新断言改为不调用；`tests/cli-management-install.test.ts` 新增安装后调用一次的断言
  - 证据：`corepack pnpm exec vitest run` 上述 4 个文件 159 项通过；临时恢复旧的指纹作废代码时 admission 3 项失败，恢复后通过
- [ ] 1.3 记录 17 个 CLI 排查时的版本号（Mac 与 Windows 各一份）

## 2. 官方账号类：Codex、Claude Code、Kimi、MiMo 〔后端｜6h｜前置 1〕
- [ ] 2.1 Codex：ChatGPT 账号与 API Key 两种登录，核对 auth.json 与系统凭据库
- [ ] 2.2 Claude Code：官方账号与 API／代理路由，核对 auth status 字段与钥匙串条目名
- [ ] 2.3 Kimi：核对 provider list 输出；探测设 KIMI_CODE_NO_AUTO_UPDATE=1
- [ ] 2.4 MiMo：核对配置路径与未登录提示文字

## 3. 订阅与续期类：ZCode、Grok Build、Hermes Agent 〔后端｜6h｜前置 1〕
- [ ] 3.1 ZCode：订阅账号与自有 API Key，核对 credentials.json 版本与键名
- [ ] 3.2 Grok Build：核对 auth.json 与续期接口；访问令牌过期后派遣前能续期
- [ ] 3.3 Hermes Agent：核对共享状态与 Nous 续期；续期失败时提示重新登录

## 4. 多服务商类：OMP、Pi、OpenCode 〔后端｜5h｜前置 1〕
- [ ] 4.1 OMP：核对账号存储与原生登录方式列表，逐条退出凭据
- [ ] 4.2 Pi：同 OMP，并核对安装完整性提示
- [ ] 4.3 OpenCode：核对授权档案结构；替换同一服务商 Key 后状态立即正确

## 5. 原生会话类：Qoder、Qoder CN、CodeBuddy Code、TRAE CN 〔后端｜6h｜前置 1〕
- [ ] 5.1 Qoder：核对 SDK daemon 协议与启动参数
- [ ] 5.2 Qoder CN：同 Qoder，国内与国际账号不混用
- [ ] 5.3 CodeBuddy Code：核对 auth.json 结构与站点字段，国内站与国际站
- [ ] 5.4 TRAE CN：核对授权文件路径、字段与官方 CLI 身份校验

## 6. 桌面端类：WorkBuddy CN、WorkBuddy 〔后端｜3h｜前置 1〕
- [ ] 6.1 WorkBuddy CN：桌面端更新后核对 bootstrap 元数据位置与格式
- [ ] 6.2 WorkBuddy：同 WorkBuddy CN，两版账号不混用

## 7. 发布前验收 〔测试｜4h｜前置 2,3,4,5,6〕
- [ ] 7.1 有改动的 CLI 补模拟测试，`corepack pnpm typecheck` 与相关测试通过
- [ ] 7.2 Windows 隔离测试 `node scripts/windows-remote.mjs` 通过
- [ ] 7.3 有改动的 CLI 在 Mac 与 Windows 上真实验收：设置页、账号窗口、模型目录、派遣、续聊、退出
- [ ] 7.4 发布后在 GitHub issue #13 回复版本号，请报告者确认

## 跟进

- 每个 CLI 的结论统一写在对应子任务的证据里：版本、登录来源、Mac 与 Windows 结果；无账号或订阅的写「未执行：原因」。
