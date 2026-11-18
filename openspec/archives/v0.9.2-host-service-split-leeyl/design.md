# Design

## Context

- `src/host/index.ts`：3768 行。第 280 行起是 `CliWorkerService extends TypertRemoteService`，`@Remote` 方法从约第 1647 行开始（立项时估为 74 个，任务 1 核定为 80 个，见决定 5）；之前约 1370 行是构造、生命周期与内部辅助方法。
- `vitest.config.ts` 只对 `/src/host/index.ts` 做装饰器转换；`scripts/build.mjs` 的暂存清单以 `./src/host/index.ts` 为 Host 入口，Typert 生成器据此生成 `lib/typert.remote-client.d.ts`。
- 立项时按名称将 Remote 方法大致分为：Harness 会话与 DSH 子 Agent（6）、历史、运行中消息设置与角色预设（6）、Worker 管理（改名、目标、删除、恢复、分叉，9）、通用设置与 CLI 启用（3）、CLI 管理与更新（11）、连接与账号（约 20）、模型目录、选型与权限（约 9）、消息发送与续聊队列（约 12）。精确归属在任务 1 中按 this 字段依赖核定。

## Goals / Non-Goals

**Goals：** index.ts 少于 1000 行；拆出的每个模块不超过 1000 行；远程契约逐字节不变；全量测试与 Desktop 行为不变。

**Non-Goals：** WorkerRuntime 拆分、目录化、改名、功能调整、修复存量 lint 警告（新代码不得新增）。

## Decisions

### 决定 1：Remote 门面留在 index.ts

装饰器转换和 Typert 生成都只认 `src/host/index.ts`。把 `@Remote` 方法留在原类中、方法体改为委托，契约与构建配置都不用改。备选方案（把 Remote 分散到多个类或改装饰器转换范围）需要改构建与契约生成，风险高，不采用。

### 决定 2：领域模块用普通类或函数，经上下文对象共享状态

领域模块不使用装饰器，构造时接收一个只读的上下文对象（运行时、存储、订阅、配置、日志等现有字段的引用）。不引入依赖注入框架和全局单例，避免改变初始化顺序与生命周期清理。

### 决定 3：逐领域拆分、每步可回退

每个领域单独一次本地提交，提交前类型检查与全量测试通过。出现行为差异时只回退该领域的提交。

### 决定 4：以产物对比证明契约不变

拆分前后各跑一次 `pnpm build:preview`，对比 `lib/typert.remote-client.d.ts` 与 `lib/` 文件清单；新增文件只能是新领域模块的编译产物。

### 决定 5：领域划分与上下文对象

基准提交 `086b865` 的 TypeScript 语法树有 **80 个**带 Remote 装饰器的方法（其中 6 个流方法），另有 48 个内部方法和 1 个构造函数。74 是直接调用的数量。保留所有 80 个门面的源码签名、JSDoc、装饰器及调用方式。

每个 Cordis 服务实例在 `super` 返回后创建一个 `ServiceContext`。Remote 实现显式接收它，内部辅助函数以类型为 `ServiceContext` 的 `this` 接收它。Cordis 为调用方赋予作用域时，门面用 SDK 的 `withProps` 将调用方的 `ctx` 和门面接收者投影到同一份状态。原生会话桥保存的回调仍使用构造时的作用域。注册与释放均由原有 Cordis scope 管理。

| 状态归属             | 上下文持有的成员                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Host 生命周期与运行  | `ctx`、`remote`（内部回调使用的 8 个门面方法）、`runtime`、`options`、`backend`、`disposed`                                                |
| 账号、安装与连接     | `accounts`、`accountParents`、`customProviders`、`cliManagement`、`connections`、`connectionEpochs`                                        |
| 设置、目录与选型     | `settingsCatalogs`、`settingsInstance`、`settingsSourceRevisions`、`displayedBindings`、`selectionBindings`、`selectionProjects`           |
| 会话、原生工具及审批 | `dshSubagents`、`harnessConversation`、`harnessConversationStore`、`bridgeCalls`、`repairingDisplays`、`runOrigins`、`runQuestionSessions` |
| 派遣与消息           | `pending`、`dispatchWaits`、`messageSubmissions`、`nativeRunDone`                                                                          |

`service-context.ts` 保存这些字段。`service-lifecycle.ts` 的 `initialize` 按原顺序装配运行时、注册与释放订阅。其中会话桥注册由 `service-harness.ts` 的 `registerConversationBridge` 在原位置执行。`service-errors.ts` 的 `failure` 生成原有 Remote 错误，`waitForInput` 处理可取消的询问等待。

八个提交领域中，账号域分开管理连接缓存和账号会话。模型域分开目录与权限。消息域把主 Agent 工具注册、选型等待和运行发布分别成文件。这些辅助方法各有独立的调用者及生命周期。

下表列出每个方法直接使用的实例字段与调用。写入列记载赋值、成员赋值和可静态识别的集合写操作。经运行时或存储 API 产生的副作用仍由相应对象管理。构造函数一行包括它注册的回调。

#### 2.1 · service-harness（Harness 会话、父会话与 DSH 子 Agent）

| 方法                               | 直接访问字段                                                      | 写入或集合修改      | 调用本服务方法      |
| ---------------------------------- | ----------------------------------------------------------------- | ------------------- | ------------------- |
| `parent`                           | `ctx`、`cliManagement`                                            | —                   | `project`           |
| `project`                          | —                                                                 | —                   | —                   |
| `machineDirectory`                 | `options`                                                         | —                   | —                   |
| `preferenceProject`                | —                                                                 | —                   | `project`           |
| `dshFallback`                      | `runtime`、`dshSubagents`                                         | —                   | —                   |
| `waitHarnessRun`                   | `nativeRunDone`、`runtime`                                        | —                   | —                   |
| Remote `ensureHarnessConversation` | `runtime`、`harnessConversation`                                  | —                   | `parent`、`project` |
| Remote `repairHarnessConversation` | `runtime`、`harnessConversation`、`disposed`、`repairingDisplays` | `repairingDisplays` | `parent`、`project` |
| Remote `listDshSubagents`          | `dshSubagents`                                                    | —                   | —                   |
| Remote `watchDshSubagents`         | `dshSubagents`                                                    | —                   | —                   |
| Remote `promptDshSubagent`         | `dshSubagents`                                                    | —                   | —                   |
| Remote `stopDshSubagent`           | `dshSubagents`                                                    | —                   | —                   |
| Remote `hideDshSubagent`           | `dshSubagents`                                                    | —                   | —                   |

#### 2.2 · service-history（Worker 快照、历史、运行中消息设置与角色预设）

| 方法                            | 直接访问字段                                                        | 写入或集合修改 | 调用本服务方法      |
| ------------------------------- | ------------------------------------------------------------------- | -------------- | ------------------- |
| Remote `watch`                  | `runtime`、`ctx`、`disposed`、`harnessConversationStore`、`pending` | —              | —                   |
| Remote `history`                | `runtime`                                                           | —              | —                   |
| Remote `runningMessageSettings` | `runtime`                                                           | —              | `parent`、`project` |
| Remote `saveRunningMessageMode` | `runtime`                                                           | —              | `parent`、`project` |
| Remote `rolePresets`            | `runtime`                                                           | —              | `parent`            |
| Remote `saveRolePreset`         | `runtime`                                                           | —              | `parent`            |
| Remote `deleteRolePreset`       | `runtime`                                                           | —              | `parent`            |

#### 2.3 · service-workers（Worker 身份、目标、生命周期及隔离副本合并）

| 方法                         | 直接访问字段                     | 写入或集合修改 | 调用本服务方法               |
| ---------------------------- | -------------------------------- | -------------- | ---------------------------- |
| Remote `renameWorker`        | `runtime`                        | —              | `parent`                     |
| Remote `renameWorkerTitle`   | `runtime`                        | —              | `parent`                     |
| Remote `setWorkerGoal`       | `runtime`                        | —              | `parent`                     |
| Remote `setWorkerGoalStatus` | `runtime`                        | —              | `parent`                     |
| Remote `clearWorkerGoal`     | `runtime`                        | —              | `parent`                     |
| Remote `deleteWorker`        | `runtime`                        | —              | `parent`                     |
| Remote `restoreWorker`       | `runtime`                        | —              | `parent`                     |
| Remote `forkWorker`          | `harnessConversation`、`runtime` | —              | `parent`                     |
| `mergeIsolatedWorker`        | `runtime`、`disposed`            | —              | `assertExecution`、`project` |

#### 2.4 · service-settings（设置快照、显示元数据、CLI 开关与通用策略）

| 方法                         | 直接访问字段                                                                            | 写入或集合修改            | 调用本服务方法                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------- |
| Remote `cliSettings`         | `runtime`、`settingsCatalogs`、`displayedBindings`                                      | `displayedBindings`       | `parent`、`connectionCache`、`machineDirectory`、`settingsDisplayMetadata`、`preferenceProject` |
| `settingsDisplayMetadata`    | `settingsInstance`、`settingsSourceRevisions`、`options`、`settingsCatalogs`、`runtime` | `settingsInstance`        | `connectionCache`、`machineDirectory`                                                           |
| `invalidateSettingsDisplay`  | `connections`、`settingsCatalogs`、`settingsSourceRevisions`、`cliManagement`           | `settingsSourceRevisions` | —                                                                                               |
| Remote `generalSettings`     | `runtime`                                                                               | —                         | `parent`                                                                                        |
| Remote `saveGeneralSettings` | `runtime`                                                                               | —                         | `parent`                                                                                        |
| Remote `setCliEnabled`       | `accounts`、`runtime`                                                                   | —                         | `parent`、`invalidateSettingsDisplay`                                                           |

#### 2.5 · service-cli-updates（CLI 更新、安装、接管与下载源）

| 方法                            | 直接访问字段    | 写入或集合修改 | 调用本服务方法              |
| ------------------------------- | --------------- | -------------- | --------------------------- |
| Remote `cliUpdateSnapshot`      | `cliManagement` | —              | `parent`                    |
| Remote `checkCliUpdates`        | `cliManagement` | —              | `parent`                    |
| Remote `watchCliUpdates`        | `cliManagement` | —              | `parent`                    |
| Remote `startCliOperation`      | `cliManagement` | —              | `parent`、`assertExecution` |
| Remote `updateAllClis`          | `cliManagement` | —              | `parent`、`assertExecution` |
| Remote `cancelCliOperation`     | `cliManagement` | —              | `parent`                    |
| Remote `requestCliTakeover`     | `cliManagement` | —              | `parent`、`assertExecution` |
| Remote `chooseInstallDirectory` | `cliManagement` | —              | `parent`                    |
| Remote `checkInstallDirectory`  | `cliManagement` | —              | `parent`                    |
| Remote `cliDownloadSource`      | `cliManagement` | —              | `parent`                    |
| Remote `saveCliDownloadSource`  | `cliManagement` | —              | `parent`                    |
| Remote `testCliDownloadSource`  | `cliManagement` | —              | `parent`                    |

#### 2.6 · service-accounts（账号会话、账号终端及自定义提供商）

| 方法                                | 直接访问字段                                                | 写入或集合修改    | 调用本服务方法                                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Remote `accountStatus`              | —                                                           | —                 | `readAccountStatus`                                                                                                             |
| Remote `refreshAccountStatus`       | —                                                           | —                 | `readAccountStatus`                                                                                                             |
| `readAccountStatus`                 | `options`、`runtime`                                        | —                 | `parent`、`cleanupHeldStatus`、`connectionCache`、`loadSettingsAccount`                                                         |
| `cleanupHeldStatus`                 | `runtime`                                                   | —                 | —                                                                                                                               |
| Remote `recoverCliCleanup`          | `accounts`、`runtime`、`cliManagement`                      | —                 | `parent`、`invalidateSettingsDisplay`                                                                                           |
| Remote `accountDesktopStart`        | `disposed`、`runtime`、`accountParents`、`accounts`         | `accountParents`  | `parent`、`assertExecution`、`machineDirectory`                                                                                 |
| Remote `accountDesktopRespond`      | `accounts`                                                  | —                 | `parent`                                                                                                                        |
| Remote `accountDesktopWatch`        | `accounts`                                                  | —                 | `parent`                                                                                                                        |
| Remote `accountDesktopStop`         | `accounts`                                                  | —                 | —                                                                                                                               |
| Remote `accountStart`               | —                                                           | —                 | `startAccount`                                                                                                                  |
| Remote `accountStartForSource`      | —                                                           | —                 | `startAccount`                                                                                                                  |
| Remote `accountStartForProvider`    | —                                                           | —                 | `startAccount`                                                                                                                  |
| Remote `accountStartWith`           | —                                                           | —                 | `startAccount`                                                                                                                  |
| `trackAccountParent`                | `accountParents`、`customProviders`、`accounts`             | `accountParents`  | —                                                                                                                               |
| `customProviderSource`              | `options`                                                   | —                 | —                                                                                                                               |
| `customProviderManager`             | `customProviders`、`options`                                | `customProviders` | —                                                                                                                               |
| Remote `customProviderForm`         | `disposed`、`options`、`runtime`                            | —                 | `parent`、`trackAccountParent`、`customProviderManager`、`customProviderSource`                                                 |
| Remote `saveCustomProvider`         | `disposed`、`options`、`runtime`、`accounts`                | —                 | `parent`、`assertExecution`、`trackAccountParent`、`customProviderSource`、`customProviderManager`、`invalidateSettingsDisplay` |
| Remote `deleteAccountConfiguration` | `disposed`、`options`、`runtime`、`accounts`、`connections` | —                 | `parent`、`assertExecution`、`trackAccountParent`、`invalidateSettingsDisplay`                                                  |
| `startAccount`                      | `runtime`、`accounts`、`connections`                        | —                 | `parent`、`assertExecution`、`trackAccountParent`、`invalidateSettingsDisplay`、`machineDirectory`                              |
| Remote `accountWatch`               | `accounts`                                                  | —                 | `parent`                                                                                                                        |
| Remote `accountWrite`               | `accounts`                                                  | —                 | `assertExecution`、`parent`                                                                                                     |
| Remote `accountRespond`             | `accounts`                                                  | —                 | `assertExecution`、`parent`                                                                                                     |
| Remote `accountResize`              | `accounts`                                                  | —                 | `parent`                                                                                                                        |
| Remote `accountStop`                | `accounts`                                                  | —                 | —                                                                                                                               |

#### 2.6 · service-connections（连接缓存、后台加载与可执行路径）

| 方法                              | 直接访问字段                                                                | 写入或集合修改                    | 调用本服务方法                                                                           |
| --------------------------------- | --------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------- |
| `connectionCache`                 | `connections`、`connectionEpochs`、`options`、`cliManagement`、`runtime`    | `connections`、`connectionEpochs` | —                                                                                        |
| Remote `settingsConnectionStatus` | `runtime`、`disposed`                                                       | —                                 | `parent`、`cleanupHeldStatus`、`connectionCache`、`readAccountStatus`、`settingsCatalog` |
| Remote `watchSettingsConnections` | `disposed`                                                                  | —                                 | `parent`、`connectionCache`                                                              |
| `preloadSettingsConnection`       | —                                                                           | —                                 | `preloadSettingsConnectionNow`                                                           |
| `preloadSettingsConnectionNow`    | `options`、`runtime`                                                        | —                                 | `loadSettingsAccount`、`loadSettingsCatalog`                                             |
| `loadSettingsAccount`             | `disposed`、`accounts`                                                      | —                                 | `connectionCache`、`machineDirectory`                                                    |
| `loadSettingsCatalog`             | `accounts`、`disposed`、`options`、`settingsCatalogs`、`runtime`、`backend` | `settingsCatalogs`                | `machineDirectory`、`connectionCache`、`readAccountBinding`、`queryCatalog`              |
| `executablePathSnapshot`          | `options`                                                                   | —                                 | —                                                                                        |
| `probeExecutablePath`             | `backend`、`options`、`runtime`                                             | —                                 | `executablePathSnapshot`                                                                 |
| Remote `cliExecutablePath`        | `disposed`、`options`、`runtime`、`accounts`                                | —                                 | `parent`、`executablePathSnapshot`、`probeExecutablePath`                                |
| Remote `refreshCliExecutablePath` | `disposed`、`options`、`runtime`、`accounts`、`displayedBindings`           | `displayedBindings`               | `parent`、`invalidateSettingsDisplay`、`probeExecutablePath`                             |

#### 2.7 · service-models（模型目录、授权与选型）

| 方法                          | 直接访问字段                                                    | 写入或集合修改      | 调用本服务方法                                                          |
| ----------------------------- | --------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------- |
| `readAccountBinding`          | `options`、`runtime`                                            | —                   | —                                                                       |
| `queryCatalog`                | `options`、`runtime`                                            | —                   | `freshCatalog`、`busyAccountCatalog`                                    |
| `freshCatalog`                | `settingsCatalogs`                                              | —                   | —                                                                       |
| `busyAccountCatalog`          | `settingsCatalogs`                                              | —                   | `readAccountBinding`、`freshCatalog`                                    |
| `authorizeChoice`             | `options`                                                       | —                   | `querySelection`                                                        |
| `querySelection`              | `runtime`                                                       | —                   | `busyAccountCatalog`                                                    |
| Remote `catalog`              | —                                                               | —                   | `catalogForCli`                                                         |
| Remote `catalogForCli`        | —                                                               | —                   | `settingsCatalog`                                                       |
| Remote `catalogForWorker`     | `disposed`、`runtime`、`options`、`settingsCatalogs`、`backend` | `settingsCatalogs`  | `parent`、`readAccountBinding`、`queryCatalog`                          |
| Remote `refreshCatalogForCli` | —                                                               | —                   | `settingsCatalog`                                                       |
| `settingsCatalog`             | `disposed`、`options`、`runtime`、`displayedBindings`           | `displayedBindings` | `parent`、`loadSettingsCatalog`、`connectionCache`、`preferenceProject` |
| Remote `configure`            | `runtime`、`backend`、`options`、`displayedBindings`            | —                   | `parent`、`project`、`authorizeChoice`                                  |
| Remote `configureWorker`      | `runtime`、`settingsCatalogs`、`backend`、`options`             | `settingsCatalogs`  | `parent`、`readAccountBinding`、`assertNativeWorkerSettingsIdle`        |

#### 2.7 · service-permissions（权限档位、原生审批及冷会话配置）

| 方法                               | 直接访问字段                                                                     | 写入或集合修改 | 调用本服务方法                                                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `assertExecution`                  | —                                                                                | —              | `hostPlanActive`                                                                                                             |
| `assertAccessSupported`            | —                                                                                | —              | `permissionState`                                                                                                            |
| `childPermission`                  | —                                                                                | —              | `permissionState`                                                                                                            |
| `permissionReceipt`                | —                                                                                | —              | `permissionState`                                                                                                            |
| `hostPlanActive`                   | `ctx`                                                                            | —              | —                                                                                                                            |
| `permissionState`                  | —                                                                                | —              | `hostPlanActive`                                                                                                             |
| `decideNativeApproval`             | `ctx`、`disposed`、`runQuestionSessions`、`runOrigins`                           | —              | `permissionState`                                                                                                            |
| `answerHarnessApproval`            | `bridgeCalls`、`runtime`、`disposed`、`runQuestionSessions`、`runOrigins`、`ctx` | —              | `decideNativeApproval`、`permissionState`                                                                                    |
| `assertNativeWorkerSettingsIdle`   | `ctx`                                                                            | —              | —                                                                                                                            |
| `configureColdWorkerPermission`    | `runtime`、`disposed`、`ctx`、`harnessConversation`                              | —              | `assertExecution`、`project`、`assertNativeWorkerSettingsIdle`、`childPermission`                                            |
| Remote `permissionForWorker`       | `runtime`                                                                        | —              | `parent`、`project`、`assertExecution`、`assertNativeWorkerSettingsIdle`、`permissionState`                                  |
| Remote `configureWorkerPermission` | `runtime`、`ctx`                                                                 | —              | `parent`、`assertExecution`、`project`、`assertNativeWorkerSettingsIdle`、`configureColdWorkerPermission`、`childPermission` |

#### 2.8 · service-messages（消息提交、引导、队列及续聊）

| 方法                             | 直接访问字段                                            | 写入或集合修改       | 调用本服务方法                                   |
| -------------------------------- | ------------------------------------------------------- | -------------------- | ------------------------------------------------ |
| Remote `submitMessage`           | `messageSubmissions`、`runtime`、`disposed`、`accounts` | `messageSubmissions` | `parent`、`assertExecution`、`project`、`launch` |
| Remote `queueFollowup`           | `runtime`                                               | —                    | `parent`、`assertExecution`、`project`           |
| Remote `steerMessage`            | `runtime`、`disposed`、`accounts`                       | —                    | `parent`、`assertExecution`、`project`           |
| Remote `sendRunningMessage`      | `runtime`、`accounts`                                   | —                    | `parent`、`assertExecution`、`project`           |
| Remote `interruptMessage`        | `runtime`、`accounts`                                   | —                    | `parent`、`assertExecution`、`project`           |
| Remote `interruptQueuedFollowup` | `runtime`、`accounts`                                   | —                    | `parent`、`assertExecution`、`project`           |
| Remote `cancelQueuedFollowup`    | `runtime`                                               | —                    | `parent`                                         |
| Remote `retryQueuedFollowups`    | `runtime`                                               | —                    | `parent`、`assertExecution`、`project`           |
| Remote `followup`                | —                                                       | —                    | `continueWorker`                                 |
| `continueWorker`                 | `runtime`                                               | —                    | `parent`、`assertExecution`、`launch`            |
| Remote `restartWorker`           | `runtime`                                               | —                    | `parent`、`assertExecution`、`project`、`launch` |
| Remote `stop`                    | `runtime`                                               | —                    | —                                                |

#### 2.8 · service-dispatch（派遣候选解析、变体询问及选型互斥）

| 方法                     | 直接访问字段                                                                                                                          | 写入或集合修改                                                                           | 调用本服务方法                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `dispatchSubject`        | `ctx`                                                                                                                                 | —                                                                                        | —                                                               |
| `siblingDispatch`        | `runtime`、`runQuestionSessions`、`runOrigins`、`ctx`                                                                                 | —                                                                                        | —                                                               |
| `resolveDispatchName`    | `options`、`backend`、`runtime`                                                                                                       | —                                                                                        | —                                                               |
| `chooseQoderVariant`     | `disposed`、`dispatchWaits`、`pending`、`runtime`                                                                                     | `dispatchWaits`、`pending`                                                               | `project`、`assertExecution`、`resolveDispatchName`             |
| `chooseWorkBuddyVariant` | `disposed`、`dispatchWaits`、`pending`、`runtime`                                                                                     | `dispatchWaits`、`pending`                                                               | `project`、`assertExecution`、`resolveDispatchName`             |
| `chooseDispatch`         | `disposed`、`runtime`、`dispatchWaits`、`pending`、`settingsCatalogs`、`backend`、`options`、`selectionBindings`、`selectionProjects` | `dispatchWaits`、`settingsCatalogs`、`selectionBindings`、`selectionProjects`、`pending` | `project`、`assertExecution`、`queryCatalog`、`authorizeChoice` |

#### 2.8 · service-launch（运行准入、发布及重启归属）

| 方法     | 直接访问字段                                                                                                                                            | 写入或集合修改                                       | 调用本服务方法                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `launch` | `disposed`、`runtime`、`accounts`、`selectionProjects`、`selectionBindings`、`backend`、`options`、`runOrigins`、`runQuestionSessions`、`nativeRunDone` | `runOrigins`、`runQuestionSessions`、`nativeRunDone` | `launch`、`assertExecution`、`assertAccessSupported`、`project`、`authorizeChoice`、`permissionReceipt` |

#### 2.8 · service-tools（主 Agent 工具注册）

| 方法            | 直接访问字段                                 | 写入或集合修改 | 调用本服务方法                                                                                                                                                                                                     |
| --------------- | -------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `registerTools` | `ctx`、`disposed`、`runtime`、`dshSubagents` | —              | `resolveDispatchName`、`dispatchSubject`、`assertExecution`、`siblingDispatch`、`chooseWorkBuddyVariant`、`chooseQoderVariant`、`chooseDispatch`、`launch`、`dshFallback`、`continueWorker`、`mergeIsolatedWorker` |

#### Host 初始化与清理（Host 生命周期与 Cordis 注册）

| 方法          | 直接访问字段                                                                                                                                                                                                                               | 写入或集合修改                                                                                                                                                                               | 调用本服务方法                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `constructor` | `options`、`backend`、`accounts`、`runtime`、`cliManagement`、`dshSubagents`、`ctx`、`harnessConversationStore`、`repairingDisplays`、`harnessConversation`、`bridgeCalls`、`disposed`、`customProviders`、`connections`、`accountParents` | `options`、`backend`、`accounts`、`runtime`、`cliManagement`、`dshSubagents`、`harnessConversationStore`、`harnessConversation`、`bridgeCalls`、`disposed`、`customProviders`、`connections` | `invalidateSettingsDisplay`、`machineDirectory`、`preloadSettingsConnection`、`connectionCache`、`steerMessage`、`forkWorker`、`setWorkerGoal`、`setWorkerGoalStatus`、`clearWorkerGoal`、`configureWorkerPermission`、`permissionForWorker`、`parent`、`waitHarnessRun`、`launch`、`childPermission`、`permissionState`、`assertExecution`、`project`、`assertAccessSupported`、`decideNativeApproval`、`answerHarnessApproval`、`registerTools` |

Typert 声明逐字节比对。JS 中的 sourceLocation 和声明映射回指方法名的位置，入口缩短后坐标随之改变。比对这三项时验证原始哈希、逐方法核对源码位置，并复核坐标以外的内容。

## Risks / Trade-offs

- 隐式共享 `this` 状态遗漏 → 任务 1 先列出每个方法用到的字段；全量测试与 Desktop 实测兜底。
- 与其他改动冲突 → 拆分期间不并行修改 index.ts；进行中的 `vnext-plan-exit-agy-background-leeyl` 代码已完成，只剩一项待用户处理的验证。
- 0.9.2 为热修复版本 → 只做内部结构调整，用户行为不变。
