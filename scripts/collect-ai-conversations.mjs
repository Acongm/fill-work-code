#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: node scripts/collect-ai-conversations.mjs [options]

Options:
  --storage-path <path>  Work log storage root (default: ~/.work-logs)
  --provider <name>      codex, cursor, qoder, or all (default: all)
  --help                 Show this help

The script discovers provider sources and writes a content-preserving import
bundle to <storage>/.runtime/ai-conversations-import.json. Use the extension
command "采集 Codex / Cursor / Qoder 对话" for direct SQLite ingestion.`);
  process.exit(0);
}

function option(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function expandHome(value) {
  return value === '~'
    ? os.homedir()
    : value.startsWith('~/')
      ? path.join(os.homedir(), value.slice(2))
      : path.resolve(value);
}

function walk(root, accept, output = []) {
  if (!fs.existsSync(root)) return output;
  const stat = fs.statSync(root);
  if (stat.isFile()) {
    if (accept(root)) output.push(path.resolve(root));
    return output;
  }
  for (const name of fs.readdirSync(root)) {
    try {
      walk(path.join(root, name), accept, output);
    } catch {
      // Unreadable provider entries are skipped.
    }
  }
  return output;
}

const provider = option('--provider', 'all');
if (!['all', 'codex', 'cursor', 'qoder'].includes(provider)) {
  throw new Error(`Unsupported provider: ${provider}`);
}
const storageRoot = expandHome(option('--storage-path', '~/.work-logs'));
const sources = [];
const add = (name, roots, accept) => {
  if (provider !== 'all' && provider !== name) return;
  for (const root of roots) {
    for (const filePath of walk(root, accept)) {
      const content = fs.readFileSync(filePath);
      sources.push({
        provider: name,
        path: filePath,
        hash: crypto.createHash('sha256').update(content).digest('hex'),
        content: content.toString('base64'),
      });
    }
  }
};

add(
  'codex',
  [
    path.join(os.homedir(), '.codex', 'sessions'),
    path.join(os.homedir(), '.codex', 'archived_sessions'),
  ],
  (filePath) => filePath.endsWith('.jsonl'),
);
add(
  'cursor',
  [path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User')],
  (filePath) =>
    ['state.vscdb', 'conversation-search.db'].includes(path.basename(filePath)),
);
add(
  'qoder',
  [
    path.join(os.homedir(), '.qoder'),
    path.join(os.homedir(), 'Library', 'Application Support', 'Qoder'),
  ],
  (filePath) => filePath.endsWith('.json') || filePath.endsWith('.jsonl'),
);

const runtimeDir = path.join(storageRoot, '.runtime');
fs.mkdirSync(runtimeDir, { recursive: true });
const target = path.join(runtimeDir, 'ai-conversations-import.json');
const temporary = `${target}.tmp`;
fs.writeFileSync(
  temporary,
  `${JSON.stringify({ version: 1, collectedAt: new Date().toISOString(), sources })}\n`,
);
fs.renameSync(temporary, target);
console.log(`Collected ${sources.length} AI conversation sources into ${target}`);
