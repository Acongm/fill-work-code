import {
  formatReleaseHint,
  getReleaseRoot,
  getVsixPath,
  readReleaseManifest,
  vsixExists,
} from './version-utils.mjs';

const root = getReleaseRoot(import.meta.url);
const manifest = readReleaseManifest(root);
const vsixPath = getVsixPath(root, manifest.packageName, manifest.lernaVersion);
const exists = vsixExists(root, manifest.packageName, manifest.lernaVersion);

process.stdout.write(`当前版本：${manifest.lernaVersion}\n`);
process.stdout.write(
  `package.json：${manifest.packageVersion}${
    manifest.packageVersion === manifest.lernaVersion
      ? '（已同步）'
      : '（与 lerna 不一致，package 时会自动同步）'
  }\n`,
);
process.stdout.write(
  exists
    ? `VSIX 已存在：${vsixPath}\n`
    : `VSIX 未生成：${vsixPath}\n`,
);
process.stdout.write(
  formatReleaseHint(manifest.lernaVersion, manifest.packageName),
);
