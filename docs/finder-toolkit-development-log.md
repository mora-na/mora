---
title: FinderToolkit 开发日志：把高频文件操作塞进 Finder 右键菜单
description: 记录 FinderToolkit 从 Finder Sync Extension、URL Scheme 协作、哈希计算、窗口修复到手动签名打包的完整开发过程。
---

# FinderToolkit 开发日志：把高频文件操作塞进 Finder 右键菜单

FinderToolkit 是一个 macOS Finder Sync Extension 项目，目标很明确：把日常高频文件操作放进 Finder 右键菜单，让“复制路径、新建文件、计算哈希、打开终端”这些动作不再依赖额外脚本或手动复制粘贴。

这篇文章记录它的开发过程。重点不只是“做了哪些功能”，而是这些功能如何落在 macOS 的扩展机制、权限模型、主 App 协作和交付验证上。

## 1. 项目目标：让 Finder 变成轻量工具入口

项目最初要解决的是 Finder 原生能力里的几个摩擦点：

- 复制路径：Finder 可以复制文件，但复制绝对路径不够直接，多选时也缺少稳定的行分隔输出。
- 新建文件：Finder 常规入口更偏“新建文件夹”，要快速创建 `txt`、`md`、`docx`、`xlsx` 等空文件并不顺手。
- 计算哈希：下载校验、包验证、文件比对经常需要 CRC32、MD5、SHA 系列摘要，切到终端会打断上下文。
- 打开终端：在当前 Finder 目录打开 Terminal 是典型高频动作。

因此 FinderToolkit 的产品形态不是一个常驻大窗口 App，而是一个贴近 Finder 右键菜单的系统级小工具。

## 2. 架构拆分：Extension 负责入口，主 App 负责重活

FinderToolkit 由两个 target 组成：

```text
FinderToolkit.app
FinderToolkitExtension.appex
```

Extension 的核心入口是 `FinderSync.swift`。它继承 `FIFinderSync`，在初始化时把监听目录设置为根目录：

```swift
FIFinderSyncController.default().directoryURLs = [
    URL(fileURLWithPath: "/")
]
```

这意味着扩展可以覆盖常规 Finder 窗口，而不是只在某个固定目录下生效。

主 App 的核心入口是 `AppDelegate.swift`。它不是传统意义上的前台工具窗口，而是一个 `LSUIElement` 辅助应用：默认不出现在 Dock，更多时候由 Extension 通过 `findertoolkit://` URL Scheme 拉起，完成那些更适合主进程处理的动作。

这种拆分有一个关键收益：Finder Sync Extension 保持轻量，菜单事件尽快分发；需要窗口展示、长耗时计算或主程序上下文的能力，则交给主 App。

## 3. 菜单模型：根据 Finder 场景裁剪能力

Finder Sync 会在不同菜单场景里调用：

- `contextualMenuForItems`：右键选中文件或文件夹
- `contextualMenuForContainer`：右键当前目录空白处
- `contextualMenuForSidebar`：右键侧边栏
- `toolbarItemMenu`：工具栏菜单

FinderToolkit 没有把所有功能粗暴塞进所有场景，而是按上下文裁剪：

```swift
case .contextualMenuForItems:
    addCopyPathItem(to: menu)
    addHashItem(to: menu)
    addOpenTerminalItem(to: menu)
    addNewFileItem(to: menu)

case .contextualMenuForContainer:
    addCopyPathItem(to: menu)
    addOpenTerminalItem(to: menu)
    addNewFileItem(to: menu)

case .contextualMenuForSidebar:
    addCopyPathItem(to: menu)
```

这个设计把用户的心智负担降下来：选中文件时可以算哈希，空白处可以新建文件，侧边栏主要只提供路径复制。

开发中还有一个细节值得记：Finder Sync 菜单里不要留下无意义的分隔项。一个空白分隔项在 Finder 里可能表现为“没有文字、点了也没反应”的菜单项，用户会把它理解成坏掉的功能。最终处理方式是移除这类 inert UI，而不是保留占位 chrome。

## 4. 复制路径：多入口统一成路径数组

复制路径看起来简单，但右键位置会影响数据来源。

选中文件时，路径来自：

```swift
FIFinderSyncController.default().selectedItemURLs()
```

目录空白处右键时，路径来自：

```swift
FIFinderSyncController.default().targetedURL()
```

实现上先统一成 `[String]`，再用换行拼接写入剪贴板：

```swift
let result = paths.joined(separator: "\n")
NSPasteboard.general.clearContents()
NSPasteboard.general.setString(result, forType: .string)
```

这让单选、多选和空白处右键共享同一条输出语义。复制成功后会发送系统通知，但通知权限不是主路径依赖；即使用户没有授权通知，剪贴板写入也不受影响。

## 5. 新建文件：Extension 直写与主 App 兜底

新建文件支持 `txt`、`docx`、`xlsx`、`pptx`、`md`、`csv` 等类型。菜单项使用 `representedObject` 保存扩展名，同时用 `tag` 做兼容定位：

```swift
child.tag = index
child.representedObject = type.fileExtension
```

目标目录通过 `currentTargetDirectory()` 判断：

- 如果选中的是文件夹，就在该文件夹内创建。
- 如果选中的是文件，就在其父目录创建。
- 如果没有选中项，就使用当前 Finder 容器目录。

文件名用 `uniqueFileURL()` 自动避开重名：第一次尝试 `新建文件.txt`，若已存在就递增为 `新建文件 2.txt`、`新建文件 3.txt`。

真正创建文件时有三层策略：

1. 优先通过 `findertoolkit://new-file` 唤起主 App 处理。
2. 如果主 App 无法打开，则 Extension 直接创建空文件。
3. 如果沙箱或 Finder 权限导致失败，再回退到 Finder AppleScript。

这套策略看起来稍复杂，但它符合 macOS 上 Finder Extension 的现实约束：Extension 离用户入口最近，主 App 更适合承担跨进程动作和可观察错误提示，AppleScript 则作为系统自动化兜底。

## 6. URL Scheme：Extension 与主 App 的轻量 IPC

项目注册了 `findertoolkit://` URL Scheme。主 App 在 `AppDelegate` 里同时处理普通 `open urls` 和 Apple Event 的 `kAEGetURL`：

```swift
NSAppleEventManager.shared().setEventHandler(
    self,
    andSelector: #selector(handleGetURLEvent(_:withReplyEvent:)),
    forEventClass: AEEventClass(kInternetEventClass),
    andEventID: AEEventID(kAEGetURL)
)
```

当前有两个主要 host：

```text
findertoolkit://new-file
findertoolkit://hash
```

`new-file` 负责解析 `directory` 和 `name`，创建文件后在 Finder 中选中新文件。

`hash` 负责解析多个 `file` 参数，把耗时计算放到后台队列，完成后回到主线程展示结果窗口：

```swift
DispatchQueue.global(qos: .userInitiated).async {
    // calculate hashes
    DispatchQueue.main.async {
        HashResultWindowController.show(result: result)
    }
}
```

这种 URL Scheme 方案足够轻量，也很适合做 smoke test。例如可以直接用：

```bash
open 'findertoolkit://new-file?directory=/tmp&name=test.txt'
```

验证主 App 的文件创建链路，而不必每次都从 Finder 右键菜单手动触发。

## 7. 哈希计算：大文件友好的流式实现

哈希功能支持：

- CRC32
- MD5
- SHA1
- SHA224
- SHA256
- SHA384
- SHA512

核心原则是流式读取，避免把大文件一次性载入内存。当前实现使用 1 MB buffer：

```swift
let bufferSize = 1024 * 1024
let data = file.readData(ofLength: bufferSize)
```

MD5、SHA1、SHA224 走 CommonCrypto 的增量 API；SHA256、SHA384、SHA512 走 CryptoKit 的 `update(data:)`。CRC32 则在读取循环中按字节推进多项式计算。

这里的专业性不在于“调用了哈希库”，而在于把算法接口包装成一个统一的 `HashResult`：

```swift
struct HashResult {
    let crc32: String
    let md5: String
    let sha1: String
    let sha224: String
    let sha256: String
    let sha384: String
    let sha512: String
}
```

调用方只需要关心成功或失败，不需要知道每种摘要背后使用 CommonCrypto 还是 CryptoKit。

## 8. 哈希结果窗口：从“能弹出”到“能使用”

哈希结果展示经历过一次典型的桌面 UI 修复：窗口不是只要能出现就算完成，它必须能稳定承载长文本、可复制、可关闭，并且尺寸不能退化成窄条。

最终窗口使用 frame-based layout，初始内容尺寸为 `760 x 520`，最小尺寸为 `640 x 420`：

```swift
let window = NSWindow(
    contentRect: NSRect(x: 0, y: 0, width: 760, height: 520),
    styleMask: [.titled, .closable, .resizable],
    backing: .buffered,
    defer: false
)
window.minSize = NSSize(width: 640, height: 420)
```

窗口内部是一个只读 `NSTextView`，使用等宽字体展示多文件、多算法结果；底部按钮栏提供“复制全部”和“关闭”。

一个容易被忽略的点是生命周期管理。窗口控制器通过 `objc_setAssociatedObject` 挂到 `NSApp` 上，避免展示后被 ARC 释放：

```swift
objc_setAssociatedObject(
    NSApp,
    Unmanaged.passUnretained(controller).toOpaque(),
    controller,
    .OBJC_ASSOCIATION_RETAIN
)
```

关闭窗口时再解除关联，既保证窗口存活，也避免无意义常驻。

## 9. 打开终端：优先系统 API，失败后 AppleScript

打开终端功能优先使用 `NSWorkspace` 指定 Terminal.app 打开目标目录：

```swift
NSWorkspace.shared.open(
    [targetDirectory],
    withApplicationAt: terminalURL,
    configuration: configuration
)
```

如果系统 API 返回错误，再使用 AppleScript：

```applescript
tell application "Terminal"
    activate
    do script "cd '<target-directory>'"
end tell
```

这里同样体现了 Finder Extension 的工程取舍：先走更直接、更系统化的 API；再提供对真实用户环境更宽容的 fallback。

## 10. 权限与沙箱：功能边界必须写清楚

FinderToolkitExtension 运行在 App Sandbox 中，关键 entitlements 包括：

```text
com.apple.security.app-sandbox
com.apple.security.files.user-selected.read-write
com.apple.security.automation.apple-events
com.apple.security.temporary-exception.files.absolute-path.read-write
```

Extension 的 `Info.plist` 声明了 Finder Sync 扩展点：

```text
NSExtensionPointIdentifier = com.apple.FinderSync
NSExtensionPrincipalClass = $(PRODUCT_MODULE_NAME).FinderSync
```

主 App 的 `Info.plist` 注册了 `findertoolkit` URL Scheme，并设置 `LSUIElement = true`，让它以辅助应用形式运行。

这些配置决定了项目不是“普通 macOS App 加几个菜单”，而是主 App、Extension、Finder、Launch Services、Apple Events 一起协作的系统扩展。

## 11. 打包交付：手动签名和安装验证是功能的一部分

macOS 工具的开发不能止步于 Xcode 里能跑。Finder Sync Extension 尤其依赖真实安装、系统扩展注册和 Finder 刷新。

Release 构建使用手动签名：

```bash
xcodebuild \
  -project FinderToolkit.xcodeproj \
  -scheme FinderToolkit \
  -configuration Release \
  -derivedDataPath build/DerivedData \
  CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY="$CERT_SHA1" \
  DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" \
  clean build
```

构建后要验证主 App：

```bash
codesign --verify --deep --strict --verbose=2 \
  build/DerivedData/Build/Products/Release/FinderToolkit.app
```

DMG 也要验证：

```bash
hdiutil verify FinderToolkit.dmg
```

本机安装时，单纯复制 `.app` 不一定立刻让 Finder Sync 使用新版本。可靠流程需要刷新 Launch Services、重注册插件并重启 Finder：

```bash
pluginkit -r FinderToolkitExtension
pluginkit -a /Applications/FinderToolkit.app/Contents/PlugIns/FinderToolkitExtension.appex
killall Finder
```

最终交付验证还包括：

- URL Scheme smoke test：确认 `findertoolkit://new-file` 能创建文件。
- 签名验证：确认 app bundle 和 embedded extension 都通过 `codesign`。
- DMG 验证：确认镜像可挂载、结构有效。
- 窗口尺寸验证：通过 CoreGraphics 枚举窗口，确认哈希结果窗口不是窄条。

## 12. 复盘：这个项目最值得保留的工程经验

FinderToolkit 的开发重点不在于某个单点 API，而在于把系统扩展项目做成真正可交付的软件。

几个结论很关键：

1. Finder Sync Extension 应该只承担菜单入口和轻量分发，长耗时任务与复杂 UI 应交给主 App。
2. URL Scheme 是 Extension 与主 App 协作的低成本方案，也天然适合自动化 smoke test。
3. 文件操作必须明确右键上下文：选中文件、选中文件夹、目录空白处得到的目标目录并不相同。
4. 大文件哈希必须流式计算，否则功能在小文件上可用，在真实文件上就可能失真。
5. macOS 桌面 UI 要用真实窗口尺寸验证，代码里“设置了约束”不等于用户看到的窗口可用。
6. Finder Sync 的交付闭环必须包含签名、安装、插件刷新、Finder 重启和实际菜单验证。

做系统级小工具时，最容易低估的不是功能实现，而是功能进入系统后的稳定性。FinderToolkit 的开发过程证明：一个看起来只有四个菜单项的工具，背后也需要清晰的进程边界、权限策略、错误兜底和交付验证链路。
