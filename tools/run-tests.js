#!/usr/bin/env node
// npm test: lanza el runner de Node con la lista explícita de test/*.test.js.
// (Node 20 no entiende patrones como "test/**/*.test.js" en --test y cmd.exe no los expande: así funciona
// igual en Node 20, 22 y 24, en Windows, macOS y Linux.)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'test');
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.test.js'))
  .sort()
  .map((f) => path.join('test', f));
if (!files.length) {
  console.error('No hay tests en test/*.test.js');
  process.exit(1);
}
const r = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { cwd: root, stdio: 'inherit' });
if (r.error) {
  console.error(r.error.message);
  process.exit(1);
}
process.exit(r.status ?? 1);
