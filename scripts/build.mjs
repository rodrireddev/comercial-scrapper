import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const tests = process.argv.includes('--tests');

if (tests) {
  // Compila los tests (lógica pura del proceso principal) para correrlos con `node --test`.
  rmSync('dist-tests', { recursive: true, force: true });
  await esbuild.build({
    entryPoints: readdirSync('tests').filter((f) => f.endsWith('.test.ts')).map((f) => `tests/${f}`),
    outdir: 'dist-tests',
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outExtension: { '.js': '.cjs' },
  });
  process.exit(0);
}

const common = { bundle: true, sourcemap: true, logLevel: 'info' };

const configs = [
  { ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.js', platform: 'node', format: 'cjs', target: 'node20', external: ['electron'] },
  { ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload.js', platform: 'node', format: 'cjs', target: 'node20', external: ['electron'] },
  { ...common, entryPoints: ['src/renderer/main.ts'], outfile: 'dist/renderer/renderer.js', platform: 'browser', format: 'esm', target: 'chrome120', loader: { '.css': 'text' } },
];

function copyStatic() {
  mkdirSync('dist/renderer', { recursive: true });
  cpSync('src/renderer/index.html', 'dist/renderer/index.html');
  cpSync('src/renderer/styles.css', 'dist/renderer/styles.css');
}

if (watch) {
  copyStatic();
  for (const c of configs) await (await esbuild.context(c)).watch();
  console.log('Observando cambios… (HTML/CSS se copian al reiniciar el watch)');
} else {
  rmSync('dist', { recursive: true, force: true });
  await Promise.all(configs.map((c) => esbuild.build(c)));
  copyStatic();
}
