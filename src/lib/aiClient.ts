import * as vscode from 'vscode';
import * as https from 'https';

type AiProvider = 'openai' | 'claude' | 'zhipu';

interface AiConfig {
  enabled: boolean;
  provider: AiProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxDailyTokens: number;
  maxWeeklyTokens: number;
  maxMonthlyTokens: number;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ModelMetadata {
  provider: AiProvider;
  maxTokens: number;
  defaultOutputTokens: number;
  baseUrl: string;
}

const MODEL_REGISTRY: Record<string, ModelMetadata> = {
  // OpenAI Models
  'gpt-4o': { provider: 'openai', maxTokens: 128000, defaultOutputTokens: 4096, baseUrl: 'https://api.openai.com/v1' },
  'gpt-4o-mini': { provider: 'openai', maxTokens: 128000, defaultOutputTokens: 4096, baseUrl: 'https://api.openai.com/v1' },
  'gpt-4-turbo': { provider: 'openai', maxTokens: 128000, defaultOutputTokens: 4096, baseUrl: 'https://api.openai.com/v1' },
  
  // Claude Models
  'claude-sonnet-4-5': { provider: 'claude', maxTokens: 200000, defaultOutputTokens: 8192, baseUrl: 'https://api.anthropic.com/v1' },
  'claude-3-5-sonnet-20241022': { provider: 'claude', maxTokens: 200000, defaultOutputTokens: 8192, baseUrl: 'https://api.anthropic.com/v1' },
  'claude-opus-4-20250514': { provider: 'claude', maxTokens: 200000, defaultOutputTokens: 8192, baseUrl: 'https://api.anthropic.com/v1' },
  
  // 智谱 Models
  'glm-4-plus': { provider: 'zhipu', maxTokens: 128000, defaultOutputTokens: 4096, baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  'glm-4-air': { provider: 'zhipu', maxTokens: 128000, defaultOutputTokens: 4096, baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  'glm-4-flash': { provider: 'zhipu', maxTokens: 128000, defaultOutputTokens: 4096, baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  
  // 兼容旧模型名（自动映射）
  'glm-4.5-air': { provider: 'zhipu', maxTokens: 128000, defaultOutputTokens: 4096, baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
};

export class AiClient {
  private config: AiConfig;
  private outputChannel: vscode.OutputChannel;
  private static instance: vscode.OutputChannel | null = null;
  private static readonly MAX_TOKENS_LIMIT = 16384; // 提高到 16K 以支持更强大的模型
  private static readonly DEFAULT_DAILY_TOKENS = 4096;
  private static readonly DEFAULT_WEEKLY_TOKENS = 4096;
  private static readonly DEFAULT_MONTHLY_TOKENS = 4096;
  private modelMetadata: ModelMetadata | null = null;

  constructor() {
    // 单例输出通道
    if (!AiClient.instance) {
      AiClient.instance = vscode.window.createOutputChannel('Daily Work Log - AI');
    }
    this.outputChannel = AiClient.instance;
    
    const config = vscode.workspace.getConfiguration('dailyWorkLog.ai');
    
    // 读取模型名称
    const model = config.get<string>('model') || 'gpt-4o-mini';
    
    // 🔧 根据模型自动识别 provider 和 baseUrl
    this.modelMetadata = MODEL_REGISTRY[model];
    if (!this.modelMetadata) {
      this.log(`⚠️  未识别的模型 ${model}，将使用默认配置`, true);
      this.modelMetadata = {
        provider: config.get<AiProvider>('provider') || 'openai',
        maxTokens: 128000,
        defaultOutputTokens: 4096,
        baseUrl: this.getDefaultBaseUrl(config.get<AiProvider>('provider') || 'openai')
      };
    }
    
    const provider = this.modelMetadata.provider;
    const autoBaseUrl = this.modelMetadata.baseUrl;
    
    // 读取配置并限制最大值（根据模型自动调整）
    const rawDailyTokens = config.get<number>('maxDailyTokens') ?? this.modelMetadata.defaultOutputTokens;
    const rawWeeklyTokens = config.get<number>('maxWeeklyTokens') ?? this.modelMetadata.defaultOutputTokens;
    const rawMonthlyTokens = config.get<number>('maxMonthlyTokens') ?? this.modelMetadata.defaultOutputTokens;
    
    this.config = {
      enabled: config.get<boolean>('enabled') ?? false,
      provider,
      apiKey: config.get<string>('apiKey') || '',
      baseUrl: autoBaseUrl, // 自动根据模型设置
      model,
      timeoutMs: config.get<number>('timeoutMs') ?? 30000,
      maxDailyTokens: this.limitMaxTokens(rawDailyTokens, 'maxDailyTokens'),
      maxWeeklyTokens: this.limitMaxTokens(rawWeeklyTokens, 'maxWeeklyTokens'),
      maxMonthlyTokens: this.limitMaxTokens(rawMonthlyTokens, 'maxMonthlyTokens')
    };
    
    // 显示最终使用的配置
    this.log(`🔧 AI 配置加载: ${this.config.provider} - ${this.config.model}`);
    this.log(`   📊 模型上下文: ${(this.modelMetadata.maxTokens / 1000).toFixed(0)}K tokens`);
    this.log(`   🎯 输出限制: 日报=${this.config.maxDailyTokens}, 周报=${this.config.maxWeeklyTokens}, 月报=${this.config.maxMonthlyTokens}`);
    this.log(`   🌐 API: ${this.config.baseUrl}`);
  }

  private getDefaultBaseUrl(provider: AiProvider): string {
    switch (provider) {
      case 'claude': return 'https://api.anthropic.com/v1';
      case 'zhipu': return 'https://open.bigmodel.cn/api/paas/v4';
      case 'openai':
      default: return 'https://api.openai.com/v1';
    }
  }

  private getDefaultModel(provider: AiProvider): string {
    switch (provider) {
      case 'claude': return 'claude-sonnet-4-5';
      case 'zhipu': return 'glm-4-flash';
      case 'openai':
      default: return 'gpt-4o-mini';
    }
  }

  public getModelInfo(): { provider: AiProvider; model: string; maxTokens: number; defaultOutputTokens: number } {
    return {
      provider: this.config.provider,
      model: this.config.model,
      maxTokens: this.modelMetadata?.maxTokens || 128000,
      defaultOutputTokens: this.modelMetadata?.defaultOutputTokens || 4096
    };
  }

  private limitMaxTokens(value: number, configName: string): number {
    const modelLimit = this.modelMetadata?.defaultOutputTokens || AiClient.MAX_TOKENS_LIMIT;
    const absoluteMax = Math.min(modelLimit, AiClient.MAX_TOKENS_LIMIT);
    
    if (value > absoluteMax) {
      this.log(`⚠️  配置 ${configName}=${value} 超出模型限制（${absoluteMax}），已自动限制`, true);
      vscode.window.showWarningMessage(`AI 配置警告: ${configName} 值过大 (${value})，已限制为 ${absoluteMax}`);
      return absoluteMax;
    }
    if (value < 100) {
      this.log(`⚠️  配置 ${configName}=${value} 过小，已自动设置为 800`, true);
      return 800;
    }
    return value;
  }

  public isEnabled(): boolean {
    return this.config.enabled;
  }

  public validateConfig(): string | null {
    if (!this.config.enabled) {
      return 'AI 功能未启用（dailyWorkLog.ai.enabled=false）';
    }
    if (!this.config.apiKey) {
      return '缺少 dailyWorkLog.ai.apiKey';
    }
    if (!this.config.baseUrl) {
      return '缺少 dailyWorkLog.ai.baseUrl';
    }
    if (!this.config.model) {
      return '缺少 dailyWorkLog.ai.model';
    }
    return null;
  }

  public async chat(messages: ChatMessage[], maxTokens: number, taskName: string = 'AI任务'): Promise<string> {
    const maxRetries = 3;
    let currentMaxTokens = maxTokens;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logInfo(`${taskName} 开始 (尝试 ${attempt}/${maxRetries}, maxTokens: ${currentMaxTokens})`);
        this.outputChannel.show(true); // 显示输出面板
        
        const result = await this._doChat(messages, currentMaxTokens);
        
        this.logSuccess(`${taskName} 完成 (${result.length} 字符)`);
        return result;
        
      } catch (e: any) {
        const errorMsg = e?.message || String(e);
        
        // 检查是否是 length 截断错误
        if (errorMsg.includes('length') || errorMsg.includes('截断')) {
          this.log(`⚠️  ${taskName} 输出被截断，自动增加 maxTokens`);
          
          if (attempt < maxRetries) {
            // 自动增加 50% 的 tokens 并重试
            currentMaxTokens = Math.floor(currentMaxTokens * 1.5);
            this.log(`🔄 将 maxTokens 提升至 ${currentMaxTokens}，准备重试...`);
            await new Promise(resolve => setTimeout(resolve, 1000)); // 等待1秒
            continue;
          }
        }
        
        // 其他错误或已达最大重试次数
        this.logError(`${taskName} 失败: ${errorMsg}`);
        
        if (attempt < maxRetries) {
          this.log(`⏳ 等待 2 秒后重试...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
        
        throw e;
      }
    }
    
    throw new Error(`${taskName} 失败: 已达最大重试次数`);
  }

  private async _doChat(messages: ChatMessage[], maxTokens: number): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    // 🔧 根据 provider 构建不同的请求
    const { url, headers, body } = this.buildRequest(messages, maxTokens);

    this.log(`📤 发送请求: ${url}`);
    this.log(`📤 模型: ${this.config.model} (${messages.length} 消息, maxTokens: ${maxTokens})`);
    const userContent = messages.find(m => m.role === 'user')?.content || '';
    this.log(`📝 用户输入: ${userContent.slice(0, 200)}${userContent.length > 200 ? '...' : ''}`);

    try {
      const startTime = Date.now();
      
      this.log(`🔗 请求 URL: ${url}`);
      this.log(`🔑 请求头: ${JSON.stringify(Object.keys(headers))}`);
      this.log(`📦 请求体大小: ${JSON.stringify(body).length} 字符`);
      
      // 创建自定义 HTTPS Agent，禁用代理以避免 macOS Private Relay/代理软件干扰
      const customAgent = new https.Agent({
        rejectUnauthorized: true,
        keepAlive: false
      });
      
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
        // @ts-ignore - Node.js fetch 支持 agent，但 TypeScript 类型定义可能不完整
        agent: customAgent
      }).catch((fetchError: Error) => {
        // 增强 fetch 错误信息
        this.logError(`Fetch 请求失败: ${fetchError.message}`);
        this.logError(`错误名称: ${fetchError.name}`);
        if (fetchError.cause) {
          this.logError(`错误原因: ${JSON.stringify(fetchError.cause)}`);
        }
        throw new Error(`网络请求失败: ${fetchError.message}。请检查: 1) 网络连接 2) URL 是否正确: ${url} 3) 是否需要代理配置`);
      });

      const elapsed = Date.now() - startTime;
      this.log(`⏱️  响应耗时: ${elapsed}ms, 状态码: ${response.status}`);

      if (!response.ok) {
        const text = await response.text();
        this.logError(`HTTP ${response.status}: ${text.slice(0, 300)}`);
        throw new Error(`AI 请求失败: ${response.status} ${text}`);
      }

      const data = await response.json() as any;
      
      // 🔧 根据 provider 解析不同的响应格式
      const content = this.parseResponse(data);
      
      if (!content) {
        const preview = JSON.stringify(data).slice(0, 500);
        this.logError(`返回内容为空: ${preview}`);
        throw new Error(`AI 返回为空: ${preview}`);
      }
      
      this.log(`📥 收到响应: ${content.length} 字符`);
      this.log(`📄 内容预览: ${content.slice(0, 200)}${content.length > 200 ? '...' : ''}`);
      
      return String(content).trim();
      
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        this.logError(`请求超时 (${this.config.timeoutMs}ms)`);
        throw new Error('AI 请求超时，请稍后重试或增大 dailyWorkLog.ai.timeoutMs');
      }
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildRequest(messages: ChatMessage[], maxTokens: number): { url: string; headers: Record<string, string>; body: any } {
    let url = this.config.baseUrl.replace(/\/$/, '');
    let headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    let body: any;

    switch (this.config.provider) {
      case 'claude':
        // Claude API 格式
        if (!url.includes('/messages')) {
          url = `${url}/messages`;
        }
        headers['x-api-key'] = this.config.apiKey;
        headers['anthropic-version'] = '2023-06-01';
        
        body = {
          model: this.config.model,
          max_tokens: maxTokens,
          messages: messages.filter(m => m.role !== 'system').map(m => ({
            role: m.role,
            content: m.content
          })),
          temperature: 0.3
        };
        
        // Claude 的 system prompt 单独处理
        const systemMsg = messages.find(m => m.role === 'system');
        if (systemMsg) {
          body.system = systemMsg.content;
        }
        break;

      case 'zhipu':
      case 'openai':
      default:
        // OpenAI/智谱 API 格式
        if (!url.includes('/chat/completions')) {
          url = `${url}/chat/completions`;
        }
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
        
        body = {
          model: this.config.model,
          messages,
          max_tokens: maxTokens,
          temperature: 0.3
        };
        
        // OpenAI 特殊处理：强制 JSON 格式
        if (this.config.provider === 'openai') {
          body.response_format = { type: 'json_object' };
        }
        break;
    }

    return { url, headers, body };
  }

  private parseResponse(data: any): string | null {
    switch (this.config.provider) {
      case 'claude':
        // Claude 响应格式: { content: [{ type: 'text', text: '...' }], ... }
        const claudeContent = data?.content;
        if (Array.isArray(claudeContent) && claudeContent.length > 0) {
          const textBlock = claudeContent.find(block => block.type === 'text');
          if (textBlock?.text) {
            this.log(`📊 stop_reason: ${data.stop_reason}`);
            return textBlock.text;
          }
        }
        return null;

      case 'zhipu':
      case 'openai':
      default:
        // OpenAI/智谱 响应格式
        const choice = data?.choices?.[0];
        const finishReason = choice?.finish_reason;
        this.log(`📊 finish_reason: ${finishReason}`);
        
        const content = choice?.message?.content ?? choice?.message?.reasoning_content ?? choice?.text;
        
        if (finishReason === 'length' && !content) {
          throw new Error(`AI 输出被截断（length），需要增加 maxTokens。当前: ${data.max_tokens || 'unknown'}`);
        }
        
        return content;
    }
  }

  public getMaxTokensDaily(): number {
    return this.config.maxDailyTokens;
  }

  public getMaxTokensWeekly(): number {
    return this.config.maxWeeklyTokens;
  }

  public getMaxTokensMonthly(): number {
    return this.config.maxMonthlyTokens;
  }

  private log(message: string, showInUI: boolean = false) {
    const timestamp = new Date().toLocaleTimeString('zh-CN');
    const logMessage = `[${timestamp}] ${message}`;
    this.outputChannel.appendLine(logMessage);
    if (showInUI) {
      this.outputChannel.show(true); // 保持焦点在编辑器
    }
  }

  private logError(message: string) {
    this.log(`❌ ${message}`, true);
  }

  private logSuccess(message: string) {
    this.log(`✅ ${message}`, false);
  }

  private logInfo(message: string) {
    this.log(`ℹ️  ${message}`, false);
  }
}
