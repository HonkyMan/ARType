import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
for (const folder of ['src', 'public', 'scripts']) {
  for (const entry of await readdir(resolve(root, folder), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(js|mjs)$/.test(entry.name)) continue;
    const result = spawnSync(process.execPath, ['--check', resolve(entry.parentPath, entry.name)], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
