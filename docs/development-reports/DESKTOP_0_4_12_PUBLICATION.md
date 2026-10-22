# Desktop 0.4.12 发布记录

日期：2026-10-22

状态：HTTPS_PUBLISHED / INSTALLED_UPDATER_PASS / USER_MANUAL_ACCEPTANCE_PASS

## 对应代码

- 主线性能优化：`e7551040a6ef3ae3536b9cf9bd4f7a8605f368e2`，已获用户人工验收后提交。
- Desktop 正常 merge checkpoint：`85aa010fff5aa22183ac4aa4f4e3a2f9efb663f8`，Windows 版本 0.4.12。
- 本次同步 PDF loading task/worker 释放、离屏 canvas 回收、派生查询/裁图/排版复用、搜索读取收敛、后台生成与页面准备分离；保留 Desktop 四角色模型与 Provider Profile、凭据、加密 PDF、显示偏好及 updater。
- 默认 CPU OCR、200 DPI 和依赖不变；main 工作区的独立 OCR 加速实验与 website 未纳入发布。未把 Desktop 特有实现整体合回 main。

## 验证

- 215 项定向 Python 用例、4 项实际冻结 Core 生命周期用例、25 项 JS 用例通过；未跑全量测试。
- 隔离真实教材检查覆盖 348 页书三轮打开/关闭、翻页缩放、目录、裁图和密码正确/错误/取消、312 页真实空密码加密 PDF。关闭书后 PDF worker 归零。
- 真实题目图片、多轮 Hint、Master Review、收藏、学习记忆跳回与继续练习通过 headless smoke；AI 回答为本地测试替身，未额外调用真实厂商服务。
- 新 PyInstaller / Tauri / NSIS / updater signature 全新构建。22 个静态文件和 200 个 PDF.js 配套资源与当前依赖一致；新缓存模块已冻结。
- 本版未重新获取 Chrome/WebView2 精确对照数字，不将主线或旧版测试数字当成本版 WebView2 实测。

## 公网分发

- manifest：[beta.408reader.xyz/desktop/latest.json](https://beta.408reader.xyz/desktop/latest.json)，当前版本 0.4.12。
- installer：[408-Guided-Reader_0.4.12_x64-setup.exe](https://reader408-desktop-staging-hk.oss-accelerate.aliyuncs.com/desktop/0.4.12/408-Guided-Reader_0.4.12_x64-setup.exe)，101355568 bytes。
- 安装包 SHA256：`a44343d7403af776fe2fc81f481bdddf407506b2b92a372cbfe20e621881925f`。
- signature SHA256：`7f6e2489e192442de95c60d7642eed805a3c30da8f199fe6ec853d9cd681be50`。
- SHA256SUMS.txt 文件 SHA256：`5232ca572fc5d5ad731d0257e6393b3bf68ad3812c593b437122503a14a84bab`。
- manifest local / server / public SHA256：`4a0668750f5e9a93be62cb36452a1703d1fde8c5fc1f869acbd5a4c1ab5d3362`。
- 公网完整下载 HTTP 200，约 15.09 秒（本次网络约 6.71 MB/s）；Range 0–1023 返回 206 / 1024 bytes。公网 installer、signature、SHA256SUMS 与本地一致；独立 minisign artifact 和 trusted-comment 验签通过。
- 首次读取因三个对象权限返回 403，用户调整后重新完整核验成功；未放宽整个 Bucket 权限，签名私钥仍只在本机。beta 只切换轻量 manifest，未改其他服务器服务。
- 发布前验证旧 manifest 的 SHA256，保留 `/var/www/desktop/latest.json.bak-pre-0.4.12-20261022` 后同目录原子切换。

## 安装版验收

更新前安装版已核对为 0.4.11，已作只读 SQLite backup、integrity check，并记录 7 个 PDF blob 与非秘密模型/显示设置的 SHA256，不接触凭据内容。用户执行真实 0.4.11 → 0.4.12 签名更新后，对版本、数据、四模型配置、大书翻页缩放、目录、框选、Practice 及关闭重开清单回复 **PASS**。

独立核对：安装 exe ProductVersion 为 0.4.12；Core 与 app.js / pdf-session.js / ai-settings.js / reading-display.js 的 SHA256 与新构建一致。Shell 与 release exe 仅有 Tauri 预期的包型标记 `UNK → NSS` 三字节差异，替换该固定标记后其余 bytes 完全一致。

日志记录完成下载和签名验证后才停止旧 Core，旧 Core exit code 0，随后新 Reader 导航成功；用户关闭重开后 Core 再次正常退出并恢复。目前仅 1 个安装目录 Shell（PID 21604）和它的 1 个 Core 子进程（PID 39156）。

更新后 SQLite integrity check 为 ok；原来 7 个 PDF blob 的 SHA256、ai-models.json 和 reading-display.json 均未改变。原书目/来源各 7 条、annotations 10 条、Master messages 39 条、section learning states 3 条、Learning Memory 3 条的全部原始行保留；证据保存在本机临时目录，不进入 Git。人工使用结果与独立安装/日志/数据核对共同构成此次 updater E2E PASS。

既有独立待办：旧版偶发下载运输失败、Windows 卸载登记版本元数据滞后；本次不改 updater/安装器逻辑。
