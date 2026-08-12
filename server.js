const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const crypto = require("crypto");

const config = require("./src/config");
const db = require("./src/services/db");
const payment = require("./src/services/payment");
const supabase = require("./src/services/supabase");
const network = require("./src/services/network");
const dnsEngine = require("./src/services/dnsEngine");
const captive = require("./src/services/captive");
const adminService = require("./src/services/admin");
const compression = require("compression");
const { resolveBindHost } = require("./src/services/bind");

const app = express();
app.use(bodyParser.json({
  verify(req, res, buf) {
    req.rawBody = buf;
  },
}));

app.disable("x-powered-by");
app.use(compression());

function isAdminRequest(req) {
  return adminService.isAdminRequest(req, config);
}

function requireAdmin(req, res, next) {
  if (!isAdminRequest(req)) {
    return res.status(403).json({ success: false, message: "Admin access only from this laptop or with the admin PIN." });
  }
  next();
}

function requireAdminPin(req, res, next) {
  const pin = req.headers["x-admin-pin"] || req.body?.pin;
  if (pin !== config.ADMIN_PIN) {
    return res.status(401).json({ success: false, message: "Invalid admin PIN." });
  }
  next();
}

app.get("/admin", (req, res) => {
  if (!isAdminRequest(req)) {
    return res.redirect("/");
  }
  res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/admin2", (req, res) => {
  if (!isAdminRequest(req)) {
    return res.redirect("/");
  }
  res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
  res.redirect("/admin");
});

app.get("/admin.html", (req, res) => {
  if (!isAdminRequest(req)) {
    return res.redirect("/");
  }
  res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
  res.redirect("/admin");
});

app.get("/admin2.html", (req, res) => {
  if (!isAdminRequest(req)) {
    return res.redirect("/");
  }
  res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
  res.redirect("/admin");
});

captive.attach(app, config, db, isAdminRequest);

app.use(express.static(path.join(__dirname, "public"), {
  index: false,
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    const name = path.basename(filePath).toLowerCase();
    if (name === 'login.html' || name === 'admin.html') {
      res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    }
  },
}));

app.get("/api/packages", (req, res) => {
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  res.json(config.PACKAGES);
});

app.get("/api/portal-config", (req, res) => {
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  res.json({
    brandName: config.BRAND_NAME,
    assistancePhone: config.ASSISTANCE_PHONE,
    assistanceWhatsApp: config.ASSISTANCE_WHATSAPP,
    mpesaPaybill: config.MPESA_PAYBILL,
    mpesaTill: config.MPESA_TILL,
    mpesaAccount: config.MPESA_ACCOUNT,
    authWaitSeconds: payment.AUTH_WAIT_MS / 1000,
    paystackPublicKey: config.PAYSTACK_PUBLIC_KEY,
    paystackCurrency: config.PAYSTACK_CURRENCY,
    paystackEnabled: config.PAYSTACK_ENABLED,
    paystackMobileProvider: config.PAYSTACK_MOBILE_PROVIDER,
    hotspotName: config.HOTSPOT_SSID,
    supabaseUrl: config.SUPABASE_URL,
    supabaseAnonKey: config.SUPABASE_ANON_KEY,
    supabaseEnabled: config.SUPABASE_ENABLED,
  });
});

app.post("/api/paystack/initiate", async (req, res) => {
  const { packageId, phone } = req.body || {};
  const ip = db.normalizeIp(req.socket.remoteAddress);
  const mac = await network.getMacAddress(ip);
  const protocol = req.headers["x-forwarded-proto"] || req.protocol;
  const callbackUrl = `${protocol}://${req.get("host")}/api/paystack/callback`;
  const result = await payment.initiatePaystackPayment({ packageId, phone, ip, callbackUrl, mac });
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json(result);
});

app.post("/api/paystack/verify", async (req, res) => {
  const { reference } = req.body || {};
  const ip = db.normalizeIp(req.socket.remoteAddress);
  const mac = await network.getMacAddress(ip);
  const result = await payment.verifyPaystackReference(reference, ip, true, mac);
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json(result);
});

app.get("/api/paystack/callback", async (req, res) => {
  const reference = req.query.reference || req.query.trxref;
  if (!reference) {
    return res.status(400).send("<h1>Paystack callback error</h1><p>Missing reference.</p>");
  }

  const ip = db.normalizeIp(req.socket.remoteAddress);
  const mac = await network.getMacAddress(ip);
  const result = await payment.verifyPaystackReference(reference, ip, true, mac);
  const message = result.success
    ? "Payment confirmed. You can now return to the portal and continue browsing."
    : `Payment could not be verified: ${result.message || "unknown error."}`;

  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Paystack Payment Result</title><style>body{font-family:system-ui,Segoe UI,Helvetica,Arial,sans-serif;background:#0e1726;color:#f8fbff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}main{max-width:520px;padding:24px;border-radius:18px;background:linear-gradient(180deg,#101828 0,#15253d 100%);box-shadow:0 20px 80px rgba(0,0,0,.35)}h1{margin:0 0 16px;font-size:1.8rem;color:#7c3aed}p{margin:0 0 18px;line-height:1.7}a{display:inline-block;padding:12px 20px;border-radius:12px;background:#7c3aed;color:#fff;text-decoration:none;font-weight:600}</style></head><body><main><h1>Paystack Payment Result</h1><p>${message}</p><a href="/">Return to WiFi Portal</a></main></body></html>`);
});

app.post("/api/paystack/webhook", async (req, res) => {
  const signature = req.headers["x-paystack-signature"];
  if (!signature || !config.PAYSTACK_SECRET_KEY) {
    return res.status(403).json({ success: false, message: "Webhook authorization failed." });
  }

  const body = req.rawBody || Buffer.from(JSON.stringify(req.body));
  const expectedSignature = crypto
    .createHmac("sha512", config.PAYSTACK_SECRET_KEY)
    .update(body)
    .digest("hex");

  if (signature !== expectedSignature) {
    return res.status(401).json({ success: false, message: "Invalid Paystack signature." });
  }

  const event = req.body;
  const reference = event?.data?.reference || event?.data?.trxref || event?.reference || null;
  if (!reference) {
    return res.status(400).json({ success: false, message: "Missing reference in webhook payload." });
  }

  if (event?.event === "charge.failed") {
    const result = await payment.rejectPendingPayment(reference, { source: "paystack_webhook", reason: "charge.failed" });
    return res.status(200).json({ success: result.success, message: result.message || "Payment marked failed." });
  }

  if (event?.event === "charge.success") {
    const result = await payment.verifyPaystackReference(reference, null, true, null);
    return res.status(result.success ? 200 : 422).json({ success: result.success, message: result.message || "Webhook processed." });
  }

  return res.status(200).json({ success: true, message: "Event ignored." });
});

app.post('/api/paystack/stk', async (req, res) => {
  const { packageId, phone, provider } = req.body || {};
  const ip = db.normalizeIp(req.socket.remoteAddress);
  const mac = await network.getMacAddress(ip);

  try {
    const result = await payment.initiatePaystackChargeMobile({ packageId, phone, ip, provider, mac });
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err?.message || 'Server error' });
  }
});
app.get("/api/status", (req, res) => {
  const ip = db.normalizeIp(req.socket.remoteAddress);
  const entry = db.getEntry(ip);
  res.json({
    authorized: db.isAuthorized(ip),
    expiresAt: entry ? entry.expiresAt : null,
    isAdmin: isAdminRequest(req),
    packageId: entry ? entry.packageId : null,
    phone: entry ? entry.phone : null,
    transactionId: entry ? entry.transactionId || entry.mpesaCode || null : null,
    source: entry ? entry.source || null : null,
  });
});

app.post("/api/subscribe", async (req, res) => {
  const { packageId, phone } = req.body || {};
  const ip = db.normalizeIp(req.socket.remoteAddress);
  const mac = await network.getMacAddress(ip);
  const result = payment.createSubscription({ packageId, phone, ip, mac });
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json(result);
});

app.get("/api/subscribe/:checkoutId/status", async (req, res) => {
  res.json(await payment.getSubscriptionStatus(req.params.checkoutId));
});

app.post("/api/mpesa-connect", async (req, res) => {
  const { input, packageId, checkoutId, phone } = req.body || {};
  const ip = db.normalizeIp(req.socket.remoteAddress);

  const mac = await network.getMacAddress(ip);
  const verified = await payment.verifyMpesaInput({ input, packageId, checkoutId, phone });
  if (!verified.success) {
    return res.status(400).json(verified);
  }

  let resolvedPackageId = verified.packageId;
  let resolvedPhone = verified.phone || null;
  if (!resolvedPackageId && checkoutId) {
    const pendingList = await payment.listPendingPayments();
    const pending = pendingList.find((p) => p.checkoutId === checkoutId);
    if (pending) {
      resolvedPackageId = pending.packageId;
      resolvedPhone = resolvedPhone || pending.phone || null;
    }
  }

  if (!resolvedPackageId) {
    return res.status(400).json({
      success: false,
      message: "Select a package before connecting with your M-Pesa code.",
    });
  }

  let rebindResult = null;
  if (verified.state === "bound_to_other_device") {
    rebindResult = payment.prepareRebindForCode({
      code: verified.code,
      packageId: resolvedPackageId,
      phone: resolvedPhone,
      ip,
      mac,
      source: verified.demo ? "demo" : "mpesa_code",
    });

    if (!rebindResult.success) {
      return res.status(400).json({
        success: false,
        state: rebindResult.state || "rebind_blocked",
        message: rebindResult.message || "The code could not be rebound to this device.",
        packageId: resolvedPackageId,
        liveState: db.isAuthorized(ip, mac) ? "active" : "inactive",
      });
    }
  } else {
    const packageCheck = payment.ensurePaymentAllowed({ phone: resolvedPhone, ip, mac, packageId: resolvedPackageId });
    if (!packageCheck.success) {
      return res.status(400).json({
        ...packageCheck,
        liveState: db.isAuthorized(ip, mac) ? "active" : "inactive",
      });
    }
  }

  if (checkoutId && verified.code) {
    payment.completePendingByCode(checkoutId, verified.code);
  }

  const finalized = payment.finalizeAuthorization({
    code: verified.code,
    packageId: resolvedPackageId,
    ip,
    phone: resolvedPhone,
    checkoutId,
    source: verified.demo ? "demo" : "mpesa_code",
    mac,
  });

  if (!finalized.success) {
    return res.status(400).json(finalized);
  }

  const pkg = config.PACKAGES.find((p) => p.id === finalized.packageId);
  const entry = db.authorize(ip, finalized.packageId, finalized.durationMinutes, {
    phone: resolvedPhone || phone || null,
    mpesaCode: verified.code,
    amount: pkg ? pkg.price : null,
    source: verified.demo ? "demo" : "mpesa_code",
    mac,
  });

  res.json({
    success: true,
    message: rebindResult?.message || verified.message || "Connected.",
    state: rebindResult?.state || verified.state || "connected",
    rebinded: Boolean(rebindResult?.rebinded),
    expiresAt: entry.expiresAt,
    liveState: db.isAuthorized(ip, mac) ? "active" : "inactive",
  });
});

app.post("/api/voucher", async (req, res) => {
  const { code, phone } = req.body || {};
  const ip = db.normalizeIp(req.socket.remoteAddress);
  const mac = await network.getMacAddress(ip);

  const verified = payment.verifyVoucher(code, { ip, mac, phone });
  if (!verified.success) {
    return res.status(400).json(verified);
  }

  const pkg = config.PACKAGES.find((p) => p.id === verified.packageId);
  if (!pkg) {
    return res.status(400).json({ success: false, message: "Voucher package not found." });
  }

  payment.finalizeAuthorization({
    code: null,
    packageId: pkg.id,
    ip,
    source: "voucher",
    mac,
  });

  const entry = db.authorize(ip, pkg.id, pkg.durationMinutes, {
    source: "voucher",
    amount: 0,
    mac,
  });

  res.json({
    success: true,
    message: verified.message,
    expiresAt: entry.expiresAt,
  });
});

/* ── Admin API (laptop only) ── */
app.get("/api/admin/dashboard", requireAdmin, async (req, res) => {
  let stats = db.getStats(config);
  const pendingList = await payment.listPendingPayments();
  const localPayments = db.loadPaymentsLog();
  let remoteSummary = null;
  try {
    remoteSummary = await Promise.race([
      supabase.fetchAdminDashboardSummary(),
      new Promise((resolve) => setTimeout(() => resolve(null), 800)),
    ]);
  } catch {
    remoteSummary = null;
  }

  stats.pendingPayments = pendingList.length;
  stats.activeDevices = Math.max(stats.activeDevices || 0, db.listAuthorized().length);
  stats.revenueTotal = localPayments
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);
  stats.paymentsToday = localPayments.filter((p) => {
    if (!p.paidAt) return false;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return p.status === "paid" && p.paidAt >= todayStart.getTime();
  }).length;

  if (remoteSummary) {
    stats = {
      ...stats,
      activeDevices: remoteSummary.activeDevices ?? stats.activeDevices,
      pendingPayments: remoteSummary.pendingPayments ?? stats.pendingPayments,
      revenueTotal: Number(remoteSummary.revenueTotal) || stats.revenueTotal,
      revenueToday: Number(remoteSummary.revenueToday) || stats.revenueToday,
      paymentsToday: Number(remoteSummary.paymentsToday) || stats.paymentsToday,
      totalPaidTransactions: Number(remoteSummary.totalPaidTransactions) || 0,
      totalUsedCodes: Number(remoteSummary.totalUsedCodes) || 0,
      totalVoucherRedemptions: Number(remoteSummary.totalVoucherRedemptions) || 0,
      totalMpesaConnections: Number(remoteSummary.totalMpesaConnections) || 0,
    };
  }

  res.json({
    stats,
    packages: config.PACKAGES,
    brandName: config.BRAND_NAME,
    adminUrl: `http://${config.PORTAL_IP}/admin`,
    realtime: true,
    supabaseUrl: config.SUPABASE_URL,
    supabaseAnonKey: config.SUPABASE_ANON_KEY,
    supabaseEnabled: config.SUPABASE_ENABLED,
    paystackEnabled: config.PAYSTACK_ENABLED,
  });
});

app.get("/api/admin/pending", requireAdmin, async (req, res) => {
  try {
    const remotePending = await Promise.race([
      supabase.fetchPendingPayments(),
      new Promise((resolve) => setTimeout(() => resolve([]), 800)),
    ]);
    if (Array.isArray(remotePending) && remotePending.length) {
      return res.json(remotePending);
    }
  } catch {
    // fall through to local data
  }
  res.json(await payment.listPendingPayments());
});

app.get("/api/admin/payments", requireAdmin, async (req, res) => {
  try {
    const remotePayments = await Promise.race([
      supabase.fetchPaymentLogs(),
      new Promise((resolve) => setTimeout(() => resolve([]), 800)),
    ]);
    if (Array.isArray(remotePayments) && remotePayments.length) {
      return res.json(remotePayments);
    }
  } catch {
    // fall through to local data
  }
  res.json(db.loadPaymentsLog());
});

app.get("/api/admin/devices", requireAdmin, async (req, res) => {
  let sourceDevices = db.listAuthorized();
  try {
    const remoteDevices = await Promise.race([
      supabase.fetchAuthorizedDevices(),
      new Promise((resolve) => setTimeout(() => resolve([]), 800)),
    ]);
    if (Array.isArray(remoteDevices) && remoteDevices.length) {
      sourceDevices = remoteDevices;
    }
  } catch {
    // keep local data
  }

  const devices = await Promise.all(sourceDevices.map(async (d) => {
    const pkg = config.PACKAGES.find((p) => p.id === d.packageId);
    const remainingMs = d.expiresAt ? Math.max(0, d.expiresAt - Date.now()) : 0;
    const isAuthorized = Boolean(d.expiresAt && d.expiresAt > Date.now());
    const packageName = pkg ? pkg.name : (d.packageName || d.packageId || "Unknown");
    const arpEntries = await network.getArpEntries();
    const connectionCheck = network.evaluateConnectionState({
      ip: d.ip,
      mac: d.mac,
      arpEntries,
    });
    const isLive = isAuthorized && connectionCheck.isConnected;

    return {
      ...d,
      packageId: d.packageId || d.package_id || null,
      packageName,
      purchasedPackage: packageName,
      remainingMs,
      remainingHours: Math.round((remainingMs / (1000 * 60 * 60)) * 10) / 10,
      connectionState: isLive ? "Connected" : "Expired",
      liveState: isLive ? "Live" : "Offline",
      deviceName: d.deviceName || "Unknown",
      connectedSince: d.authorizedAt || d.authorized_at || null,
      purchaseSource: d.source || "—",
      uploadSpeed: null,
      downloadSpeed: null,
      trafficInterface: null,
    };
  }));

  res.json(devices);
});

app.get("/api/admin/codes", requireAdmin, async (req, res) => {
  try {
    const remoteCodes = await Promise.race([
      supabase.fetchUsedCodes(),
      new Promise((resolve) => setTimeout(() => resolve([]), 800)),
    ]);
    if (Array.isArray(remoteCodes) && remoteCodes.length) {
      return res.json(remoteCodes);
    }
  } catch {
    // fall through to local data
  }
  const localCodes = payment.loadUsedCodes();
  const codes = localCodes.length ? localCodes : Object.values(payment.loadUsedCodesSync());
  if (Array.isArray(codes)) {
    return res.json(codes);
  }
  return res.json(Object.entries(codes).map(([code, meta]) => ({ code, ...meta })));
});

app.get("/api/admin/vouchers", requireAdmin, async (req, res) => {
  try {
    const remoteVouchers = await Promise.race([
      supabase.fetchVoucherRedemptions(),
      new Promise((resolve) => setTimeout(() => resolve([]), 800)),
    ]);
    if (Array.isArray(remoteVouchers) && remoteVouchers.length) {
      return res.json(remoteVouchers);
    }
  } catch {
    // fall through to local data
  }
  return res.json(payment.loadVoucherRedemptions());
});

app.get("/api/admin/mpesa-connections", requireAdmin, async (req, res) => {
  try {
    const remoteConnections = await Promise.race([
      supabase.fetchMpesaCodeConnections(),
      new Promise((resolve) => setTimeout(() => resolve([]), 800)),
    ]);
    if (Array.isArray(remoteConnections) && remoteConnections.length) {
      return res.json(remoteConnections);
    }
  } catch {
    // fall through to local data
  }
  return res.json(payment.loadMpesaConnections());
});

app.post("/api/admin/confirm", requireAdmin, requireAdminPin, async (req, res) => {
  const { checkoutId } = req.body || {};
  if (!checkoutId) {
    return res.status(400).json({ success: false, message: "Missing checkoutId." });
  }
  res.json(await payment.adminConfirmPayment(checkoutId));
});

app.post("/api/admin/reject", requireAdmin, requireAdminPin, async (req, res) => {
  const { checkoutId } = req.body || {};
  if (!checkoutId) {
    return res.status(400).json({ success: false, message: "Missing checkoutId." });
  }
  res.json(await payment.adminRejectPayment(checkoutId));
});

app.post("/api/admin/revoke", requireAdmin, requireAdminPin, async (req, res) => {
  const { identifier, ip, mac } = req.body || {};
  const target = identifier || ip || mac;
  if (!target) {
    return res.status(400).json({ success: false, message: "Missing device identifier (IP or MAC)." });
  }

  if (config.SUPABASE_ENABLED) {
    await supabase.revokeAuthorizedDevice(target);
  }
  const ok = db.revoke(target);
  res.json({
    success: ok,
    message: ok ? "Device access revoked." : "Device not found.",
  });
});

// Manual cash sale (admin) — create a paid payment record and optionally authorize IP/MAC
app.post('/api/admin/manual-sale', requireAdmin, requireAdminPin, async (req, res) => {
  const { ip, mac, phone, amount, package: pkg, authorizedBy, transactionId } = req.body || {};
  if (!amount && !pkg) {
    return res.status(400).json({ success: false, message: 'Missing amount or package.' });
  }

  try {
    const result = await payment.adminManualSale({ ip, mac, phone, amount, package: pkg, authorizedBy, transactionId });
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err) {
    console.error('admin/manual-sale error', err);
    return res.status(500).json({ success: false, message: err?.message || 'Server error' });
  }
});

app.post('/api/admin/extend-package', requireAdmin, requireAdminPin, async (req, res) => {
  const { identifier, ip, mac, phone, amount, package: pkg, authorizedBy, transactionId } = req.body || {};
  if (!pkg) {
    return res.status(400).json({ success: false, message: 'Select a package to extend.' });
  }

  try {
    const result = await payment.adminExtendAccess({ identifier, ip, mac, phone, amount, package: pkg, authorizedBy, transactionId });
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err) {
    console.error('admin/extend-package error', err);
    return res.status(500).json({ success: false, message: err?.message || 'Server error' });
  }
});

app.get("*", (req, res) => {
  if (isAdminRequest(req) && (req.path === "/" || req.path === "/index.html")) {
    return res.redirect("/admin");
  }
  res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

setInterval(() => db.cleanupExpired(), 60 * 1000);

// Track attempted ports to avoid retry loops
let attemptedPorts = new Set();
let attemptedHosts = new Set();

function startServer(port, bindHost = null) {
  const primaryBindHost = bindHost || config.HTTP_BIND_IP || "0.0.0.0";
  const server = app.listen(port, primaryBindHost, () => {
    config.ACTUAL_HTTP_PORT = port;
    const displayHost = primaryBindHost === "0.0.0.0" ? "0.0.0.0" : config.PORTAL_IP;
    console.log(`Portal web server listening on http://${displayHost}:${port}`);
    console.log(`Admin dashboard: http://${config.PORTAL_IP}:${port}/admin (from this laptop)`);
    console.log(`Hotspot SSID: ${config.HOTSPOT_SSID} (open — no password)`);
    console.log(`Captive portal: unpaid devices redirect to http://${config.PORTAL_IP}:${port}/`);
    console.log(`DNS interception: ${config.DNS_BIND_IP === "off" ? "disabled via config" : "attempting to bind to UDP :53"}`);
    console.log(`Supabase: ${config.SUPABASE_ENABLED ? "configured" : "missing configuration"}`);
    console.log(`Paystack: ${config.PAYSTACK_ENABLED ? "enabled" : "disabled / missing keys"}`);
    // Reset tracking on successful start
    attemptedPorts.clear();
    attemptedHosts.clear();
  });

  server.on("error", (err) => {
    const hostPortKey = `${primaryBindHost}:${port}`;
    
    if (err && err.code === "EADDRINUSE") {
      attemptedPorts.add(port);
      
      // Try next port on same bind host
      const candidates = [80, 8080, 8000, 3000, 5000].filter(p => !attemptedPorts.has(p));
      
      if (candidates.length > 0) {
        const nextPort = candidates[0];
        console.warn(`Port ${port} on ${primaryBindHost} is busy. Trying port ${nextPort}.`);
        server.close(() => startServer(nextPort, primaryBindHost));
        return;
      }
      
      // If all ports tried on current host, try 0.0.0.0
      if (primaryBindHost !== "0.0.0.0" && !attemptedHosts.has("0.0.0.0")) {
        attemptedHosts.add(primaryBindHost);
        attemptedPorts.clear();
        console.warn(`All ports busy on ${primaryBindHost}. Trying 0.0.0.0 instead.`);
        server.close(() => startServer(port, "0.0.0.0"));
        return;
      }
    }

    if (err && err.code === "EADDRNOTAVAIL") {
      if (primaryBindHost !== "0.0.0.0" && !attemptedHosts.has("0.0.0.0")) {
        attemptedHosts.add(primaryBindHost);
        console.warn(`Bind address ${primaryBindHost} not available. Trying 0.0.0.0 instead.`);
        server.close(() => startServer(port, "0.0.0.0"));
        return;
      }
      console.warn(`Bind address ${primaryBindHost} not available: ${err.message}`);
    }

    throw err;
  });
}

startServer(process.env.PORT ? Number(process.env.PORT) : config.HTTP_PORT);

function startDnsEngine(attempt = 1) {
  try {
    dnsEngine.start();
  } catch (error) {
    if (attempt <= 3 && (error?.code === "EADDRINUSE" || /EADDRINUSE|already in use/i.test(String(error?.message || error)))) {
      console.warn(`DNS engine hit port 53 conflict. Retrying in 2 seconds (attempt ${attempt}/3)...`);
      setTimeout(() => startDnsEngine(attempt + 1), 2000);
      return;
    }

    console.warn("DNS engine did not start cleanly:", error.message || error);
  }
}

startDnsEngine();

