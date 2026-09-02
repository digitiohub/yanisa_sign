/**
 * Creates one demo account per built-in role so the permission model can be
 * explored without inviting real people.
 *
 *   npm run seed:demo
 *
 * These accounts use a shared, well-known password, so the script refuses to
 * run against a production environment. Override the password with
 * DEMO_PASSWORD, and set ALLOW_DEMO_SEED=true only if you genuinely intend to
 * create them outside development.
 */
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Company = require('../server/models/Company');
const Workspace = require('../server/models/Workspace');
const Role = require('../server/models/Role');
const User = require('../server/models/User');
const { hashPassword } = require('../server/services/tokens');

const PASSWORD = process.env.DEMO_PASSWORD || 'Demo@12345';
const DEMO_USERS = [
  { roleKey: 'admin', firstName: 'Aisha', lastName: 'Khan', email: 'admin.demo@yanisa.test' },
  { roleKey: 'manager', firstName: 'Marco', lastName: 'Rossi', email: 'manager.demo@yanisa.test' },
  { roleKey: 'editor', firstName: 'Ella', lastName: 'Fernandes', email: 'editor.demo@yanisa.test' },
  { roleKey: 'viewer', firstName: 'Vikram', lastName: 'Iyer', email: 'viewer.demo@yanisa.test' },
];

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
    console.error('Refusing to create shared-password demo accounts in production.');
    console.error('Set ALLOW_DEMO_SEED=true if that is really what you want.');
    process.exit(1);
  }
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set. Copy .env.example to .env first.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  const company = await Company.findOne().sort({ createdAt: 1 });
  if (!company) {
    console.error('No company found. Start the server once so it can seed the organisation, then run this again.');
    process.exit(1);
  }
  const workspace = await Workspace.findOne({ companyId: company._id, isDefault: true }) || await Workspace.findOne({ companyId: company._id });
  const passwordHash = await hashPassword(PASSWORD);
  const rows = [];

  for (const demo of DEMO_USERS) {
    const role = await Role.findOne({ key: demo.roleKey, $or: [{ companyId: null }, { companyId: company._id }] });
    if (!role) { console.error(`Role ${demo.roleKey} is missing; skipping ${demo.email}`); continue; }

    const existing = await User.findOne({ companyId: company._id, email: demo.email });
    if (existing) {
      // Re-running resets the demo password rather than creating duplicates.
      existing.passwordHash = passwordHash;
      existing.passwordChangedAt = new Date();
      existing.status = 'active';
      existing.emailVerified = true;
      existing.failedLoginCount = 0;
      existing.lockedUntil = undefined;
      existing.roleId = role._id;
      await existing.save();
      rows.push({ role: role.name, email: demo.email, action: 'password reset' });
      continue;
    }

    await User.create({
      companyId: company._id,
      workspaceId: workspace?._id,
      roleId: role._id,
      firstName: demo.firstName,
      lastName: demo.lastName,
      email: demo.email,
      status: 'active',
      emailVerified: true,
      passwordHash,
      passwordChangedAt: new Date(),
      activatedAt: new Date(),
    });
    rows.push({ role: role.name, email: demo.email, action: 'created' });
  }

  const superAdmin = await User.findOne({ companyId: company._id, email: String(process.env.ADMIN_EMAIL || '').toLowerCase() });
  console.log(`\nDemo accounts for ${company.name} (password: ${PASSWORD})\n`);
  if (superAdmin) console.log(`  Super Admin   ${superAdmin.email}  (uses ADMIN_PASSWORD from .env)`);
  for (const row of rows) console.log(`  ${row.role.padEnd(13)} ${row.email.padEnd(30)} ${row.action}`);
  console.log('\nSign in at the app URL, for example http://localhost:5173/login\n');

  await mongoose.disconnect();
}

main().catch(error => { console.error(error.message); process.exit(1); });
