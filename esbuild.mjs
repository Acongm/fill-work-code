import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, 'src');
const watch = process.argv.includes('--watch');

const aliasAtPlugin = {
  name: 'alias-at',
  setup(build) {
    build.onResolve({ filter: /^@\// }, (args) => ({
      path: path.join(srcDir, args.path.slice(2)),
    }));
  },
};

const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: false,
  plugins: [aliasAtPlugin],
});

if (watch) {
  await ctx.watch();
  console.log('[daily-work-log] watching...');
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log('[daily-work-log] build done');
}
