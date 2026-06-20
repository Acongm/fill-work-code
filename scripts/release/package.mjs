import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  formatReleaseHint,
  getReleaseRoot,
  getVsixPath,
  readReleaseManifest,
  syncVersionFromLerna,
  vsixExists,
} from './version-utils.mjs';

const root = getReleaseRoot(import.meta.url);
const force = process.argv.includes('--force');

const version = syncVersionFromLerna(root);
const manifest = readReleaseManifest(root);
const vsixPath = getVsixPath(root, manifest.packageName, version);

if (vsixExists(root, manifest.packageName, version) && !force) {
  process.stderr.write(`\n错误：当前版本 ${version} 的 VSIX 已存在。\n`);
  process.stderr.write(`${vsixPath}\n`);
  process.stderr.write(formatReleaseHint(version, manifest.packageName));
  process.stderr.write('\n若确需覆盖，请使用：npm run package:force\n');
  process.exit(1);
}

execSync('npm run compile', { cwd: root, stdio: 'inherit' });

const artifactsDir = path.join(root, 'artifacts');
fs.mkdirSync(artifactsDir, { recursive: true });

execSync(
  [
    'npx vsce package',
    '--no-yarn',
    '--no-dependencies',
    '--out artifacts',
    '--allow-missing-repository',
  ].join(' '),
  { cwd: root, stdio: 'inherit' },
);

if (!fs.existsSync(vsixPath)) {
  throw new Error(`未找到 VSIX 产物：${vsixPath}`);
}

assertVsixContents(vsixPath);

process.stdout.write(`\nVSIX 已生成：${vsixPath}\n`);
process.stdout.write(`版本：${version}\n`);

function assertVsixContents(vsixPath) {
  const listing = execSync(`unzip -l ${JSON.stringify(vsixPath)}`, {
    encoding: 'utf8',
  });

  const forbidden = [
    'extension/web/node_modules/',
    'extension/artifacts/',
    'extension/.env',
  ];
  for (const item of forbidden) {
    if (listing.includes(item)) {
      throw new Error(`VSIX 包含禁止路径：${item}`);
    }
  }

  const required = [
    'extension/dist/extension.js',
    'extension/web/dist/index.html',
    'extension/scripts/',
  ];
  for (const item of required) {
    if (!listing.includes(item)) {
      throw new Error(`VSIX 缺少运行必需文件：${item}`);
    }
  }
}
