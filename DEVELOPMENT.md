# Daily Work Log 开发与调试

## 环境要求

- Node.js 20+
- Python 3 + `openpyxl`（`pip install openpyxl`）
- VS Code / Cursor 1.85+

## 首次安装

```bash
yarn install            # 推荐；含 web 需再执行 npm --prefix web install
# 或: npm run install:all
npm run compile         # 首次编译
```

## 调试方式（推荐）

### 方式一：F5 启动扩展宿主（最常用）

1. 在本仓库根目录打开 VS Code / Cursor
2. 运行任务或按 **F5**，选择 **Run Extension**
3. 会打开新的 **Extension Development Host** 窗口
4. 在新窗口侧边栏点击 **工作日志** 图标，或命令面板执行 `打开每日工作日报`

本仓库已配置 [`.vscode/launch.json`](./.vscode/launch.json)：

- `preLaunchTask` 会先执行 `npm run compile`（esbuild + webview vite）
- `extensionDevelopmentPath` 指向本仓库根目录

### 方式二：Watch 热更新

开两个终端：

```bash
# 终端 1：Host 代码变更自动编译
npm run watch

# 终端 2：Webview UI 变更自动编译
npm run watch:webview
```

修改 Host 代码后，在 Extension Development Host 窗口按 **Cmd+R** 重载窗口。  
修改 Webview 后，同样需要重载 Webview 或整个扩展宿主窗口。

### 方式三：安装 VSIX 验证发布包

```bash
npm run package
# 在 VS Code 中：扩展 → ... → 从 VSIX 安装 → 选择 artifacts/daily-work-log-*.vsix
```

## 日志与排错

| 问题 | 查看位置 |
|------|----------|
| Host 逻辑 / Git 采集 / Python 脚本 | **帮助 → 切换开发人员工具**（Extension Development Host）或输出面板 |
| Webview UI / 一键填写 | Extension Development Host 中 **Cmd+Option+I** 打开 Webview 开发者工具 |
| AI 请求 | 输出通道（如有配置）或 Host 控制台 |
| Python 工时表失败 | 通知栏错误信息；终端手动执行见下 |

手动测试 Python 工时表：

```bash
python3 scripts/python/timesheet_generator.py \
  --year 2026 --month 5 \
  --work-log-dir ~/.work-logs \
  --output-dir ~/.work-logs/2026-05 \
  --psp-name 彭聪 \
  --source-fields ailog
```

## 目录说明

| 路径 | 作用 |
|------|------|
| `src/` | Extension Host（esbuild → `dist/extension.js`） |
| `web/src/` | Webview React（Vite → `web/dist/`） |
| `scripts/bash/` | Git 采集 shell 脚本 |
| `scripts/python/` | 工时表 / 交付物 Python 脚本 |
| `scripts/release/` | 版本号与 VSIX 打包（对齐 skill-store） |

## 发布

### 一键发布（推荐）

在本仓库根目录执行：

```bash
yarn release:app              # 默认 patch 升版 → commit → 编译 → VSIX → tag → push
yarn release:app 0.1.2        # 指定版本
yarn release:app minor        # minor 升版
yarn release:app --no-push-tag   # 不推送远程
yarn release:app --force      # 覆盖已存在的同版本 VSIX
yarn release:app --help
```

（亦可用 `npm run release:app`，参数相同。）

产物：`artifacts/daily-work-log-<version>.vsix`

### 分步发布

```bash
npm run release:status   # 查看版本与 VSIX 状态
npm run package          # 仅打包
npm run release:patch    # 升 patch + 编译 + 打包 + commit + tag（要求工作区干净且在 main）
```
