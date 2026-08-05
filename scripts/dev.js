const { spawn } = require('child_process');
const path = require('path');

const root = process.cwd();
const server = spawn(process.execPath, [path.join(root, 'server', 'index.js')], {
  cwd: root,
  stdio: 'inherit',
});

const client = spawn(process.execPath, [path.join(root, 'client', 'node_modules', 'vite', 'bin', 'vite.js')], {
  cwd: path.join(root, 'client'),
  stdio: 'inherit',
});

server.on('exit', (code) => {
  if (code !== 0) process.exit(code);
});

client.on('exit', (code) => {
  if (code !== 0) process.exit(code);
});
