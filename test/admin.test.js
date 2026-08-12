const test = require('node:test');
const assert = require('node:assert/strict');

const admin = require('../src/services/admin');

const config = {
  ADMIN_PIN: 'admin123',
  ADMIN_IPS: ['127.0.0.1', '::1', '192.168.137.1'],
};

test('isAdminRequest does not treat hotspot clients as admins', () => {
  const req = {
    socket: { remoteAddress: '192.168.137.42' },
    headers: {},
  };

  assert.equal(admin.isAdminRequest(req, config), false);
});

test('isAdminRequest allows the configured admin host', () => {
  const req = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
  };

  assert.equal(admin.isAdminRequest(req, config), true);
});
