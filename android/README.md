# Guided Reader Android 本地版

**0.2.0 已于 2026-10-22 由用户在联想 Y900 13 完成人工验收，并授权提交和上传 GitHub。** 源码保留在独立的 `codex/android-tablet-reader` 分支；Android 安装包以 `android-tablet-v0.2.0` 独立预发布交付，不合入 main，不改变桌面版发布渠道。发布的 APK 与本次验收安装包相同，未重新构建。

面向联想 Y900 13 的本地 APK。0.2.0 起将共享 Web Reader、Python Core、PDF 渲染与中文 OCR 放在应用内；电脑关机、平板断网时仍可导入和阅读教材、选字、搜索及保存彩色手写批注。联网时使用 DeepSeek / 智谱；离线可查看已保存的学习内容。APK 不包含用户教材、学习数据库或 API Key。

## 使用

安装 `dist/android/GuidedReader-Tablet-0.2.0.apk`，覆盖旧版本即可，无需卸载。首次进入本机书库，直接通过 Reader 导入 PDF；不输入电脑地址、不需要 Wi-Fi 或扫码连接。数据位于应用私有目录，卸载或清除应用数据会删除本机书库。

默认阅读模式保留笔选字；主动进入「手写」后笔才落墨，手指继续滚动和双指缩放。八种明亮笔色、整笔擦除、撤销/重做沿用现有 Tablet 实现。阅读位置、已保存笔迹和学习内容由同一套 Core 写入本机 SQLite。

在书库按 Android 返回键打开应用菜单，可进入「AI 设置」，填写自己的 DeepSeek / 智谱 Key；两者分别配置，审查任务需要对应 Provider。Key 使用 Android Keystore 加密保存，仅由本机 Python 访问，网页拿不到 Key。Windows 凭据不会自动迁入。离线时不发起新的模型请求，原有 PDF 和已发布内容继续可读。

## 从旧 Demo 迁入已有内容

使用一次性 `.grlibrary` 包迁入旧 Demo 的原 PDF、OCR、目录、笔迹及学习记录。应用菜单「导入原有书库」通过系统文件选择器读取，仅允许导入到空本机书库，拒绝覆盖已导入内容。旧 Demo 和正式电脑书库不被修改。

导出工具仅接受带 Demo 标记的隔离书库，例如：

```powershell
$env:PYTHONPATH = Join-Path (Get-Location) 'src'
python -m reader_service.library_transfer --source-data-dir "$env:LOCALAPPDATA\408GuidedReaderAndroidTabletDemo" --output dist/android/GuidedReader-Tablet-Library.grlibrary
```

输出文件必须尚不存在。开发连接页提供两个带本次鉴权的下载二维码（APK 与迁移包），仅在一次性下载时需要电脑在线。

迁移包包含用户教材与学习内容，请自行通过 USB 等方式传到平板；它独立于 APK，不应公开分享。未完成的 AI 生成任务会标为迁移中断，不在打开应用时自动重跑。已保存/已发布内容、来源与用户学习状态保留。

## 构建

需要 Node.js 依赖 `npm ci`、Python 3.13、Android SDK Platform 37.0 / Build Tools 36.0.0 与 JDK 17+（本机使用 Android Studio JBR 25）。

```powershell
.\tools\build-tablet-apk.ps1 -JavaHome 'Android Studio 的 jbr 目录' -BuildPython 'Python 3.13 的 python.exe'
```

脚本使用 Gradle 9.1.0、Android Gradle Plugin 9.0.0、Chaquopy 17.1；首次构建需要下载依赖，安装后的应用离线运行不需要这些下载。Gradle 分发校验固定 SHA-256，工具缓存放在工作区 `.tmp/offline-build-tools/`，不改用户全局 Gradle 配置。可传 `-GradlePath` 使用已有分发。

Python 运行依赖仅 `pypdf 6.15.0`。PDF 页图与裁图通过 Android `PdfRenderer`，直接复用原生 PNG，避免重复解码/编码及旧图像库的 16 KB 内存页兼容问题；中文 OCR 使用随 APK 内置的 ML Kit Chinese 16.0.1，首次安装断网也无需下载模型。选字坐标优先使用 ML Kit 实际字符边框；没有可靠字符边框时保留实际词框。业务逻辑复用 `src/reader_service`，没有重写 KP、Guide、Master、Practice 或学习记录。

APK 含 `arm64-v8a`（Y900）与 `x86_64`（隔离 QA 模拟器），min SDK 26、target SDK 36。`-Debuggable` 生成 QA 包，允许 WebView 调试；用户包关闭调试。同包名、同 Demo 签名覆盖升级，签名文件仍在用户本机 `408GuidedReaderAndroidTabletBuild/signing/`，不进 Git。

## 运行边界

- Core 进程内仅监听 `127.0.0.1:18765`，保留每次随机凭证、同源检查与现有写入鉴权。不监听局域网，不要求电脑服务。
- Web 资源与 PDF.js 等依赖内置，首次启动解压静态资源；升级只替换静态资源，不覆盖 `reader-local` 数据。
- Android 系统文件选择器仅授予所选文件权限；没有全盘存储权限、相机权限或网页到原生通用文件/密钥桥。
- 横竖屏保留 WebView，系统杀进程后重新打开本机 Core，恢复已持久化状态。临时 Assistant 对话沿用原 Reader 的临时语义。
- 新书扫描页的第一次文字识别需要本机计算；已有 OCR 和学习内容无需重复生成。原 PDF 可以先显示，文字识别随后完成。
- AI 仍需要网络及用户自己的有效 Key；本版本不包含离线大语言模型。不会自动调用其他 Provider。
- Y900 实笔延迟、掌托、侧键与输入法差异仍以真实设备使用为准；模拟器检查不能替代这些体验。

定向验证脚本为 `tests-e2e/tablet-offline-apk.mjs`，只操作任务自有 `ReaderTabletQa` AVD，使用无文字层的真实教材页，检查首次断网启动、SAF、本地 OCR / 搜索 / 选字、笔迹和重开。实际结果以 `test-results/tablet-offline-apk/result.json` 为准。

0.1.0 是旧的电脑局域网客户端，不满足本地离线目标，已被此版本取代。旧 LAN 启动脚本仅作为开发验证路径保留。
## 本轮验证记录

Android 37.1 / 16 KB 内存页、系统 WebView Chrome 149 的任务专用模拟器已完成首次飞行模式启动：空本机书库、SAF 导入从真实教材提取的三页纯扫描 PDF、首次本地中文识别、搜索与反向笔选字、笔迹、跨页、125% 缩放、横竖屏，以及强制结束后从实际 SQLite 恢复。没有浏览器错误或网页外部请求，没有模型调用。报告与横竖屏截图位于 `test-results/tablet-offline-apk/`。

初始 Pillow 方案实际因旧 libjpeg 的 4096 字节 ELF 对齐不能在 16384 字节系统页加载而失败；已移除 Android Pillow 路径，保留原生 PNG。不是依靠兼容模式掩盖启动失败。相关无 Pillow / PNG、迁移、本机 Core，以及原有页图/裁图定向回归通过，未跑全量测试。

安装包及迁移包通过实际私网地址完整下载并核对哈希；匿名下载返回 401。包仍仅在独立分支构建，没有合入 main。

原生 SAF 迁移实测通过：2 本 / 350 页（其中真实教材 348 页），保留 OCR、知识点、已发布导读/行间、Notes 和 Master 记录。已实际离线打开 Directory、KP、Guide、Notes；数据库与迁移包的保存条目数量一致，13 条已擦除笔迹仍保持软删，不复活已删除内容。报告在 `test-results/tablet-offline-migration/`。

最终非调试 APK 已同签名覆盖 QA 包，在飞行模式下保留迁入数据并打开 348 页教材与可选文字；未出现 AndroidRuntime fatal，WebView 调试入口关闭。结果在 `test-results/tablet-offline-release/`。

原生 AI 设置的保存/读取/移除已实际验证：固定假 Key 经 Keystore AES/GCM 写入后可读，SharedPreferences 只含 v1 密文；测试后已移除，没有携带真实 Key。

联网 AI 仍有一项验证限制：隔离模拟器恢复网络后，对 DeepSeek / 智谱的无鉴权 HEAD 均停在 DNS_FAILURE；只重启任务 AVD并使用电脑当前 WLAN DNS（119.29.29.29、223.5.5.5）复测一次仍相同，未进入 TLS 阶段。没有关闭证书验证、添加代理或搬用 Windows 密钥，因此不能声称已经验证 Android 真实模型调用。已完成的离线阅读、迁移与保存不依赖此网络检查。
