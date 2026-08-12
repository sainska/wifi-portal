const fs = require("fs");
const path = require("path");

const DB_FILE = path.join(__dirname, "authorized.json");
const PAYMENTS_LOG_FILE = path.join(__dirname, "payments-log.json");

function load() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch (e) {
    return {};
  }
}

function save(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function loadPaymentsLog() {
  try {
    return JSON.parse(fs.readFileSync(PAYMENTS_LOG_FILE, "utf8"));
  } catch {
    return [];
  }
}

function appendPaymentLog(entry) {
  const log = loadPaymentsLog();
  log.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ...entry });
  if (log.length > 500) log.length = 500;
  fs.writeFileSync(PAYMENTS_LOG_FILE, JSON.stringify(log, null, 2));
  return log[0];
}

function normalizeIp(ip) {
  if (!ip) return ip;
  return ip.replace("::ffff:", "");
}

function isAuthorized(ip) {
  ip = normalizeIp(ip);
  const data = load();
  const entry = data[ip];
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    delete data[ip];
    save(data);
    return false;
  }
  return true;
}

function getEntry(ip) {
  ip = normalizeIp(ip);
  const data = load();
  return data[ip] || null;
}

function authorize(ip, packageId, durationMinutes, meta = {}) {
  ip = normalizeIp(ip);
  const data = load();
  const now = Date.now();
  data[ip] = {
    packageId,
    authorizedAt: now,
    expiresAt: now + durationMinutes * 60 * 1000,
    phone: meta.phone || null,
    mpesaCode: meta.mpesaCode || null,
    amount: meta.amount ?? null,
    source: meta.source || "mpesa",
  };
  save(data);
  return data[ip];
}

function listAuthorized() {
  const data = load();
  const now = Date.now();
  return Object.entries(data)
    .filter(([, entry]) => entry.expiresAt > now)
    .map(([ip, entry]) => ({ ip, ...entry }))
    .sort((a, b) => b.authorizedAt - a.authorizedAt);
}

function revoke(ip) {
  ip = normalizeIp(ip);
  const data = load();
  if (!data[ip]) return false;
  delete data[ip];
  save(data);
  return true;
}

function cleanupExpired() {
  const data = load();
  const now = Date.now();
  let changed = false;
  for (const ip of Object.keys(data)) {
    if (data[ip].expiresAt < now) {
      delete data[ip];
      changed = true;
    }
  }
  if (changed) save(data);
}

function getStats(config) {
  const authorized = listAuthorized();
  const payments = loadPaymentsLog();
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayPayments = payments.filter(
    (p) => p.status === "paid" && p.paidAt >= todayStart.getTime()
  );
  const revenueToday = todayPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const revenueTotal = payments
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + (p.amount || 0), 0);

  return {
    activeDevices: authorized.length,
    pendingPayments: 0,
    revenueToday,
    revenueTotal,
    paymentsToday: todayPayments.length,
    hotspotName: config.HOTSPOT_SSID,
    portalIp: config.PORTAL_IP,
  };
}

module.exports = {
  isAuthorized,
  getEntry,
  authorize,
  listAuthorized,
  revoke,
  cleanupExpired,
  normalizeIp,
  loadPaymentsLog,
  appendPaymentLog,
  getStats,
};
