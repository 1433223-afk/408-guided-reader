# Tablet PDF 打开速度修复

2026-10-19，独立分支 `codex/android-tablet-reader`，基线 `a12de41`。本轮针对用户仍需长时间等待原页文字出现的反馈；未合入 main，未修改正式书库或 Windows Desktop。

## 确认的阻塞

真实教材为 348 页、150,123,418 字节。原 PDF 的 `/Pages` 直接引用 348 个分散的页字典。PDF.js 6.3.289 在 `getDocument().promise` 返回前执行 `checkLastPage()`；对这种平铺页树，逐个取页字典才能找到末页。因此即使打开第 20 页，初始化也先发约 370 个 Range。已有 OCR 读取和原页渲染都在此后才开始，不能靠重新 OCR 解决。

现版本 16 KiB 参数复跑：4 MiB/s 下载、50ms 延迟，真实私网 HTTP，首屏原页完成约 7.463 秒、371 个 PDF 请求。此前调整 Range 块只能减轻，未消除该原因。

## 修改

- 仅 Tablet LAN 的 `pdf?tablet=1` 采用紧凑页字典索引：在内存里序列化原有页字典，用相同 object ID、generation、Parent 和内容引用构造标准增量 xref。原页树、内容流、资源、书签、注释和来源坐标保持原语义。
- 仅把约 94 KB 的尾段原子缓存在 Demo 的 `tmp/tablet-pdf-index-v1/`。HTTP Range 将原件与尾段视作一个固定的读取表示，支持跨界和末尾 suffix；不复制整本 PDF，不改原件、SHA、数据库或 OCR。默认 `/pdf` 与 Desktop 仍返回原字节。
- 枚举页引用和序列化原字典使用两个文件 reader，避免 pypdf flatten 继承值改变字典。加密、不支持或已经有效线性化的源保持原件；后者避免增量尾段使 `/L` 长度失效而丢失既有快路径。同一服务中的表示决定固定，避免下载中途切换长度。
- 平板先完成可见页和它的文字层，再预读前后页；不让四张屏外扫描页抢首屏带宽。OCR 请求共享在途 promise，已有文字层失败仍显示原有重试入口。
- Tablet LAN 的 JS/CSS/WASM 采用 gzip 与私有 ETag 校验；修改文件后更新 validator。HTML、API、PDF 保持 no-store，鉴权和 Host/Origin 限制不变。PDF worker HTTP 正文由 2,228,489 字节减至 477,017 字节。

## 同条件性能结果

`tests-e2e/tablet-opening.mjs` 使用独立临时书库、真实教材和全部既有 OCR，不加载 OCR worker 或模型。每次新建 Chrome 155 冷 profile，1200×800 CSS viewport、DPR 1.5，以实际 LAN HTTP 加 CDP 4 MiB/s / 50ms 限速测量。控制组仅将 PDF 请求转回原件，仍走真实网络，不直接 fulfill PDF；双方采用相同的资源压缩和可见页优先策略。

时间从点击教材开始，包含总览到继续 PDF，终点为可见第 20 页实际绘制完成及可见 OCR 行已挂载后的浏览器帧。

| 轮次 | 原件 | 修复后原页及可选文字就绪 | 改善 |
| --- | ---: | ---: | ---: |
| 第一次，包含索引生成 | 7.044s | 2.124s | 69.8% |
| 第二次，服务端索引已缓存、浏览器仍冷 | 7.158s | 1.822s | 74.5% |

修复后首屏约 697 KB PDF 正文、18 个请求（17 Range）。首次服务端索引创建 374.6ms，复用为 0.0ms；单独纯函数测得 100.6ms。首次仍超过测试设定的 2 秒目标 124ms，不写作两轮均低于 2 秒。此为开发机受控对照，不能当作 Y900 无线环境或 Android CPU 的实际计时。

未加首屏优先的中间结果为 2.305s / 2.071s，首屏约 1.86–2.05 MB / 27 个请求，已据此继续减少屏外竞争。初次旧版复跑、中间结果和最终结果分别保留在 ignored `.tmp/`、`test-results/tablet-opening/` 与其 `visible-priority/` 下，没有覆盖原始观测。CDP dataLength 是解码正文且包含重复 Range；资源压缩大小以 HTTP Content-Length 为准，不把跨 worker target 的局部 encoded 计数声称为链路总量。

## 正确性与交接

- 真实教材 348 页几何与 page/Parent 引用一致；页 1、20、348 的 768px PDFium 图像逐像素一致，原件 hash 与完整前缀保持。
- 定向后端检查覆盖继承 Resources/CropBox/Rotate、书签/注释、旧增量 xref-stream、无末尾换行、加密回退、缓存、跨边界/suffix/416、热缓存鉴权、Desktop 原件，以及资源 gzip/304/文件更新和 HTML/API 隔离。
- `tablet-pen.mjs`、`tablet-directory.mjs` 的真实书交互回归通过：笔选字/正反拖动、笔后手指滚动、目录跳转、末页显示、Range 字节长度、横竖屏位置与缩放、目录/AI 草稿切换和 Desktop opt-in 隔离。模型、新 OCR 均为 0。
- 新的 PDF/资源检查最终 19 项、JS 渲染生命周期与文字层加载 15 项通过；另通过 PDF.js 资源与相关 LAN 鉴权回归。渲染测试 fixture 补充 Tablet 全局与共享文字层等待；原文字加载 fixture 缺少此前兼容修复的 `requestTimeout` mock，已在 `a12de41` 复现同一失败并仅修 fixture，未改 OCR 生产逻辑。未跑全量测试。

运行中的隔离 Demo 已升级并在实际 `192.168.43.65:8876` 无人工限速验证：点击教材至可见原页和 OCR 就绪 743ms，包含本次服务首次创建索引 308.1ms，所有 PDF 响应均为 compact。该验证在本机 Chrome 通过私网 HTTP 完成，阻止所有 API 写入，不改用户在 Demo 中的阅读位置；同样不代表 Y900 真机计时。结果位于 ignored `test-results/tablet-opening/live/`。

升级 Demo 后保留本地连接页 `.tmp/tablet-connect.html`，使用本次启动的完整地址。旧启动会话在服务重启后失效。原书库、main 以及原有未跟踪网站目录均未更改。真实 Y900 的计时留给用户人工验收，本轮完成后停止扩展。
