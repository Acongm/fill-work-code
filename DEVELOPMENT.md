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
- `timeout: 120000`：扩展宿主启动超时放宽至 120 秒（避免 10 秒误报）
- `stopOnEntry: false`：不在入口断点暂停
- **Run Extension (Skip Build)**：已编译时可跳过 preLaunchTask，启动更快

### 提示「扩展未在 10 秒内启动 / 可能在第一行已停止」

这通常**不是扩展崩溃**，而是调试器在等你在 Extension Host 进程上点「继续」：

1. 切到 **Run and Debug** 面板，确认没有勾选 **Stop on Entry**（入口暂停）
2. 若调试工具栏处于暂停状态，按 **F5（Continue / 继续）** 或点击 ▶️
3. 检查是否在 `dist/extension.js` 或 `extension.ts` 上误设了 **无条件断点**
4. 若仍超时：先终端执行 `npm run compile`，再用 **Run Extension (Skip Build)** 启动
5. macOS 上若日志出现 `Unable to resolve your shell environment`：已在 [`.vscode/settings.json`](./.vscode/settings.json) 将 shell 环境解析超时设为 120 秒；仍慢时可精简 `~/.zshrc` 中阻塞命令（如 `nvm`、耗时 `brew` 等）

Extension Development Host 首次冷启动可能需 15–30 秒（加载 wasm、SQLite 迁移），属正常现象；启动完成后切日应明显快于优化前。

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

### GitHub Actions 自动发布

仓库已配置 CI/CD：

| Workflow | 触发 | 作用 |
|----------|------|------|
| `ci.yml` | push / PR 到 `main` | compile + lint + typecheck |
| `publish-extension.yml` | 推送 tag `v*` 或手动触发 | 发布到 VS Code Marketplace |

**前置条件**：在 GitHub 仓库配置 **`VSCE_PAT`**（Azure DevOps PAT，Scope: Marketplace → Manage）。

> **注意**：GitHub Actions **不会**读取你本机 shell 里的 `export VSCE_PAT=...`，必须在 GitHub 网页配置。

| 配置位置 | Workflow 能否读取 | 推荐 |
|----------|-------------------|------|
| Settings → Actions → **Secrets** | ✅ `secrets.VSCE_PAT` | **推荐** |
| Settings → Actions → **Variables** | ✅ `vars.VSCE_PAT`（workflow 已兜底） | 可用但不推荐 |
| Settings → **Environments** → Secrets | ⚠️ 需在 workflow 加 `environment: <名称>` | 可用 |
| 本机 `~/.zshrc` 环境变量 | ❌ 无效 | — |

Organization 级 Secret 还需在 Org 设置中 **授权给 `fill-work-code` 仓库**。

**一键配置（本地 + GitHub Secret）**：

```bash
./scripts/configure-vsce-pat.sh
# 按提示粘贴 Azure DevOps PAT（不要用占位符 xx）
```

仅写本地 `.env.local`：`./scripts/configure-vsce-pat.sh --local-only`

**推荐发布流程**：

```bash
yarn release:app              # 升版 → commit → VSIX → tag vX.Y.Z → push
# push tag 后 GitHub Actions 自动 vsce publish
```

或手动打 tag：

```bash
# 先确保 package.json / lerna.json 版本一致
git tag v0.1.6
git push origin v0.1.6
```

```bash
npm run release:status   # 查看版本与 VSIX 状态
npm run package          # 仅打包
npm run release:patch    # 升 patch + 编译 + 打包 + commit + tag（要求工作区干净且在 main）
```
