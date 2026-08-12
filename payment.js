const fs = require("fs");
const path = require("path");
const config = require("./config");
const db = require("./db");

const USED_CODES_FILE = path.join(__dirname, "used-codes.json");
const PENDING_FILE = path.join(__dirname, "pending-payments.json");
const USED_VOUCHERS_FILE = path.join(__dirname, "used-vouchers.json");

const MPESA_CODE_RE = /\b([A-Z0-9]{10})\b/i;
const AUTH_WAIT_MS = 30_000;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function extractMpesaCode(input) {
  if (!input) return null;
  const text = String(input).trim().toUpperCase();
  if (/^[A-Z0-9]{10}$/.test(text)) return text;
  const match = text.match(MPESA_CODE_RE);
  return match ? match[1].toUpperCase() : null;
}

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("254") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 10) return `254${digits.slice(1)}`;
  if (digits.length === 9) return `254${digits}`;
  return digits.length >= 9 ? digits : null;
}

function isCodeUsed(code) {
  const used = readJson(USED_CODES_FILE, {});
  return Boolean(used[code]);
}

function markCodeUsed(code, meta) {
  const used = readJson(USED_CODES_FILE, {});
  used[code] = { ...meta, usedAt: Date.now() };
  writeJson(USED_CODES_FILE, used);
}

function loadPending() {
  return readJson(PENDING_FILE, {});
}

function savePending(data) {
  writeJson(PENDING_FILE, data);
}

function cleanupPending() {
  const pending = loadPending();
  const now = Date.now();
  let changed = false;
  for (const id of Object.keys(pending)) {
    if (now - pending[id].createdAt > 10 * 60 * 1000) {
      delete pending[id];
      changed = true;
    }
  }
  if (changed) savePending(pending);
}

function createSubscription({ packageId, phone, ip }) {
  cleanupPending();
  const pkg = config.PACKAGES.find((p) => p.id === packageId);
  if (!pkg) {
    return { success: false, message: "Unknown package selected." };
  }

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return { success: false, message: "Enter a valid M-Pesa number (e.g. 0712345678)." };
  }

  const checkoutId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const pending = loadPending();
  pending[checkoutId] = {
    checkoutId,
    packageId: pkg.id,
    amount: pkg.price,
    phone: normalizedPhone,
    ip,
    status: "pending",
    createdAt: Date.now(),
    expiresAt: Date.now() + AUTH_WAIT_MS,
  };
  savePending(pending);

  db.appendPaymentLog({
    checkoutId,
    packageId: pkg.id,
    packageName: pkg.name,
    amount: pkg.price,
    phone: normalizedPhone,
    ip,
    status: "pending",
    createdAt: Date.now(),
  });

  const payHint = config.MPESA_TILL
    ? `Pay KES ${pkg.price} to Till ${config.MPESA_TILL}`
    : config.MPESA_PAYBILL
      ? `Pay KES ${pkg.price} to Paybill ${config.MPESA_PAYBILL}, Account ${config.MPESA_ACCOUNT}`
      : `Complete the M-Pesa prompt on ${normalizedPhone}`;

  return {
    success: true,
    checkoutId,
    message: payHint,
    waitSeconds: AUTH_WAIT_MS / 1000,
    amount: pkg.price,
    phone: normalizedPhone,
  };
}

function getSubscriptionStatus(checkoutId) {
  cleanupPending();
  const pending = loadPending();
  const entry = pending[checkoutId];
  if (!entry) {
    return { success: false, status: "not_found", message: "Session expired. Subscribe again." };
  }

  if (entry.status === "paid") {
    return {
      success: true,
      status: "paid",
      packageId: entry.packageId,
      expiresAt: entry.expiresAtAuth,
    };
  }

  if (Date.now() > entry.expiresAt) {
    return {
      success: false,
      status: "timeout",
      message: "Payment not confirmed in time. Paste your M-Pesa code below or try again.",
    };
  }

  const remaining = Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
  return {
    success: false,
    status: "pending",
    message: `Waiting for M-Pesa confirmation… (${remaining}s)`,
    remainingSeconds: remaining,
  };
}

function completePendingByCode(checkoutId, code) {
  const pending = loadPending();
  const entry = pending[checkoutId];
  if (!entry || entry.status !== "pending") return null;
  entry.status = "paid";
  entry.mpesaCode = code;
  savePending(pending);
  return entry;
}

function verifyMpesaInput({ input, packageId, checkoutId }) {
  const code = extractMpesaCode(input);
  if (!code) {
    return { success: false, message: "Could not find a valid M-Pesa transaction code." };
  }

  if (code === "PAID") {
    return { success: true, message: "Demo payment accepted.", code, demo: true };
  }

  if (isCodeUsed(code)) {
    return { success: false, message: "This M-Pesa code has already been used." };
  }

  if (checkoutId) {
    const pending = loadPending()[checkoutId];
    if (pending && pending.status === "paid" && pending.mpesaCode === code) {
      return { success: true, message: "Payment confirmed.", code, packageId: pending.packageId };
    }
  }

  const pkg = packageId ? config.PACKAGES.find((p) => p.id === packageId) : null;
  if (!pkg && !checkoutId) {
    return {
      success: false,
      message: "Select a package or subscribe first so we can match your payment.",
    };
  }

  return {
    success: true,
    message: "M-Pesa code accepted.",
    code,
    packageId: pkg ? pkg.id : null,
    amount: pkg ? pkg.price : null,
  };
}

function verifyVoucher(code) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) {
    return { success: false, message: "Enter a voucher code." };
  }

  const voucher = config.VOUCHERS.find((v) => v.code.toUpperCase() === normalized);
  if (!voucher) {
    return { success: false, message: "Invalid voucher code." };
  }

  const used = readJson(USED_VOUCHERS_FILE, {});
  if (used[normalized]) {
    return { success: false, message: "This voucher has already been used." };
  }

  used[normalized] = { usedAt: Date.now() };
  writeJson(USED_VOUCHERS_FILE, used);

  return {
    success: true,
    message: "Voucher accepted.",
    packageId: voucher.packageId,
  };
}

function logPaidPayment({ checkoutId, packageId, phone, ip, amount, mpesaCode, source }) {
  const pkg = config.PACKAGES.find((p) => p.id === packageId);
  const log = db.loadPaymentsLog();
  const existing = checkoutId ? log.find((p) => p.checkoutId === checkoutId) : null;

  if (existing) {
    existing.status = "paid";
    existing.paidAt = Date.now();
    existing.mpesaCode = mpesaCode || existing.mpesaCode;
    existing.source = source || existing.source;
    fs.writeFileSync(
      path.join(__dirname, "payments-log.json"),
      JSON.stringify(log, null, 2)
    );
    return existing;
  }

  return db.appendPaymentLog({
    checkoutId: checkoutId || null,
    packageId,
    packageName: pkg ? pkg.name : packageId,
    amount: amount ?? (pkg ? pkg.price : 0),
    phone: phone || null,
    ip,
    mpesaCode: mpesaCode || null,
    status: "paid",
    createdAt: Date.now(),
    paidAt: Date.now(),
    source: source || "mpesa",
  });
}

function listPendingPayments() {
  cleanupPending();
  const pending = loadPending();
  return Object.values(pending)
    .map((entry) => {
      const pkg = config.PACKAGES.find((p) => p.id === entry.packageId);
      return {
        ...entry,
        packageName: pkg ? pkg.name : entry.packageId,
        remainingSeconds: Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000)),
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

function adminConfirmPayment(checkoutId) {
  const pending = loadPending();
  const entry = pending[checkoutId];
  if (!entry) {
    return { success: false, message: "Pending payment not found or expired." };
  }

  const pkg = config.PACKAGES.find((p) => p.id === entry.packageId);
  if (!pkg) {
    return { success: false, message: "Package not found." };
  }

  entry.status = "paid";
  entry.paidAt = Date.now();
  savePending(pending);

  logPaidPayment({
    checkoutId,
    packageId: entry.packageId,
    phone: entry.phone,
    ip: entry.ip,
    amount: entry.amount,
    source: "admin_confirm",
  });

  const authEntry = db.authorize(entry.ip, pkg.id, pkg.durationMinutes, {
    phone: entry.phone,
    amount: entry.amount,
    source: "admin_confirm",
  });

  return {
    success: true,
    message: "Payment confirmed and device authorized.",
    ip: entry.ip,
    expiresAt: authEntry.expiresAt,
  };
}

function adminRejectPayment(checkoutId) {
  const pending = loadPending();
  if (!pending[checkoutId]) {
    return { success: false, message: "Pending payment not found." };
  }
  delete pending[checkoutId];
  savePending(pending);

  const log = db.loadPaymentsLog();
  const entry = log.find((p) => p.checkoutId === checkoutId);
  if (entry) {
    entry.status = "rejected";
    entry.rejectedAt = Date.now();
    fs.writeFileSync(
      path.join(__dirname, "payments-log.json"),
      JSON.stringify(log, null, 2)
    );
  }

  return { success: true, message: "Payment rejected." };
}

function finalizeAuthorization({ code, packageId, ip, phone, checkoutId, source }) {
  const pkg = config.PACKAGES.find((p) => p.id === packageId);
  if (!pkg) {
    return { success: false, message: "Unknown package." };
  }

  if (code && code !== "PAID") {
    markCodeUsed(code, { packageId, ip });
  }

  logPaidPayment({
    checkoutId,
    packageId: pkg.id,
    phone,
    ip,
    amount: pkg.price,
    mpesaCode: code && code !== "PAID" ? code : null,
    source: source || "mpesa",
  });

  return { success: true, message: "Connected.", packageId: pkg.id, durationMinutes: pkg.durationMinutes };
}

module.exports = {
  extractMpesaCode,
  normalizePhone,
  createSubscription,
  getSubscriptionStatus,
  completePendingByCode,
  verifyMpesaInput,
  verifyVoucher,
  finalizeAuthorization,
  listPendingPayments,
  adminConfirmPayment,
  adminRejectPayment,
  loadUsedCodes: () => readJson(USED_CODES_FILE, {}),
  AUTH_WAIT_MS,
};
