const { spawn } = require('child_process');
const path = require('path');

const root = process.cwd();
require('dotenv').config({ path: path.join(root, '.env') });

// The client proxies /api to the server, so it has to be told the port the
// server actually picked. Without this the proxy falls back to its own default
// of 5000, which on macOS is AirPlay Receiver - and AirPlay answers 403, so
// every API call fails with no sign of it in the server log.
const apiPort = process.env.PORT || '5050';

const server = spawn(process.execPath, [path.join(root, 'server', 'index.js')], {
  cwd: root,
  stdio: 'inherit',
});

const client = spawn(process.execPath, [path.join(root, 'client', 'node_modules', 'vite', 'bin', 'vite.js')], {
  cwd: path.join(root, 'client'),
  stdio: 'inherit',
  env: { ...process.env, API_PORT: apiPort },
});

console.log(`[dev] proxying the client's /api to http://127.0.0.1:${apiPort}`);

server.on('exit', (code) => {
  if (code !== 0) process.exit(code);
});

client.on('exit', (code) => {
  if (code !== 0) process.exit(code);
});
