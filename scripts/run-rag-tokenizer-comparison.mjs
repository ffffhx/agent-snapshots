import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const child = spawn(require('electron'), [fileURLToPath(new URL('./compare-rag-tokenizers.mjs', import.meta.url)), ...process.argv.slice(2)], {
  cwd: fileURLToPath(new URL('../', import.meta.url)), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: 'inherit',
});
child.on('error', (error) => { console.error(error); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
