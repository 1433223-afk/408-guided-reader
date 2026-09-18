# OCR / Outline Evidence Reliability Correction

## Result

2026-09-18–19：修复真实《保险学》的 OCR 方向误判、伪目录、篇章层级和页码重启定位。
已部署至 `http://127.0.0.1:8767/`。原 PDF 阅读不依赖 OCR 或目录成功。
这是当前能力的可靠性修正，不是新 Reader / 新 AI pipeline。

`IMPLEMENTATION_READY`；本轮用户复核及窄范围独立 review 尚未完成，不能继承历史 PASS。
建议 review 范围：目录身份修复隔离、篇下 Chapter ownership、TOC/body 页码隔离和物理范围。

## 根因与实现

1. **OCR 成功执行不等于识别完整。** RapidOCR 的方向分类会把长目录引导点行误判为倒置。
   真实物理第 9 页“第五章 保险市场引论”因此变成 `()……半王第`。
   已安装 RapidOCR `ch_ppocr_cls/main.py` 的固定宽度分类/180°翻转路径及实际同图实验
   证实这一点。现在低置信长引导点页最多增加一次禁用方向分类的对照识别；同检测框、
   置信度提高、字符量不退化才替换。补识别异常/畸形输出保留原结果；每次整页调用
   仍显式恢复 det/cls/rec，防止上轮已修的 provider 参数状态泄漏复发。
   没有新依赖、外部代码复制或远程模型调用。曾尝试外部 OCRmyPDF 文档读取失败，未作为证据。
2. **逐页书签冒充章节。** 原 PDF 有 356 条书签，其中 351 条是连续页码；原逻辑只要有
   书签便优先采用，全部变成章。现在密集连续的数字页签不作为章节证据，回退教材目录页；
   稀疏的数字章名仍合法。
3. **kind 被错误等同于 depth。** 支持实际 `篇/部 → 章 → 节`，篇为 OTHER 组织容器；
   章即使不是 root，仍然是 KP 准备和来源的 owner。中文数词、同视觉行碎片、独立右侧页码、
   括号页码及跨目录页重复的节序号统一处理；显式新篇可重新从第一章编号。
   已知编号断裂、缺少所属章、目录前页尚未 READY 时不发布残缺身份树。
4. **目录自身页码与正文页码重新从 1 开始。** 真实第一章 printed 3 曾错误指向目录页。
   TOC 目标页码解析现在排除整个 TOC/front prefix；原始 PageLabel 行仍保留真实页码。
   章首页可能不印页码：只在唯一相邻测得页码与实际章标题相互印证时获得 page-only 目标，
   不外推持久化 PageLabel，不用全书固定 offset。同 printed label 的节共享这一已验证页目标。
   中文独立章号和同视觉行标题可拼接匹配；大标题的间距按字号高度容纳，不改 OCR geometry。
5. **后续消费仍按章。** 物理解析与 Knowledge 准备取实际子树及下一同级/上级边界；下一章
   起点未知时不跳过并吞入其正文。书籍总览按篇分组、按章进入，不将篇当成一个巨大 Chapter。
   UI/UX 技能影响仅为层级分组与准确状态反馈；文字层完成不再暗示逐字无误。

## Authority / deviations

用户明确授权为可靠性调整不合适的既有框架；因此同步 Product §9、Implementation §11.2、
Map the Book brief，明确语义种类独立于深度、可用证据门槛和有备份的离线修复边界。
不是删除治理规则，也不是把全书 OCR 设为所有功能的全局锁。
原始 PDF、匿名 cell、source revision、稳定已有资产及 provider adapter 边界不变。

## 实际数据修复与回退

- source revision `743e6ba5-75ff-47b7-86a2-a9adcb017243`，364 页；PDF SHA-256
  `77ad5d081cd678f9ff0c5ef19f220da02cde6cca8d556f33597fbe7534a3b9db`。
- `tools/repair_book_evidence.py` 默认 dry-run；正式执行前停止 8767 服务，核对 PDF hash，
  确认无 target durable dependent / Outline FK dependent、无活动 job，在临时 SQLite 中准备。
  发布前重核 live 未变化，验证 integrity/FK，创建不覆盖的完整数据库备份。
- 回滚文件 `var/manual-browser/before-evidence-repair.sqlite3`；更早的
  `ocr-recovery-20260918-before.sqlite3` 保留。回退需停服后同时选择相容代码/data checkpoint，
  不可在之后产生用户资产后直接整库覆盖。工具仅供明确离线维护，不是并发在线迁移 API。
- 重提取 7 页（0-based 7/8/9/10/11/12/235），其中 4 页内容/几何变化通过既有
  Foundation publication 产生 4 条事件，revision foundation_version 1→5；未直接改 OCRLine。
- 356 个错误节点替换为 **137 节点：6 篇、25 章、84 节、22 练习节点**，identity_revision=2。
  正常 parser 升级仍受结构摘要 guard 保护，不自动重建其他已提交树。
- 数据核对：该书其余 357 页 OCRPage/OCRLine 全字段不变；其他书 760 OCRPage、46,098 OCRLine、
  760 PageLabel、427 OutlineNode 和全部 7 annotation 全字段不变。364/364 READY；
  SQLite integrity_check=ok，foreign_key_check 为空。浏览器验收会正常更新阅读位置。

## Acceptance evidence

- TARGETED：Outline/Knowledge **44 passed**（含 3 个 offline repair tests）；最终 adapter/Outline/
  repair **32 passed**；覆盖嵌套章范围、编号缺失/重启、未见前页、页码重启、缺章标题不猜测、
  修复失败 live 不变、有 durable/FK/job 则拒绝、optional OCR 的异常/低分/NaN/错框/坏 cells。
- CLOSURE：Python **364 passed, 2 skipped**；两项 inherited external-fixture 校准测试因未配置
  外部素材环境变量跳过，不计 PASS。JS **53 passed**，nested chapter UI 定向回归另 **2 passed**。
- 真实 29 页样本 `327da74e…c7e0aa1`：R2 E2E **PASS，29/29 READY/OCR**；正文拖选复制、
  精确 `6.2.1`、selection context menu、透明 native paint 与 0.2-alpha 自绘、reload geometry。
  第一次调用指定了不存在的样本路径，ENOENT，未计 PASS；纠正为真实已验证路径后通过。
- crash recovery **PASS**：kill 前 2 READY，restart 后保留 2，最后 29 READY；重做 1 batch，
  maximum attempts=2。
- 实际《保险学》浏览器：总览显示 6 篇分组/25 章；第五章可独立进入并显示三节；Reader
  `第二篇 → 第五章` 导航至原 PDF **90**（printed hint77）；原页面截图核对标题相符。
  物理第9页实际鼠标拖选并 Ctrl+C，clipboard 精确为 **第五章 保险市场引论**。
  服务重启、浏览器完整刷新、重开书后再次拖选复制，结果完全一致。
- 25 个真实章的 physical resolution 在隔离数据库副本中 **25/25 PASS**；未调用 AI，
  不声称真实模型 KP 内容生成 PASS，也不向 live 预先写入全书 RESOLVED 状态。
- 原 348 页《计算机组成原理》浏览器回归：旧 211 节点目录保留；`6.2.1 总线事务` →
  PDF303 / 印刷页291，与实际画面一致；测试后恢复 PDF99。
- 初轮测试曾因本轮函数名与局部变量冲突失败，已修复并完整重跑；不把失败当 PASS。
- 未运行无关远程 Teaching/Assistant/AI 生成套件（INTENTIONALLY_NOT_RUN：未改这些 provider
  或语义生成链路，也未发起远程模型请求）。没有进行独立 ZCode review，不声称 review PASS。
  仅新文件/adapter/Outline lint 通过；扩展 lint 暴露原有 Knowledge/page-label 未用变量/异常
  风格告警，未借本轮大范围整理。

## 限制 / 待复核

这次解决已复现的系统性失败，不承诺任意扫描书逐字完整。仍有低置信/高置信误识别、
缺失 printed label（例如“选择保险公司”页码被识别为401）和标题末尾噪声；不硬编码纠正
具体书名/标题/页码。84 节是提取数量，不是逐字人工召回率。已知编号断裂可拒绝，尾部全部
漏检等情况不一定能仅靠序号检测。新目录格式不符合当前 parser 时可能诚实地无目录；
跨页/多栏/无编号目录仍需后续真实语料扩展，不能凭本书宣称全格式适用。

cross-page continuous selection = **required but deferred**；geometry.js live single conversion
authority = **non-blocking P2 deferred**。缺少约700页真实扫描样本，
`FULL_REAL_MATERIAL_ACCEPTANCE_PENDING = true`。

## Reproducible entry points / files

- `python -m pytest -o addopts='' -q`；`npm test`。
- `READER_REAL_PDF` 指向真实29页扫描 PDF：`npm run test:e2e:r2`、`npm run test:e2e:recovery`。
- `tools/repair_book_evidence.py --help`：必须离线；默认 dry-run；不可用来绕过 dependents。
- `outline/evidence.py`、`outline/service.py`：证据判别、逻辑层级与物理目标。
- `foundation/rapidocr_adapter.py`、`foundation/page_labels.py`：OCR adapter 与 scoped label lookup。
- `knowledge/service.py` / `repository.py`、`static/app.js` / `screens.js`：章 owner 消费与 UI。

## Git checkpoint

本报告随实现 checkpoint 提交；准确 hash 在交付消息中记录。
