const jwt = require('jsonwebtoken');

const permissionsByRole = {
  super_admin: ['*'],
  hr_admin: ['sign.view', 'sign.create', 'sign.upload', 'sign.edit', 'sign.send', 'sign.delete', 'sign.cancel', 'sign.resend', 'sign.download', 'sign.manage_signers', 'sign.view_audit'],
  recruiter: ['sign.view', 'sign.create', 'sign.upload', 'sign.edit', 'sign.send', 'sign.resend', 'sign.download', 'sign.manage_signers'],
  manager: ['sign.view', 'sign.download'], employee: ['sign.view', 'sign.download'],
};

function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); return next(); }
  catch { return res.status(401).json({ error: 'Invalid or expired session' }); }
}

const permit = (permission) => (req, res, next) => {
  const allowed = permissionsByRole[req.user?.role] || [];
  return allowed.includes('*') || allowed.includes(permission) ? next() : res.status(403).json({ error: 'Insufficient permission' });
};

module.exports = { authenticate, permit, permissionsByRole };
