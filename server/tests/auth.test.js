const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long';
process.env.ADMIN_EMAIL = 'hr@example.com';
process.env.ADMIN_PASSWORD = 'correct-horse-battery-staple';

const request = require('supertest');
const { app } = require('../index');

test('health endpoint responds without authentication', async () => {
  const response = await request(app).get('/api/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
});

test('protected Sign API rejects anonymous requests', async () => {
  const response = await request(app).get('/api/sign');
  assert.equal(response.status, 401);
});

test('standalone admin login rejects invalid credentials', async () => {
  const response = await request(app).post('/api/auth/login').send({ email: 'hr@example.com', password: 'wrong' });
  assert.equal(response.status, 401);
});

test('standalone admin login returns a JWT for valid credentials', async () => {
  const response = await request(app).post('/api/auth/login').send({ email: 'hr@example.com', password: 'correct-horse-battery-staple' });
  assert.equal(response.status, 200);
  assert.ok(response.body.token);
  assert.equal(response.body.user.role, 'hr_admin');
});
