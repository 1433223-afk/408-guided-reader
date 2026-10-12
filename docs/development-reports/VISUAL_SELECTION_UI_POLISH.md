# PDF 框选操作 UI 微调

日期：2026-10-08  
状态：USER_MANUAL_ACCEPTANCE_PASS / MAINLINE_CLOSEOUT

2026-10-12 收口确认：下文保留开发时的待验收记录，以本节及末尾核对结果为准。相同框选实现已随 Desktop 0.4.10 完成人工验收并发布，主线此前遗漏验收状态与提交，本轮补齐。

用户已确认上一轮 Desktop 同步验收通过，本轮只优化截图中 PDF 框选状态的视觉。

- 根据用户第二轮反馈，选框改为浅墨绿细边与四角 L 形标记，移除小方块手柄和区域填色；保留原有拖动命中区域。
- 操作条沿用奶油白纸面、细分隔线与轻阴影；主操作为“解释 · Enter”，次操作为“取消 · Esc”，两组快捷键使用相同高度和列宽。
- 没有修改框选坐标、拖动/调整、裁图、Assistant 请求或 Provider 路由。保持 Enter 确认、Esc 取消以及原有滚动定位。
- 相同 HTML/CSS 片段已同步到 Desktop 工作区，保留其余未提交整合改动。

验证：`node --test tests-js/visual-selection.test.js`，16 passed。隔离浏览器组件渲染使用真实教材页面图像及当前 HTML/CSS/框选模块，在 949px、560px 宽度验证操作条边界、选区外定位、键盘确认与按钮取消，结果 PASS，并目检截图。该证据是组件渲染，不能替代完整 Reader 或安装包人工验收。

外部预览与记录：`%TEMP%/408-visual-polish-20261008/`。未调用 AI、未修改用户教材或数据库、未打包发布、未提交 checkpoint。`website/` 未读取或修改。

第二轮设计参考：[CleanShot 区域截图](https://cleanshot.com/screenshots)、[Cropper.js 可调整选区](https://fengyuanchen.github.io/cropperjs/api/cropper-selection.html)。仅借鉴轻量裁图交互的呈现，不引入组件依赖或修改裁图行为。最新组件截图在 `%TEMP%/408-model-history-polish-20261008/`，949px / 560px 目检、确认与取消验证通过。真实 Desktop 预览中 371 页教材正常显示，新选框及角点调整正常；等待用户视觉验收。

人工验收：确认真实 Reader 的选框/角点与操作条视觉可接受，并试拖动、调整、解释、取消。

## 2026-10-12 主线收口核对

- 当前未提交版本还包含选区外的轻量遮罩：只覆盖当前 PDF canvas 的选区外部分，保持选区、其他页面、节末学习区域和工具栏原样；取消后清除遮罩，不修改原 canvas 或裁图数据。
- 本次运行 `visual-selection.test.js` 与 `visual-selection-shade.test.js`，共 17 项通过；模块语法及 diff 空白检查通过。没有运行全量测试，也没有发送 AI 请求。
- 核对 Desktop `d95046e` 与后续 `6731d3b` 的 0.4.10 发布记录，用户已针对这组 L 形角点、快捷键操作条及 9% 选区外遮罩明确验收通过，并在安装更新后确认框选与取消正常。本轮逐字节核对框选模块、遮罩测试与对应 HTML/CSS 片段，主线与已验收桌面实现相同，沿用该验收证据。
- 主线收口只补齐现有改动的提交与文档，不重新设计或扩展框选。网站仍在本次提交范围之外。
