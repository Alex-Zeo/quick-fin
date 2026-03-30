import { build } from 'esbuild';
import { readdir, stat } from 'fs/promises';
import { join, relative } from 'path';

async function getEntryPoints(dir) {
  const entries = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, item.name);
    if (item.isDirectory()) {
      entries.push(...await getEntryPoints(full));
    } else if (item.name.endsWith('.ts') && !item.name.endsWith('.test.ts')) {
      entries.push(full);
    }
  }
  return entries;
}

const entryPoints = await getEntryPoints('src');

await build({
  entryPoints,
  outdir: 'dist',
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  outExtension: { '.js': '.js' },
  packages: 'external',
});

console.log(`Built ${entryPoints.length} files to dist/`);
