const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(process.env.STORAGE_PATH || path.join(__dirname, '..', '..', 'storage'));
async function initStorage() { await fs.mkdir(path.join(root, 'originals'), { recursive: true }); await fs.mkdir(path.join(root, 'signed'), { recursive: true }); }
async function save(kind, buffer) { await initStorage(); await fs.mkdir(path.join(root, kind), { recursive: true }); const name = `${crypto.randomUUID()}.pdf`; const target = path.join(root, kind, name); await fs.writeFile(target, buffer, { mode: 0o600 }); return target; }
module.exports = { initStorage, save };
