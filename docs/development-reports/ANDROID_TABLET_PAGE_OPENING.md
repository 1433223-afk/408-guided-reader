# Tablet 原页显示提速

2026-10-19，独立分支 `codex/android-tablet-reader`，前一版本 `6408017`。范围仅为打开原页与已有文字的等待；不合入 main，不修改 Windows Desktop 发布或正式学习库，不运行模型或新 OCR。

## 原因与选择

用户反馈紧凑页索引版本仍比电脑和 WPS 打开慢。前次实测的 1.8–2.1 秒不能作为 Y900 已通过验收的证据。WPS 打开平板本地文件，与 LAN Demo 远程取片段、浏览器初始化 PDF.js 再绘制的路径不同；本轮没有测量 WPS 内部实现，也不以设备性能或 OCR 推测替代定位。

已有请求记录确认：紧凑页索引减少了页树遍历，但首屏仍等待 PDF.js 文档初始化。检查还发现 Tablet 打开阶段读取当前未使用的学习/练习数据，给首屏带来约 1 MB 附加传输。因此更换 Tablet 首屏路径并延后无关读取。

## 实现与边界

- 仅 LAN 服务增加已鉴权的 `page-image?page=0&width=N`。电脑用现有 PDFium 从原 PDF 渲染请求页，传输无损 PNG，真实 CropBox/rotation 几何随响应头返回。按实际 viewport、DPR 和缩放请求画布宽度，不通过低分辨率缩略图伪装提速。
- Tablet adapter 接入现有逐页 canvas 与 normalized OCR/选区，不替换来源坐标或原文件。图片获取、解码、绘制和后备 PDF 渲染均支持取消，换书/旋转后的旧任务不能绘制。可见页原图和 OCR 先完成，再预读相邻页。
- 同一网页会话中按来源 SHA、页码和像素宽度复用最近 PNG Blob，最多 32 MiB。释放 Bitmap/Blob URL，关闭网页即失去 RAM 缓存，不新增持久化平板书库。
- 服务端只在 Demo 的 `tmp/tablet-page-images-v2/` 原子写入 PNG 缓存，最多 256 MiB / 256 张。同键合并请求，最多两个缓存 miss 构建；与既有 OCR/裁图共用 PDFium 锁，编码在锁外完成。缓存故障不阻断已生成页图。
- 128–8192px 请求宽度、既有 32MP / 16384 边长预算之外，以及含表单、引擎不支持等情况，懒加载原 PDF.js 后备路径。表单不初始化、不执行文档动作；缓存 v2 防止旧页图绕过这一策略。取消不触发后备；鉴权/版本错误明确报错。后备路径保留此前紧凑页索引和 Range 优化。
- Tablet 不在打开书时重绘隐藏书库，Master 条目与 Practice catalog 改在首屏后加载，保留现有入口；显式从学习记录回到原题仍强制加载，OCR 全部就绪时更新 catalog。全书准备状态和目录也在首个可见页 OCR 尝试结束后启动；已有 OCR 失败仍显示原重试入口。Desktop 保持原先时机与 PDF.js 显示路径。
- 所有页图请求先做原有鉴权，包含缓存命中；LAN Host/Origin 与 token/cookie 规则不变，Desktop 无该 API。没有公网发布或 API Key 下发。

## 可复现对照

`node tests-e2e/tablet-page-opening.mjs` 复用打开性能 fixture：独立临时书库、同一份 348 页 / 150,123,418 字节 PDF 与已有 OCR；两组均使用当前轻启动策略。基线强制 compact PDF.js，候选使用页图；只切换 app 参数，PDF/PNG 正文都走真实私网 HTTP，不 mock 图片或 PDF。

Chrome 冷 context 为 1200×800 CSS px / DPR 1.5；第一次打开后，同一标签页经书库再打开，验证 RAM 复用。终点分别为可见原页绘制与可见 OCR 行已挂载后的帧。无模型、无 OCR worker。结果为开发机模拟网络，不是 Android/WPS 实测。

| 网络 | 场景 | PDF.js 画面 / 文字 | 页图画面 / 文字 |
| --- | --- | ---: | ---: |
| 4 MiB/s，50ms | 首次 | 1668 / 1770ms | 474 / 578ms |
| 4 MiB/s，50ms | 同标签重开 | 1553 / 1633ms | 64 / 147ms |
| 1 MiB/s，100ms | 首次 | 3206 / 3417ms | 1250 / 1445ms |
| 1 MiB/s，100ms | 同标签重开 | 3137 / 3314ms | 44 / 306ms |

页图候选无 PDF/worker 请求；同标签重开目标页无页图请求。首次页图约 913 KB / 1380px 宽，服务端生成 160–172ms。PNG 高度因 PDFium ceil 与画布 round 可相差 1px，PNG IHDR 与响应头严格一致、宽度严格等于画布；不是降采样。不能把 Blob 响应的 CDP dataLength=0 写成无网络流量。

最终原始数据保存在 ignored `test-results/tablet-page-opening/final-normal/` 与 `final-slow/`；早期实验记录保留，未覆盖。最终两组均使用 v2 空缓存，且都在首屏后恢复 Master/Practice 加载，避免提速实际移除旧入口。

## 必要验证与交接

- 后端 15 项通过：真实 PDF crop/四种 rotation/准确尺寸、PNG 像素、缓存/并发/预算/失败、真实 AcroForm 后备、HTTP 鉴权与 Desktop 404。
- JS 35 项通过，其中 adapter 20 项涵盖几何、精确像素请求、会话缓存、解码失败、取消与懒后备；另保留既有渲染生命周期和文字层加载回归。
- `tablet-pen.mjs` 通过：真实 OCR 点选/正反拖动/菜单/取消、笔后手指滚动/长按、目录；第 348 页主动返回不支持以验证真实 PDF.js 后备及完成的 Range 字节。
- `tablet-directory.mjs` 通过：五种 viewport、目录长标题/独立滚动/不覆盖原页、锚点/缩放/旋转、AI 草稿恢复，以及 Desktop opt-in/竖屏隔离。未跑全量测试。
- 隔离 Demo 重启后，通过实际 `192.168.43.65:8876` HTTP 检查：本机 Chrome 无限速、冷浏览器及服务端页图缓存命中时，画面 144ms、已有文字 184ms；PNG 请求成功，宽度等于 canvas，无 PDF/worker 请求，旋转完成后原页与文字仍显示。验证阻止 API 写入和 beacon，未改变 Demo 阅读位置。ignored `test-results/tablet-page-opening/live/` 保存脱敏结果和横竖屏截图。此前服务首次生成的运行观测为 263/301ms，不能把暖缓存数值当作首次生成。

本轮未测量 Y900 实机速度。新页或新缩放仍需 Wi-Fi 传输；未 OCR 的扫描页显示与选字准备是两步。含表单和其他后备场景可能仍需较长初始化。没有承诺完整离线、WPS 同等性能或关闭电脑后可用。

服务重启后旧会话失效，连接页 `.tmp/tablet-connect.html` 已更新为新启动地址。由用户在 Y900 Chrome 人工验收，完成后停止扩展；main、正式书库及主线未跟踪 `website/` 保留。
