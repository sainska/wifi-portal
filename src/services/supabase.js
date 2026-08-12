const { createClient } = require("@supabase/supabase-js");
const config = require("../config");

const supabase = config.SUPABASE_ENABLED
  ? createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
      global: { fetch: (...args) => fetch(...args) },
    })
  : null;

function supabaseWarn(action) {
  // Keep logs quiet for non-critical background syncs so the portal stays responsive.
  if (process.env.NODE_ENV !== "test") {
    console.warn(`Supabase not configured: cannot ${action}. Set SUPABASE_URL, SUPABASE_SERVICE_KEY, and SUPABASE_ANON_KEY.`);
  }
}

function toCamelCase(record) {
  if (!record) return record;
  return Object.entries(record).reduce((acc, [key, value]) => {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    acc[camelKey] = value;
    return acc;
  }, {});
}
function obfuscateIp(ip) {
  if (!ip) return null;
  if (typeof ip !== 'string') return null;
  if (ip.includes('.')) {
    const parts = ip.split('.');
    parts[parts.length - 1] = '0';
    return parts.join('.');
  }
  if (ip.includes(':')) {
    const parts = ip.split(':');
    return parts.slice(0, 2).join(':') + '::';
  }
  return null;
}

const SUPABASE_TIMEOUT_MS = 15000;
const SUPABASE_FAILURE_COOLDOWN_MS = 15000;
let supabaseCooldownUntil = 0;

function compactRow(row) {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== undefined && value !== null)
  );
}

function extractMissingColumns(message) {
  if (!message || typeof message !== "string") return [];
  const regex = /Could not find the '([^']+)' column of '([^']+)' in the schema cache/g;
  const columns = [];
  let match;
  while ((match = regex.exec(message))) {
    columns.push(match[1]);
  }
  return columns;
}

function isMissingRelationError(error) {
  const message = error && typeof error === "object" ? error.message || error : String(error || "");
  return Boolean(message) && /(does not exist|not found|schema cache|relation|table .* not found)/i.test(message);
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Supabase timeout")), ms)),
  ]);
}

function isSupabaseFailureTransient(error) {
  const message = error && typeof error === "object" ? error.message || error : String(error || "");
  return Boolean(message) && /(timeout|522|5\d\d|socket hang up|fetch failed|network|temporarily unavailable|connection timed out|ECONNRESET|EAI_AGAIN|ENOTFOUND)/i.test(message);
}

function shouldSkipSupabaseRequest() {
  return !supabase || Date.now() < supabaseCooldownUntil;
}

function markSupabaseFailure(error) {
  if (isSupabaseFailureTransient(error)) {
    supabaseCooldownUntil = Date.now() + SUPABASE_FAILURE_COOLDOWN_MS;
  }
}

async function safeUpsert(table, row, onConflict) {
  if (shouldSkipSupabaseRequest()) return;
  let body = compactRow(row);
  if (!body || Object.keys(body).length === 0) return;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const query = supabase.from(table).upsert([body], onConflict ? { onConflict } : undefined);
    const { error } = await withTimeout(query, SUPABASE_TIMEOUT_MS);

    if (!error) return;
    markSupabaseFailure(error);
    const missing = extractMissingColumns(error.message);
    if (!missing.length) throw error;
    for (const column of missing) {
      delete body[column];
    }
    if (!Object.keys(body).length) return;
  }
}

async function safeUpdate(table, matchClause, changes) {
  if (!supabase) return;
  const body = compactRow(changes);
  if (!Object.keys(body).length) return;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const query = supabase.from(table).update(body);
    if (typeof matchClause === "object" && matchClause !== null) {
      for (const [column, value] of Object.entries(matchClause)) {
        query.eq(column, value);
      }
    } else if (typeof matchClause === "string") {
      query.eq("checkout_id", matchClause);
    } else {
      throw new Error("safeUpdate requires matchClause");
    }

    const { error } = await withTimeout(query, SUPABASE_TIMEOUT_MS);
    if (!error) return;
    markSupabaseFailure(error);

    const missing = extractMissingColumns(error.message);
    if (!missing.length) throw error;
    for (const column of missing) {
      delete body[column];
    }
    if (!Object.keys(body).length) return;
  }
}

function paymentParams(entry) {
  return compactRow({
    checkout_id: entry.checkoutId || null,
    package_id: entry.packageId || null,
    package_name: entry.packageName || null,
    amount: entry.amount ?? null,
    phone: entry.phone || null,
    ip: config.MASK_IPS ? obfuscateIp(entry.ip) : entry.ip || null,
    mac: entry.mac ?? null,
    mpesa_code: entry.mpesaCode ?? null,
    paystack_reference: entry.paystackReference ?? null,
    paystack_authorization_url: entry.paystackAuthorizationUrl ?? null,
    status: entry.status || null,
    created_at: entry.createdAt ?? Date.now(),
    paid_at: entry.paidAt ?? null,
    rejected_at: entry.rejectedAt ?? null,
    source: entry.source || null,
    authorized_by: entry.authorizedBy ?? null,
    authorized_at: entry.authorizedAt ?? null,
    is_manual: entry.isManual ?? null,
    transaction_id: entry.transactionId ?? null,
  });
}

async function fetchAdminDashboardSummary() {
  if (!supabase) {
    supabaseWarn("fetch admin dashboard summary");
    return null;
  }

  try {
    const { data, error } = await supabase
      .from("admin_dashboard_summary")
      .select("*")
      .single();
    if (error) {
      if (error.message && /does not exist|not found|schema cache/i.test(error.message)) {
        return null;
      }
      throw error;
    }
    return toCamelCase(data);
  } catch (error) {
    const message = error && typeof error === "object" ? error.message || error : String(error);
    if (isMissingRelationError(error)) {
      return null;
    }
    if (!isSupabaseFailureTransient(error)) {
      console.error("Supabase fetchAdminDashboardSummary error:", message);
    }
    return null;
  }
}

async function insertPaymentLog(entry) {
  if (shouldSkipSupabaseRequest()) return;
  if (!supabase) {
    supabaseWarn("insert payment log");
    return;
  }

  try {
    await safeUpsert("payments", paymentParams(entry), "checkout_id");
  } catch (error) {
    if (process.env.NODE_ENV !== "test" && !isSupabaseFailureTransient(error)) {
      console.error("Supabase insertPaymentLog error:", error.message || error);
    }
  }
}

async function updatePaymentLog(checkoutId, changes) {
  if (shouldSkipSupabaseRequest()) return;
  try {
    const body = {};
    if (changes.status) body.status = changes.status;
    if (changes.paidAt) body.paid_at = changes.paidAt;
    if (changes.rejectedAt) body.rejected_at = changes.rejectedAt;
    if (changes.mpesaCode) body.mpesa_code = changes.mpesaCode;
    if (changes.source) body.source = changes.source;
    if (changes.amount != null) body.amount = changes.amount;
    if (changes.phone) body.phone = changes.phone;
    if (changes.ip) body.ip = config.MASK_IPS ? obfuscateIp(changes.ip) : changes.ip;
    if (changes.mac) body.mac = changes.mac;
    if (changes.packageId) body.package_id = changes.packageId;
    if (changes.packageName) body.package_name = changes.packageName;
    if (changes.paystackReference != null) body.paystack_reference = changes.paystackReference;
    if (changes.paystackAuthorizationUrl != null) body.paystack_authorization_url = changes.paystackAuthorizationUrl;
    if (changes.transactionId != null) body.transaction_id = changes.transactionId;
    if (changes.authorizedBy != null) body.authorized_by = changes.authorizedBy;
    if (changes.authorizedAt != null) body.authorized_at = changes.authorizedAt;
    if (changes.isManual != null) body.is_manual = changes.isManual;

    await safeUpdate("payments", { checkout_id: checkoutId }, body);
  } catch (error) {
    if (!isSupabaseFailureTransient(error)) {
      console.error("Supabase updatePaymentLog error:", error.message || error);
    }
  }
}

async function fetchPaymentLogs() {
  if (shouldSkipSupabaseRequest()) return [];
  try {
    const { data, error } = await supabase
      .from("payments")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data.map(toCamelCase);
  } catch (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    if (!isSupabaseFailureTransient(error)) {
      console.error("Supabase fetchPaymentLogs error:", error.message || error);
    }
    return [];
  }
}

async function insertPendingPayment(entry) {
  if (shouldSkipSupabaseRequest()) return;
  if (!supabase) {
    supabaseWarn("insert pending payment");
    return;
  }
  try {
    const row = compactRow({
      checkout_id: entry.checkoutId,
      package_id: entry.packageId,
      amount: entry.amount,
      phone: entry.phone,
      ip: config.MASK_IPS ? obfuscateIp(entry.ip) : entry.ip,
      mac: entry.mac,
      status: entry.status,
      created_at: entry.createdAt,
      expires_at: entry.expiresAt,
      mpesa_code: entry.mpesaCode,
      paystack_reference: entry.paystackReference,
      paystack_authorization_url: entry.paystackAuthorizationUrl,
      source: entry.source || null,
      transaction_id: entry.transactionId ?? null,
      authorized_by: entry.authorizedBy ?? null,
      authorized_at: entry.authorizedAt ?? null,
      is_manual: entry.isManual ?? null,
    });

    await safeUpsert("pending_payments", row, "checkout_id");
  } catch (error) {
    if (process.env.NODE_ENV !== "test" && !isSupabaseFailureTransient(error)) {
      console.error("Supabase insertPendingPayment error:", error.message || error);
    }
  }
}

async function fetchPendingPayments() {
  if (shouldSkipSupabaseRequest()) return [];
  if (!supabase) {
    supabaseWarn("fetch pending payments");
    return [];
  }
  try {
    const { data, error } = await supabase
      .from("pending_payments")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data.map(toCamelCase);
  } catch (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    if (!isSupabaseFailureTransient(error)) {
      console.error("Supabase fetchPendingPayments error:", error.message || error);
    }
    return [];
  }
}

async function getPendingPayment(checkoutId) {
  if (shouldSkipSupabaseRequest()) return null;
  if (!supabase) {
    supabaseWarn("get pending payment");
    return null;
  }
  try {
    const { data, error } = await supabase
      .from("pending_payments")
      .select("*")
      .eq("checkout_id", checkoutId)
      .limit(1)
      .single();
    if (error) {
      if (error.code === "PGRST116") return null;
      throw error;
    }
    return toCamelCase(data);
  } catch (error) {
    if (!isSupabaseFailureTransient(error)) {
      console.error("Supabase getPendingPayment error:", error.message || error);
    }
    return null;
  }
}

async function updatePendingPayment(checkoutId, changes) {
  if (shouldSkipSupabaseRequest()) return;
  if (!supabase) {
    supabaseWarn("update pending payment");
    return;
  }
  try {
    const body = {};
    if (changes.status) body.status = changes.status;
    if (changes.mac) body.mac = changes.mac;
    if (changes.mpesaCode) body.mpesa_code = changes.mpesaCode;
    if (changes.paidAt) body.paid_at = changes.paidAt;
    if (changes.expiresAt) body.expires_at = changes.expiresAt;
    if (changes.paystackReference != null) body.paystack_reference = changes.paystackReference;
    if (changes.paystackAuthorizationUrl != null) body.paystack_authorization_url = changes.paystackAuthorizationUrl;
    if (changes.transactionId != null) body.transaction_id = changes.transactionId;
    if (changes.authorizedBy != null) body.authorized_by = changes.authorizedBy;
    if (changes.authorizedAt != null) body.authorized_at = changes.authorizedAt;
    if (changes.isManual != null) body.is_manual = changes.isManual;
    await safeUpdate("pending_payments", { checkout_id: checkoutId }, body);
  } catch (error) {
    if (!isSupabaseFailureTransient(error)) {
      console.error("Supabase updatePendingPayment error:", error.message || error);
    }
  }
}

async function deletePendingPayment(checkoutId) {
  if (shouldSkipSupabaseRequest()) return;
  if (!supabase) {
    supabaseWarn("delete pending payment");
    return;
  }
  try {
    const { error } = await supabase.from("pending_payments").delete().eq("checkout_id", checkoutId);
    if (error) throw error;
  } catch (error) {
    if (!isSupabaseFailureTransient(error)) {
      console.error("Supabase deletePendingPayment error:", error.message || error);
    }
  }
}

async function markCodeUsed(code, meta = {}) {
  if (shouldSkipSupabaseRequest()) return;
  if (!supabase) {
    supabaseWarn("mark used code");
    return;
  }
  try {
    const { error } = await supabase.from("used_codes").insert([
      {
        code,
        package_id: meta.packageId || null,
        ip: meta.ip || null,
        mac: meta.mac || null,
        phone: meta.phone || null,
        transaction_id: meta.transactionId || null,
        used_at: Date.now(),
        meta: meta.meta || null,
      },
    ]);
    if (error) throw error;
  } catch (error) {
    if (!isSupabaseFailureTransient(error)) {
      console.error("Supabase markCodeUsed error:", error.message || error);
    }
  }
}

async function fetchUsedCodes() {
  if (shouldSkipSupabaseRequest()) return [];
  if (!supabase) {
    supabaseWarn("fetch used codes");
    return [];
  }
  try {
    const { data, error } = await supabase.from("used_codes").select("*").order("used_at", { ascending: false });
    if (error) throw error;
    return data.map(toCamelCase);
  } catch (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    if (!isSupabaseFailureTransient(error)) {
      console.error("Supabase fetchUsedCodes error:", error.message || error);
    }
    return [];
  }
}

async function fetchVoucherRedemptions() {
  if (shouldSkipSupabaseRequest()) return [];
  if (!supabase) {
    supabaseWarn("fetch voucher redemptions");
    return [];
  }
  try {
    const { data, error } = await supabase.from("voucher_redemptions").select("*").order("used_at", { ascending: false });
    if (error) throw error;
    return data.map(toCamelCase);
  } catch (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    if (!isSupabaseFailureTransient(error)) {
      console.error("Supabase fetchVoucherRedemptions error:", error.message || error);
    }
    return [];
  }
}

async function insertVoucherRedemption(entry) {
  if (shouldSkipSupabaseRequest()) return;
  if (!supabase) {
    supabaseWarn("insert voucher redemption");
    return;
  }
  try {
    await supabase.from("voucher_redemptions").insert([
      compactRow({
        code: entry.code,
        package_id: entry.packageId,
        ip: entry.ip,
        mac: entry.mac,
        phone: entry.phone,
        used_at: entry.usedAt || Date.now(),
        expires_at: entry.expiresAt || null,
        source: entry.source || "voucher",
      }),
    ]);
  } catch (error) {
    if (!isSupabaseFailureTransient(error)) {
      console.error("Supabase insertVoucherRedemption error:", error.message || error);
    }
  }
}

async function fetchMpesaCodeConnections() {
  if (shouldSkipSupabaseRequest()) return [];
  if (!supabase) {
    supabaseWarn("fetch mpesa code connections");
    return [];
  }
  try {
    const { data, error } = await supabase
      .from("mpesa_code_connections")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data.map(toCamelCase);
  } catch (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    if (!isSupabaseFailureTransient(error)) {
      console.error("Supabase fetchMpesaCodeConnections error:", error.message || error);
    }
    return [];
  }
}

async function insertMpesaCodeConnection(entry) {
  if (shouldSkipSupabaseRequest()) return;
  if (!supabase) {
    supabaseWarn("insert mpesa code connection");
    return;
  }
  try {
    await supabase.from("mpesa_code_connections").insert([
      compactRow({
        checkout_id: entry.checkoutId,
        code: entry.code,
        package_id: entry.packageId,
        ip: entry.ip,
        mac: entry.mac,
        phone: entry.phone,
        created_at: entry.createdAt || Date.now(),
        expires_at: entry.expiresAt || null,
        source: entry.source || "mpesa_code",
      }),
    ]);
  } catch (error) {
    if (!isSupabaseFailureTransient(error)) {
      console.error("Supabase insertMpesaCodeConnection error:", error.message || error);
    }
  }
}

async function upsertAuthorizedDevice(entry) {
  if (shouldSkipSupabaseRequest()) return;
  try {
    const row = compactRow({
      ip: entry.ip,
      package_id: entry.packageId,
      authorized_at: entry.authorizedAt,
      expires_at: entry.expiresAt,
      phone: entry.phone,
      amount: entry.amount ?? null,
      source: entry.source,
      mac: entry.mac,
      device_name: entry.deviceName,
      transaction_id: entry.transactionId ?? null,
    });

    await safeUpsert("authorized_devices", row, ["ip"]);
  } catch (error) {
    if (!isSupabaseFailureTransient(error)) {
      console.error("Supabase upsertAuthorizedDevice error:", error.message || error);
    }
  }
}

async function fetchAuthorizedDevices() {
  if (shouldSkipSupabaseRequest()) return [];
  if (!supabase) {
    supabaseWarn("fetch authorized devices");
    return [];
  }
  try {
    const { data, error } = await supabase
      .from("authorized_devices")
      .select("*")
      .gt("expires_at", Date.now())
      .order("authorized_at", { ascending: false });
    if (error) throw error;
    return data.map(toCamelCase);
  } catch (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    if (!isSupabaseFailureTransient(error)) {
      console.error("Supabase fetchAuthorizedDevices error:", error.message || error);
    }
    return [];
  }
}

async function revokeAuthorizedDevice(identifier) {
  if (shouldSkipSupabaseRequest()) return;
  if (!supabase) {
    supabaseWarn("revoke authorized device");
    return;
  }
  try {
    const isMac = typeof identifier === "string" && identifier.includes(":");
    const query = supabase.from("authorized_devices").delete();
    if (isMac) {
      const normalizedMac = identifier.trim().replace(/-/g, ":").toUpperCase();
      await query.or(`mac.eq.${normalizedMac},ip.eq.${identifier}`);
    } else {
      await query.eq("ip", identifier);
    }
  } catch (error) {
    if (!isSupabaseFailureTransient(error)) {
      console.error("Supabase revokeAuthorizedDevice error:", error.message || error);
    }
  }
}

async function cleanupExpiredAuthorizedDevices() {
  if (shouldSkipSupabaseRequest()) return;
  if (!supabase) {
    supabaseWarn("cleanup expired authorized devices");
    return;
  }
  try {
    const { error } = await supabase.from("authorized_devices").delete().lt("expires_at", Date.now());
    if (error) throw error;
  } catch (error) {
    if (!isSupabaseFailureTransient(error)) {
      console.error("Supabase cleanupExpiredAuthorizedDevices error:", error.message || error);
    }
  }
}

module.exports = {
  isSupabaseFailureTransient,
  insertPaymentLog,
  updatePaymentLog,
  fetchPaymentLogs,
  insertPendingPayment,
  fetchPendingPayments,
  getPendingPayment,
  updatePendingPayment,
  deletePendingPayment,
  markCodeUsed,
  fetchUsedCodes,
  fetchAdminDashboardSummary,
  fetchVoucherRedemptions,
  insertVoucherRedemption,
  fetchMpesaCodeConnections,
  insertMpesaCodeConnection,
  upsertAuthorizedDevice,
  fetchAuthorizedDevices,
  revokeAuthorizedDevice,
  cleanupExpiredAuthorizedDevices,
};
