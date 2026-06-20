import * as vscode from 'vscode';
import * as path from 'path';
import { WorkLogManager, DailyLog } from '../lib/workLogManager';

export function registerCommands(
  context: vscode.ExtensionContext,
  workLogManager: WorkLogManager
) {
  // 打开日报表单
  const openFormCommand = vscode.commands.registerCommand(
    'daily-work-log.openForm',
    () => {
      const today = new Date();
      const todayLog = workLogManager.getTodayLog();
      const yesterdayLog = workLogManager.getYesterdayLog();
      
      const webviewPanel = vscode.window.createWebviewPanel(
        'workLogForm',
        '📋 今日工作日报',
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          enableForms: true,
          localResourceRoots: [
            vscode.Uri.file(path.join(context.extensionPath, 'media'))
          ]
        }
      );

      webviewPanel.webview.html = getWebviewContent();
      webviewPanel.webview.postMessage({
        command: 'updateLog',
        todayLog,
        yesterdayLog
      });

      webviewPanel.webview.onDidReceiveMessage((message) => {
        if (message.command === 'save') {
          try {
            workLogManager.saveDailyLog(today, message.log);
            webviewPanel.webview.postMessage({
              command: 'saved',
              message: '✅ 日志已保存'
            });
            vscode.window.showInformationMessage('✅ 工作日志已保存');
          } catch (e) {
            vscode.window.showErrorMessage(`保存失败: ${e}`);
          }
        }
      });
    }
  );

  // 打开当月日报汇总
  const viewMonthCommand = vscode.commands.registerCommand(
    'daily-work-log.viewMonth',
    async () => {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;

      const summary = workLogManager.getMonthSummary(year, month);
      
      const panel = vscode.window.createWebviewPanel(
        'monthSummary',
        `📊 ${year}年${month}月工作汇总`,
        vscode.ViewColumn.One,
        {
          enableScripts: false
        }
      );

      panel.webview.html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; line-height: 1.6; }
    h1, h2 { color: #333; }
    pre { background: #f5f5f5; padding: 10px; overflow: auto; }
  </style>
</head>
<body>
  <button onclick="copyToClipboard()">📋 复制到剪贴板</button>
  <button onclick="exportMarkdown()">📥 导出 Markdown</button>
  <pre id="content">${summary.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
  <script>
    function copyToClipboard() {
      const text = document.getElementById('content').textContent;
      navigator.clipboard.writeText(text).then(() => {
        alert('已复制到剪贴板');
      });
    }
    function exportMarkdown() {
      const text = document.getElementById('content').textContent;
      const blob = new Blob([text], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'work-summary.md';
      a.click();
    }
  </script>
</body>
</html>`;
    }
  );

  // 打开文件管理器查看存储位置
  const openStorageCommand = vscode.commands.registerCommand(
    'daily-work-log.openStorage',
    () => {
      const storageUri = vscode.Uri.file(
        vscode.workspace.workspaceFolders
          ? path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, '.work-logs')
          : path.join(require('os').homedir(), '.work-logs')
      );
      vscode.commands.executeCommand('revealFileInOS', storageUri);
    }
  );

  const aiGenerateCommand = vscode.commands.registerCommand(
    'daily-work-log.aiGenerateAll',
    () => {
      vscode.window.showInformationMessage('请在侧边栏“汇总”页使用 AI 润色/总结按钮');
    }
  );

  context.subscriptions.push(openFormCommand);
  context.subscriptions.push(viewMonthCommand);
  context.subscriptions.push(openStorageCommand);
  context.subscriptions.push(aiGenerateCommand);
}

function getWebviewContent(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>每日工作日报</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 20px;
      min-height: 100vh;
    }
    .container { 
      max-width: 700px; 
      margin: 0 auto;
      background: white;
      border-radius: 8px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.1);
      padding: 30px;
    }
    h1 { color: #333; margin-bottom: 5px; }
    .date-info { color: #999; font-size: 12px; margin-bottom: 20px; }
    .section { 
      margin-bottom: 25px;
      padding-bottom: 20px;
      border-bottom: 1px solid #eee;
    }
    .section:last-child { border-bottom: none; }
    .section-title { 
      font-weight: 600; 
      color: #333;
      margin-bottom: 12px;
      font-size: 14px;
    }
    .form-group { margin-bottom: 12px; }
    label { 
      display: block; 
      font-size: 12px; 
      margin-bottom: 4px; 
      color: #666;
      font-weight: 500;
    }
    input[type="text"], textarea { 
      width: 100%; 
      padding: 8px; 
      border: 1px solid #ddd; 
      border-radius: 4px; 
      font-size: 13px;
      font-family: inherit;
    }
    input[type="text"]:focus, textarea:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }
    textarea { min-height: 80px; resize: vertical; }
    .item-list { margin: 8px 0; }
    .item { 
      display: flex; 
      justify-content: space-between; 
      align-items: center; 
      padding: 8px 10px; 
      background: #f9f9f9; 
      margin: 5px 0; 
      border-radius: 4px; 
      font-size: 13px;
      border-left: 3px solid #667eea;
    }
    .item button { 
      background: none; 
      border: none; 
      color: #e74c3c; 
      cursor: pointer; 
      font-size: 11px;
      text-decoration: underline;
    }
    .item button:hover { color: #c0392b; }
    .add-item { display: flex; gap: 8px; }
    .add-item input { flex: 1; }
    .add-item button { 
      background: #667eea; 
      color: white; 
      border: none; 
      padding: 8px 12px; 
      border-radius: 4px; 
      cursor: pointer; 
      font-size: 12px;
      font-weight: 500;
    }
    .add-item button:hover { background: #5568d3; }
    .yesterday-section { 
      background: #f5f5f5; 
      padding: 12px;
      border-radius: 4px;
      opacity: 0.9;
    }
    .button-group { 
      display: flex; 
      gap: 10px; 
      margin-top: 25px;
    }
    .btn { 
      flex: 1;
      padding: 12px; 
      border: none; 
      border-radius: 4px; 
      cursor: pointer; 
      font-size: 13px;
      font-weight: 600;
    }
    .btn-primary { 
      background: #667eea; 
      color: white;
    }
    .btn-primary:hover { background: #5568d3; }
    .message { 
      padding: 10px; 
      margin-top: 10px; 
      border-radius: 4px; 
      font-size: 12px;
      display: none;
    }
    .message.show { display: block; }
    .message.success { 
      background: #d4edda; 
      color: #155724;
      border: 1px solid #c3e6cb;
    }
    .message.error {
      background: #f8d7da;
      color: #721c24;
      border: 1px solid #f5c6cb;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📋 每日工作日报</h1>
    <div class="date-info" id="dateInfo"></div>

    <div class="section yesterday-section" id="yesterdaySection" style="display: none;">
      <div class="section-title">📅 昨日计划检查</div>
      <div id="yesterdayPlan"></div>
    </div>

    <div class="section">
      <div class="section-title">✅ 今日完成</div>
      <div class="item-list" id="completedList"></div>
      <div class="add-item">
        <input type="text" id="completedInput" placeholder="输入完成的任务...">
        <button onclick="addCompleted()">添加</button>
      </div>
    </div>

    <div class="section">
      <div class="section-title">📝 明日计划</div>
      <div class="item-list" id="planList"></div>
      <div class="add-item">
        <input type="text" id="planInput" placeholder="输入明日计划...">
        <button onclick="addPlan()">添加</button>
      </div>
    </div>

    <div class="section">
      <div class="section-title">⚠️ 阻碍/问题</div>
      <div class="item-list" id="blockersList"></div>
      <div class="add-item">
        <input type="text" id="blockerInput" placeholder="输入阻碍或问题...">
        <button onclick="addBlocker()">添加</button>
      </div>
    </div>

    <div class="section">
      <div class="section-title">📌 其他备注</div>
      <textarea id="notesInput" placeholder="输入其他备注..."></textarea>
    </div>

    <div class="button-group">
      <button class="btn btn-primary" onclick="saveLog()">💾 保存日志</button>
    </div>

    <div id="message" class="message"></div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    
    let currentLog = {
      date: new Date().toISOString().split('T')[0],
      completed: [],
      plan: [],
      blockers: [],
      notes: ''
    };

    let yesterdayLog = null;

    window.addEventListener('message', (event) => {
      const data = event.data;
      if (data.command === 'updateLog') {
        currentLog = data.todayLog;
        yesterdayLog = data.yesterdayLog;
        initUI();
      } else if (data.command === 'saved') {
        showMessage(data.message, 'success');
      }
    });

    function initUI() {
      document.getElementById('dateInfo').textContent = currentLog.date;
      renderUI();

      if (yesterdayLog && yesterdayLog.plan.length > 0) {
        document.getElementById('yesterdaySection').style.display = 'block';
        document.getElementById('yesterdayPlan').innerHTML = yesterdayLog.plan
          .map(p => '<div style="padding:4px;">✓ ' + p + '</div>')
          .join('');
      }
    }

    function renderUI() {
      renderList('completedList', currentLog.completed, 'completed');
      renderList('planList', currentLog.plan, 'plan');
      renderList('blockersList', currentLog.blockers, 'blockers');
      document.getElementById('notesInput').value = currentLog.notes;
    }

    function renderList(elementId, items, type) {
      const element = document.getElementById(elementId);
      element.innerHTML = items.map((item, index) => \`
        <div class="item">
          <span>\${item}</span>
          <button onclick="removeItem('\${type}', \${index})">删除</button>
        </div>
      \`).join('');
    }

    function addCompleted() {
      addItemToList('completedInput', 'completed');
    }

    function addPlan() {
      addItemToList('planInput', 'plan');
    }

    function addBlocker() {
      addItemToList('blockerInput', 'blockers');
    }

    function addItemToList(inputId, type) {
      const input = document.getElementById(inputId);
      if (input.value.trim()) {
        currentLog[type].push(input.value.trim());
        input.value = '';
        const listId = type === 'completed' ? 'completedList' : type === 'plan' ? 'planList' : 'blockersList';
        renderList(listId, currentLog[type], type);
      }
    }

    function removeItem(type, index) {
      currentLog[type].splice(index, 1);
      const listId = type === 'completed' ? 'completedList' : type === 'plan' ? 'planList' : 'blockersList';
      renderList(listId, currentLog[type], type);
    }

    function saveLog() {
      currentLog.notes = document.getElementById('notesInput').value;
      vscode.postMessage({
        command: 'save',
        log: currentLog
      });
    }

    function showMessage(msg, type) {
      const messageEl = document.getElementById('message');
      messageEl.textContent = msg;
      messageEl.className = 'message ' + type + ' show';
      setTimeout(() => {
        messageEl.classList.remove('show');
      }, 3000);
    }

    initUI();
  </script>
</body>
</html>`;
}
