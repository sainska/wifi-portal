const fs = require("fs");
const path = require("path");
const supabase = require("./supabase");

const DATA_DIR = process.env.WIFI_PORTAL_DATA_DIR || path.join(__dirname, "..", "..", "data");
const DB_FILE = path.join(DATA_DIR, "authorized.json");
const PAYMENTS_LOG_FILE = path.join(DATA_DIR, "payments-log.json");

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
  void supabase.insertPaymentLog(log[0]);
  return log[0];
}

function normalizeIp(ip) {
  if (!ip) return ip;
  return ip.replace("::ffff:", "");
}

function normalizeMac(mac) {
  if (!mac || typeof mac !== "string") return null;
  const value = mac.trim().replace(/-/g, ":").toUpperCase();
  const parts = value.split(":");
  if (parts.length !== 6 || parts.some((part) => !/^[0-9A-F]{2}$/.test(part))) {
    return null;
  }
  return parts.join(":");
}

function findEntryByMac(data, mac) {
  const normalizedMac = normalizeMac(mac);
  if (!normalizedMac) return null;
  return Object.values(data).find((entry) => normalizeMac(entry.mac) === normalizedMac) || null;
}

function findEntriesByMac(data, mac) {
  const normalizedMac = normalizeMac(mac);
  if (!normalizedMac) return [];
  return Object.entries(data).filter(([ , entry]) => normalizeMac(entry.mac) === normalizedMac);
}

function isExpired(entry) {
  return !entry || Date.now() > entry.expiresAt;
}

function isAuthorized(ip, mac) {
  ip = normalizeIp(ip);
  const data = load();
  const entry = data[ip];
  if (entry && !isExpired(entry)) {
    return true;
  }

  let changed = false;
  if (entry && isExpired(entry)) {
    delete data[ip];
    changed = true;
  }

  const macEntries = findEntriesByMac(data, mac);
  const macEntry = macEntries[0];
  if (macEntry && !isExpired(macEntry[1])) {
    if (changed) save(data);
    return true;
  }

  if (macEntry && isExpired(macEntry[1])) {
    for (const [key] of macEntries) {
      delete data[key];
      changed = true;
    }
  }

  if (changed) {
    save(data);
  }
  return false;
}

function getEntry(ip, mac) {
  return resolveAuthorizationEntry(ip, mac).entry;
}

function resolveAuthorizationEntry(ip, mac) {
  ip = normalizeIp(ip);
  const data = load();
  const normalizedMac = normalizeMac(mac);

  if (ip && data[ip]) {
    const entry = data[ip];
    if (!normalizedMac || !entry.mac || normalizeMac(entry.mac) === normalizedMac) {
      return { key: ip, entry };
    }
  }

  if (normalizedMac) {
    const macEntries = findEntriesByMac(data, normalizedMac);
    if (macEntries.length) {
      const [key, entry] = macEntries[0];
      return { key, entry };
    }
  }

  if (ip && data[ip]) {
    return { key: ip, entry: data[ip] };
  }

  return { key: null, entry: null };
}

function authorize(ip, packageId, durationMinutes, meta = {}) {
  ip = normalizeIp(ip);
  const data = load();
  const now = Date.now();
  const normalizedMac = normalizeMac(meta.mac);
  const existingEntry = data[ip];
  const matchingMacEntries = normalizedMac ? findEntriesByMac(data, normalizedMac) : [];
  const [matchingMacKey, matchingMacEntry] = matchingMacEntries[0] || [];

  if (matchingMacEntry) {
    const retained = matchingMacEntry;
    retained.packageId = retained.packageId || packageId;
    retained.authorizedAt = now;
    retained.expiresAt = now + durationMinutes * 60 * 1000;
    retained.phone = meta.phone || retained.phone || null;
    retained.mpesaCode = meta.mpesaCode || retained.mpesaCode || null;
    retained.amount = meta.amount ?? retained.amount ?? null;
    retained.source = meta.source || retained.source || "mpesa";
    retained.mac = normalizedMac;
    retained.transactionId = meta.transactionId || retained.transactionId || null;
    retained.deviceName = meta.deviceName || retained.deviceName || null;

    if (matchingMacKey !== ip) {
      delete data[ip];
    }
    data[matchingMacKey] = retained;
    save(data);
    void supabase.upsertAuthorizedDevice({ ip: matchingMacKey, ...retained });
    return retained;
  }

  if (existingEntry && existingEntry.mac && normalizedMac && normalizeMac(existingEntry.mac) === normalizedMac) {
    existingEntry.packageId = existingEntry.packageId || packageId;
    existingEntry.authorizedAt = now;
    existingEntry.expiresAt = now + durationMinutes * 60 * 1000;
    existingEntry.phone = meta.phone || existingEntry.phone || null;
    existingEntry.mpesaCode = meta.mpesaCode || existingEntry.mpesaCode || null;
    existingEntry.amount = meta.amount ?? existingEntry.amount ?? null;
    existingEntry.source = meta.source || existingEntry.source || "mpesa";
    existingEntry.mac = normalizedMac;
    existingEntry.transactionId = meta.transactionId || existingEntry.transactionId || null;
    data[ip] = existingEntry;
  } else {
    if (normalizedMac) {
      for (const [key, entry] of Object.entries(data)) {
        if (key !== ip && normalizeMac(entry.mac) === normalizedMac) {
          delete data[key];
        }
      }
    }

    data[ip] = {
      packageId,
      authorizedAt: now,
      expiresAt: now + durationMinutes * 60 * 1000,
      phone: meta.phone || null,
      mpesaCode: meta.mpesaCode || null,
      amount: meta.amount ?? null,
      source: meta.source || "mpesa",
      mac: normalizedMac,
      transactionId: meta.transactionId || null,
      deviceName: meta.deviceName || null,
    };
  }

  save(data);
  void supabase.upsertAuthorizedDevice({ ip, ...data[ip] });
  return data[ip];
}

function extendAuthorization(ip, packageId, durationMinutes, meta = {}) {
  ip = normalizeIp(ip);
  const data = load();
  const now = Date.now();
  const normalizedMac = normalizeMac(meta.mac);
  const existingEntry = ip ? data[ip] : null;
  const matchingMacEntries = normalizedMac ? findEntriesByMac(data, normalizedMac) : [];
  const [matchingMacKey, matchingMacEntry] = matchingMacEntries[0] || [];
  const targetEntry = existingEntry || matchingMacEntry || null;
  const targetKey = targetEntry
    ? Object.keys(data).find((key) => data[key] === targetEntry) || (matchingMacKey || ip || null)
    : (ip || (normalizedMac ? normalizedMac : null));

  if (!targetEntry) {
    if (!targetKey) {
      return null;
    }

    const created = {
      packageId,
      authorizedAt: now,
      expiresAt: now + durationMinutes * 60 * 1000,
      phone: meta.phone || null,
      mpesaCode: meta.mpesaCode || null,
      amount: meta.amount ?? null,
      source: meta.source || "mpesa",
      mac: normalizedMac,
      transactionId: meta.transactionId || null,
      deviceName: meta.deviceName || null,
    };
    data[targetKey] = created;
    save(data);
    void supabase.upsertAuthorizedDevice({ ip: targetKey, ...created });
    return created;
  }

  const retained = { ...targetEntry };
  retained.packageId = packageId;
  retained.authorizedAt = now;
  retained.expiresAt = retained.expiresAt && retained.expiresAt > now
    ? retained.expiresAt + durationMinutes * 60 * 1000
    : now + durationMinutes * 60 * 1000;
  retained.phone = meta.phone || retained.phone || null;
  retained.mpesaCode = meta.mpesaCode || retained.mpesaCode || null;
  retained.amount = meta.amount ?? retained.amount ?? null;
  retained.source = meta.source || retained.source || "mpesa";
  retained.mac = normalizedMac || retained.mac || null;
  retained.transactionId = meta.transactionId || retained.transactionId || null;
  retained.deviceName = meta.deviceName || retained.deviceName || null;

  if (ip && targetKey !== ip && data[ip]) {
    delete data[ip];
  }

  data[targetKey] = retained;
  save(data);
  void supabase.upsertAuthorizedDevice({ ip: targetKey, ...retained });
  return retained;
}

function listAuthorized() {
  const data = load();
  const now = Date.now();
  return Object.entries(data)
    .filter(([, entry]) => entry.expiresAt > now)
    .map(([ip, entry]) => {
      const remainingMs = Math.max(0, entry.expiresAt - now);
      return {
        ip,
        ...entry,
        remainingMs,
        remainingHours: Math.round((remainingMs / (1000 * 60 * 60)) * 10) / 10,
        connectionState: remainingMs > 0 ? "Connected" : "Expired",
      };
    })
    .sort((a, b) => b.authorizedAt - a.authorizedAt);
}

function revoke(ip) {
  ip = normalizeIp(ip);
  const data = load();
  if (data[ip]) {
    delete data[ip];
    save(data);
    void supabase.revokeAuthorizedDevice(ip);
    return true;
  }

  const entryByMac = findEntryByMac(data, ip);
  if (entryByMac) {
    for (const key of Object.keys(data)) {
      if (normalizeMac(data[key].mac) === normalizeMac(entryByMac.mac)) {
        delete data[key];
      }
    }
    save(data);
    void supabase.revokeAuthorizedDevice(entryByMac.ip || ip);
    return true;
  }

  return false;
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
  if (changed) {
    save(data);
    void supabase.cleanupExpiredAuthorizedDevices();
  }
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
  resolveAuthorizationEntry,
  authorize,
  extendAuthorization,
  listAuthorized,
  revoke,
  cleanupExpired,
  normalizeIp,
  normalizeMac,
  loadPaymentsLog,
  appendPaymentLog,
  getStats,
};
