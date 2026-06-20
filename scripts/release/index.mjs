import { execSync } from 'node:child_process';
import {
  assertCleanWorkingTree,
  assertReleaseBranch,
  getReleaseRoot,
  getVsixPath,
  readReleaseManifest,
} from './version-utils.mjs';

const root = getReleaseRoot(import.meta.url);
const bumpArg = process.argv[2];
const bumpType = ['patch', 'minor', 'major'].includes(bumpArg ?? '')
  ? bumpArg
  : 'patch';

assertReleaseBranch(root, 'main');
assertCleanWorkingTree(root);

const before = readReleaseManifest(root);
process.stdout.write(`当前版本：${before.lernaVersion}\n`);
process.stdout.write(`升版类型：${bumpType}\n`);

execSync(
  `npx lerna version ${bumpType} --yes --no-push --no-git-tag-version`,
  { cwd: root, stdio: 'inherit' },
);

const after = readReleaseManifest(root);
const version = after.lernaVersion;
process.stdout.write(`新版本：${version}\n`);

execSync('npm run compile', { cwd: root, stdio: 'inherit' });
execSync('node scripts/release/package.mjs', { cwd: root, stdio: 'inherit' });

execSync('git add lerna.json package.json', { cwd: root, stdio: 'inherit' });
const pending = execSync('git diff --cached --name-only', {
  cwd: root,
  encoding: 'utf8',
})
  .split('\n')
  .map((item) => item.trim())
  .filter(Boolean);

if (pending.length > 0) {
  execSync(`git commit -m "chore(release): publish ${version}"`, {
    cwd: root,
    stdio: 'inherit',
  });
}

const tag = `v${version}`;
const existingTag = execSync('git tag -l', { cwd: root, encoding: 'utf8' })
  .split('\n')
  .map((item) => item.trim())
  .filter(Boolean);

if (!existingTag.includes(tag)) {
  execSync(`git tag -a ${tag} -m "release ${version}"`, {
    cwd: root,
    stdio: 'inherit',
  });
}

const vsixPath = getVsixPath(root, after.packageName, version);
process.stdout.write(`\nRelease ${version} 完成。\n`);
process.stdout.write(`VSIX：${vsixPath}\n`);
