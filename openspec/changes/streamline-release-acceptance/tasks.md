# Tasks

## 1. 收敛发布验收

- [x] 1.1 Windows CI 定向文件由 7 个扩到 17 个（新增本轮 Windows 账号、进程、CLI 解析、Codex 启动、系统代理、OpenCode/ZCode/Grok、agy 目录、ACP 与账号引导测试），同步远程脚本、工作流与 `doc/windows-remote-testing.md`。
  - `pnpm exec vitest run tests/windows-remote.test.ts`：28 通过。
- [ ] 1.2 更新 development-workflow 规格、发布模板、`doc/openspec.md` 与 `AGENTS.md` 中的验收与版本描述。
- [ ] 1.3 按新范围完成 v0.8.5 发布验收并记录结果。
