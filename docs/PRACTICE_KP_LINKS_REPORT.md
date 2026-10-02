# Practice → KP 自动关联（2026-10-02）

状态：首轮及书库级 Exercise → KP best-effort 关联均已通过人工验收。定向测试与真实浏览器 smoke 结果见后续记录。基线 `main / 0a48dc6`；本次收口创建独立 checkpoint，不同步桌面安装版。

## 行为

- 进入做题模式立即显示原题，随后独立请求后台关联当前习题节。没有匹配进度、失败提示或空白占位。
- 候选来自当前教材、当前已发布版本的 KP，优先限所属 Section；章节级习题限所属 Chapter。来源待复核的 KP 不参与。
- 一次批量发送当前节缺少结果的题干、选项和候选 KP 标题/摘要。使用现有 DeepSeek / 智谱快速调用，只能返回一个真实候选 ID 或 `null`，不发送官方答案/解析。
- 成功和明确 `null` 都保存复用；调用失败、非法候选、格式错误或漏题不写成 `null`，下次进入可重试。没有候选时直接保存 `null`，不调用模型。
- 按题源、候选集和目录范围校验缓存；新 KP、重新生成或来源变化后失效。写入前再检查，防止旧任务写回。新增表为迁移 25，自动关系不计作用户学习资产，不会阻止重新生成 KP。
- 后台按节串行处理并去重；读取题目时只解析当前习题及答案区间的 OCR，默认原有题库行为不变。

## 界面与状态

左侧只在匹配成功时出现「回到教材 / 真实 KP 名称 →」文字入口，沿用现有纸张、字体和绿色。使用已有 KP 原文定位，复用「返回题目」；选择、判题结果、Hint 和 Master 复盘状态保留。阅读教材期间 Enter 不会提交题目。

不新增 KP、不写 mastery、不改变官方答案判题，不做多 KP 推荐或全书预计算。模型语义匹配仍是 best-effort，不承诺覆盖率或逐题绝对正确。

## 验证

- Python 定向组：`tests/test_practice_knowledge.py`、`tests/test_practice_catalog.py`、`tests/test_practice_hint.py`、`tests/test_knowledge_map.py`，筛选 `practice or regeneration or durable_kp_reference`，32 passed / 52 deselected。
- JS：`practice-knowledge.test.js` 与 `practice-fixture-regions.test.js`，9 passed；覆盖请求未返回时立即可用、失败静默、换书/退出后丢弃晚响应、教材往返保留答案/Hint/复盘状态、既有跨页来源。
- 真实 smoke 初次揭示 DS/Z 不接受既有运行时的 `json_object=True` 参数，出站前即被拒绝；已删除不兼容参数，保留提示词约束和严格 JSON 校验，并补真实 Runtime → mock adapter 的 DS/Z 边界测试。初次本地请求不是模型超时，也没有实际出站。
- 真实 Edge 浏览器使用正式书库静态备份的隔离副本。网络 1.1.7 共 16 道可用题、6 个真实候选；DeepSeek `deepseek-flash` 一次出站、首轮 2.02 秒完成。第 01 题关联「计算机网络与互连网的概念」，第 02 题关联「计算机网络的功能」。本次模型将该节 16 道题全部匹配；这不是强制覆盖规则或逐题人工准确性结论。
- 网络 2.1.4 所在第二章没有已发布 KP，26 道可用题保存 `null`，没有模型调用；无入口、无占位，仍可选择作答。没有人为改动模型结果制造未匹配样例。
- 浏览器故意暂缓匹配 POST 时仍可打开 Practice 并选择 A；真实匹配后的题目→教材→原题保留未提交选择，以及提交后的结果/次数。退出重进直接复用持久结果，零新增出站；1440 / 900 像素入口未越界或遮挡 PDF。

验收副本与截图：`D:\408-reader-practice-kp-20261002`；`smoke-result.json` 记录结果，`model-calls-first-success.jsonl` 保留首次真实出站与耗时，后续截图复跑读取缓存。可复跑脚本为 `tests-e2e/practice-knowledge.mjs`，配套安全诊断启动器为 `tests-e2e/practice-knowledge-server.py`，需要传入 `READER_DATA_DIR` 和仓库外的 `READER_OUTPUT_DIR`。

仅运行相关定向测试和隔离真实教材浏览器 smoke，未跑全量测试。正式书库、凭据、PDF 不修改；截图、模型诊断和测试数据库在仓库外。既有未跟踪 `website/` 保留。

## 书库级适用范围（2026-10-02，人工验收通过）

首轮已人工验收；本轮沿用同一 matcher、后台触发、缓存和 Paper 入口，不重写关联机制。

检查确认触发、候选、结果和请求去重均按实际 revision / 目录祖先 / 习题节工作，不限定书名、测试 UUID、章节编号或候选数量。`126` / `524` 是既有题库身份兼容别名；旧 fixture 仍由原 PDF 摘要限定，保留它们以维护已有作答身份。关联缓存同时包含 revision，不会串书。

发现并修正一处实际限制：全书 OCR `foundation_version` 更新会使关联模块排除仍处于 READY 的已发布 Knowledge Map。当前按 KP 与其章节发布版本内部一致性取候选，不再要求等于全书最新 OCR 版本；同一原书、当前发布结构、章节身份/位置版本和来源待复核校验仍保留。候选新增自然使旧 null 缓存失效，保存前仍复算输入摘要。

当前真实 Desktop 书库只读盘点（不是新生成或全书预匹配）：

| 教材 | 可用习题节 / 题数 | 已发布且版本内部一致的 KP | 有候选的习题节 |
| --- | --- | --- | --- |
| 计算机网络 | 28 / 476 | 13 | 2 |
| 数据结构 | 30 / 484 | 80 | 10 |
| 计算机组成原理 | 27 / 607 | 292 | 27（修正前为 2） |
| 操作系统 | 9 / 318 | 0 | 0 |

候选仍限所属 Section；真正章节级习题才使用所属章。没有跨书或跨章搜罗候选。操作系统缺少 KP，网络/数据结构也有未建图章节，本轮不补生成；这些节照常 Practice，无「回到教材」入口。

定向测试：`pytest -o addopts='' -q tests/test_practice_knowledge.py tests/test_practice_catalog.py` 共 33 passed；`node --test tests-js/practice-knowledge.test.js tests-js/practice-fixture-regions.test.js` 共 9 passed。新增覆盖任意导入书/章节身份、两本书共享旧别名与题号时的缓存隔离、排除其他章，以及全书 OCR 版本增长和发布内部不一致的区别。

当前书库通过 SQLite backup API 和 PDF 副本隔离到 `D:\408-reader-practice-kp-library-20261002\data`；只在副本进行浏览器 smoke 和实际模型调用。

### 真实浏览器结果

| 教材 / 习题节 | 关联 / 无关联 | 实际批量出站 | 模型耗时 |
| --- | --- | --- | --- |
| 网络 1.2.4 | 36 / 0 | 1 | 4.53 秒 |
| 网络 2.1.4（无 KP） | 0 / 26 | 0 | — |
| 数据结构 4.2.4 | 12 / 0 | 1 | 1.51 秒 |
| 数据结构 5.1.4（无 KP） | 0 / 9 | 0 | — |
| 组成原理 6.1.6 | 27 / 1 | 1 | 3.26 秒 |
| 组成原理 5.2.4（此前被全书版本误排除） | 12 / 3 | 1 | 1.57 秒 |
| 操作系统 1.1.4（无 KP） | 0 / 14 | 0 | — |

最终 7 case 全部 PASS；唯一真实 Provider/model 为 DeepSeek `deepseek-flash`，共 4 次实际 transport，无重试、无全书预匹配。每节重入零新增模型调用，正结果和 null 均复用。上表是本次真实模型结果，不是准确率或全书覆盖承诺。

- 1440 / 900 像素检查各实际已匹配结果中最长/最短标题，人工看截图未见入口溢出或与箭头/PDF 重叠；组成原理第 13 题「指令执行方案：单周期、多周期与流水线处理器」自然换成两行。
- 每个有匹配案例都实际点击回教材并返回原题，保留未提交选择与提交后的结果/次数。匹配 POST 故意延迟时，普通作答仍可先进行。
- 组成原理 5.2.4 第 02 题（DMA）和 6.1.6 第 11 题为真实模型 null；无入口、无占位，照常可选。没有人为修改模型结果来制造未匹配样例。网络/数据结构/操作系统的无候选节也完成相同 UI 检查。
- 通用 smoke 接受 `PRACTICE_KNOWLEDGE_MANIFEST` 中的 `{cases:[{name,revision,section,expect}]}`，按实际书库找到教材，不再依靠网络书的固定页数/首题。最初脚本在文字交互层未就绪时点击、以及书库初次渲染未完成时读取，发生时序失败且零模型出站；加上相应 UI 就绪等待后，完整 7 case 通过。没有把这些失败记成通过。

证据：`D:\408-reader-practice-kp-library-20261002\smoke-result.json`、`model-calls.jsonl` 及各 case 截图目录。只读盘点与 manifest 在 `D:\408-reader-library-kp-20261002`。验收预览使用同一隔离书库，停在组成原理 5.2.4 第 13 题；第 02 题可查看无关联状态。未运行全量测试；未生成缺失 KP、未修改匹配提示词或 UI 样式、未打包。

### 人工验收收口

用户已明确确认书库级关联人工验收通过。本次仅更新验收状态、检查 diff 与提交范围，不再修改功能或重复运行测试。checkpoint 消息为 `Generalize practice knowledge-point links across books`；提交包含已验收实现、相关测试和文档。PDF、数据库、截图、模型调用记录及预览临时文件均在仓库外；既有未跟踪 `website/` 保留，不纳入 checkpoint。
