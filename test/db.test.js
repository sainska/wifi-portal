const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'tmp', 'db-test');
fs.mkdirSync(dataDir, { recursive: true });
process.env.WIFI_PORTAL_DATA_DIR = dataDir;

const db = require('../src/services/db');
const supabase = require('../src/services/supabase');

const authFile = path.join(dataDir, 'authorized.json');

function resetAuthFile() {
  fs.writeFileSync(authFile, '{}');
}

test('authorize locks a MAC to its first package and reuses the same active entry', () => {
  const originalUpsert = supabase.upsertAuthorizedDevice;
  supabase.upsertAuthorizedDevice = async () => {};
  resetAuthFile();

  try {
    const first = db.authorize('192.168.1.2', '1h', 60, {
      phone: '0712345678',
      mac: 'AA:BB:CC:DD:EE:FF',
    });

    const second = db.authorize('192.168.1.3', '24h', 120, {
      phone: '0712345678',
      mac: 'AA:BB:CC:DD:EE:FF',
    });

    const data = JSON.parse(fs.readFileSync(authFile, 'utf8'));
    const entries = Object.values(data);

    assert.equal(entries.length, 1);
    assert.equal(first.packageId, '1h');
    assert.equal(second.packageId, '1h');
    assert.equal(second.mac, 'AA:BB:CC:DD:EE:FF');
    assert.equal(db.getEntry('192.168.1.3', 'AA:BB:CC:DD:EE:FF').packageId, '1h');
    assert.equal(db.isAuthorized('192.168.1.3', 'AA:BB:CC:DD:EE:FF'), true);
  } finally {
    supabase.upsertAuthorizedDevice = originalUpsert;
    resetAuthFile();
  }
});

test('authorize persists the successful payment transaction id on the device entry', () => {
  const originalUpsert = supabase.upsertAuthorizedDevice;
  supabase.upsertAuthorizedDevice = async () => {};
  resetAuthFile();

  try {
    const entry = db.authorize('192.168.1.5', '1h', 60, {
      phone: '0712345678',
      mac: 'CC:DD:EE:FF:00:11',
      transactionId: 'MPESA-123456',
      source: 'paystack',
    });

    assert.equal(entry.transactionId, 'MPESA-123456');

    const data = JSON.parse(fs.readFileSync(authFile, 'utf8'));
    const savedEntry = Object.values(data)[0];
    assert.equal(savedEntry.transactionId, 'MPESA-123456');
  } finally {
    supabase.upsertAuthorizedDevice = originalUpsert;
    resetAuthFile();
  }
});

test('extendAuthorization adds time to active sessions and restarts expired sessions', () => {
  const originalUpsert = supabase.upsertAuthorizedDevice;
  supabase.upsertAuthorizedDevice = async () => {};
  resetAuthFile();

  try {
    const active = db.authorize('192.168.1.20', '1h', 60, {
      phone: '0712345678',
      mac: 'AA:BB:CC:DD:EE:20',
    });

    const extendedActive = db.extendAuthorization('192.168.1.20', '3h', 180, {
      phone: '0712345678',
      mac: 'AA:BB:CC:DD:EE:20',
      source: 'admin-extend',
    });

    assert.equal(extendedActive.packageId, '3h');
    assert.ok(extendedActive.expiresAt > active.expiresAt);

    const expired = db.authorize('192.168.1.21', '1h', 0, {
      phone: '0712345678',
      mac: 'AA:BB:CC:DD:EE:21',
    });

    const extendedExpired = db.extendAuthorization('192.168.1.21', '24h', 1440, {
      phone: '0712345678',
      mac: 'AA:BB:CC:DD:EE:21',
      source: 'admin-extend',
    });

    assert.equal(extendedExpired.packageId, '24h');
    assert.ok(extendedExpired.expiresAt >= Date.now() + (24 * 60 * 60 * 1000) - 1000);
  } finally {
    supabase.upsertAuthorizedDevice = originalUpsert;
    resetAuthFile();
  }
});
