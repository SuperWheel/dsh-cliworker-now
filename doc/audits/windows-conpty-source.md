# Windows ConPTY 来源核验

`windows-account-owner.ps1` 保留系统 `conhost.exe` 的精确路径检查；官方宿主使用包内 OpenConsole 时，还检查当前控制台 HWND、Host 父进程、创建时间、Job 归属及范围退出。

当前新增可信 helper 来自冻结锁文件中的官方 `node-pty@1.2.0-beta.15`，不是 CLI 版本白名单。公开 npm 资产为 [node-pty-1.2.0-beta.15.tgz](https://registry.npmjs.org/node-pty/-/node-pty-1.2.0-beta.15.tgz)，锁文件完整性为 `sha512-vORSzHXi4Ofl7HemVWpuudLqCPdaQb4LfpRCUpE5HPxhp4JYscl8zZwxh11p26v2wvW24WMwnMfLjhRLixrfxA==`。2026-10-18 从该固定依赖包的 `third_party/conpty/1.25.260303002/` 实读以下 SHA-256；Windows frozen install 依照相同锁文件安装原生依赖。

| 架构 | 文件 | SHA-256 |
| --- | --- | --- |
| win10-x64 | OpenConsole.exe | `7f68c840226505004215c0b82d4e502c24b5bc3f4b93c4baaaa19bd679c0def8` |
| win10-x64 | conpty.dll | `3319b484b80bb53d1f4d0a9eb0ea60fd0f61da69db7280ca43b84215f19245ff` |
| win10-arm64 | OpenConsole.exe | `7fa560be0c9b6c81db5d1b855a4a6e0f3ee5a2ea75d36eebb3ae44443b8d4866` |
| win10-arm64 | conpty.dll | `b3a9f975c51d5b9b96d290bf784e990e3f85203b063c21614457353f566266ff` |

接受的实际路径须为该 `node-pty` 包的 `build/Release/conpty/OpenConsole.exe`，或其官方预编译布局 `prebuilds/win32-{x64,arm64}/conpty/OpenConsole.exe`。官方 `lib/utils.js` 按 build/Release、build/Debug、对应平台 prebuilds 次序选择原生模块；当前仅接纳已核验的 Release 与预编译目录。包清单名称和固定版本须相符，exe 与同目录 DLL 均匹配同一架构的官方哈希，且与对应 `third_party` 原件一致；预编译目录架构必须匹配该哈希组合。路径祖先不能含重解析点，读取文件时禁止并发写入/删除。其他来源、同名文件、未知 helper 版本或混合架构均拒绝。宿主仍须证明准确的父 PID、创建时间及同 HWND 控制台身份，停止成功仍以 Job 范围为空和 SDK 终端释放为准。

arm64 当前仅核对分发包原始字节；运行验收以实际平台记录为准，不把 x64 实机结果推广到 arm64。

正式 Windows Desktop 的 `node-pty` 二进制位于当前 Host 安装目录的 `resources/app.asar.unpacked/dsh/node_modules/node-pty/`，包清单则可能保留在 `resources/app.asar/dsh/node_modules/node-pty/package.json`。只有物理清单不存在且实际 helper 精确位于该 Host 的标准解包目录时，owner 才发起有界的随机 nonce 握手；Host 使用 Electron 文件系统只读逻辑清单，并以 `original-fs` 校验真实安装程序、归档和解包目录均无链接。owner 在握手及控制台归属确认期间保持归档的只读锁。回复必须同时匹配 nonce、实际包根、归档路径、包名及固定版本。该布局支持不修改归档，也不替代上述 exe/DLL、源码副本、父 PID、创建时间、HWND 和 Job 范围校验；完整 npm 目录继续直接读取物理清单。
