/**
 * Webview HTML 模板生成器
 * 
 * 说明：VS Code Webview API 要求扩展端提供 HTML 字符串，
 * 无法像普通 Web 应用直接加载 HTML 文件。
 * 这个模块封装了 HTML 生成逻辑，保持代码整洁。
 */

import * as vscode from 'vscode';

interface WebviewHtmlOptions {
  webview: vscode.Webview;
  extensionUri: vscode.Uri;
  scriptFilename: string;
  title?: string;
}

/**
 * 生成 Webview 的 HTML 内容
 */
export function getWebviewHtml(options: WebviewHtmlOptions): string {
  const { webview, extensionUri, scriptFilename, title = 'Daily Work Log' } = options;

  // 获取脚本 URI
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', scriptFilename)
  );

  // 生成 nonce 用于 CSP
  const nonce = generateNonce();

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' ${webview.cspSource};">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background-color: var(--vscode-sideBar-background);
      height: 100vh;
      overflow: hidden;
    }
    #root { height: 100%; }
  </style>
</head>
<body>
  <div id="root">
    <div style="padding: 20px; text-align: center; color: var(--vscode-descriptionForeground);">
      加载中...
    </div>
  </div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
}

/**
 * 生成随机 nonce 字符串
 */
function generateNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
