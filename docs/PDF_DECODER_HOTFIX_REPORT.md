# PDF.js 扫描 PDF 解码资源热修复

日期：2026-10-03。共享代码定向验证通过；安装版 Desktop 0.4.9 的打包及人工验收由桌面任务继续。

## 问题与范围

唐朔飞《计算机组成原理（第3版）》真实 PDF（436 页）导入后原页空白，但 OCR 正常。该书页面使用 JBIG2 图像；PDF.js 6.3.289 缺少 `wasmUrl`，服务与旧桌面包只提供 build 脚本，无法加载解码器及 JS 后备实现。OCR 使用另一条渲染路径，因此仍可运行。

本修复从 Desktop 已集成的 `0a48dc66f23b0924430a9210d590ad9b78f7b56b` 建立 `codex/pdf-decoder-hotfix`，供 main 与 Desktop 分别正常合入，不夹带后续 Practice / Visual Region 功能。

仅两个生产文件、29 行新增：

- `getDocument` 配置同版本 PDF.js 的 wasm、cmaps、standard_fonts、iccs 路径及 packed CMap。
- 服务开放上述平面资源目录，限制文件名和后缀，拒绝越界符号链接与路径穿越；WASM 使用正确 MIME，保留 JS fallback。
- 保持现有 Host / Origin / 启动凭证限制；不升级 PDF.js，不改 OCR、数据模型或用户书库。

## 定向验证

- 资源 HTTP 测试 39 项通过，无跳过；覆盖字节与 MIME、错误后缀、缺失资源、目录、路径穿越、编码路径、ADS、越界 symlink 及现有 vendor 路径。
- 原有浏览器访问限制与启动凭证检查 5 项通过。
- 真实 PDF 前两页分别以 HTTP WASM 和 `useWasm:false` JS 后备解码成功；图像为 2782×3561、2796×3579，均有非空黑白像素。两种模式逐页像素 SHA256 相同。Node 无法直接导入 HTTP ES module，因此后备测试执行从服务下载、与依赖逐字节一致的 JS 模块。
- 真实 Reader 浏览器中打开该书，首页封面与翻页后的版权/CIP 页均正常显示；浏览器 warning / error 为 0。
- 浏览器使用独立临时书库与原 Reader 页面。验证服务未挂载 OCR / AI / 目录生成子系统，界面中的文字状态不可用不作为这些能力的验证结果。正式用户书库未改，无 OCR 或模型调用。
- 未跑全量、全书或 AI 测试，未把浏览器结果表述为打包 Desktop / WebView2 验收。

验证源码：`tests/test_pdfjs_resources.py`、`tests-e2e/pdf-decoders.mjs`。测试通过 `PYTHONPATH` 指向本 worktree 的 `src`，避免误测已安装主工作区。

## Desktop 集成要求

Desktop 必须将当前锁定版本 `pdfjs-dist` 的 `wasm`（包含 `.wasm` 和 JS fallback）、`cmaps`、`standard_fonts`、`iccs` 与已有 `build` 一同打包，保留包内目录结构。只合共享代码而未补齐资源不能解决安装版空白。打包、全新构建及安装版真实画布验收由 Desktop 任务负责。

## 产物与数据边界

证据保留于 Git 外的 `D:\408-reader-pdf-decoder-hotfix-20261003`：`run-uHqHfJ/decoder-result.json`、`reader-page-1.jpg`、`reader-page-2.jpg`。用户 PDF、临时书库、截图、运行输出和凭证均不提交。主工作区原有无关 `website/` 不动。
