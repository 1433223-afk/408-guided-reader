# Desktop 0.4.11 发布记录

日期：2026-10-12

状态：HTTPS_PUBLISHED / INSTALLED_UPDATE_USER_ACCEPTANCE_PENDING

- 已验收主线基线：`88315a0c632ae6148e8281035bcc3e572b3778c3`，包含阅读显示/可编辑缩放、竖屏阅读布局及框选 UI 收口。
- Desktop 集成 checkpoint：`7df8efe01f55ad0f55343063b9d604ceb27582b4`，正常合入上述 main，保留四模型/API 来源、Windows 凭据、加密 PDF 和 Tauri/Core 生命周期。唯一冲突为静态资源清单，保留 AI 设置与阅读显示入口。
- Desktop 另补纸色/竖屏偏好的跨动态端口持久化，保存在数据目录非秘密 `reading-display.json`；这项平台整合处理在 desktop-spike，本次 main 文档提交不声称已合入其实现。
- Desktop 定向验证：65 个不同 Python 用例、40 个不同 JS 用例通过；真实教材隔离阅读显示和竖屏 smoke 通过，不调用 AI。最终重新构建 Core、Tauri、NSIS、签名/manifest/SHA256，Core 跨端口重启偏好恢复及全部 PDF 配套资源核对通过。
- HTTPS updater manifest：`https://beta.408reader.xyz/desktop/latest.json`，当前版本 **0.4.11**。
- Windows installer：`https://reader408-desktop-staging-hk.oss-accelerate.aliyuncs.com/desktop/0.4.11/408-Guided-Reader_0.4.11_x64-setup.exe`。
- Installer 大小 101352411 bytes；SHA256 `8d49588b791975a3464a9c88962173715e64fe888ac8cb28ef9c193298c993ad`。公网完整 HTTPS 下载 200（本次约 7.93 秒），Range 206（1024 bytes），签名/校验和与本地一致；本地独立 minisign 验证通过。
- Local / server / public manifest SHA256：`8a232c46d7f6d3e2f257d7b74611e619cc963208d536e10ac0bc0ab9ab0de5fd`。
- 仅通过 admin SSH 更新 beta manifest，旧 0.4.10 清单备份至 `/var/www/desktop/latest.json.bak-pre-0.4.11-20261012`。服务器其他功能未改，签名私钥只在本机；OSS 只公开 installer、signature、SHA256SUMS 三个对象，latest.json 和匿名 Bucket listing 返回 403。
- 已请用户从原安装版执行真实 HTTPS 更新，并确认版本、数据/配置保留、阅读显示、竖屏及重启偏好。人工结果尚未返回，不记录为 updater E2E PASS。没有使用 Computer Use 或 remote debugging。

本次只将对应已提交的主线代码及此公开发布记录同步 GitHub；`website/`、用户数据、日志、密钥和安装包不进入提交。不改写历史或移动 milestone tag。
