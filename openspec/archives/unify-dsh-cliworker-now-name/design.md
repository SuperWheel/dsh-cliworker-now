# Design

## Context

参见 proposal.md。npm 名称已为 dsh-cliworker-now；GitHub 旧仓库已由当前 ADMIN 账号改名，repo ID 保留。用户随后明确：DSH 中安装的插件界面显示名称全部不改。当前 0.7.8 包已提交发布，公开传播仍待验证。dshfind 使用 full_name 主键和精确 npm 回链。

## Goals / Non-Goals

只统一 GitHub、npm 名称、Release、外部目录及分发文档；DSH 内现有 CLI Worker / CLI Worker Now 名称、标题、按钮、Host 文案、内部服务/工具/目录全部保持。准备中的界面改名已撤回，未覆盖正式 Desktop。

## Decisions

1. GitHub 原仓库直接改名，同一 repo ID、stars、issues、Release 历史保留；本地 origin 更新，旧新下载链接核对相同包哈希。
2. 仅修改未来打包元数据、当前 README、Release 标题/模板和目录条目，版本仍为 0.7.8，不覆盖已发布包，不需要为界面改名另发版本。
3. dshfind 提交限定本条的改名映射及历史 npm 回链兼容补丁；下载量由官方探测读取，不写死数字。目录实际迁移需要维护方权限，PR 不等于公开页面已更新。

## Risks / Trade-offs

- [旧包保留旧 repository URL] → GitHub 重定向已核验；dshfind 通过经审核的单条别名兼容，不假称已自动关联。
- [误改安装界面] → 源码和对应测试逐字节恢复到本次改名前 HEAD；正式包 SHA 不变。
- [目录主键分裂] → 使用官方迁移工具搬历史及下载组，保留权限待办。

## Migration Plan

仓库改名与下载验证；同步分发文档；确认运行时代码不变；更新外部市场和 dshfind PR；记录 npm 公开传播及维护者待办。正式 Desktop 不构建覆盖。旧仓库名不重建，避免破坏重定向。
