# 408 Guided Reader 2.0 初步产品蓝图

**状态：Draft 0.1**

这份蓝图描述我们目前对 Reader 2.0 的理解。

它不是最终规格，也不是要求一次把所有东西做完。

Reader 2.0 当前最重要的目标，是在现有 Reader 1.x 基础上继续往前走一步：

> 从“AI 帮我读懂教材”，逐渐变成“教材本身就是一个可以阅读、练习、发现问题、回书修复问题的完整学习环境”。

---

# 1. Reader 2.0 不是重写 Reader

现有 Reader 已经有相当完整的基础：

- 原始 PDF 阅读；
- Directory；
- KnowledgePoint；
- Reading Guide；
- Inline Guidance；
- Assistant；
- Master；
- Search；
- 来源跳转；
- 学习状态；
- Learning Memory；
- Desktop Reader。

这些能力继续保留。

Reader 2.0 不应该重新造一套 Reader，也不应该为了加入新功能破坏已经很好用的阅读体验。

Reader 2.0 更像是在现有 Reader 上增加一层新的学习能力。

---

# 2. 永远不变的核心：原 PDF 还是书

Guided Reader 不是 PDF Chat，也不是 AI 重新生成一本教材。

核心关系一直是：

```text
原始教材 PDF
    ↓
用户真正阅读的内容

AI / OCR / KnowledgePoint / Guide / Practice
    ↓
贴在教材周围的学习增强能力
```

因此：

- 原始 PDF 是 source truth；
- PDF 页面始终是主要学习界面；
- OCR 只是机器理解教材的辅助层；
- AI 失败不能影响原书阅读；
- 不把教材重新排版成 HTML；
- 不为了增加功能把 PDF 切碎重新生成一本“AI 教材”。

这条原则在 Practice 中同样成立。

---

# 3. Reader 2.0 当前最重要的新方向

Reader 1.x 主要解决的是：

```text
我正在看什么
↓
这个概念为什么存在
↓
作者这里省略了什么
↓
这句话 / 这个公式是什么意思
↓
我哪里没有理解
```

Reader 2.0 现在准备补上另一个非常重要的学习环节：

```text
阅读
↓
做题
↓
发现自己哪里不会
↓
回到教材修复
↓
重新验证
```

因此，目前 Reader 2.0 第一条真正要做的主线是：

# Interactive Practice Layer

不是另外造一个题库。

而是：

> 让王道教材 PDF 中原本静态的习题，直接变成可以交互的学习内容。

用户仍然看的是王道原 PDF。

只是现在他可以直接在书上做题。

---

# 4. Reader 2.0 的基本工作区

Reader 2.0 逐渐形成三个主要区域：

```text
LEFT                CENTER               RIGHT

Context / State     Original PDF         Intelligence
Navigation
```

也可以更简单地理解成：

```text
左边：我现在在干什么
中间：我正在学什么
右边：帮我理解为什么
```

---

## Left：Context

正常阅读时：

```text
Directory
```

做题时：

```text
Practice
```

未来可能还有少量其他临时状态，但左侧不是再不断增加新面板，而是一个可以切换内容的 Context 区域。

Directory 和 Practice 不应该同时横向占两个栏位。

应该是：

```text
Reading

Directory | PDF | Assistant / Master
```

切换成：

```text
Practice

Practice | PDF | Assistant / Master
```

如果做题过程中临时打开 Directory：

```text
Directory | PDF | Assistant / Master
```

Practice 本身的状态仍然保留。

关闭 Directory 后继续回到 Practice。

现有 Directory 已经基本成熟，因此不因为 Reader 2.0 再重做 Directory。

---

# 5. Center：Original PDF

中间永远是原始教材。

这里承载：

- PDF；
- 原文文字选择；
- Teaching；
- highlight；
- 来源定位；
- 未来 Practice 的题目和选项交互区域。

Practice 不把题目复制到左边，也不把题目重新生成成网页卡片。

题目依旧长在书里。

---

## 一个新的硬规则

当前 Reader 在左右面板同时打开、空间不足时，Directory 有可能进入 Navigation Mode，并让 PDF 暂时消失。

这个行为在普通 Directory 场景里可以存在。

但是：

> **Practice 模式中，PDF 不能消失。**

因为题目本身就在 PDF 上。

所以以后 Practice 激活时，不管左右栏怎样 resize，中间都必须保留原 PDF。

如果空间不足，应该优先压缩左右区域，或者使用合适的最小宽度策略，而不是把 PDF 换掉。

---

# 6. Right：Assistant / Master

右侧继续使用现有的 Assistant / Master。

暂时没有必要为了习题创造新的 Exercise Agent。

## Assistant

Assistant 继续负责：

> “这里是什么意思？”

比如做题时：

- 一个术语没看懂；
- 一个选项不知道什么意思；
- 一个公式不会；
- 一个图不知道在表达什么；
- AI 回答里的某句话又没懂。

用户仍然应该可以：

```text
选中文字
↓
Assistant
↓
直接解释
```

这是现有 Reader 很重要的低摩擦体验。

Practice 不能破坏它。

---

## Master

Master 负责更深的学习问题：

> “为什么我这道题会错？”

例如：

```text
我做错一道题
↓
帮我找出错在哪
↓
Master
↓
结合题目、教材、官方解析和过去学习状态
↓
带我真正弄明白
```

因此：

```text
Assistant = 局部解释

Master = 深度理解 / 复盘
```

Practice 应该复用这套关系，而不是再创造一个新的 AI 角色。

---

# 7. Practice V1 到底是什么

第一版只针对：

> 王道教材中的单项选择题。

暂时不追求通用教材。

也不追求支持所有题型。

第一版最重要的是验证：

> “直接在原 PDF 上刷王道题”到底好不好用。

---

# 8. 一道题的基本体验

例如用户看到王道里的第 4 题。

PDF 原文不变化。

Practice 只在已有 A / B / C / D 文字区域上增加非常轻的交互。

例如用户点击：

```text
C
```

第一次点击：

```text
选中 C
```

但没有立刻提交。

然后：

```text
Enter
```

或者：

```text
再次点击 C
```

提交答案。

这样可以尽量避免在密集的王道习题页里增加大量：

```text
○ A
○ B
○ C
○ D

[提交]
```

这种网页式 UI。

王道习题页本身已经很密，Reader 应该尽量少往书里塞东西。

---

# 9. 判题非常简单

王道本身已经有官方答案。

所以：

```text
用户选择 C
官方答案 B
```

结果就是：

```text
错误
```

不需要 AI 判断。

也就是说：

```text
正确 / 错误
= 程序判断

为什么会错
= AI
```

这样会比让 AI 自己做题然后判断用户答案稳定很多。

---

# 10. 做错后不要急着公布答案

用户提交错误答案以后，可以先看到：

```text
✕ 不正确
```

然后给他几个选择，例如：

```text
再试一次

帮我找出错在哪

查看官方解析
```

而不是系统马上说：

```text
正确答案是 B
```

因为一旦直接公布答案，就失去了继续思考或者让 AI 帮他找到思维漏洞的机会。

这也是 Practice 和普通题库很不一样的地方。

我们的重点不是“刷完”。

而是：

> 做错以后，能不能真正修复这个知识缺口。

---

# 11. Practice Rail

做题时左侧 Directory 切换成 Practice Rail。

它不需要复制完整题目。

完整题目已经在 PDF 里。

左边只显示当前状态。

例如：

```text
04

已选 C

再次点 C 确认
Enter 提交

给我一个提示

04 / 20
```

答错以后：

```text
04

✕ 不正确
你选了 B

再试一次

帮我找出错在哪
查看官方解析

04 / 20
```

答对以后：

```text
04

✓ 正确

带我复盘这道题
查看官方解析
下一题

04 / 20
```

这些现在都只是方向。

最终文字、间距、视觉效果需要真的做出来以后人工体验。

---

# 12. 做题时 Assistant 必须还能正常工作

这是 Practice 的一个重要特点。

例如用户正在做一道题。

他不是一定要提交以后才能问 AI。

他可能只是：

> “这个选项里的‘补码加法器’是什么意思？”

那么他应该仍然可以直接选中那几个字：

```text
选中
↓
Assistant
↓
解释
```

这时候 Assistant 不应该知道正确答案。

它只是解释用户选中的内容。

所以 Practice overlay 不能把 PDF 的正常文字选择能力全部挡住。

---

# 13. Solve 和 Review 必须分开

这是 Practice 一个非常重要的原则。

## 还没有提交

AI 可以知道：

- 题目；
- 选项；
- 图片；
- 表格；
- 当前教材；
- 当前 Section；
- 相关正文；
- 用户自己的思路。

但：

> 不应该拿到官方答案和官方解析。

用户点击：

```text
给我一个提示
```

也是在这个状态下。

否则模型很容易不小心泄题。

所以最稳的方法不是：

> prompt 里写“不要告诉用户答案”。

而是：

> 提交以前根本不给模型答案数据。

---

## 已经提交

这时候进入 Review。

Master 可以看到：

- 题目；
- 用户选择；
- 是否正确；
- 官方答案；
- 官方解析；
- 相关教材正文；
- 相关 KP；
- 用户以前的问题；
- 后续的 Practice history。

于是才能真正做：

```text
帮我找出错在哪
```

或者：

```text
带我复盘这道题
```

这也是 Practice 以后最可能进一步发展出更强 AI 教学能力的地方。

---

# 14. Question 和 Answer 是一对真正的教材结构

王道有一个现在普通 PDF 阅读器很难利用的优势：

> 题目和官方答案都已经存在。

所以未来系统里，一道 Exercise 应该知道自己的官方 Answer 在哪里。

效果例如：

题目页面：

```text
查看官方解析 →
```

答案页面：

```text
← 返回第 04 题
```

即使完全不使用 AI，这个功能本身就已经有明显价值。

以后 AI Review 也可以直接使用对应官方答案，而不是自己重新猜答案。

---

# 15. 图表题不要只相信 OCR

计算机组成原理里很多题有：

- 电路图；
- 数据通路；
- 表格；
- 时序图；
- 公式；
- 特殊排版。

因此以后 AI 看一道题时，不应该只拿 OCR 文本。

更合理的是同时给：

```text
题目截图
选项截图
相关图表截图
OCR 文本
教材位置
```

OCR 是辅助。

PDF crop 本身也是重要信息。

用户不需要自己截图。

Reader 可以自动完成这些事情。

这部分不要求第一版 prototype 一次全部做完。

---

# 16. 做过一道题，不代表系统已经“理解”用户

未来需要区分几种东西。

## Attempt

一次真实作答。

例如：

```text
第一次
B
错误

第二次
C
正确
```

## Practice History

客观发生过什么：

```text
选了什么
什么时候做
是否正确
用了几次提示
有没有进入复盘
```

## Learning Memory

真正值得以后回看的学习内容。

不是每道题都保存。

只有例如：

- 真的开过 Master 深度复盘；
- 用户明确保存；
- 形成了值得保留的学习总结；

才进入习题学习记录。

所以：

```text
做过一道题
≠
生成一条 Learning Memory
```



---

# 17. 一道题也不能自动改变 KP 学习状态

这一点继续保持克制。

```text
一道题答对
≠
这个 KP 已经完全掌握

一道题答错
≠
这个 KP 完全不会
```

题目只能提供新的学习证据。

以后如果系统发现：

```text
同一个知识点
连续多道题出现类似错误
+
Master 复盘也发现类似误区
```

可以提示用户：

> 最近几次练习都说明这里可能还不够稳，要不要回去复习？

但不能偷偷改变用户长期的 mastery 状态。

---

# 18. Reader 2.0 当前不准备做什么

当前阶段不要把 Practice 膨胀成一个完整在线题库系统。

暂时不做：

- 通用所有教材；
- 多选题；
- 填空；
- 判断；
- 主观题自动评分；
- 自动生成完整错因体系；
- 完整 Practice dashboard；
- 自动修改 KP mastery；
- 所有做过的题都保存到 Learning Memory；
- 新建 ExerciseAgent；
- 通用 Agent runtime；
- 为了未来可能支持的东西提前设计大量抽象。



---

# 19. Reader 2.0 第一阶段应该怎么做

我们不准备先把完整系统设计出来。

正确顺序更像：

```text
先找 10–20 道真实王道题

↓

人工标定题目和选项区域

↓

在真实 PDF 上能点击选项

↓

可以提交

↓

程序判断对错

↓

左边出现 Practice 状态

↓

右边 Assistant 仍然可以正常使用

↓

能跳官方解析

↓

选一两道题接 Master Review

↓

人工实际刷一遍
```

然后再看：

> 好不好用？

如果不好：

直接改。

如果好：

再逐渐把临时实现做成正式能力。

---

# 20. Prototype 阶段允许“临时但好用”

现在没有必要一开始解决：

> 系统怎样自动识别王道全部习题？

10–20 题 demo 完全可以：

- 人工指定题目区域；
- 人工指定 A/B/C/D；
- 人工填写正确答案；
- 人工指定答案页。

目的不是证明我们的 extractor 已经成熟。

目的是尽快回答：

> “在原 PDF 上这样做题，实际体验到底值不值得？”

如果这个体验本身不好，提前花大量时间做自动 extractor 没有意义。

---

# 21. Resizable Workspace

Reader 2.0 希望三栏可以自由调整：

```text
Left ║ PDF ║ Right
```

右侧当前已经有 resize 基础。

左侧以后也应该可以拖。

但不急着一次把所有尺寸规则做成复杂布局系统。

现阶段重点只有几个：

- 用户可以调整左侧大小；
- 用户可以调整右侧大小；
- 中央 PDF 一直可用；
- resize 不要偷偷改变固定 PDF zoom；
- Practice 状态下不能因为空间不足把 PDF 隐藏。

具体最舒服的宽度，可以等我们实际使用以后慢慢调。

---

# 22. 开发方式

Reader 2.0 接下来仍然采用比较直接的开发方式。

不是：

```text
先写完整 specification
↓
设计完整数据库
↓
设计所有异常状态
↓
跑所有测试
↓
最后才看到 UI
```

而是：

```text
定清楚方向
↓
快速看现有代码
↓
做最小实现
↓
跑必要的基本测试
↓
人工打开真实 Reader
↓
实际使用
↓
修改
```

尤其是 Practice 这种强交互功能：

> 人工体验比提前设计大量规则更重要。

---

# 23. 测试和验收原则

Codex 完成一个 prototype 或改动后，不默认运行整个项目的全量测试。

一般只需要：

- 与这次改动直接相关的测试；
- 必要的基本 build / type / syntax 检查；
- 一两个关键路径 smoke test。

确认没有明显基础错误后就停。

然后：

> **由我们自己进行真实人工验收。**

例如 Practice prototype 真正重要的验收不是“跑了几百个测试”。

而是我们亲自打开 Reader，看：

```text
左右面板同时打开舒服吗？

PDF 有没有被挤坏？

点选项自然吗？

第二次点击提交舒服吗？

Enter 好不好用？

Assistant 还能不能随手解释？

做完一道题以后下一步自然吗？

我真的愿不愿意用它连续刷十道题？
```

人工体验发现问题以后再改。

只有涉及真正底层、影响范围很大的变化，或者基础测试发现异常时，才有必要扩大自动测试范围。

---

# 24. 旧 Blueprint 和 Reader 2.0 的关系

旧 Product Blueprint 曾经把：

- auto-scoring；
- wrong-question flow；
- Practice Progress；
- per-question KP mapping；

等能力放在 deferred。

这在过去是合理的。

现在产品方向发生了变化，Practice 被主动重新打开。

因此：

> 这些东西不再因为旧 Blueprint 的 deferred 就天然禁止。

但也不是一次全部重新开放。

Reader 2.0 第一阶段真正重新打开的是：

```text
原书单选题交互
deterministic scoring
基础 wrong-answer flow
官方答案连接
AI Practice Review
```

Practice Progress、完整 KP mapping 等更大的系统，等 prototype 之后再决定。

---

# 25. Reader 2.0 当前最重要的问题

现在不是：

> 我们应该使用哪个 Agent framework？

也不是：

> Exercise 数据库最终应该有多少张表？

而是：

> **当一个学生正在用王道学习时，我们能不能让“读书 → 做题 → 发现不会 → 回书修复”这条过程明显比现在方便？**

如果答案是可以，那么 Reader 2.0 就值得继续做。

后面的架构应该服务这个体验，而不是反过来。