// Permission catalogue and the built-in roles. Roles live in the database so
// custom roles can be created later; these are the ones seeded on first boot.

const PERMISSIONS = [
  ['users.create', 'Create and invite users'], ['users.view', 'View users'], ['users.edit', 'Edit users'], ['users.delete', 'Remove users'],
  ['roles.create', 'Create roles'], ['roles.view', 'View roles'], ['roles.edit', 'Edit roles'], ['roles.delete', 'Delete roles'],
  ['documents.create', 'Create documents'], ['documents.view', 'View own and shared documents'], ['documents.view_team', 'View documents of their workspace'],
  ['documents.view_all', 'View every document in the organisation'], ['documents.edit', 'Edit documents'], ['documents.delete', 'Delete documents'],
  ['documents.send', 'Send documents for signature'], ['documents.download', 'Download documents'], ['documents.share', 'Share documents with colleagues'],
  ['templates.create', 'Create templates'], ['templates.view', 'View templates'], ['templates.edit', 'Edit templates'], ['templates.delete', 'Delete templates'],
  ['signers.create', 'Add signers'], ['signers.view', 'View signers'], ['signers.edit', 'Edit signers'], ['signers.delete', 'Remove signers'],
  ['reports.view', 'View reports'], ['activity.view', 'View the activity log'], ['audit.view', 'View the audit log'],
  ['sessions.revoke', 'Revoke sessions of other users'],
  ['settings.view', 'View settings'], ['settings.edit', 'Change settings'],
  ['integrations.view', 'View integrations'], ['integrations.manage', 'Manage integrations'],
];
const PERMISSION_KEYS = PERMISSIONS.map(([key]) => key);

const SYSTEM_ROLES = [
  { key: 'super_admin', name: 'Super Admin', rank: 100, description: 'Unrestricted access to everything in the organisation.', permissions: ['*'] },
  { key: 'admin', name: 'Admin', rank: 80, description: 'Manages users, documents and templates. No system-level settings.',
    permissions: ['users.create','users.view','users.edit','roles.view','documents.create','documents.view','documents.view_team','documents.view_all','documents.edit','documents.delete','documents.send','documents.download','documents.share','templates.create','templates.view','templates.edit','templates.delete','signers.create','signers.view','signers.edit','signers.delete','reports.view','activity.view','audit.view','sessions.revoke','settings.view'] },
  // Administration is for administrators only, so a Manager gets neither
  // users.view nor activity.view - the two permissions that open it.
  { key: 'manager', name: 'Manager', rank: 60, description: 'Runs a workspace: team documents, templates and reports.',
    permissions: ['documents.create','documents.view','documents.view_team','documents.edit','documents.send','documents.download','documents.share','templates.create','templates.view','templates.edit','signers.create','signers.view','signers.edit','signers.delete','reports.view'] },
  { key: 'editor', name: 'Editor', rank: 40, description: 'Prepares and sends their own documents.',
    permissions: ['documents.create','documents.view','documents.edit','documents.send','documents.download','documents.share','templates.view','signers.create','signers.view','signers.edit','signers.delete'] },
  { key: 'viewer', name: 'Viewer', rank: 20, description: 'Read-only access to permitted documents.',
    permissions: ['documents.view','documents.download','templates.view','signers.view'] },
];

// Supports '*' (everything) and 'module.*' (a whole module).
function permissionsInclude(granted = [], permission) {
  if (!permission) return true;
  if (granted.includes('*') || granted.includes(permission)) return true;
  const [module] = permission.split('.');
  return granted.includes(`${module}.*`);
}

// user is a request user carrying `permissions` resolved from its role.
const hasPermission = (user, permission) => permissionsInclude(user?.permissions, permission);
const hasAnyPermission = (user, permissions = []) => permissions.some(permission => hasPermission(user, permission));

module.exports = { PERMISSIONS, PERMISSION_KEYS, SYSTEM_ROLES, hasPermission, hasAnyPermission, permissionsInclude };
