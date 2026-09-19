# OCR / Outline Evidence Reliability Correction

## Current result — 2026-09-19 populated-book correction

### Follow-up: long Section capacity and immediate KP list

用户要求直接修复第三章容量失败与“读取知识点状态”变慢，只跑必要检验，由用户人工验收。
根因：无子小节的Section完整fallback窗口被9,600字实现常量拦住；KP列表等待的目录GET又做了
两次全书safe-target扫描。本机诊断KP/learning约16/9ms，而两次只读目标计算约5.03秒。

修正：本地窗口安全上限调为48,000字（不是provider上下文大小声明），不改变窗口身份/语义，
不截断、不按字符拆分；输出预算按完整unit-ID记账需求扩展，保持配置下限和runtime16,384上限。
仍保留超限、完整覆盖、连续来源校验与Chapter Review，不保证超长任意输入或模型输出必然成功。
Reader KP列表同步显示已保存条目，学习状态异步补齐，使用已加载Outline分组，不再请求目录。
Reader/Overview已有目录走`?stored=1`只读快照，无证据时仍走原bootstrap；证据刷新仍由现有
准备worker/显式bootstrap负责，无全书结果缓存、身份迁移或自动KP生成。

TARGETED：容量/超限/只读目录Python4 passed；章节入口JS2 passed（含状态悬挂时列表可用，
禁止列表请求Outline）。未跑全量。真实《保险学》第三章只读projection预检：2,524字/14units、
13,631字/98units，两个完整窗口，输出预算4096/7296，所有units保留。未发起远程模型调用，
不声称第三章生成或Review已PASS；旧FAILED记录保留，需用户刷新后点击“上次小节容量受限·重试”。
重启8767后实际stored目录205节点约12.7ms（本机单次观测，非SLA），不重算证据。
用户复核pending；既有KP和学习记录未改写。

### Follow-up: reopen / selection / KP loading UAT fix

用户随后报告重开又准备文字、PDF9后不可选、KP一直读取。本次检查时364页均READY，
只有1个已完成Chapter job和25个已有KP，没有全书KP生成。PDF10 overlay可返回74行。
确认 viewport POST 同步触发 Outline bootstrap（单次safe-target实测2.6秒，一次bootstrap两次），
前端重开先清状态并等待该POST才订阅READY；overlay还等待批注，读取失败静默退出，GET无超时。
这些为真实代码缺陷，但浏览器工具不可用，未声称捕获用户现场所有卡住原因。

修正：viewport scheduling不再刷新目录；已READY全书不新排任务；worker不因READY短路重算目录；
状态SSE不负责排任务。前端先GET已存状态，全READY不POST/不开SSE，翻页不调准备；
页面文字可独立读取，不等待批注。GET限时15秒，文字读取失败提供页内重试，KP失败显示重试，
同章读取去重，KP生成仍只在显式点击时POST。保留失败OCR的显式重试观察路径。
UI/UX技能用于区分“读取”和“生成”、失败反馈；无数据迁移/重OCR/模型调用。

必要验证：jobs定向6 passed；读取/章节入口JS合计5 passed；真实29页R2选择/复制/reload PASS。
新增批注阻塞单测初次缺事件handler桩，补齐后通过。用户要求不跑全量后立即中止Python全量，
不计PASS；此前已结束的JS全量57 passed，未再启动全量。交付后由用户人工验收。
重启8767后实际API：PDF10/16 overlay READY（74/29行），已有KP READY25；
viewport schedule约11ms且job增量0（单次本机观测，不是性能SLA）。用户材料和KP未重生成。
当前源码checkpoint不代表本轮UAT已PASS；请完整刷新后测试重开、PDF10/16选择、KP读取。

已修复并部署至 `http://127.0.0.1:8767/`：目录/阅读器显示 PDF 页数；补齐教材自己的
引言、总结、练习和前后附属内容；前后内容归入“其他内容”。当前《保险学》为 **205 节点、
199 个可导航页目标**，而不是下方上一 checkpoint 的 137 节点。

`IMPLEMENTATION_READY`；**本轮用户复核与窄范围独立 review 仍 pending，不是 closure PASS**。
此前真实浏览器已验证核心目录路径；最后一轮跨教材浏览器复核因工具连接故障未完成，见下。

### 人工反馈、根因与通用修正

- 长引导点行不仅有方向误判，也会吞掉短标题、将页码顺序识错，整页 OCR 成功不等于目录完整。
  `quality-retry-v3` 对至少五行引导点的页面增加有界、重叠水平分带和左侧短标题裁切；
  在 adapter 内恢复原页坐标，同位置/文本一致性去重，只有缺失标题几何才补入。
  畸形/非有限几何、低质量或异常保留 baseline。仍为匿名 cell，无 Word/Character 实体。
- 目录 parser 以前忽略无编号引言/总结、部分无页码练习和后记；新增章节内 extras、前后内容，
  去除分带重复碎片及低价值引导线噪声，但保留真实标题括号（合同(上)/(下)）。
  数字小节目录仍走原路径；不把数字逐页书签作为章节，也不丢掉其中有效的具名前置书签。
- printed hint 只作内部证据。实际章内标题匹配可纠正错误 hint，检索严格限于有证据的所属章；
  未确定仍显示“页码待核实”，不凭全书常量推算。组织篇无目标时可以展开。
  “选择保险公司”从错误 hint401 正确落到 **PDF117**，“失业保险”落到 **PDF325**。
- Reader、目录和总览统一使用 PDF 页码；已有 page-label 数据不删除。
  附属内容不会通过最后一个 PARTIAL 章的 fallback 被当成正文学习 owner。
  UI/UX 技能用于清晰层级、可读状态提示和导航检查，没有新增 Reader 设计。
- 研究依据：[Tesseract ImproveQuality](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html)
  关于稀疏布局分割、裁切和边界的建议；本地实际 crop 实验验证了适用性。借用模式，未复制
  外部代码、未引入依赖、未调用远程模型。生产代码无本书标题/页码/offset 特判。

### 已授权的资产保留迁移

发现已有学习资产后暂停，并取得用户“行”的明确同意，再执行 `--preserve-assets`。
同步 Product §5/§9.5、Implementation §10.1/§11.4 和当前 brief；无 schema 变更。

- 六张真实目录页 PDF8–13 重提取，四页发生真实文本/几何变化，经既有 Foundation publication
  产生版本 **5→9**。其他358页 OCRPage/OCRLine 全字段不变。
- 添加68节点，**原137个 ID、parent/owner/kind 全保留**；5个既有物理范围变化。
  结果：6篇、25章、84节、25引言、25总结、25练习、5前置、10后置。
- 25个 KP、1份 Teaching、1份 section guide、Chapter Preparation 和其他学习表逐行完全相同。
  受影响 READY 章写入按 structure version 作用的 `asset_review` evidence，投影 `needs_review`；
  原内容继续可读，不自动删除、重写、重新生成或改变 mastery。
- 离线工具先在完整副本校验，拒绝缺失旧 ID/reparent/kind 变化；发布前重核 live 快照、依赖表
  指纹、SQLite integrity/FK，创建不覆盖的备份。原 unowned 模式仍拒绝资产。不是在线并发迁移。
- 主恢复点：`var/manual-browser/before-directory-additive-20260919.sqlite3`；标题括号整理前另存
  `before-directory-title-polish-20260919.sqlite3`。第二次仅复用 READY OCR，0新增/205保留/0范围变化。
  不要用旧整库备份覆盖后来新增的用户数据；回退必须停服并选择相容代码和数据。
- 发布时及重启后分别核验：其他书的 OCR、labels、outline、events 未变，资产指纹未变，
  integrity=ok、FK violations=0。重开书按现有队列机制新增364个 fv9 的检查 job；旧 job 行未变，
  READY 页直接短路，不是再次 OCR，也没有新 Foundation 变化。

### 本轮测试与实书结果

- CLOSURE Python：**375 passed, 2 skipped**（外部校准素材未配置，跳过不算 PASS）。
  最后小整理后 adapter/parser/asset repair TARGETED：**38 passed**。JS：**55 passed**。
  adapter、Outline、repair 工具和新增迁移测试 targeted Ruff 通过。
- 真实目录六页逐项对照形成 hash-referenced fixture；只读 audit 对当前 live 数据通过：
  **25章/84节/75章内附项/15前后项，199页目标**。前置目标与原 PDF 书签独立核对；
  页目标核对不等于每个 OCR 字符正确。附录 PDF338/340/350，参考文献354，后记356–362。
- 29页真实样本 R2 E2E **PASS，29/29 READY/OCR**：正文拖选复制、精确 `6.2.1`、右键文字操作、
  native selection 透明 + 自绘0.2 alpha、reload persisted geometry。初次 reload 等待曾超时；
  增加失败截图/page-error 诊断后重跑通过，未声称该次超时已找到确定根因。
- R1 Reader 最终 **PASS，DPR2.5**：100/110/125% backing/CSS 比例及像素起点、缩放锚点、
  返回/重开/位置与缩放恢复、重复导入、测试书删除。最初失败不是 PASS：一条
  `margin-inline:auto!important` 覆盖了已有像素对齐，移除该全局覆盖后通过；旧测试书卡点击/
  删除 selector 同步到现有“打开教材 → 继续 PDF”和更多菜单，不放宽断言。原侧栏布局不改。
- Crash recovery **PASS**：2 READY → kill → restart仍2 → 最后29；重做1 batch，最大attempts=2。
- 本轮真实浏览器已验证：Insurance 总览25章、既有25 KP及待核验提示；其他内容15项；
  第三版后记跳到 PDF359并截图核对标题；第二篇/第七章/选择保险公司跳到PDF117；关闭/重开目录。
  最后一段工作中浏览器连接连续两次 `nodeRepl.fetch request failed`，故当前版本 Insurance
  PDF9再次指针复制/reload、348页和412页教材最后一轮点击、后记学习owner提示复核 **未完成**。
  下方旧checkpoint的348页真人路径证据不能冒充本轮重测；本轮仅证实其持久数据未变。
- 当前服务HTTP200。未运行远程AI/Teaching生成（INTENTIONALLY_NOT_RUN：本轮未改provider/
  生成算法，也不能为了验收破坏保留资产）。没有调用独立审计，不声称新review PASS。

### 剩余边界与复核入口

这次修复有通用的布局、身份保护与章内定位规则，但不保证任意教材逐字无误。多栏、跨页、
无编号目录和末尾全部漏检仍需要更多真实语料；启动目录可能因全书标题证据扫描出现数秒延迟。
本轮未引入自动重建旧树：已有书仍受 structural digest guard，需明确离线修复。

建议下一次窄范围 review 仅查：additive migration 身份/owner/资产隔离、证据定位与物理范围、
needs-review 投影；用户重测 PDF9目录、选择保险公司PDF117、其他内容以及旧学习记录。
剩余浏览器复核需工具恢复，不应因此宣布完成大规模材料验收。

cross-page continuous selection = **required but deferred**；geometry.js live single conversion
authority = **non-blocking P2 deferred**。缺少约700页真实扫描样本：
`FULL_REAL_MATERIAL_ACCEPTANCE_PENDING = true`。

复现：`python -m pytest -o addopts='' -q`、`npm test`；`READER_REAL_PDF` 指向下方hash的29页样本后
运行 `npm run test:e2e` / `test:e2e:r2` / `test:e2e:recovery`。
`tools/audit_insurance_directory.py <repair-report.json>` 使用 `tests/fixtures/insurance_toc_pages.json`。
`tools/repair_book_evidence.py --help` 提供 dry-run、明确资产保留模式和备份参数；report/candidates
含用户材料只能留在忽略的本地目录，工具不再额外导出完整调试数据库。
本次实现 checkpoint hash 见交付消息；用户复核与独立 review 不随 git commit 自动通过。

## Previous checkpoint evidence — 2026-09-18–19 (superseded where noted above)

### Result

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
