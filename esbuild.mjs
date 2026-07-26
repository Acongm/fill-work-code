import * as esbuild from 'esbuild';
import fs from 'node:fs';
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

const copySqlJsWasm = () =>
  fs.copyFileSync(
    path.join(__dirname, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(__dirname, 'dist', 'sql-wasm.wasm'),
  );

if (watch) {
  await ctx.watch();
  copySqlJsWasm();
  console.log('[daily-work-log] watching...');
} else {
  await ctx.rebuild();
  await ctx.dispose();
  copySqlJsWasm();
  console.log('[daily-work-log] build done');
}
