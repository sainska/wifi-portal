const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const dataDir = path.join(__dirname, '..', 'tmp', 'payment-test');
fs.mkdirSync(dataDir, { recursive: true });
process.env.WIFI_PORTAL_DATA_DIR = dataDir;

const payment = require('../src/services/payment');
const db = require('../src/services/db');

const AUTHORIZED_FILE = path.join(dataDir, 'authorized.json');
const PENDING_FILE = path.join(dataDir, 'pending-payments.json');

test('payment service exposes the Paystack handlers', () => {
  assert.equal(typeof payment.initiatePaystackPayment, 'function');
  assert.equal(typeof payment.verifyPaystackReference, 'function');
});

test('normalizePhone produces the international format Paystack expects for Kenyan numbers', () => {
  assert.equal(payment.normalizePhone('0715757627'), '+254715757627');
  assert.equal(payment.normalizePhone('254715757627'), '+254715757627');
});

test('manual payment fallback is returned when Paystack is unavailable', async () => {
  fs.writeFileSync(AUTHORIZED_FILE, JSON.stringify({}));
  fs.writeFileSync(PENDING_FILE, JSON.stringify({}));

  const originalSecret = process.env.PAYSTACK_SECRET_KEY;
  const originalPublic = process.env.PAYSTACK_PUBLIC_KEY;
  process.env.PAYSTACK_SECRET_KEY = '';
  process.env.PAYSTACK_PUBLIC_KEY = '';

  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/services/payment')];

  const paymentWithoutPaystack = require('../src/services/payment');
  const result = await paymentWithoutPaystack.initiatePaystackChargeMobile({
    packageId: '1h',
    phone: '0712345678',
    ip: '127.0.0.1',
  });

  process.env.PAYSTACK_SECRET_KEY = originalSecret;
  process.env.PAYSTACK_PUBLIC_KEY = originalPublic;
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/services/payment')];

  assert.equal(result.success, true);
  assert.equal(result.manualMode, true);
  assert.equal(Boolean(result.checkoutId), true);
  assert.equal(typeof result.displayText, 'string');
});

test('createPendingPayment blocks a second payment for the same phone when a single-device package is active', () => {
  fs.writeFileSync(AUTHORIZED_FILE, JSON.stringify({}));
  fs.writeFileSync(PENDING_FILE, JSON.stringify({}));

  db.authorize('127.0.0.1', '1h', 60, {
    phone: '+254712345678',
    mac: 'AA:BB:CC:DD:EE:FF',
    source: 'test',
  });

  const result = payment.createPendingPayment({
    packageId: '1h',
    phone: '0712345678',
    ip: '127.0.0.2',
    mac: '11:22:33:44:55:66',
    source: 'paystack',
  });

  assert.equal(result.success, false);
  assert.match(result.message, /already has \d+ active connection/i);
});

test('createPendingPayment allows the same MAC to reconnect for the same package', () => {
  fs.writeFileSync(AUTHORIZED_FILE, JSON.stringify({}));
  fs.writeFileSync(PENDING_FILE, JSON.stringify({}));

  db.authorize('127.0.0.1', '1h', 60, {
    phone: '+254712345678',
    mac: 'AA:BB:CC:DD:EE:FF',
    source: 'test',
  });

  const result = payment.createPendingPayment({
    packageId: '1h',
    phone: '0712345678',
    ip: '127.0.0.2',
    mac: 'AA:BB:CC:DD:EE:FF',
    source: 'paystack',
  });

  assert.equal(result.success, true);
});

test('verifyMpesaInput rejects codes that are not linked to a paid session', async () => {
  fs.writeFileSync(AUTHORIZED_FILE, JSON.stringify({}));
  fs.writeFileSync(PENDING_FILE, JSON.stringify({}));

  const result = await payment.verifyMpesaInput({ input: 'ABCD123456', packageId: '1h' });
  assert.equal(result.success, false);
  assert.match(result.message, /not linked to an active or paid payment session/i);
});

test('prepareRebindForCode rebinds a conflicting code to the current device for a single-device package', () => {
  fs.writeFileSync(AUTHORIZED_FILE, JSON.stringify({}));
  fs.writeFileSync(PENDING_FILE, JSON.stringify({}));

  db.authorize('127.0.0.1', '1h', 60, {
    phone: '+254712345678',
    mac: 'AA:BB:CC:DD:EE:FF',
    mpesaCode: 'ABCD123456',
    source: 'test',
  });

  const result = payment.prepareRebindForCode({
    code: 'ABCD123456',
    packageId: '1h',
    phone: '+254712345678',
    ip: '127.0.0.2',
    mac: '11:22:33:44:55:66',
  });

  assert.equal(result.success, true);
  assert.equal(result.state, 'rebound');
  assert.equal(db.isAuthorized('127.0.0.2', '11:22:33:44:55:66'), true);
});

test('verifyMpesaInput accepts a paid pending checkout by checkoutId and code', async () => {
  fs.writeFileSync(AUTHORIZED_FILE, JSON.stringify({}));
  const now = Date.now();
  fs.writeFileSync(PENDING_FILE, JSON.stringify({
    'checkout-paid': {
      checkoutId: 'checkout-paid',
      packageId: '1h',
      packageName: '1 HOUR UNLIMITED',
      amount: 2,
      phone: '+254712345678',
      status: 'paid',
      mpesaCode: 'ABCD123456',
      createdAt: now,
      paidAt: now,
      expiresAt: now + 60000,
    },
  }));

  const result = await payment.verifyMpesaInput({ input: 'ABCD123456', checkoutId: 'checkout-paid' });
  assert.equal(result.success, true);
  assert.equal(result.packageId, '1h');
  assert.equal(result.code, 'ABCD123456');
});

test('ensurePaymentAllowed blocks second device for single-device package', () => {
  fs.writeFileSync(AUTHORIZED_FILE, JSON.stringify({}));
  const auth = db.authorize('127.0.0.1', '1h', 60, {
    phone: '+254712345678',
    mac: 'AA:BB:CC:DD:EE:FF',
    source: 'test',
  });

  const result = payment.ensurePaymentAllowed({
    phone: '+254712345678',
    ip: '127.0.0.2',
    mac: '11:22:33:44:55:66',
    packageId: '1h',
  });

  assert.equal(result.success, false);
  assert.match(result.message, /already has \d+ active connection/i);
});

test('ensurePaymentAllowed allows a second device for a 2-device package', () => {
  fs.writeFileSync(AUTHORIZED_FILE, JSON.stringify({}));
  const auth = db.authorize('127.0.0.1', '7d2', 60, {
    phone: '+254712345678',
    mac: 'AA:BB:CC:DD:EE:FF',
    source: 'test',
  });

  const result = payment.ensurePaymentAllowed({
    phone: '+254712345678',
    ip: '127.0.0.2',
    mac: '11:22:33:44:55:66',
    packageId: '7d2',
  });

  assert.equal(result.success, true);
});

test('ensurePaymentAllowed blocks a third device for a 2-device package', () => {
  fs.writeFileSync(AUTHORIZED_FILE, JSON.stringify({}));
  db.authorize('127.0.0.1', '7d2', 60, {
    phone: '+254712345678',
    mac: 'AA:BB:CC:DD:EE:FF',
    source: 'test',
  });
  db.authorize('127.0.0.2', '7d2', 60, {
    phone: '+254712345678',
    mac: '11:22:33:44:55:66',
    source: 'test',
  });

  const result = payment.ensurePaymentAllowed({
    phone: '+254712345678',
    ip: '127.0.0.3',
    mac: '22:33:44:55:66:77',
    packageId: '7d2',
  });

  assert.equal(result.success, false);
  assert.match(result.message, /upgrade to a larger package/i);
});

test('ensurePaymentAllowed allows the same MAC to reconnect for the same package', () => {
  fs.writeFileSync(AUTHORIZED_FILE, JSON.stringify({}));
  db.authorize('127.0.0.1', '1h', 60, {
    phone: '+254712345678',
    mac: 'AA:BB:CC:DD:EE:FF',
    source: 'test',
  });

  const result = payment.ensurePaymentAllowed({
    phone: '+254712345678',
    ip: '127.0.0.1',
    mac: 'AA:BB:CC:DD:EE:FF',
    packageId: '1h',
  });

  assert.equal(result.success, true);
});

test('updatePaymentState keeps the transaction id on the pending entry', () => {
  fs.writeFileSync(PENDING_FILE, JSON.stringify({
    'checkout-1': {
      checkoutId: 'checkout-1',
      packageId: '1h',
      packageName: '1 HOUR UNLIMITED',
      amount: 2,
      status: 'pending',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000,
    },
  }));

  payment.updatePaymentState('checkout-1', {
    status: 'paid',
    paidAt: Date.now(),
    paystackReference: 'ref-123',
    transactionId: 'MPESA-123456',
  });

  const pending = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'));
  assert.equal(pending['checkout-1'].transactionId, 'MPESA-123456');
});

test('filterRecordsBySearchQuery matches manual-sale metadata and transaction identifiers', () => {
  const records = [
    {
      checkoutId: 'cash-1',
      packageName: '1 HOUR UNLIMITED',
      phone: '+254712345678',
      ip: '127.0.0.1',
      source: 'manual-admin',
      authorizedBy: 'Alice',
      transactionId: 'TX-100',
      amount: 100,
    },
    {
      checkoutId: 'mpesa-2',
      packageName: '7 DAYS',
      phone: '+254723456789',
      ip: '127.0.0.2',
      source: 'mpesa',
      amount: 200,
    },
  ];

  const byTransaction = payment.filterRecordsBySearchQuery(records, 'TX-100');
  assert.equal(byTransaction.length, 1);
  assert.equal(byTransaction[0].checkoutId, 'cash-1');

  const byPhone = payment.filterRecordsBySearchQuery(records, '0712345678');
  assert.equal(byPhone.length, 1);
  assert.equal(byPhone[0].checkoutId, 'cash-1');
});

test('resolveTransactionId prefers the Paystack receipt number and falls back to the reference', () => {
  assert.equal(payment.resolveTransactionId({ data: { receipt_number: 'MPESA-123456' } }, 'ref-123'), 'MPESA-123456');
  assert.equal(payment.resolveTransactionId({ data: { reference: 'ref-123' } }, 'ref-123'), 'ref-123');
});

test('adminConfirmPayment authorizes the pending payment without throwing', async () => {
  fs.writeFileSync(AUTHORIZED_FILE, JSON.stringify({}));
  fs.writeFileSync(PENDING_FILE, JSON.stringify({
    'checkout-admin': {
      checkoutId: 'checkout-admin',
      packageId: '1h',
      packageName: '1 HOUR UNLIMITED',
      amount: 2,
      phone: '+254712345678',
      ip: '127.0.0.10',
      mac: 'AA:BB:CC:DD:EE:FF',
      status: 'pending',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000,
    },
  }));

  const result = await payment.adminConfirmPayment('checkout-admin');

  assert.equal(result.success, true);
  assert.equal(db.getEntry('127.0.0.10', 'AA:BB:CC:DD:EE:FF').packageId, '1h');
});

test('adminRejectPayment marks the payment as rejected', async () => {
  fs.writeFileSync(PENDING_FILE, JSON.stringify({
    'checkout-reject': {
      checkoutId: 'checkout-reject',
      packageId: '1h',
      packageName: '1 HOUR UNLIMITED',
      amount: 2,
      phone: '+254712345678',
      status: 'pending',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000,
    },
  }));
  fs.writeFileSync(path.join(dataDir, 'payments-log.json'), JSON.stringify([{ checkoutId: 'checkout-reject', status: 'pending' }]));

  const result = await payment.adminRejectPayment('checkout-reject');
  const pending = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'));
  const log = JSON.parse(fs.readFileSync(path.join(dataDir, 'payments-log.json'), 'utf8'));

  assert.equal(result.success, true);
  assert.equal(pending['checkout-reject'], undefined);
  assert.equal(log[0].status, 'rejected');
});
