# Design: CLI Worker 界面中英双语

## 模块边界

| 位置 | 职责 |
| --- | --- |
| `src/shared/cli-settings.ts` | `LanguagePreference`、`LANGUAGE_PREFERENCES`、`GeneralSettings.language` |
| `src/host/storage.ts` | `general-settings.json` 的 `language` 字段校验、`null` 恢复默认 |
| `src/host/runtime.ts` | `generalSettings()` 返回有效偏好（缺省 `follow`）；`snapshot()` 附带 `language` |
| `src/client/i18n-messages.ts` | 词典：中文原文为键，值为英文；`as const satisfies` 保证类型化键 |
| `src/client/i18n.ts` | 模块级语言状态、`t()`、`useT()`、`installClientLocale(ctx)`、`setLanguagePreference()`、`formatLocale()` |
| `src/client/operation-error.ts` | Host 常见错误映射（精确匹配与少量模板） |

Host 仍只负责持久化，Client 通过原生 Gateway 读取；Remote 签名不变。

## 词典键：中文原文

键使用现有中文原文（gettext 风格），中文词典是恒等映射，英文词典 `Record<MessageKey, string>`：

- 代码保留可读、可搜索的中文；现有大量断言中文文案的测试在默认语言下不变。
- 缺词时 Harness 与插件查找都显示键本身，即中文原文，不会出现空白或内部键名。
- 带变量的文案用 `{name}` 占位（与 Harness 插值规则一致），如 `t('{count}（默认）', { count })`。
- 同一中文在不同语境需要不同英文时，使用 `语境|原文` 形式的键并在中文词典给出原文；目前未出现。

`i18n-messages.ts` 中 `en` 对象以 `satisfies Record<string, string>` 声明，`MessageKey = keyof typeof en`；`t()` 只接受 `MessageKey`，新增调用若未补英文会在 build-preview 类型检查失败。通过 `declare module '@deepseek-ai/dsh-client-ui-slots'` 把 `cliworker: MessageKey` 并入 `LocaleNamespaceMap`，使 `ctx.locale.register('cliworker', { zh, en })` 也由编译器检查双语完整。测试另行核对每个键英文非空、占位一致。

## 语言状态与实时更新

许多文案由普通函数生成（状态标签、错误、时间格式），不在组件 props 中传递 `t`。采用模块级外部 store：

- 状态：`harness`（Harness 当前语言或 `undefined`）、`preference`（插件偏好，初始 `follow`）、`harnessTranslate`（`bind('cliworker')` 的结果）、`revision`。
- `language()`：`zh`/`en` 偏好直接使用；`follow` 时 Harness 为 `zh*` 则中文，存在其他 Harness 语言则英文；无 Harness locale（测试或旧宿主）时中文。
- `t(key, params)`：`follow` 且有 Harness 翻译函数时调用它（外部语言包可覆盖 `cliworker` 命名空间）；否则查插件词典并按 `{name}` 插值。
- `useT()`：`useSyncExternalStore(subscribe, () => revision)`，返回 `t`；渲染文案的组件调用它订阅变化。普通函数在渲染期间被调用时随调用方组件重渲染。
- `installClientLocale(ctx)`：在 `ctx.inject(['locale'], …)` 的可选作用域内 `scope.effect` 注册词典、`scope.effect` 订阅 `locale.subscribe`；作用域释放时注销并把 Harness 状态清空。

偏好来源：设置页读取/保存成功、以及 `watch` 流中每个快照的 `language`。保存后 Host `changed()` 推送新快照，其他窗口同步。打开任一会话前没有快照时按 `follow` 显示。

## 设置页

「语言」分区位于「任务调度」之前，单行：标签「界面语言」+ 说明「跟随 DSH 时与 DeepSeek Harness 当前语言一致」+ `NativeChoice`（跟随 DSH / 中文 / English）。保存反馈复用 `cwn-settings-save`，与任务调度分区各自独立；遵循 `doc/settings-ui-design.md` 的文字层级与间距，不新增样式参数。选项名「中文」「English」以各自语言书写，不随界面语言变化。

## Host 错误

Host 错误由 `failure()` 以 `cliworker/unavailable` 包装为字符串；Client `operationMessage()` 已集中清洗。英文界面在清洗后对照映射表：精确匹配常见错误（项目已变更、账号终端未关闭、插件正在关闭、待发送消息状态冲突、权限与模型修改时机等），加少量正则模板（如 `<CLI> 已关闭…`）。未命中原样返回。不引入错误码，避免改变 Remote 协议与旧 Host 兼容性；风险是 Host 改写文案后映射失效、回到中文原文，属于可见但无害的退化，由映射表测试覆盖现有文案。

## 兼容与回退

- 旧 `general-settings.json` 无 `language`：`follow`。降级到旧版插件时，未知字段被旧 schema 拒绝会导致读取失败——旧 schema 是 `z.object`（非 strict），未知键被剥离，不影响。
- 回退：把偏好设为「中文」即恢复原界面；代码回退只需移除 `language` 字段与词典调用。

## 风险

- 文案遗漏：以脚本扫描 `src/client` 非注释中文字面量核对，剩余项列入 `doc/tasks.md`。
- Harness 外部语言包缺词时回退英文，而非中文；符合 Harness 回退链约定。
