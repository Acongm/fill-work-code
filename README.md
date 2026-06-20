# Daily Work Log

用于管理每日工作日志的 VS Code 扩展：日报表单、Git 采集、AI 润色、月度汇总、工时表与交付物生成、邮件发送。

## 功能

- 日报 Webview 表单（`completed` / `ailog` / `gitlog` 等 JSON 字段）
- 一键 Git 采集 → 按天确认 → 写入 `gitlog` / `gitCommit` / `origin_url`
- 一键 AI 润色 AILog（以 `completed` 为主，禁止幻觉）
- 月度 Markdown 预览、工时表与交付物（固定文件名）
- 材料管理与邮件发送（密钥存 SecretStorage）

## 使用

- 命令面板：`打开每日工作日报`、`查看当月工作汇总`、`打开插件设置`
- 快捷键：`Cmd+Alt+D`（macOS）/ `Ctrl+Alt+D`（Windows/Linux）

## 数据存储

默认 `~/.work-logs/`，按 `YYYY-MM/YYYY-MM-DD.json` 组织。可在 VS Code 设置中改 `dailyWorkLog.storagePath`。

## VS Code 设置（仅 3 项）

| 键 | 说明 |
|----|------|
| `dailyWorkLog.storagePath` | 日志目录（默认 `~/.work-logs`） |
| `dailyWorkLog.autoSave` | 自动保存 |
| `dailyWorkLog.preview.enabled` | Markdown 预览 |

API Key、邮箱等请在 Webview 内 **⚙️ 设置** 中配置。

## 开发与调试

详见 [DEVELOPMENT.md](./DEVELOPMENT.md)。

在本仓库根目录打开 VS Code，按 **F5**（Run Extension）即可启动扩展开发宿主。

```bash
npm run install:all
npm run compile          # 首次或发布前
npm run watch            # Host 热编译
npm run watch:webview    # Webview 热编译
yarn release:app         # 一键升版 + 编译 + VSIX + tag（推荐）
npm run package          # 仅打 VSIX
npm run publish:marketplace  # 编译并发布到 Marketplace（需 VSCE_PAT）
```

## License

MIT
