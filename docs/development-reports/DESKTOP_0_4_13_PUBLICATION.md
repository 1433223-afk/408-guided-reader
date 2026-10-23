# Desktop 0.4.13 发布记录

日期：2026-10-23

状态：HTTPS_PUBLISHED / INSTALLED_UPDATER_PASS / USER_MANUAL_ACCEPTANCE_PASS

## 对应代码与验证

- 主线已验收的首屏与连续性能优化：`bf6d27de31b88b3e2b3c326583e4ac008b61c1e0`。
- 集成发现的 Practice 并发加载修复：`ff284386d2c72ddd6da35e77d0ce00123b54f839`；同会话共享完整加载与结果应用，隔离旧会话，保留 OCR 刷新与位置保存等待。
- Desktop 正常 merge checkpoint：`04691d80a685ea851b4d4bf4fc5a1c174fe80e6f`，Windows 版本 0.4.13。
- 同步真实原页首屏预览、可见页优先与后台延后、离屏资源释放、显示缓存上限、Notes/目录/流式滚动复用、冷习题目录与搜索优化。保留四模型与来源配置、安全凭据、密码 PDF、显示偏好、原生 Shell、生命周期与 updater。
- main 独立 OCR / DirectML / OpenVINO 实验及 website 未纳入；默认 CPU OCR、200 DPI、运行依赖和数据库 schema 未改。未把 Desktop 特有实现整体合回 main。
- 121 项相关 Python、4 项最终冻结 Core 生命周期、143 个不同 JS 用例通过；未跑全量测试。真实隔离教材 smoke 覆盖首屏回退与目标页、连续阅读/重开、选字/标记/Notes、缩放/目录、框选、空密码/真密码/错误/取消；受控 Practice smoke 验证共享读取、连续 Hint、跨页图片、Master Review、收藏和继续复盘。AI 回答为本地替身或禁用，没有额外付费出站。
- 发现并发回归的首个候选包已移出分发目录，修复后全新构建 PyInstaller / Tauri / NSIS / signature / manifest / SHA256。22 个静态文件和 200 个 PDF.js 配套资源与源码/依赖逐字节一致。
- 本轮未测当前 WebView2 精确性能矩阵，不把主线数据或旧版数据当成本版安装版测量，也不宣称浏览器总内存按 JS 堆改善幅度下降。

## 公网分发

- manifest：[beta.408reader.xyz/desktop/latest.json](https://beta.408reader.xyz/desktop/latest.json)，当前版本 0.4.13。
- installer：[408-Guided-Reader_0.4.13_x64-setup.exe](https://reader408-desktop-staging-hk.oss-accelerate.aliyuncs.com/desktop/0.4.13/408-Guided-Reader_0.4.13_x64-setup.exe)，101366759 bytes。
- 安装包 SHA256：`e9ea887fded1024a2434bec00bd5c3ad08b4ef04146f67ca6a5518a90541fc07`。
- signature SHA256：`d5a16262786ae6c77ca165d662f28ce3dcdb0ffaf7851a3d0679cac8110f075f`。
- SHA256SUMS.txt 文件 SHA256：`988412ccccdb81050bb90601068e02bf6ab33c80d048245cce21f2a77944a7c9`。
- local / server / public manifest SHA256：`62f3b0f45fe4bf52de3caf5f0783acda20b151e6e1c513a95ebb8fa8449e285e`。
- 公网完整下载返回 200，约 4.54 秒、TTFB 0.211 秒；本次网络约 22.31 MB/s，不作长期速度承诺。Range 0–1023 返回 206 / 1024 bytes，内容与 installer 前段一致；三个公开对象均与本地逐文件 SHA256 一致。
- 独立 minisign artifact 和 trusted-comment 验签通过，manifest 的版本/URL/signature 匹配当前产物。签名私钥仍只留本机，未上传数据或凭据。
- 经已有 owner SSH identity，以 admin 用户核对旧 0.4.12 manifest SHA256 后，保留 `/var/www/desktop/latest.json.bak-pre-0.4.13-20261023`，同目录原子切换；未修改其他服务器功能或 Bucket 配置。

## 安装版验收

更新前安装版 ProductVersion 已独立核对为 0.4.12。已作只读 SQLite backup / integrity check，并记录 7 个 PDF blob、非秘密 AI 模型与阅读显示设置的 SHA256，不接触凭据内容。

用户执行实际 0.4.12 → 0.4.13 应用内更新、自动重启后，对“关于”版本、首开/重开与连续翻页、目录/Notes/搜索/Practice、Memory 继续复盘、数据与四模型配置保留、关闭重开清单回复 **PASS**。

独立核对安装 exe ProductVersion 为 0.4.13；Core、app.js、pdf-session.js、ai-settings.js、reading-display.js 的 SHA256 与最终构建一致。Shell 与构建只有 Tauri 预期的 NSIS 包型标记 `UNK → NSS` 三字节差异，替换该固定标记后其他 bytes 完全一致。

日志 `[1792738371]` 显示下载和签名验证完成后才停止旧 Core；旧 Core 同秒 exit code 0，`[1792738382]` 新 Reader 导航成功。验收后用户关闭窗口，Core 再次正常退出且没有残留；随后正常启动安装 exe，独立观察到 1 个 Shell（PID 34936）与其 1 个 Core 子进程（PID 40712），安装路径正确。

更新后 SQLite integrity check 为 ok。原 7 个 PDF blob SHA256、ai-models.json、reading-display.json 保持不变；书目/来源各 7 条、annotations 10 条、Master messages 39 条、section learning states 3 条、Learning Memory 3 条的全部原始行保留。本机前后备份、hash/count 和筛选日志留在临时目录，不进入 Git。人工使用确认与安装/日志/数据独立核对共同构成本次 updater E2E PASS。

既有独立待办仍包括偶发网络运输失败、Windows 卸载登记元数据滞后；本版未修改 updater 协议或登记逻辑。
