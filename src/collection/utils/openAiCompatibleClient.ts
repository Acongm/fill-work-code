import * as https from 'https';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAiCompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  extraHeaders?: Record<string, string>;
}

export interface ChatRequestOptions {
  maxTokens?: number;
  temperature?: number;
  responseFormatJson?: boolean;
  thinking?: 'enabled' | 'disabled';
  reasoningEffort?: 'high' | 'max';
  /** 流式请求并实时回调日志行 */
  stream?: boolean;
  /** 流式时把 delta.reasoning_content 按行打到 onLog（前缀 [AI][think]） */
  streamReasoningLog?: boolean;
  onLog?: (line: string) => void;
}

export type ChatResult = {
  content: string;
  reasoningContent?: string;
};

function logLine(onLog: ChatRequestOptions['onLog'], line: string): void {
  onLog?.(line);
}

function truncateBody(body: string, max = 600): string {
  if (body.length <= max) {
    return body;
  }
  return `${body.slice(0, max)}…(${body.length} 字符)`;
}

function logReasoningContent(
  text: string,
  onLog: ChatRequestOptions['onLog'],
  opts: { prefix: string; truncate?: number },
): void {
  const limit = opts.truncate ?? 0;
  const body =
    limit > 0 && text.length > limit
      ? `${text.slice(0, limit)}…(${text.length} 字符)`
      : text;
  for (const line of body.split('\n')) {
    const trimmed = line.trimEnd();
    if (trimmed) {
      logLine(onLog, `${opts.prefix} ${trimmed}`);
    }
  }
}

export class OpenAiCompatibleClient {
  async chat(
    config: OpenAiCompatibleConfig,
    messages: ChatMessage[],
    options: ChatRequestOptions = {},
  ): Promise<ChatResult> {
    const base = config.baseUrl.replace(/\/$/, '');
    const url = `${base}/chat/completions`;
    const onLog = options.onLog;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      ...config.extraHeaders,
    };

    const thinking = options.thinking ?? 'disabled';
    const body: Record<string, unknown> = {
      model: config.model,
      messages,
      max_tokens: options.maxTokens ?? 4096,
      stream: options.stream !== false,
    };

    if (thinking === 'enabled') {
      body.thinking = { type: 'enabled' };
      if (options.reasoningEffort) {
        body.reasoning_effort = options.reasoningEffort;
      }
    } else {
      body.thinking = { type: 'disabled' };
      if (options.temperature !== undefined) {
        body.temperature = options.temperature;
      }
    }

    if (options.responseFormatJson !== false) {
      body.response_format = { type: 'json_object' };
    }

    const bodyStr = JSON.stringify(body);
    logLine(onLog, `[AI] → POST ${url}`);
    logLine(onLog, `[AI] 请求体: ${truncateBody(bodyStr)}`);

    if (body.stream) {
      return this.postStream(url, headers, bodyStr, config.timeoutMs, onLog, {
        streamReasoningLog: options.streamReasoningLog,
      });
    }

    logLine(onLog, '[AI] 等待完整响应（非流式）…');
    const responseText = await this.postJson(url, headers, bodyStr, config.timeoutMs, onLog);
    return this.parseNonStreamResponse(responseText, onLog);
  }

  private parseNonStreamResponse(
    responseText: string,
    onLog?: (line: string) => void,
  ): ChatResult {
    logLine(onLog, `[AI] ← 响应 ${responseText.length} 字符`);
    const parsed = JSON.parse(responseText) as {
      choices?: Array<{
        message?: { content?: string; reasoning_content?: string };
      }>;
      error?: { message?: string };
    };

    if (parsed.error?.message) {
      throw new Error(parsed.error.message);
    }

    const message = parsed.choices?.[0]?.message;
    const content = message?.content;
    if (!content) {
      throw new Error('AI 响应为空');
    }
    if (message?.reasoning_content) {
      logReasoningContent(message.reasoning_content, onLog, {
        prefix: '[AI][think]',
        truncate: 2000,
      });
      logLine(
        onLog,
        `[AI] reasoning 完成，${message.reasoning_content.length} 字符`,
      );
    }
    logLine(onLog, `[AI] content 完成，${content.length} 字符`);
    return {
      content,
      reasoningContent: message?.reasoning_content,
    };
  }

  private postStream(
    url: string,
    headers: Record<string, string>,
    body: string,
    timeoutMs: number,
    onLog?: (line: string) => void,
    streamOpts: { streamReasoningLog?: boolean } = {},
  ): Promise<ChatResult> {
    const streamReasoningLog = streamOpts.streamReasoningLog ?? false;
    return new Promise((resolve, reject) => {
      const started = Date.now();
      let contentAcc = '';
      let reasoningAcc = '';
      let reasoningLineBuf = '';
      let lastProgressLog = 0;
      let chunkCount = 0;
      let buffer = '';
      let statusLogged = false;
      let reasoningStreamStarted = false;

      const flushReasoningLines = (final = false) => {
        if (!streamReasoningLog) {
          return;
        }
        const parts = reasoningLineBuf.split('\n');
        if (!final) {
          reasoningLineBuf = parts.pop() ?? '';
        } else {
          reasoningLineBuf = '';
        }
        for (const part of parts) {
          const line = part.trimEnd();
          if (line) {
            logLine(onLog, `[AI][think] ${line}`);
          }
        }
        if (final && reasoningLineBuf.trim()) {
          logLine(onLog, `[AI][think] ${reasoningLineBuf.trimEnd()}`);
        }
      };

      const appendReasoningDelta = (delta: string) => {
        reasoningAcc += delta;
        if (!streamReasoningLog || !delta) {
          return;
        }
        if (!reasoningStreamStarted) {
          reasoningStreamStarted = true;
          logLine(onLog, '[AI] ── reasoning 流式输出开始 ──');
        }
        reasoningLineBuf += delta;
        flushReasoningLines(false);
      };

      const logProgress = (phase: string) => {
        const now = Date.now();
        if (now - lastProgressLog < 1500) {
          return;
        }
        lastProgressLog = now;
        const elapsed = ((now - started) / 1000).toFixed(1);
        logLine(
          onLog,
          `[AI] 流式 ${phase} | ${elapsed}s | reasoning ${reasoningAcc.length} 字 | content ${contentAcc.length} 字 | chunks ${chunkCount}`,
        );
      };

      const req = https.request(
        url,
        { method: 'POST', headers, timeout: timeoutMs },
        (res) => {
          if (!statusLogged) {
            statusLogged = true;
            logLine(
              onLog,
              `[AI] ← HTTP ${res.statusCode ?? '?'} ${res.headers['content-type'] ?? ''}`,
            );
          }

          res.on('data', (chunk: Buffer) => {
            buffer += chunk.toString('utf-8');
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed === 'data: [DONE]') {
                continue;
              }
              if (!trimmed.startsWith('data:')) {
                continue;
              }
              const jsonStr = trimmed.slice(5).trim();
              if (!jsonStr || jsonStr === '[DONE]') {
                continue;
              }

              try {
                const evt = JSON.parse(jsonStr) as {
                  error?: { message?: string };
                  choices?: Array<{
                    delta?: {
                      content?: string;
                      reasoning_content?: string;
                    };
                  }>;
                };
                if (evt.error?.message) {
                  reject(new Error(evt.error.message));
                  return;
                }
                const delta = evt.choices?.[0]?.delta;
                if (!delta) {
                  continue;
                }
                chunkCount += 1;
                if (delta.reasoning_content) {
                  appendReasoningDelta(delta.reasoning_content);
                  logProgress('reasoning');
                }
                if (delta.content) {
                  contentAcc += delta.content;
                  logProgress('content');
                }
              } catch {
                // 忽略单行解析失败
              }
            }
          });

          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}`));
              return;
            }
            flushReasoningLines(true);
            if (reasoningStreamStarted) {
              logLine(onLog, '[AI] ── reasoning 流式输出结束 ──');
            }
            const elapsed = ((Date.now() - started) / 1000).toFixed(1);
            logLine(
              onLog,
              `[AI] 流式结束 ${elapsed}s | reasoning ${reasoningAcc.length} 字 | content ${contentAcc.length} 字`,
            );
            if (!contentAcc) {
              reject(new Error('AI 流式响应 content 为空'));
              return;
            }
            resolve({
              content: contentAcc,
              reasoningContent: reasoningAcc || undefined,
            });
          });
        },
      );

      req.on('error', (err) => {
        logLine(onLog, `[AI] 网络错误: ${err.message}`);
        reject(err);
      });
      req.on('timeout', () => {
        req.destroy();
        reject(
          new Error(
            `AI 请求超时（${Math.round(timeoutMs / 1000)}s），可在系统设置中增大「请求超时」或关闭 Thinking`,
          ),
        );
      });

      logLine(onLog, '[AI] 已发送请求，等待流式响应…');
      req.write(body);
      req.end();
    });
  }

  private postJson(
    url: string,
    headers: Record<string, string>,
    body: string,
    timeoutMs: number,
    onLog?: (line: string) => void,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      let firstByte = false;

      const req = https.request(
        url,
        { method: 'POST', headers, timeout: timeoutMs },
        (res) => {
          if (!firstByte) {
            firstByte = true;
            logLine(
              onLog,
              `[AI] ← HTTP ${res.statusCode ?? '?'} 首包 ${((Date.now() - started) / 1000).toFixed(1)}s`,
            );
          }
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}: ${data}`));
              return;
            }
            resolve(data);
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(
          new Error(
            `AI 请求超时（${Math.round(timeoutMs / 1000)}s），可在系统设置中增大「请求超时」或关闭 Thinking`,
          ),
        );
      });
      req.write(body);
      req.end();
    });
  }
}
