const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long';

const request = require('supertest');
const { app } = require('../index');
const { hasPermission, SYSTEM_ROLES } = require('../config/permissions');
const { passwordProblem } = require('../services/tokens');
const { maskEmail } = require('../services/otp');
const { sanitize } = require('../services/audit');

test('health endpoint responds without authentication', async () => {
  const response = await request(app).get('/api/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
});

test('the document API rejects anonymous requests', async () => {
  const response = await request(app).get('/api/sign');
  assert.equal(response.status, 401);
});

test('the admin API rejects anonymous requests', async () => {
  const response = await request(app).get('/api/admin/users');
  assert.equal(response.status, 401);
});

test('login validates its input before touching the database', async () => {
  const response = await request(app).post('/api/auth/login').send({ email: 'not-an-email', password: 'x' });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /valid email/i);
});

test('permission checks honour exact grants, module wildcards and full access', () => {
  assert.equal(hasPermission({ permissions: ['documents.send'] }, 'documents.send'), true);
  assert.equal(hasPermission({ permissions: ['documents.send'] }, 'documents.delete'), false);
  assert.equal(hasPermission({ permissions: ['documents.*'] }, 'documents.delete'), true);
  assert.equal(hasPermission({ permissions: ['documents.*'] }, 'users.create'), false);
  assert.equal(hasPermission({ permissions: ['*'] }, 'anything.at.all'), true);
  assert.equal(hasPermission({ permissions: [] }, 'documents.view'), false);
});

test('built-in roles keep their intended limits', () => {
  const role = key => SYSTEM_ROLES.find(entry => entry.key === key);
  assert.equal(hasPermission(role('viewer'), 'documents.view'), true);
  assert.equal(hasPermission(role('viewer'), 'documents.create'), false);
  assert.equal(hasPermission(role('viewer'), 'documents.send'), false);
  assert.equal(hasPermission(role('editor'), 'documents.send'), true);
  assert.equal(hasPermission(role('editor'), 'users.create'), false);
  assert.equal(hasPermission(role('editor'), 'documents.view_all'), false);
  assert.equal(hasPermission(role('manager'), 'documents.view_team'), true);
  assert.equal(hasPermission(role('manager'), 'documents.view_all'), false);
  assert.equal(hasPermission(role('admin'), 'documents.view_all'), true);
  assert.equal(hasPermission(role('admin'), 'settings.edit'), false, 'admins do not get system settings by default');
  assert.equal(hasPermission(role('super_admin'), 'settings.edit'), true);
});

test('password policy requires length and variety', () => {
  assert.match(passwordProblem('short'), /8 characters/);
  assert.match(passwordProblem('alllowercaseonly'), /three of/);
  assert.equal(passwordProblem('Str0ng-Enough'), null);
  assert.equal(passwordProblem('MixedCase123'), null);
});

test('masked emails do not reveal the local part', () => {
  const masked = maskEmail('pratik.nikade@company.com');
  assert.match(masked, /^p\*+@company\.com$/);
  assert.equal(masked.includes('nikade'), false);
});

test('audit sanitising removes anything secret-shaped', () => {
  const cleaned = sanitize({
    email: 'user@example.com',
    passwordHash: '$2a$12$abcdef',
    otpHash: 'deadbeef',
    refreshToken: 'secret-token',
    nested: { authorization: 'Bearer abc', keep: 'visible' },
  });
  assert.equal(cleaned.email, 'user@example.com');
  assert.equal(cleaned.nested.keep, 'visible');
  assert.equal('passwordHash' in cleaned, false);
  assert.equal('otpHash' in cleaned, false);
  assert.equal('refreshToken' in cleaned, false);
  assert.equal('authorization' in cleaned.nested, false);
});
