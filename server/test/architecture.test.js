import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

test('server modules have an acyclic dependency graph', async () => {
  const root = fileURLToPath(new URL('../src', import.meta.url));
  const graph = new Map();
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    const path = resolve(entry.parentPath, entry.name);
    const source = await readFile(path, 'utf8');
    const imports = [...source.matchAll(/(?:import|export)\s[^;]*?\sfrom\s*['"](\.[^'"]+)['"]/g)];
    graph.set(path, imports.map(match => resolve(dirname(path), match[1])));
  }
  const done = new Set();
  function visit(path, trail = []) {
    assert.ok(!trail.includes(path), `Circular dependency: ${[...trail, path].map(p => relative(root, p)).join(' → ')}`);
    if (done.has(path)) return;
    for (const dependency of graph.get(path) || []) visit(dependency, [...trail, path]);
    done.add(path);
  }
  for (const path of graph.keys()) visit(path);
});
