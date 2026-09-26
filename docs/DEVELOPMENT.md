# 开发入口

## 本地运行

需要 Python 3.11+、Node.js 20+ 和 Chrome 或 Edge。在仓库根目录执行：

~~~powershell
python -m pip install -e .
npm ci
python -m reader_service
~~~

本机服务默认只监听 127.0.0.1:8765。Python 入口和服务在 src/reader_service/；网页在 src/reader_service/static/，运行时依赖仓库根目录的 node_modules。测试分别在 tests/、tests-js/、tests-e2e/。pyproject.toml 和 package.json 是依赖与命令入口。

默认数据放在 Windows 用户的 LOCALAPPDATA/408 Guided Reader；开发时可用 --data-dir 指向独立目录。不要把 PDF、数据库、备份、截图、日志或密钥提交到 Git。模型配置项见 .env.example；正常 Windows 使用通过凭据管理器保存密钥，.env.example 不应填真实值。

## 做改动

- 先看当前代码和用户的实际问题。原 PDF 是阅读与来源依据；OCR、知识点、教学内容和学习记录各有自己的持久化边界。涉及身份、数据迁移、原文锚点、学习状态或模型出站时，把验证放在真正产生副作用的位置。
- 本地小修直接复现、最小修改、定向验证。重大能力或架构选择再调查成熟方案；避免提前做通用框架、过度工程化和没有具体风险的防御性分支。
- 新的交互能力优先做可用的短路径，在真实教材中试用。默认跑相关测试和必要的浏览器 smoke，由人实际验收体验；不因每次小改动自动跑全量套件。测试通过不能替代真实使用，也不能把未跑或失败的检查写成通过。
- 当前项目的 OpenRouter 调用只允许 google/gemini-3.8-flash；native DeepSeek 的 deepseek-flash 也已获授权。其他模型、自动回退和旧配置中的模型名都不构成调用许可。每次真实调用前核对最终解析出的 provider/model；需要例外先由用户明确批准。
- Git 操作先检查工作区，保留用户现有改动。不要擅自 reset、clean、rebase、强推或改写历史；密钥和用户教材始终留在仓库外。

朋友内测服务端方案尚未实施。若以后继续，先重新确认范围；Windows 本地版不能因此退化，多人数据和密钥必须隔离，并单独验证登录、安全、备份与恢复。

新对话接手一项较大的开发任务时，先读 AGENTS.md、docs/PRODUCT.md 和本文，再按任务查看相关代码。连续的小任务、同一问题的修复与验收沿用当前上下文，不重复做完整冷启动，也不默认翻旧阶段资料。
