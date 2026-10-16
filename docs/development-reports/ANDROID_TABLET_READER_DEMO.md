# Android Tablet Reader Demo（2026-10-16）

## 隔离边界

冷启动确认主线为 `main` / `b718e767f67406c3e4241d78a5adbead5b9d94bb`，只有未跟踪的 `website/`。开发在独立工作区 `C:/Users/26389/.codex/worktrees/android-tablet-reader/408-guided-reader` 的 `codex/android-tablet-reader` 分支进行；未合入 main，未发布或修改 Windows Desktop。

阅读了 PRODUCT / DEVELOPMENT、Reader 2.0 蓝图及最近阅读显示、竖屏布局报告；沿用 PDF.js、OCR 选区、Directory、Assistant 和 Python Core，没有重新研究或改造 Practice。

## Demo 行为

通过显式 `?tablet=1` 启用。工具栏保留书库、页码、目录、解释续接和更多显示设置；触控主要操作以至少 48 CSS px 为目标。单指保留原生滚动；约 430ms 长按激活 OCR 选区，保持按住可拖动扩展，松手出现「问 AI」。双指只在交互中预览变换，收势一次提交现有 PDF 缩放并重渲染。缩放范围沿用 50%–400%。

目录为按需抽屉，展开/收起始终可点，点击目录目标后关闭；点击遮罩也可返回阅读。横屏宽视口将 Assistant 放在右侧；竖屏或不足 960 CSS px 的窄视口放在底部。通过动态视口处理键盘可用高度，保留原有多轮、流式和临时会话语义；旋转只重排，不重开书或创建会话。长选区引用单独限高，避免首问发送按钮与模型菜单被裁切。

平板保存视口顶部的 PDF 锚点，解决两页同时可见时中心页与顶部偏移不一致的问题；普通 Desktop 路径保持原行为。重排锚点按 revision 校验，避免换书时沿用旧书位置。LAN HTTP 使用 getRandomValues 生成 UUID，并提供复制回退，修复非安全上下文里 randomUUID / Clipboard API 不可用的问题。

## 局域网与数据

只在显式 `--tablet-lan` 下绑定指定本机 RFC1918 地址，拒绝 wildcard、公网绑定、非私网 peer 和错误 Host/Origin。保留每次启动凭证与 HttpOnly 会话，不创建公网入口。API Key 沿用开发电脑的 Windows 凭据，Provider 限为 DeepSeek / 智谱。

独立 Demo 保存到 `%LOCALAPPDATA%/408GuidedReaderAndroidTabletDemo`。从现有开发样本只读备份数据库，在副本中筛选一本组成原理教材并物理复制 PDF；348 页已有 OCR 与 211 个目录节点可复用。拒绝覆盖非空数据目录、原目录或嵌套目录。复制的在途模型任务被终结，避免服务恢复继承生成意图；已发布内容保留。没有改动日常学习库。

## 验证与交接

19 项必要 JS、34 项 Tablet 后端定向检查通过，相关授权与 PDF 资源检查通过；没有跑全量套件。真实 WLAN HTTP 通过会话、Range PDF 和 Host/Origin 检查。浏览器触控 smoke 通过 1200×800 / 800×1200 CSS viewport 下的真实教材、单指滚动、目录、长按、双指、旋转、两页交界刷新恢复与 Desktop opt-in 隔离，无页面异常。最终解析为 DeepSeek / deepseek-flash 后测试了真实首轮与追问，两轮完整返回。截图仅保存在 ignored `test-results/tablet/`。

当前尚无 Y900 真机结果；Android 输入法、系统栏、长按手感、回答原生选区与热点互访均留待用户人工验收。原文选字暂没有系统选区手柄。不交付离线 APK、Android Python Core、手写笔、云同步或 Practice / Master Review 触控改造。

启动和连接详见 [ANDROID_TABLET_DEMO.md](../ANDROID_TABLET_DEMO.md)。本轮停止继续扩展，交给用户真实平板人工验收。
