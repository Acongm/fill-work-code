# AI 配置示例

## 🤖 支持的 AI 提供商

本扩展支持三种 AI 提供商：OpenAI、Anthropic Claude、智谱 AI。

**✨ 智能特性：**
- 🔧 **自动识别**：根据模型名称自动识别提供商和 API 端点
- 📊 **自动调整**：根据模型能力自动设置合理的 token 限制
- 🎯 **枚举配置**：所有选项都通过下拉菜单选择，避免配置错误

---

## 📝 配置说明

在 VS Code 设置中（`Cmd+Shift+P` → `Preferences: Open Settings (UI)`），搜索 "Daily Work Log"：

### 🎯 核心配置（仅需配置这两项）

1. **AI Model**: 从下拉菜单选择模型（会自动设置 provider 和 baseUrl）
2. **AI Api Key**: 输入对应的 API Key

---

## 📋 支持的模型列表

### 1️⃣ OpenAI Models

| 模型名称 | 上下文窗口 | 输出限制 | 推荐场景 |
|---------|-----------|---------|---------|
| `gpt-4o-mini` ⭐ | 128K | 4K | 日常使用，性价比高 |
| `gpt-4o` | 128K | 4K | 复杂任务，能力最强 |
| `gpt-4-turbo` | 128K | 4K | 平衡性能和成本 |

**配置示例：**
```json
{
  "dailyWorkLog.ai.enabled": true,
  "dailyWorkLog.ai.model": "gpt-4o-mini",
  "dailyWorkLog.ai.apiKey": "sk-proj-xxxxxxxxxxxx"
}
```

---

### 2️⃣ Anthropic Claude Models

| 模型名称 | 上下文窗口 | 输出限制 | 推荐场景 |
|---------|-----------|---------|---------|
| `claude-sonnet-4-5` ⭐ | 200K | 8K | Claude 最新最强 |
| `claude-3-5-sonnet-20241022` | 200K | 8K | 高性价比，稳定 |
| `claude-opus-4-20250514` | 200K | 8K | 最强能力，复杂任务 |

**配置示例：**
```json
{
  "dailyWorkLog.ai.enabled": true,
  "dailyWorkLog.ai.model": "claude-sonnet-4-5",
  "dailyWorkLog.ai.apiKey": "sk-ant-api03-xxxxxxxxxxxx"
}
```

---

### 3️⃣ 智谱 AI Models

| 模型名称 | 上下文窗口 | 输出限制 | 推荐场景 |
|---------|-----------|---------|---------|
| `glm-4-flash` ⭐ | 128K | 4K | 快速响应，日常推荐 |
| `glm-4-air` | 128K | 4K | 平衡性能和速度 |
| `glm-4-plus` | 128K | 4K | 能力最强，复杂任务 |

**配置示例：**
```json
{
  "dailyWorkLog.ai.enabled": true,
  "dailyWorkLog.ai.model": "glm-4-flash",
  "dailyWorkLog.ai.apiKey": "6c8089c68e3240219e141dee8033c26e.9M7YSJL8luQOImfM"
}
```

---

## 🔧 自动配置说明

### 📊 Token 限制自动调整

切换模型后，扩展会自动根据模型能力设置合理的 token 限制：

| 模型类型 | 默认日报 | 默认周报 | 默认月报 |
|---------|---------|---------|---------|
| GPT-4o 系列 | 4096 | 4096 | 4096 |
| Claude 系列 | 8192 | 8192 | 8192 |
| GLM-4 系列 | 4096 | 4096 | 4096 |

**自动调整规则：**
- ✅ 超出模型限制会自动降低
- ✅ 过小会自动提升到 800
- ✅ 最大不超过 16384

### 🌐 API 端点自动识别

无需手动配置 `baseUrl`，扩展会根据模型名称自动识别：

```
gpt-4o-mini      → https://api.openai.com/v1
claude-sonnet-4-5 → https://api.anthropic.com/v1
glm-4-flash      → https://open.bigmodel.cn/api/paas/v4
```

---

## 🎯 使用步骤

### 方法 1: 使用 UI 配置（推荐）

1. `Cmd+,` 打开设置
2. 搜索 "Daily Work Log"
3. 在 **AI Model** 下拉菜单中选择模型
4. 在 **AI Api Key** 输入框中粘贴 API Key
5. 勾选 **AI Enabled**

### 方法 2: 使用 JSON 配置

1. `Cmd+Shift+P` → `Preferences: Open User Settings (JSON)`
2. 添加配置：
   ```json
   {
     "dailyWorkLog.ai.enabled": true,
     "dailyWorkLog.ai.model": "gpt-4o-mini",
     "dailyWorkLog.ai.apiKey": "your-api-key"
   }
   ```

3. **重新加载 VS Code**（`Cmd+Shift+P` → `Developer: Reload Window`）
4. 打开工作日志扩展（侧边栏图标）
5. 切换到"汇总"标签
6. 点击 🧠 AI 润色按钮
7. 查看输出日志（`Cmd+Shift+U` → "Daily Work Log - AI"）

---

## 📊 配置日志示例

启动后会在输出面板显示：

```
🔧 AI 配置加载: openai - gpt-4o-mini
   📊 模型上下文: 128K tokens
   🎯 输出限制: 日报=4096, 周报=4096, 月报=4096
   🌐 API: https://api.openai.com/v1
```

---

## 🔄 切换模型

只需修改 `model` 字段即可，其他配置会自动更新：

```json
// 从 OpenAI 切换到 Claude
{
  "dailyWorkLog.ai.model": "claude-sonnet-4-5",  // 只改这里！
  "dailyWorkLog.ai.apiKey": "sk-ant-api03-xxx"   // 更新 API Key
}

// 从 Claude 切换到智谱
{
  "dailyWorkLog.ai.model": "glm-4-flash",        // 只改这里！
  "dailyWorkLog.ai.apiKey": "xxx.xxx"            // 更新 API Key
}
```

扩展会自动：
- ✅ 识别提供商类型
- ✅ 设置正确的 API 端点
- ✅ 调整 token 限制
- ✅ 使用正确的请求格式

---

## 🛠️ 网络问题解决

如果遇到 "fetch failed" 错误：

### macOS 用户
1. 关闭 **iCloud Private Relay**（系统设置 → Apple ID → iCloud → 专用中继）
2. 检查是否有代理软件（ClashX, Surge 等）干扰

### 测试连接
```bash
# 测试 OpenAI
curl -I https://api.openai.com/v1/models

# 测试 Claude
curl -I https://api.anthropic.com/v1/messages

# 测试智谱 AI
curl -I https://open.bigmodel.cn/api/paas/v4/chat/completions
```

---

## 📊 Token 配置建议

扩展会根据模型自动设置合理的 token 限制，通常无需手动调整。

如需自定义，参考以下建议：

| 任务类型 | 保守值 | 推荐值 | 激进值 |
|---------|--------|--------|--------|
| 日报润色 | 2048 | 4096 | 8192 |
| 周报总结 | 2048 | 4096 | 8192 |
| 月报总结 | 4096 | 8192 | 16384 |

**注意：**
- 批量处理（5-7天日报）建议使用 4096-8192
- Claude 模型支持更高的输出 token（默认 8192）
- 如遇截断错误，扩展会自动重试并增加 50% token

---

## 🆘 常见问题

### Q: 我需要配置 provider 和 baseUrl 吗？
A: **不需要！** 只需选择模型和填写 API Key，其他自动配置。

### Q: 如何查看当前配置？
A: 打开输出面板（`Cmd+Shift+U`），选择 "Daily Work Log - AI"，查看启动日志。

### Q: Claude API 一直返回错误？
A: 确保：
- 模型名称从下拉菜单选择（如 `claude-sonnet-4-5`）
- API Key 格式正确（`sk-ant-api03-xxx`）
- 查看输出日志确认 API 端点

### Q: 智谱 AI 显示 "fetch failed"？
A: 检查：
- 网络是否可以访问国内 API
- 关闭 macOS Private Relay（系统设置 → Apple ID → iCloud）
- 查看输出日志中的详细错误信息

### Q: Token 不够用怎么办？
A: 扩展会自动重试并增加 token。也可以手动提高：
```json
{
  "dailyWorkLog.ai.maxDailyTokens": 8192,
  "dailyWorkLog.ai.maxWeeklyTokens": 8192,
  "dailyWorkLog.ai.maxMonthlyTokens": 16384
}
```

### Q: 支持哪些模型？
A: 在 VS Code 设置中，"AI Model" 下拉菜单列出所有支持的模型（共 9 个）。

---

## 📚 API 文档参考

- **OpenAI**: https://platform.openai.com/docs/api-reference
- **Claude**: https://docs.anthropic.com/en/api/messages
- **智谱 AI**: https://open.bigmodel.cn/dev/api

---

## 🎉 快速开始

**最简配置（OpenAI）：**
```json
{
  "dailyWorkLog.ai.enabled": true,
  "dailyWorkLog.ai.model": "gpt-4o-mini",
  "dailyWorkLog.ai.apiKey": "sk-proj-xxx"
}
```

**最简配置（Claude）：**
```json
{
  "dailyWorkLog.ai.enabled": true,
  "dailyWorkLog.ai.model": "claude-sonnet-4-5",
  "dailyWorkLog.ai.apiKey": "sk-ant-api03-xxx"
}
```

**最简配置（智谱）：**
```json
{
  "dailyWorkLog.ai.enabled": true,
  "dailyWorkLog.ai.model": "glm-4-flash",
  "dailyWorkLog.ai.apiKey": "xxx.xxx"
}
```

重新加载 VS Code，即可开始使用！🚀
