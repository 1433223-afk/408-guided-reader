# R2 OCR 引擎状态泄漏修复

后续人工使用发现的方向误判、伪书签目录、篇章 ownership 和页码重启问题，及其实际数据
修复，见 [OCR / Outline Evidence Reliability Correction](OCR_OUTLINE_EVIDENCE_CORRECTION.md)。
本文的引擎状态泄漏修复结果保留，不代表识别完整率或后续 correction 已获用户验收。

## 问题与根因

2026-09-18，新上传《保险学 (孙祁祥 (女)) (Z-Library)》364 页中，只有 4 页 READY，
其余 360 页为 OCR_FAILED。PDF SHA-256：
`77ad5d081cd678f9ff0c5ef19f220da02cde6cca8d556f33597fbe7534a3b9db`。

这是前次 sparse-line retry 修补引入的回归，而不是用户 PDF 无法识别。
RapidOCR 3.9.2 的 `__call__ → update_params` 会将非 None 调用参数保留在实例上。
裁剪行补识别设置 `use_det=False`，随后整页调用却只传 `return_word_box=True`，
从而沿用关闭检测的状态，返回没有 boxes 的 TextRecOutput。线程内复用引擎使故障传播
到后续页面。此前测试 provider 无状态，且仅验证单页，漏掉了这条真实调用路径。

只读实验证实：同一引擎依次处理物理第 6、7、8 页，第 6 页触发补识别后，第 7、8 页
均失败；显式恢复检测后第 7 页正常产出 22 行、634 字符。依据是已安装 provider 源码与
真实材料实验，不是更换 OCR 引擎或泛化重构。

## 修正与防复发

- 每次整页调用明确启用 detection/classification/recognition，不依赖 provider 上次状态。
- 可选补识别的异常边界覆盖调用及输出解析；格式错误、非有限/越界置信度均保留原行。
- 全页输出结构错误仍然失败，不把真正错误伪装成空白 READY。
- 有状态 provider 回归覆盖补识别接受、拒绝、抛异常和畸形输出之后连续三页调用。
- 真实使用还发现独立的调度并发缺陷：priority SELECT 游标未耗尽时，worker 提交会使
  读快照无法升级为写事务，触发 SQLITE_BUSY_SNAPSHOT，导致准备订阅启动失败、页面
  没有 overlay。现在先 fetchall 关闭读游标再写；确定性并发回归先 FAIL 后 PASS。
- E2E 与当前书库“打开教材 → 继续 PDF”路径对齐，并等待测试服务退出后清理 SQLite，
  避免 Windows EBUSY 掩盖测试结果。

没有新增依赖、schema、Word/Character 实体、cell 身份或 provider 外泄；没有改 selection
contract 或 OCR geometry。没有扩展其他产品功能。

## 数据恢复边界

服务空闲时备份 SQLite：`var/manual-browser/ocr-recovery-20260918-before.sqlite3`。
仅通过现有 JobRepository.requeue_page 重试 revision
`743e6ba5-75ff-47b7-86a2-a9adcb017243` 的 360 个 FAILED 页面。
这些页面原先没有 OCRLine，因此不涉及覆盖 READY 几何、重处理或 foundation version bump。
revision foundation_version 保持 1。四个原 READY 页（index 0/1/2/5）完整保留。
正常准备流程可能逐步刷新该书页码映射；不是手工修改映射或其他书籍。

## 验证结果

- TARGETED：adapter/Foundation/Jobs **29 passed**，新增状态泄漏与并发测试均先复现失败。
- CLOSURE：Python **345 passed, 2 skipped**；两个 inherited-fixture 参数用例因未设置素材
  环境变量跳过，不冒充通过。JS **53/53 passed**；Ruff 与 diff check PASS。
- 29 页真实王道样本 E2E：**29/29 READY / OCR**，准备期间跳页、正文拖选与剪贴板、
  reload geometry、目录编号 `6.2.1`、选区右键菜单及轻量选区绘制均 PASS。
  首次旧 harness 因 Windows 清理 EBUSY 失败；修正后两次完成 PASS。
- 29 页 crash recovery：中断前 2 页 READY，重启后仍为 2 页；最终 29 页 READY，
  仅 1 个 in-flight batch 重做，最大 attempts=2。
- 《保险学》同引擎连续物理第 6/7/8/11/21 页只读提取成功：分别为
  35/22/42/101/57 行，1148/634/853/494/1063 字符。
- 实际服务 `http://127.0.0.1:8767/`：恢复过程中可正常翻页；物理第 7 页真实鼠标
  拖选、Ctrl+C 及完整刷新重开后的相同范围复制成功。内容为
  `本系列教材的作者均是我院主讲同门课程的教`；这是实际 OCR 输出，非逐字准确率验收。
- 本轮没有重跑历史 R1 多 DPR 像素截图全套（INTENTIONALLY_NOT_RUN：未改 PDF renderer
  或布局；实际翻页、原 PDF 可读性及恢复/重开在上面的真实路径覆盖）。历史该套的像素
  断言/清理失败没有改记 PASS。

- 《保险学》最终 **364/364 READY，0 FAILED，364 PAGE_PREPARE SUCCEEDED**。恢复期间
  部署并发修补的一次服务重启后继续完成；原 4 页全字段不变。其他书籍 760 页 OCRPage、
  46,098 条 OCRLine、760 条 page label 全字段不变；全部 7 条 annotation 不变。
  SQLite integrity_check=ok、foreign_key_check 为空；foundation_version=1。

结果：IMPLEMENTATION_READY，已部署并恢复用户材料，等待用户复核。本次为局部缺陷修复；
不将历史 R2 人工/ZCode 验收
自动视为本次补丁的新用户验收或独立 review。

## 限制

本次消除状态泄漏与已复现的并发读写缺陷，不承诺所有扫描文字都能正确识别。
低质量图像、检测遗漏和高置信误识别仍可能存在。原 PDF 阅读始终独立于 OCR。
cross-page continuous selection = required but deferred；geometry.js live single conversion
authority = non-blocking P2 deferred。缺少约 700 页真实扫描样本，
FULL_REAL_MATERIAL_ACCEPTANCE_PENDING 仍为 true。
