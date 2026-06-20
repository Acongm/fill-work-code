# Daily Work Log — 开发结构说明

> 架构对齐 `skill-store-ide-plugin`：Host（`src/`）+ Webview（`web/`）双轨，esbuild + Vite 构建。

## 目录

```
fill-work-code/
├── src/                    # Extension Host
│   ├── extension.ts        # activate / 命令注册
│   ├── panels/
│   │   └── ChatViewProvider.ts   # Webview 提供方 + 消息路由
│   ├── services/           # Git 采集、AI 润色、工时表 runner 等
│   ├── lib/                # 存储、邮件、月报等
│   └── features/settings/  # 插件设置类型
├── web/                    # React Webview（Vite → web/dist/）
│   └── src/
│       ├── App.tsx
│       └── pages/          # fill-review、settings 等
├── scripts/
│   ├── bash/               # Git 证据采集
│   ├── python/             # 工时表、交付物
│   ├── generate-evidence.mjs
│   └── release/            # 版本与 VSIX 打包
├── dist/extension.js       # esbuild 产物（package.json main）
├── esbuild.mjs
├── lerna.json
└── artifacts/              # daily-work-log-<version>.vsix
```

## 消息流

1. 用户打开侧边栏 **Work Log** → `ChatViewProvider` 创建 Webview
2. Webview 加载 `web/dist/assets/index.js` + `index.css`
3. `postMessage` 双向：`App.tsx` ↔ `ChatViewProvider`（加载日报、保存、Git、AI、工时表等）

## 构建

| 命令 | 输出 |
|------|------|
| `node esbuild.mjs` | `dist/extension.js` |
| `npm --prefix web run build` | `web/dist/` |
| `npm run package` | `artifacts/daily-work-log-*.vsix` |

VSIX 内包含：`dist/`、`web/dist/`、`scripts/`（不含 `web/node_modules`）。

## 调试

见 [DEVELOPMENT.md](./DEVELOPMENT.md)。本仓库 `.vscode/launch.json` 的 `extensionDevelopmentPath` 指向仓库根目录。

## 已废弃（勿再使用）

以下路径已删除，文档中若仍出现请忽略：

- 根目录 `extension.ts`、`providers/`、`lib/`、`commands/`、`webview-ui/`
- `webpack.config.js`
- `scripts/timesheet_generator.py`（请用 `scripts/python/timesheet_generator.py`）
