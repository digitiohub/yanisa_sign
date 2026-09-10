const Company = require('../models/Company');
const Workspace = require('../models/Workspace');
const Role = require('../models/Role');
const User = require('../models/User');
const SignDocument = require('../models/SignDocument');
const MailSetting = require('../models/MailSetting');
const { SYSTEM_ROLES } = require('../config/permissions');
const { hashPassword } = require('./tokens');
const { encryptSecret } = require('../utils/secretBox');

const slugify = value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'company';

/**
 * Idempotent first-boot setup: keep the shared system roles in sync, make sure
 * the default company/workspace exists, promote the bootstrap administrator
 * from the environment, and adopt any pre-multi-user documents so nothing
 * created before this release becomes invisible.
 */
async function bootstrap() {
  for (const role of SYSTEM_ROLES) {
    await Role.findOneAndUpdate(
      { companyId: null, key: role.key },
      { $set: { ...role, companyId: null, isSystem: true } },
      { upsert: true, new: true },
    );
  }

  // Upserts, so two instances starting together cannot collide.
  const companyName = process.env.COMPANY_NAME || 'Yanisa';
  const company = await Company.findOneAndUpdate(
    { slug: slugify(companyName) },
    { $setOnInsert: { name: companyName, slug: slugify(companyName) } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  const workspace = await Workspace.findOneAndUpdate(
    { companyId: company._id, name: 'General' },
    { $setOnInsert: { companyId: company._id, name: 'General', isDefault: true, description: 'Default workspace' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  await seedMailSettings();

  const adminEmail = String(process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  const adminPassword = process.env.ADMIN_PASSWORD;
  const superAdminRole = await Role.findOne({ companyId: null, key: 'super_admin' });
  let admin = adminEmail ? await User.findOne({ companyId: company._id, email: adminEmail }) : null;

  if (adminEmail && adminPassword && !admin) {
    admin = await User.create({
      companyId: company._id,
      workspaceId: workspace._id,
      roleId: superAdminRole._id,
      firstName: process.env.ADMIN_FIRST_NAME || 'Super',
      lastName: process.env.ADMIN_LAST_NAME || 'Admin',
      email: adminEmail,
      status: 'active',
      emailVerified: true,
      passwordHash: await hashPassword(adminPassword),
      passwordChangedAt: new Date(),
      activatedAt: new Date(),
    });
    console.log(`Bootstrap super admin created: ${adminEmail}`);
  }

  const owner = admin || await User.findOne({ companyId: company._id, status: 'active' }).sort({ createdAt: 1 });
  const orphaned = await SignDocument.countDocuments({ companyId: { $in: [null, undefined] } });
  if (orphaned && owner) {
    await SignDocument.updateMany(
      { companyId: { $in: [null, undefined] } },
      { $set: { companyId: company._id, workspaceId: workspace._id, ownerId: owner._id, createdByUserId: owner._id } },
    );
    console.log(`Adopted ${orphaned} existing document(s) into ${company.name}`);
  }

  return { company, workspace, admin };
}

/**
 * One-time migration of SMTP config out of the environment.
 *
 * Mail settings are database-backed now, so SMTP_* is only ever read here, on
 * the first boot after upgrading, to carry an existing deployment across
 * without an operator having to retype it. Once the row exists the environment
 * is ignored entirely and Administration > Mail is the only source of truth.
 */
async function seedMailSettings() {
  if (await MailSetting.exists({ key: 'global' })) return;
  const host = String(process.env.SMTP_HOST || '').trim();
  await MailSetting.create({
    key: 'global',
    // Adopting an existing SMTP_HOST turns mail on; a fresh install starts off
    // and waits to be configured from Administration.
    enabled: Boolean(host),
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    username: String(process.env.SMTP_USER || '').trim(),
    passwordEncrypted: process.env.SMTP_PASSWORD ? encryptSecret(process.env.SMTP_PASSWORD) : '',
    fromName: process.env.MAIL_FROM_NAME || 'Yanisa Sign',
    fromEmail: String(process.env.MAIL_FROM_EMAIL || '').toLowerCase().trim(),
  });
  console.log(host ? `Mail settings adopted from the environment (${host})` : 'Mail settings created - configure them in Administration > Mail');
}

module.exports = { bootstrap, slugify };
