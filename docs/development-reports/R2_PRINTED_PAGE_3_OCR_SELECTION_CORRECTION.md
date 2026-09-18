# R2 印刷第 3 页 OCR 文字不可选问题报告

## 结论

问题已修复并完成真实页面验证。

`2026计算机组成原理`教材印刷第 3 页对应 PDF page index 14（物理第 15 页）。该页一行
正文的 OCR 检测范围正确，但识别结果异常塌缩为 `无·`，导致绝大部分可见文字根本没有
进入 selectable text layer。问题不在 pointer hit-testing，也不在 Reader 的选择边界算法。

修复后，该行恢复为完整文字和 42 个匿名 cell；刷新前后均可精确拖选和复制。原 PDF 阅读
始终可用，既有批注、印刷页码映射及其他 347 页 OCR 数据没有被修改。

当前状态：`RESOLVED`。R2 仍为 `READY_FOR_R2_CLOSURE: YES`；由于缺少约 700 页真实
扫描教材，`FULL_REAL_MATERIAL_ACCEPTANCE_PENDING` 仍为 true。

## 影响范围

- 受影响教材：`2026计算机组成原理`
- revision：`8ed51463-78da-448f-883a-cf26684d902b`
- PDF SHA-256：
  `6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd`
- 用户所指页面：教材印刷页码 3
- 实际 PDF 页面：page index 14，物理第 15 页
- 受影响能力：该行文字的选择、复制及后续基于选择的操作
- 未受影响能力：PDF 渲染、翻页、缩放、阅读位置及其他已准备页面

## 用户现象

印刷第 3 页标题 `1.2.2 计算机硬件` 下方的首段正文存在大面积不可选区域。用户能看到
完整句子，但选择层只覆盖极少文字，因此无法从合理字符边界开始或结束选择。

本次排查过程中曾将“书本第三页”误解为物理 PDF 第 3 页，并先修复了该页纵排文字的 Y 轴
选择。该修复本身有效并保留，但不是本次剩余问题的目标。用户澄清后，排查对象改为印刷页码
3，即 PDF page index 14。

## 复现与证据

目标页持久化的异常 `OCRLine` 为：

```text
pdf_page_index = 14
line_ordinal = 5
quad ≈ x 0.1431–0.8813, y 0.1925–0.2072
text = "无·"
confidence = 0.54085
cells = 2
```

同一检测框在原页面上对应的可见文字为：

```text
冯·诺依曼在研究EDVAC机时提出了“存储程序”的概念，“存储程序”的思想奠定了现代
```

检测框横跨整行，位置和范围正确；错误集中在 recognition 阶段。对该框增加约
`0.75 × line height` 的裁剪边距后，仅重新运行 recognition，稳定得到完整文本、约
`0.997` 置信度和 42 个匿名 cell。

## 根因

RapidOCR 的首次检测已经找到了正确正文行，但紧贴检测框的首次识别在该真实页面上发生了
严重文本塌缩。原 adapter 接受 provider 返回的 `无·`，并忠实发布为两个可选择 cell。

Reader 的选择模型只能在已发布的文本与 cell 上计算边界。由于缺失字符从未进入
`OCRLine.text` 和 `cells_json`，调整 hit-testing、选择 overlay 或视觉样式都无法修复该行。

根因属于“检测正确、识别异常稀疏”的 OCR 质量缺口，而不是：

- PDF 页面映射错误；
- reading order 错误；
- cell 稳定身份不足；
- pointer 到 cell boundary 的映射错误；
- 原生 DOM Range 与自定义 overlay 冲突。

## 修正方案

RapidOCR adapter 增加一次保守的 `sparse-line-retry-v1` 质量重试。重试只在以下
provider-neutral 形态同时出现时触发：

- 行框宽高比至少为 12；
- 初次识别置信度低于 0.85；
- 非空白字符数相对检测框宽度异常稀少。

触发后：

1. 在原检测框四周增加约 `0.75 × line height` 的边距；
2. 对裁剪区域执行 recognition-only，不重新改变检测几何；
3. 仅在新置信度显著提高、达到最低阈值、文本长度合理增加且没有异常超长时接受结果；
4. 将 provider alignment 转换为现有匿名 x cell；alignment 不可用时退化为均匀字符 cell；
5. 任意重试异常或质量门失败都保留初次 OCR 行，不让可选质量重试把页面从 READY 变成
   FAILED。

RapidOCR 字段仍只存在于 adapter 内部。持久化 contract、cell 匿名性、Reader hit-testing
和 selection contract 均未改变。

## 既有页面的数据处置

代码修复只会影响此后准备的页面；目标页此前已经是 READY，因此在服务停止并完成 SQLite
一致性备份后，执行了一次用户明确授权的单页 correction：

- 仅 revision `8ed51463-78da-448f-883a-cf26684d902b`；
- 仅 PDF page index 14；
- revision foundation version：`1 → 2`；
- 新增一条 `page_start = page_end = 14` 的 `REPROCESS` event；
- 页面恢复为 READY，engine profile 记录 `sparse-line-retry-v1`；
- 既有 annotation `ae3162d7-c9f0-403d-a464-e2fb91c09809` 全字段不变；
- 印刷页码 3 的映射不变；
- 其他 347 页的 OCR page/line 快照不变。

这不是通用 correction UI、批量 reprocessing、migration 或 cross-version anchoring 的实现。

## 验证结果

### 校准

从现有 348 页持久化 OCR 中按相同异常形态找到 30 条候选并进行只读裁剪重识别：

- 多条塌缩正文恢复为高置信长文本；
- 大部分公式和图表候选没有通过质量门，保留初次结果；
- 没有批量发布或重处理这些候选页面。

### 自动化

- adapter/Foundation 定向测试：**15 passed**；
- JS 全套：**53/53 passed**；
- Python 全套：**335 passed, 2 skipped**；
- Ruff：**PASS**；
- `git diff --check`：**PASS**。

新增 adapter 回归覆盖：

- 异常稀疏长行触发带边距的 recognition-only 重试；
- 正常行不增加重试成本；
- 重试异常时保留初次结果；
- provider alignment 只转换为匿名 cell；
- 异常超长的重试结果被拒绝。

### 真实页面

在 `http://127.0.0.1:8767/` 使用真实鼠标路径验证：

- 修正后可精确选择并复制 `冯·诺依曼在研究EDVAC`；
- 完整刷新并重新打开教材后，可精确选择并复制
  `提出了“存储程序”的概念`；
- `window.getSelection()`、系统剪贴板和自定义 selection quad 一致；
- 原批注继续正常显示，原 PDF 阅读未被 OCR 重试阻塞。

## 为什么能减少同类问题

修复针对的是可从 provider-neutral 结果识别出的通用异常形态，而不是目标截图或固定中文
句子的特判。以后新准备的页面只要出现“检测框很宽、识别置信度低、文本异常短”的组合，就会
自动获得一次低风险重识别机会。

接受门和 fail-open 设计限制了误修范围：正常正文不支付额外成本，公式/图表不会仅因重试
返回更长文本就被接受，重试故障也不会影响 PDF 阅读或页面原有 OCR 可用性。

## 已知限制与后续边界

- 已经 READY 的其他页面不会被自动批量重处理；本次只修正了用户授权的目标页。
- 高置信但内容错误、检测框本身缺失、复杂公式或图表 OCR 不属于本规则覆盖范围。
- 通用 OCR correction/error-report UI、批量 reprocessing、migration 和 cross-version
  anchoring 仍然 deferred。
- 跨页连续选择仍是 required but deferred。
- `geometry.js` 成为 live single conversion authority 仍是非阻断 P2 deferred。
- 缺少约 700 页真实扫描教材，无法关闭 full-scale sustained preparation/recovery 验收。

## 关联记录

- 主 Development Report：`docs/development-reports/R2_SELECTABLE_BOOK.md`
- 纵排文字选择修复：commit `f14c51971728fbe6fecba41372786ccd38e25deb`
- 本次 OCR 稀疏行修复：commit `8fe1c6d729bd4d2a4772546e675066cd7a40cf8a`

