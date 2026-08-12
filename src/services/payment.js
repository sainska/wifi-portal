const fs = require("fs");
const path = require("path");
const config = require("../config");
const db = require("./db");
const supabase = require("./supabase");

const DATA_DIR = process.env.WIFI_PORTAL_DATA_DIR || path.join(__dirname, "..", "..", "data");
const USED_CODES_FILE = path.join(DATA_DIR, "used-codes.json");
const PENDING_FILE = path.join(DATA_DIR, "pending-payments.json");
const USED_VOUCHERS_FILE = path.join(DATA_DIR, "used-vouchers.json");
const VOUCHER_REDEMPTIONS_FILE = path.join(DATA_DIR, "voucher-redemptions.json");
const MPESA_CONNECTIONS_FILE = path.join(DATA_DIR, "mpesa-code-connections.json");

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
  if (digits.startsWith("254") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return `+254${digits.slice(1)}`;
  if (digits.length === 9) return `+254${digits}`;
  if (digits.length >= 9) return `+${digits}`;
  return null;
}

function getSearchableText(record) {
  const rawPhone = record?.phone ? String(record.phone) : "";
  const normalizedPhone = rawPhone ? normalizePhone(rawPhone) : null;
  const phoneDigits = normalizedPhone ? normalizedPhone.replace(/\D/g, "") : "";
  const rawPhoneDigits = rawPhone.replace(/\D/g, "");
  const localPhoneVariant = rawPhoneDigits.startsWith("254") ? `0${rawPhoneDigits.slice(3)}` : rawPhoneDigits;
  return [
    record?.checkoutId,
    record?.checkout_id,
    record?.packageId,
    record?.package_id,
    record?.packageName,
    record?.package_name,
    record?.phone,
    normalizedPhone,
    phoneDigits,
    rawPhoneDigits,
    localPhoneVariant,
    record?.ip,
    record?.mac,
    record?.mpesaCode,
    record?.mpesa_code,
    record?.transactionId,
    record?.transaction_id,
    record?.source,
    record?.authorizedBy,
    record?.authorized_by,
    record?.status,
    record?.amount,
    record?.paystackReference,
    record?.paystack_reference,
    record?.deviceName,
    record?.device_name,
  ]
    .filter((value) => value != null && value !== "")
    .map((value) => String(value))
    .join(" ")
    .toLowerCase();
}

function filterRecordsBySearchQuery(records, query) {
  const value = String(query || "").trim().toLowerCase();
  if (!value) return Array.isArray(records) ? records : [];
  return (Array.isArray(records) ? records : []).filter((record) => getSearchableText(record).includes(value));
}

function resolveTransactionId(payload, fallbackReference = null) {
  const raw = payload?.data || payload || {};
  const receipt = raw.receipt_number || raw.receiptNumber || raw.transaction_code || raw.transactionCode || raw.reference || null;
  return receipt || fallbackReference || null;
}

function isCodeUsed(code) {
  const used = readJson(USED_CODES_FILE, {});
  return Boolean(used[code]);
}

function markCodeUsed(code, meta) {
  const used = readJson(USED_CODES_FILE, {});
  used[code] = { ...meta, usedAt: Date.now() };
  writeJson(USED_CODES_FILE, used);
  void supabase.markCodeUsed(code, { packageId: meta.packageId, ip: meta.ip, meta });
}

function loadPending() {
  return readJson(PENDING_FILE, {});
}

function savePending(data) {
  writeJson(PENDING_FILE, data);
}

function loadVoucherRedemptions() {
  return readJson(VOUCHER_REDEMPTIONS_FILE, []);
}

function saveVoucherRedemptions(data) {
  writeJson(VOUCHER_REDEMPTIONS_FILE, data);
}

function loadMpesaConnections() {
  return readJson(MPESA_CONNECTIONS_FILE, []);
}

function saveMpesaConnections(data) {
  writeJson(MPESA_CONNECTIONS_FILE, data);
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

function deletePendingPayment(checkoutId) {
  const pending = loadPending();
  if (pending[checkoutId]) {
    delete pending[checkoutId];
    savePending(pending);
  }
  void supabase.deletePendingPayment(checkoutId);
}

function appendVoucherRedemption(entry) {
  const redemptions = loadVoucherRedemptions();
  redemptions.unshift(entry);
  if (redemptions.length > 500) redemptions.length = 500;
  saveVoucherRedemptions(redemptions);
  void supabase.insertVoucherRedemption(entry);
}

function appendMpesaCodeConnection(entry) {
  const connections = loadMpesaConnections();
  connections.unshift(entry);
  if (connections.length > 500) connections.length = 500;
  saveMpesaConnections(connections);
  void supabase.insertMpesaCodeConnection(entry);
}

function updatePaymentState(checkoutId, { status, paidAt, rejectedAt, paystackReference, paystackAuthorizationUrl, source, packageId, packageName, phone, ip, amount, mpesaCode, mac, transactionId, authorizedBy, authorizedAt, isManual }) {
  const pendingStore = loadPending();
  const entry = pendingStore[checkoutId] || null;
  if (entry) {
    if (status) entry.status = status;
    if (paidAt) entry.paidAt = paidAt;
    if (rejectedAt) entry.rejectedAt = rejectedAt;
    if (paystackReference != null) entry.paystackReference = paystackReference;
    if (paystackAuthorizationUrl != null) entry.paystackAuthorizationUrl = paystackAuthorizationUrl;
    if (source) entry.source = source;
    if (packageId) entry.packageId = packageId;
    if (packageName) entry.packageName = packageName;
    if (phone) entry.phone = phone;
    if (ip) entry.ip = ip;
    if (amount != null) entry.amount = amount;
    if (mpesaCode != null) entry.mpesaCode = mpesaCode;
    if (mac != null) entry.mac = mac;
    if (transactionId != null) entry.transactionId = transactionId;
    if (authorizedBy != null) entry.authorizedBy = authorizedBy;
    if (authorizedAt != null) entry.authorizedAt = authorizedAt;
    if (isManual != null) entry.isManual = isManual;
    savePending(pendingStore);
  }

  void supabase.updatePendingPayment(checkoutId, {
    status,
    paidAt,
    rejectedAt,
    paystackReference,
    paystackAuthorizationUrl,
    mac,
    transactionId,
    authorizedBy,
    authorizedAt,
    isManual,
  });
  void supabase.updatePaymentLog(checkoutId, {
    status,
    paidAt,
    rejectedAt,
    paystackReference,
    paystackAuthorizationUrl,
    source,
    packageId,
    packageName,
    phone,
    ip,
    amount,
    mpesaCode,
    mac,
    transactionId,
    authorizedBy,
    authorizedAt,
    isManual,
  });
}

function ensurePaymentAllowed({ phone, ip, mac, packageId }) {
  const normalizedPhone = phone ? normalizePhone(phone) : null;
  const normalizedMac = db.normalizeMac ? db.normalizeMac(mac) : null;
  const pkg = config.PACKAGES.find((p) => p.id === packageId);
  const activeEntries = db.listAuthorized();

  const activeByMac = normalizedMac
    ? activeEntries.filter((entry) => entry.mac && entry.mac === normalizedMac)
    : [];
  if (activeByMac.length > 0) {
    const samePackageMac = activeByMac.find((entry) => entry.packageId === packageId);
    if (samePackageMac) {
      return { success: true };
    }
    const activePackage = config.PACKAGES.find((p) => p.id === activeByMac[0].packageId);
    return {
      success: false,
      message: `This device is already connected with an active ${activePackage ? activePackage.name : activeByMac[0].packageId} package. One physical device can only use one active connection at a time.`,
      activePackageId: activeByMac[0].packageId,
    };
  }

  const activeByPhone = normalizedPhone
    ? activeEntries.filter((entry) => entry.phone && entry.phone === normalizedPhone)
    : [];
  if (activeByPhone.length > 0) {
    const samePackageEntries = activeByPhone.filter((entry) => entry.packageId === packageId);
    if (samePackageEntries.length > 0 && pkg) {
      if (samePackageEntries.length < pkg.devices) {
        return { success: true };
      }
      return {
        success: false,
        message: `This phone already has ${samePackageEntries.length} active connection${samePackageEntries.length === 1 ? "" : "s"} for ${pkg.name}. Upgrade to a larger package or wait for existing access to expire before connecting more devices.`,
        activePackageId: pkg.id,
      };
    }

    const activePackage = config.PACKAGES.find((p) => p.id === activeByPhone[0].packageId);
    return {
      success: false,
      message: `This phone is already associated with an active ${activePackage ? activePackage.name : activeByPhone[0].packageId} connection. Use that package or wait until it expires before buying a different package.`,
      activePackageId: activeByPhone[0].packageId,
    };
  }

  return { success: true };
}

const PAYSTACK_WAIT_MS = 5 * 60_000;

async function adminExtendAccess({ identifier = null, ip = null, mac = null, phone = null, amount = null, package: packageName = null, authorizedBy = null, transactionId = null } = {}) {
  const now = Date.now();
  const normalizedPhone = phone ? normalizePhone(phone) : null;
  const pkg = config.PACKAGES.find((p) => p.id === packageName || p.name === packageName) || null;
  if (!pkg) {
    return { success: false, message: 'Unknown package selected.' };
  }

  const packageId = pkg.id;
  const targetIp = ip || null;
  const targetMac = mac || null;
  const lookupMac = targetMac || identifier || null;

  if (!targetIp && !lookupMac) {
    return { success: false, message: 'Enter a device IP or MAC address to extend.' };
  }

  const resolved = db.resolveAuthorizationEntry(targetIp, lookupMac);
  let resolvedIp = resolved.key || targetIp;
  const existingEntry = resolved.entry;

  if (!resolvedIp && lookupMac) {
    try {
      const network = require('./network');
      const arp = await network.getArpEntries();
      const match = (arp || []).find((e) => network.normalizeMac(e.mac) === network.normalizeMac(lookupMac));
      if (match) resolvedIp = match.ip;
    } catch (err) {
      // ignore
    }
  }

  const wasActive = Boolean(existingEntry && existingEntry.expiresAt > now);
  const previousRemainingMs = wasActive ? Math.max(0, existingEntry.expiresAt - now) : 0;

  const authEntry = db.extendAuthorization(resolvedIp || targetIp || identifier || null, packageId, pkg.durationMinutes, {
    phone: normalizedPhone || null,
    amount: amount != null ? Number(amount) : pkg.price,
    source: 'admin-extend',
    mac: targetMac || lookupMac || null,
    transactionId: transactionId || `extend:${now}`,
  });

  if (!authEntry) {
    return { success: false, message: 'Could not locate the device to extend.' };
  }

  const formatRemaining = (ms) => {
    const totalMinutes = Math.max(1, Math.round(ms / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours && minutes) return `${hours}h ${minutes}m`;
    if (hours) return `${hours}h`;
    return `${minutes}m`;
  };

  let message = 'Package access extended successfully.';
  if (wasActive) {
    message = `Added ${pkg.name} to ${formatRemaining(previousRemainingMs)} remaining. New expiry: ${new Date(authEntry.expiresAt).toLocaleString()}.`;
  } else if (existingEntry) {
    message = `Restarted expired session with ${pkg.name}. New expiry: ${new Date(authEntry.expiresAt).toLocaleString()}.`;
  } else {
    message = `Granted new ${pkg.name} access. Expires: ${new Date(authEntry.expiresAt).toLocaleString()}.`;
  }

  const entry = {
    checkoutId: transactionId || `extend-${now}-${Math.random().toString(36).slice(2, 6)}`,
    packageId: authEntry.packageId,
    packageName: pkg.name,
    amount: amount != null ? Number(amount) : pkg.price,
    phone: normalizedPhone,
    ip: resolvedIp || targetIp || null,
    mac: targetMac || authEntry.mac || null,
    status: 'paid',
    createdAt: now,
    paidAt: now,
    source: 'admin-extend',
    isManual: true,
    authorizedBy: authorizedBy || 'Admin',
    authorizedAt: now,
    transactionId: transactionId || `extend:${now}`,
  };

  const saved = db.appendPaymentLog(entry);
  try { void supabase.insertPaymentLog(saved); } catch {}

  return {
    success: true,
    message,
    packageId: authEntry.packageId,
    expiresAt: authEntry.expiresAt,
    authorized: Boolean(authEntry.expiresAt && authEntry.expiresAt > Date.now()),
    stacked: wasActive,
    previousRemainingMs,
    addedMinutes: pkg.durationMinutes,
    transactionId: entry.transactionId,
    authorizedBy: entry.authorizedBy,
  };
}

async function adminManualSale({ ip = null, mac = null, phone = null, amount = null, package: packageName = null, authorizedBy = null, transactionId = null } = {}) {
  const now = Date.now();
  const checkoutId = `manual-${now}-${Math.random().toString(36).slice(2, 6)}`;
  const normalizedPhone = phone ? normalizePhone(phone) : null;

  // Resolve package by id or name
  const pkg = config.PACKAGES.find((p) => p.id === packageName || p.name === packageName) || null;
  const packageId = pkg ? pkg.id : (packageName || null);
  const packageLabel = pkg ? pkg.name : (packageName || null);
  const numericAmount = amount != null ? Number(amount) : (pkg ? pkg.price : 0);

  const entry = {
    checkoutId,
    packageId: pkg ? pkg.id : packageId,
    packageName: packageLabel,
    amount: numericAmount,
    phone: normalizedPhone,
    ip: ip || null,
    mac: mac || null,
    status: 'paid',
    createdAt: now,
    paidAt: now,
    source: 'manual-admin',
    isManual: true,
    authorizedBy: authorizedBy || 'Admin',
    authorizedAt: now,
    transactionId: transactionId || `manual:${checkoutId}`,
  };

  // Persist to payments log (local + supabase insert)
  const saved = db.appendPaymentLog({
    checkoutId: entry.checkoutId,
    packageId: entry.packageId,
    packageName: entry.packageName,
    amount: entry.amount,
    phone: entry.phone,
    ip: entry.ip,
    mac: entry.mac,
    status: 'paid',
    createdAt: entry.createdAt,
    paidAt: entry.paidAt,
    source: entry.source,
  });

  // Optionally authorize device if we can resolve a package and an IP
  let authorized = false;
  let authEntry = null;
  try {
    let targetIp = entry.ip;
    if (!targetIp && entry.mac) {
      // try to resolve MAC to IP using ARP table (best-effort)
      try {
        const network = require('./network');
        const arp = await network.getArpEntries();
        const match = (arp || []).find((e) => network.normalizeMac(e.mac) === network.normalizeMac(entry.mac));
        if (match) targetIp = match.ip;
      } catch (err) {
        // ignore
      }
    }

    if (pkg && targetIp) {
      authEntry = db.authorize(targetIp, pkg.id, pkg.durationMinutes, {
        phone: normalizedPhone || null,
        amount: numericAmount,
        source: 'manual-admin',
        mac: entry.mac || null,
        transactionId: `manual:${checkoutId}`,
      });
      authorized = Boolean(authEntry && authEntry.expiresAt && authEntry.expiresAt > Date.now());
    }
  } catch (err) {
    // authorization best-effort
    console.error('adminManualSale authorize error', err);
  }

  // Inform supabase about paid payment if available
  try { void supabase.insertPaymentLog(saved); } catch {}

  return {
    success: true,
    message: 'Manual sale recorded' + (authorized ? ' and device authorized.' : '.'),
    checkoutId,
    authorized,
    expiresAt: authEntry ? authEntry.expiresAt : null,
    transactionId: entry.transactionId,
    authorizedBy: entry.authorizedBy,
  };
}

function createPendingPayment({ packageId, phone, ip, source = "mpesa", paystackReference = null, paystackAuthorizationUrl = null, mac = null }) {
  cleanupPending();
  const pkg = config.PACKAGES.find((p) => p.id === packageId);
  if (!pkg) {
    return { success: false, message: "Unknown package selected." };
  }

  const normalizedPhone = phone ? normalizePhone(phone) : null;
  if (source === "mpesa" && !normalizedPhone) {
    return { success: false, message: "Enter a valid M-Pesa number (e.g. 0712345678)." };
  }

  const duplicateCheck = ensurePaymentAllowed({ phone: normalizedPhone, ip, mac, packageId: pkg.id });
  if (!duplicateCheck.success) {
    return duplicateCheck;
  }

  const checkoutId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = Date.now();
  const expiresAt = createdAt + (source === "paystack" ? PAYSTACK_WAIT_MS : AUTH_WAIT_MS);
  const pending = loadPending();
  pending[checkoutId] = {
    checkoutId,
    packageId: pkg.id,
    packageName: pkg.name,
    amount: pkg.price,
    phone: normalizedPhone,
    ip,
    mac,
    status: "pending",
    createdAt,
    expiresAt,
    source,
    paystackReference,
    paystackAuthorizationUrl,
  };
  savePending(pending);

  const pendingEntry = {
    checkoutId,
    packageId: pkg.id,
    packageName: pkg.name,
    amount: pkg.price,
    phone: normalizedPhone,
    ip,
    mac,
    status: "pending",
    createdAt,
    expiresAt,
    source,
    paystackReference,
    paystackAuthorizationUrl,
  };

  db.appendPaymentLog({
    ...pendingEntry,
  });

  return {
    success: true,
    checkoutId,
    amount: pkg.price,
    phone: normalizedPhone,
    packageId: pkg.id,
    packageName: pkg.name,
    source,
    expiresAt,
  };
}

function persistPendingRemote(entry) {
  if (!entry) return;
  void supabase.insertPendingPayment(entry);
  void supabase.insertPaymentLog(entry);
}

function createSubscription({ packageId, phone, ip, mac = null }) {
  const result = createPendingPayment({ packageId, phone, ip, source: "mpesa", mac });
  if (!result.success) return result;

  const pkg = config.PACKAGES.find((p) => p.id === packageId);
  const payHint = config.MPESA_TILL
    ? `Pay KES ${pkg.price} to Till ${config.MPESA_TILL}`
    : config.MPESA_PAYBILL
      ? `Pay KES ${pkg.price} to Paybill ${config.MPESA_PAYBILL}, Account ${config.MPESA_ACCOUNT}`
      : `Complete the M-Pesa prompt on ${result.phone}`;

  return {
    success: true,
    checkoutId: result.checkoutId,
    message: payHint,
    waitSeconds: AUTH_WAIT_MS / 1000,
    amount: pkg.price,
    phone: result.phone,
  };
}

async function initiatePaystackPayment({ packageId, phone, ip, callbackUrl, mac = null }) {
  if (!config.PAYSTACK_SECRET_KEY) {
    const fallback = createPendingPayment({ packageId, phone, ip, source: "paystack", mac });
    if (!fallback.success) return fallback;
    return {
      success: true,
      checkoutId: fallback.checkoutId,
      reference: fallback.checkoutId,
      authorizationUrl: null,
      amount: fallback.amount,
      currency: config.PAYSTACK_CURRENCY || "KES",
      manualMode: true,
      message: "Paystack is not configured, so the portal will continue with the manual payment fallback.",
    };
  }

  const result = createPendingPayment({ packageId, phone, ip, source: "paystack", mac });
  if (!result.success) return result;

  const accessEmail = result.phone
    ? `guest+${result.phone.replace(/\D/g, "")}@gmail.com`
    : "guest@gmail.com";
  const amountInKobo = Math.round(result.amount * 100);

  try {
    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: accessEmail,
        amount: amountInKobo,
        currency: config.PAYSTACK_CURRENCY || "NGN",
        reference: result.checkoutId,
        callback_url: callbackUrl || undefined,
        metadata: {
          checkoutId: result.checkoutId,
          packageId: result.packageId,
          source: "paystack",
        },
      }),
    });

    const data = await response.json();
    if (!data.status) {
      deletePendingPayment(result.checkoutId);
      return { success: false, message: data.message || "Unable to initialize Paystack payment." };
    }

    const paystackReference = data.data.reference || result.checkoutId;
    const paystackAuthorizationUrl = data.data.authorization_url || null;
    const pending = loadPending();
    if (pending[result.checkoutId]) {
      pending[result.checkoutId].paystackReference = paystackReference;
      pending[result.checkoutId].paystackAuthorizationUrl = paystackAuthorizationUrl;
      pending[result.checkoutId].status = "pending";
      savePending(pending);
      persistPendingRemote(pending[result.checkoutId]);
      void supabase.updatePendingPayment(result.checkoutId, {
        status: "pending",
        paystackReference,
        paystackAuthorizationUrl,
      });
      void supabase.updatePaymentLog(result.checkoutId, {
        status: "pending",
        paystackReference,
        paystackAuthorizationUrl,
      });
    }

    return {
      success: true,
      checkoutId: result.checkoutId,
      reference: paystackReference,
      accessCode: data.data.access_code,
      authorizationUrl: paystackAuthorizationUrl,
      amount: result.amount,
      currency: config.PAYSTACK_CURRENCY,
    };
  } catch (error) {
    deletePendingPayment(result.checkoutId);
    return { success: false, message: error?.message || "Paystack initialization failed." };
  }
}

async function initiatePaystackChargeMobile({ packageId, phone, ip, provider, mac = null }) {
  const result = createPendingPayment({ packageId, phone, ip, source: "paystack", mac });
  if (!result.success) return result;

  if (!config.PAYSTACK_SECRET_KEY) {
    const displayText = `Payment is being handled manually. Please contact support or use the M-Pesa code flow. Checkout ${result.checkoutId}`;
    return {
      success: true,
      paid: false,
      manualMode: true,
      checkoutId: result.checkoutId,
      reference: result.checkoutId,
      displayText,
      waitSeconds: PAYSTACK_WAIT_MS / 1000,
      message: "Paystack is not configured; the portal is using the manual fallback flow.",
    };
  }

  if (!result.success) return result;

  const accessEmail = result.phone
    ? `guest+${result.phone.replace(/\D/g, "")}@gmail.com`
    : "guest@gmail.com";
  const amountInKobo = Math.round(result.amount * 100);

  try {
    const paystackPhone = normalizePhone(phone) || normalizePhone(result.phone) || phone;
    const body = {
      amount: amountInKobo,
      email: accessEmail,
      currency: config.PAYSTACK_CURRENCY || "NGN",
      mobile_money: {
        phone: paystackPhone,
        provider: provider || config.PAYSTACK_MOBILE_PROVIDER,
      },
      metadata: {
        checkoutId: result.checkoutId,
        packageId: result.packageId,
        source: "paystack_mobile",
      },
      reference: result.checkoutId,
    };

    const response = await fetch("https://api.paystack.co/charge", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!data.status) {
      deletePendingPayment(result.checkoutId);
      return { success: false, message: data.message || "Unable to initiate mobile charge." };
    }

    const charge = data.data || {};
    const pending = loadPending();
    if (pending[result.checkoutId]) {
      pending[result.checkoutId].paystackReference = charge.reference || result.checkoutId;
      pending[result.checkoutId].paystackAuthorizationUrl = charge.authorization_url || null;
      pending[result.checkoutId].status = "pending";
      savePending(pending);
      persistPendingRemote(pending[result.checkoutId]);
      void supabase.updatePendingPayment(result.checkoutId, {
        status: "pending",
        paystackReference: charge.reference || result.checkoutId,
        paystackAuthorizationUrl: charge.authorization_url || null,
      });
      void supabase.updatePaymentLog(result.checkoutId, {
        status: "pending",
        paystackReference: charge.reference || result.checkoutId,
        paystackAuthorizationUrl: charge.authorization_url || null,
      });
    }

    // If charge returned success, treat as paid
    if (charge.status === "success") {
      // Mark paid and authorize
      const verifyResult = await verifyPaystackReference(charge.reference || result.checkoutId, ip, true, mac);
      return {
        success: true,
        paid: true,
        result: verifyResult,
        reference: charge.reference || result.checkoutId,
        checkoutId: result.checkoutId,
        waitSeconds: PAYSTACK_WAIT_MS / 1000,
      };
    }

    // Otherwise return pending state and any instructions (display_text)
    return {
      success: true,
      paid: false,
      status: charge.status || "pending",
      displayText: charge.display_text || null,
      reference: charge.reference || result.checkoutId,
      requiredAction: charge,
      checkoutId: result.checkoutId,
      authorizationUrl: charge.authorization_url || null,
      waitSeconds: PAYSTACK_WAIT_MS / 1000,
    };
  } catch (error) {
    deletePendingPayment(result.checkoutId);
    return { success: false, message: error?.message || "Paystack charge failed." };
  }
}

async function verifyPaystackReference(reference, ip, shouldAuthorize = true, mac = null) {
  if (!reference) {
    return { success: false, message: "Missing Paystack reference." };
  }

  if (!config.PAYSTACK_SECRET_KEY) {
    return { success: false, message: "Paystack is not configured." };
  }

  try {
    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${config.PAYSTACK_SECRET_KEY}`,
        },
      }
    );
    const data = await response.json();
    if (!data.status || data.data.status !== "success") {
      return { success: false, message: data.message || "Payment not verified." };
    }

    const checkoutId = data.data.reference;
    const transactionId = resolveTransactionId(data, checkoutId);
    const pendingLocal = loadPending()[checkoutId];
    const pendingRemote = pendingLocal ? null : await supabase.getPendingPayment(checkoutId);
    const pending = pendingLocal || pendingRemote;
    if (!pending) {
      return { success: false, message: "Payment session not found." };
    }

    if (pending.status === "paid") {
      if (shouldAuthorize) {
        const pkg = config.PACKAGES.find((p) => p.id === pending.packageId);
        const entry = db.authorize(ip, pending.packageId, pkg ? pkg.durationMinutes : 0, {
          phone: pending.phone,
          amount: pending.amount,
          source: "paystack",
          mac,
          transactionId: transactionId || pending.mpesaCode || null,
        });
        return { success: true, expiresAt: entry.expiresAt, packageId: pending.packageId };
      }
      return { success: true, expiresAt: pending.expiresAt, packageId: pending.packageId };
    }

    const now = Date.now();
    const expiresAt = pending.expiresAt || now;
    if (now > expiresAt) {
      return { success: false, message: "Payment session has expired." };
    }

    updatePaymentState(checkoutId, {
      status: "paid",
      paidAt: now,
      paystackReference: reference,
      source: "paystack",
      packageId: pending.packageId,
      packageName: pending.packageName,
      phone: pending.phone,
      ip,
      amount: pending.amount,
      mpesaCode: transactionId || pending.mpesaCode,
      mac,
      transactionId,
    });

    const updated = {
      ...pending,
      status: "paid",
      paidAt: now,
      paystackReference: reference,
      source: "paystack",
      phone: pending.phone,
      packageId: pending.packageId,
      packageName: pending.packageName,
      amount: pending.amount,
      mac,
      mpesaCode: transactionId || pending.mpesaCode,
      transactionId,
    };

    const pendingStore = loadPending();
    if (pendingStore[checkoutId]) {
      pendingStore[checkoutId] = updated;
      savePending(pendingStore);
    }

    logPaidPayment({
      checkoutId,
      packageId: updated.packageId,
      phone: updated.phone,
      ip,
      amount: updated.amount,
      source: "paystack",
      paystackReference: reference,
      mpesaCode: updated.mpesaCode || transactionId,
      mac,
    });

    if (!shouldAuthorize) {
      return { success: true, expiresAt: updated.expiresAt, packageId: updated.packageId };
    }

    const pkg = config.PACKAGES.find((p) => p.id === updated.packageId);
    const authEntry = db.authorize(updated.ip, updated.packageId, pkg ? pkg.durationMinutes : 0, {
      phone: updated.phone,
      amount: updated.amount,
      source: "paystack",
      mac,
      transactionId: transactionId || updated.mpesaCode || null,
    });

    return { success: true, expiresAt: authEntry.expiresAt, packageId: updated.packageId };
  } catch (error) {
    return { success: false, message: error?.message || "Paystack verification failed." };
  }
}

async function getSubscriptionStatus(checkoutId) {
  cleanupPending();
  let entry = loadPending()[checkoutId];
  if (!entry) {
    entry = await supabase.getPendingPayment(checkoutId);
  }

  if (!entry) {
    return { success: false, status: "not_found", message: "Session expired. Subscribe again." };
  }

  if (entry.status === "paid") {
    return {
      success: true,
      status: "paid",
      packageId: entry.packageId,
      expiresAt: entry.expiresAtAuth || entry.expiresAt,
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
  entry.paidAt = Date.now();
  savePending(pending);
  void supabase.updatePendingPayment(checkoutId, {
    status: "paid",
    mpesaCode: code,
    paidAt: entry.paidAt,
  });
  return entry;
}

async function getPendingSession(checkoutId) {
  if (!checkoutId) return null;
  const local = loadPending()[checkoutId];
  if (local) return local;
  return await supabase.getPendingPayment(checkoutId);
}

async function findPaidPendingByCode(code) {
  if (!code) return null;
  const local = Object.values(loadPending()).find((entry) => entry.status === "paid" && entry.mpesaCode === code);
  if (local) return local;

  const remote = await supabase.fetchPendingPayments();
  if (!remote || !remote.length) return null;
  return remote.find((entry) => entry.status === "paid" && entry.mpesaCode === code) || null;
}

function findActiveCodeBinding(code, normalizedPhone = null, packageId = null, currentMac = null) {
  const activeEntries = db.listAuthorized();
  return activeEntries.find((entry) => {
    const sameCode = entry.mpesaCode === code || entry.transactionId === code;
    const samePhone = normalizedPhone ? entry.phone === normalizedPhone : false;
    const samePackage = packageId ? entry.packageId === packageId : false;
    const differentDevice = !currentMac || !entry.mac || entry.mac !== currentMac;
    return differentDevice && (sameCode || (samePhone && samePackage));
  }) || null;
}

function prepareRebindForCode({ code, packageId, phone, ip, mac, source = "mpesa_code" }) {
  const pkg = config.PACKAGES.find((p) => p.id === packageId);
  if (!pkg || !code) {
    return { success: false, state: "missing_code", message: "Missing M-Pesa code for rebind." };
  }

  const normalizedPhone = phone ? normalizePhone(phone) : null;
  const currentMac = db.normalizeMac(mac);
  const activeEntries = db.listAuthorized();
  const conflictingEntries = activeEntries.filter((entry) => {
    const sameCode = entry.mpesaCode === code || entry.transactionId === code;
    const samePhone = normalizedPhone ? entry.phone === normalizedPhone : false;
    const samePackage = entry.packageId === pkg.id;
    const differentDevice = !currentMac || !entry.mac || entry.mac !== currentMac;
    return differentDevice && (sameCode || (samePhone && samePackage));
  });

  if (pkg.devices <= 1 && conflictingEntries.length > 0) {
    conflictingEntries.forEach((entry) => {
      db.revoke(entry.ip);
    });

    const authorizedEntry = db.authorize(ip, pkg.id, pkg.durationMinutes, {
      phone: normalizedPhone || null,
      mpesaCode: code,
      amount: pkg.price,
      source,
      mac: db.normalizeMac(mac),
      transactionId: code,
    });

    return {
      success: true,
      state: "rebound",
      message: "The portal re-bound the existing connection to this device.",
      rebinded: true,
      packageId: pkg.id,
      packageName: pkg.name,
      liveState: authorizedEntry?.expiresAt && authorizedEntry.expiresAt > Date.now() ? "live" : "pending",
    };
  }

  const samePhonePackageEntries = activeEntries.filter((entry) => {
    const samePhone = normalizedPhone ? entry.phone === normalizedPhone : false;
    const samePackage = entry.packageId === pkg.id;
    const differentDevice = !currentMac || !entry.mac || entry.mac !== currentMac;
    return differentDevice && samePhone && samePackage;
  });

  if (pkg.devices > 1 && samePhonePackageEntries.length >= pkg.devices) {
    return {
      success: false,
      state: "package_limit_reached",
      message: `This package allows ${pkg.devices} active device${pkg.devices === 1 ? "" : "s"}. Please wait for an existing connection to expire or remove one first.`,
      packageId: pkg.id,
      packageName: pkg.name,
    };
  }

  return {
    success: true,
    state: "ready",
    message: "The package is available for this device.",
    rebinded: false,
    packageId: pkg.id,
    packageName: pkg.name,
    liveState: ip ? "live" : "pending",
  };
}

async function verifyMpesaInput({ input, packageId, checkoutId, phone, mac = null }) {
  const code = extractMpesaCode(input);
  if (!code) {
    return { success: false, message: "Could not find a valid M-Pesa transaction code." };
  }

  if (code === "PAID") {
    return { success: true, message: "Demo payment accepted.", code, demo: true, state: "demo" };
  }

  const normalizedPhone = phone ? normalizePhone(phone) : null;
  const pkg = packageId ? config.PACKAGES.find((p) => p.id === packageId) : null;
  const pending = checkoutId ? await getPendingSession(checkoutId) : null;
  const currentMac = db.normalizeMac(mac);
  const activeBinding = findActiveCodeBinding(code, normalizedPhone, pkg?.id, currentMac);

  if (activeBinding) {
    return {
      success: false,
      state: "bound_to_other_device",
      message: "This M-Pesa code is already tied to another active device. The portal can rebind it to this device if the package allows it.",
      code,
      packageId: pkg?.id || activeBinding.packageId || null,
      phone: normalizedPhone || activeBinding.phone || null,
      activeBinding: {
        ip: activeBinding.ip,
        mac: activeBinding.mac,
        packageId: activeBinding.packageId,
        packageName: config.PACKAGES.find((p) => p.id === activeBinding.packageId)?.name || activeBinding.packageId,
      },
      rebindable: true,
    };
  }

  if (isCodeUsed(code)) {
    return {
      success: false,
      state: "code_used",
      message: "This M-Pesa code has already been used. The portal can only restore an active package if the phone and package still match.",
      code,
      packageId: pkg?.id || null,
      phone: normalizedPhone || null,
    };
  }

  if (checkoutId) {
    if (!pending) {
      return {
        success: false,
        message: "This payment session could not be found or has expired. Please start again and use the same checkout session.",
        state: "checkout_missing",
      };
    }

    if (pkg && pending.packageId !== pkg.id) {
      return {
        success: false,
        message: "The selected package does not match the pending checkout session.",
        state: "package_mismatch",
      };
    }

    if (normalizedPhone && pending.phone && normalizedPhone !== pending.phone) {
      return {
        success: false,
        message: "The phone number does not match the pending checkout session.",
        state: "phone_mismatch",
      };
    }

    if (pending.status === "paid") {
      if (pending.mpesaCode === code) {
        return {
          success: true,
          message: "Payment confirmed.",
          code,
          packageId: pending.packageId,
          phone: pending.phone || null,
          state: "payment_confirmed",
        };
      }
      return {
        success: false,
        message: "The M-Pesa code does not match this checkout session.",
        state: "checkout_code_mismatch",
      };
    }

    if (pending.status === "pending") {
      if (pending.source !== "mpesa") {
        return {
          success: false,
          message: "This checkout session was started through Paystack and cannot be completed with an M-Pesa code.",
          state: "paystack_checkout",
        };
      }

      return {
        success: true,
        message: "M-Pesa code accepted for pending checkout.",
        code,
        packageId: pending.packageId,
        phone: pending.phone || null,
        state: "pending_checkout",
      };
    }

    return {
      success: false,
      message: "This checkout session is not valid for M-Pesa code confirmation.",
      state: "checkout_invalid",
    };
  }

  const paidMatch = await findPaidPendingByCode(code);
  if (paidMatch) {
    if (pkg && paidMatch.packageId !== pkg.id) {
      return {
        success: false,
        message: "This M-Pesa code is linked to a different package than the one selected.",
        state: "package_mismatch",
      };
    }

    if (paidMatch.phone && normalizedPhone && paidMatch.phone !== normalizedPhone) {
      return {
        success: false,
        message: "The phone number does not match the M-Pesa payment record.",
        state: "phone_mismatch",
      };
    }

    return {
      success: true,
      message: "M-Pesa code matches a confirmed payment.",
      code,
      packageId: paidMatch.packageId,
      phone: paidMatch.phone || normalizedPhone,
      amount: paidMatch.amount,
      state: "payment_confirmed",
    };
  }

  return {
    success: false,
    message: "This M-Pesa code is not linked to an active or paid payment session. Please use the same checkout session or start a new payment flow.",
    state: "not_found",
  };
}

function verifyVoucher(code, { ip = null, mac = null } = {}) {
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

  const record = {
    code: normalized,
    packageId: voucher.packageId,
    ip,
    mac,
    usedAt: Date.now(),
    source: "voucher",
  };

  used[normalized] = record;
  writeJson(USED_VOUCHERS_FILE, used);
  appendVoucherRedemption(record);

  return {
    success: true,
    message: "Voucher accepted.",
    packageId: voucher.packageId,
    code: normalized,
    ip,
    mac,
  };
}

function logPaidPayment({ checkoutId, packageId, phone, ip, amount, mpesaCode, paystackReference, paystackAuthorizationUrl = null, source, mac = null }) {
  const pkg = config.PACKAGES.find((p) => p.id === packageId);
  const log = db.loadPaymentsLog();
  const existing = checkoutId ? log.find((p) => p.checkoutId === checkoutId) : null;

  if (existing) {
    existing.status = "paid";
    existing.paidAt = Date.now();
    existing.mpesaCode = mpesaCode || existing.mpesaCode;
    existing.paystackReference = paystackReference || existing.paystackReference;
    existing.paystackAuthorizationUrl = paystackAuthorizationUrl || existing.paystackAuthorizationUrl;
    existing.source = source || existing.source;
    existing.mac = mac || existing.mac;

    fs.writeFileSync(
      path.join(__dirname, "..", "..", "data", "payments-log.json"),
      JSON.stringify(log, null, 2)
    );

    void supabase.updatePaymentLog(checkoutId, {
      status: "paid",
      paidAt: existing.paidAt,
      mpesaCode: existing.mpesaCode,
      paystackReference: existing.paystackReference,
      paystackAuthorizationUrl: existing.paystackAuthorizationUrl,
      source: existing.source,
      amount: existing.amount,
      phone: existing.phone,
      ip: existing.ip,
      packageId: existing.packageId,
      packageName: existing.packageName,
      mac: existing.mac,
    });
    return existing;
  }

  const entry = db.appendPaymentLog({
    checkoutId: checkoutId || null,
    packageId,
    packageName: pkg ? pkg.name : packageId,
    amount: amount ?? (pkg ? pkg.price : 0),
    phone: phone || null,
    ip,
    mac,
    mpesaCode: mpesaCode || null,
    paystackReference: paystackReference || null,
    paystackAuthorizationUrl: paystackAuthorizationUrl || null,
    status: "paid",
    createdAt: Date.now(),
    paidAt: Date.now(),
    source: source || "mpesa",
  });
  return entry;
}

async function listPendingPayments() {
  cleanupPending();
  const pending = loadPending();
  const local = Object.values(pending).map((entry) => ({
    ...entry,
    packageName: config.PACKAGES.find((p) => p.id === entry.packageId)?.name || entry.packageId,
    remainingSeconds: Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000)),
  }));
  const remote = await supabase.fetchPendingPayments();
  if (remote && remote.length) {
    return remote.map((entry) => ({
      ...entry,
      packageName: config.PACKAGES.find((p) => p.id === entry.packageId)?.name || entry.packageId,
      remainingSeconds: Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000)),
    }));
  }
  return local.sort((a, b) => b.createdAt - a.createdAt);
}

async function confirmPendingPayment(checkoutId, { source = "admin_confirm", transactionId = null, paystackReference = null, ip = null, mac = null } = {}) {
  const pending = loadPending();
  const entry = pending[checkoutId];
  if (!entry) {
    return { success: false, message: "Pending payment not found or expired." };
  }

  const pkg = config.PACKAGES.find((p) => p.id === entry.packageId);
  if (!pkg) {
    return { success: false, message: "Package not found." };
  }

  const now = Date.now();
  entry.status = "paid";
  entry.paidAt = now;
  entry.transactionId = transactionId || entry.transactionId || null;
  entry.paystackReference = paystackReference || entry.paystackReference || null;
  entry.paystackAuthorizationUrl = entry.paystackAuthorizationUrl || null;
  entry.source = source;
  entry.ip = ip || entry.ip || null;
  entry.mac = mac || entry.mac || null;
  savePending(pending);

  updatePaymentState(checkoutId, {
    status: "paid",
    paidAt: now,
    packageId: entry.packageId,
    packageName: entry.packageName,
    phone: entry.phone,
    ip: entry.ip,
    amount: entry.amount,
    mpesaCode: entry.mpesaCode,
    mac: entry.mac,
    transactionId: entry.transactionId,
    paystackReference: entry.paystackReference,
    paystackAuthorizationUrl: entry.paystackAuthorizationUrl,
    source,
  });

  logPaidPayment({
    checkoutId,
    packageId: entry.packageId,
    phone: entry.phone,
    ip: entry.ip,
    amount: entry.amount,
    source,
    mpesaCode: entry.transactionId || entry.mpesaCode || null,
    paystackReference: entry.paystackReference,
    mac: entry.mac,
  });

  const authEntry = db.authorize(entry.ip || ip, pkg.id, pkg.durationMinutes, {
    phone: entry.phone,
    amount: entry.amount,
    source,
    mac: entry.mac || mac || null,
    transactionId: entry.transactionId,
  });

  return {
    success: true,
    message: "Payment confirmed and device authorized.",
    ip: entry.ip || ip,
    expiresAt: authEntry.expiresAt,
  };
}

async function adminConfirmPayment(checkoutId) {
  return confirmPendingPayment(checkoutId, { source: "admin_confirm" });
}

async function rejectPendingPayment(checkoutId, { source = "admin_reject", reason = null } = {}) {
  const pending = loadPending();
  if (!pending[checkoutId]) {
    return { success: false, message: "Pending payment not found." };
  }
  delete pending[checkoutId];
  savePending(pending);

  const rejectedAt = Date.now();
  updatePaymentState(checkoutId, {
    status: "rejected",
    rejectedAt,
    source,
  });
  void supabase.deletePendingPayment(checkoutId);

  const log = db.loadPaymentsLog();
  const entry = log.find((p) => p.checkoutId === checkoutId);
  if (entry) {
    entry.status = "rejected";
    entry.rejectedAt = rejectedAt;
    entry.source = source;
    if (reason) entry.reason = reason;
    const paymentLogPath = path.join(process.env.WIFI_PORTAL_DATA_DIR || DATA_DIR, "payments-log.json");
    fs.writeFileSync(paymentLogPath, JSON.stringify(log, null, 2));
    void supabase.updatePaymentLog(checkoutId, {
      status: "rejected",
      rejectedAt: entry.rejectedAt,
      source,
    });
  }

  return { success: true, message: "Payment rejected." };
}

async function adminRejectPayment(checkoutId) {
  return rejectPendingPayment(checkoutId, { source: "admin_reject" });
}

function finalizeAuthorization({ code, packageId, ip, phone, checkoutId, source, mac = null }) {
  const pkg = config.PACKAGES.find((p) => p.id === packageId);
  if (!pkg) {
    return { success: false, message: "Unknown package." };
  }

  if (code && code !== "PAID") {
    markCodeUsed(code, { packageId, ip, mac, phone });
  }

  logPaidPayment({
    checkoutId,
    packageId: pkg.id,
    phone,
    ip,
    amount: pkg.price,
    mpesaCode: code && code !== "PAID" ? code : null,
    source: source || "mpesa",
    mac,
  });

  if (code) {
    appendMpesaCodeConnection({
      checkoutId: checkoutId || null,
      code,
      packageId: pkg.id,
      ip,
      mac,
      phone,
      createdAt: Date.now(),
      expiresAt: null,
      source: source || "mpesa_code",
    });
  }

  return { success: true, message: "Connected.", packageId: pkg.id, durationMinutes: pkg.durationMinutes };
}

function loadUsedCodesSync() {
  return readJson(USED_CODES_FILE, {});
}

async function loadUsedCodes() {
  const remote = await supabase.fetchUsedCodes();
  if (remote && remote.length) return remote;
  const local = loadUsedCodesSync();
  return Object.values(local);
}

function loadVoucherRedemptionsSync() {
  return loadVoucherRedemptions();
}

async function loadVoucherRedemptions() {
  const remote = await supabase.fetchVoucherRedemptions();
  if (remote && remote.length) return remote;
  return loadVoucherRedemptionsSync();
}

function loadMpesaConnectionsSync() {
  return loadMpesaConnections();
}

async function loadMpesaConnections() {
  const remote = await supabase.fetchMpesaCodeConnections();
  if (remote && remote.length) return remote;
  return loadMpesaConnectionsSync();
}

module.exports = {
  extractMpesaCode,
  normalizePhone,
  filterRecordsBySearchQuery,
  resolveTransactionId,
  createPendingPayment,
  updatePaymentState,
  createSubscription,
  getSubscriptionStatus,
  completePendingByCode,
  verifyMpesaInput,
  prepareRebindForCode,
  verifyVoucher,
  finalizeAuthorization,
  listPendingPayments,
  confirmPendingPayment,
  adminConfirmPayment,
  rejectPendingPayment,
  adminRejectPayment,
  ensurePaymentAllowed,
  loadUsedCodes,
  loadUsedCodesSync,
  loadVoucherRedemptions,
  loadVoucherRedemptionsSync,
  loadMpesaConnections,
  loadMpesaConnectionsSync,
  AUTH_WAIT_MS,
  initiatePaystackPayment,
  verifyPaystackReference,
  initiatePaystackChargeMobile,
  adminExtendAccess,
  adminManualSale,
};
