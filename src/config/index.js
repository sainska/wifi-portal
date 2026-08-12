// ── EDIT THESE FOR YOUR SETUP ────────────────────────────────────────────────

const path = require("path");
const os = require("os");
const dotenv = require("dotenv");
const { selectPreferredHost, getHotspotCandidates } = require("../services/bind.js");

dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });

const detectedAddresses = Object.values(os.networkInterfaces())
  .flat()
  .filter(Boolean)
  .map((entry) => entry.address)
  .filter((address) => address && address !== "127.0.0.1" && !address.startsWith("169.254."));

const preferredPortalIp = process.env.PORTAL_IP || selectPreferredHost(detectedAddresses, ['192.168.137.', '192.168.0.', '10.0.0.', '172.16.']);
const PORTAL_IP = preferredPortalIp || '192.168.137.1';
const DEFAULT_BIND_HOST = process.env.HTTP_BIND_IP || process.env.BIND_HOST || PORTAL_IP;
const DEFAULT_DNS_BIND_HOST = process.env.DNS_BIND_IP || process.env.BIND_HOST || PORTAL_IP;
const HOTSPOT_SSID = "FREE FAST WiFi"; // Set this on your hotspot and ensure the SSID is open (no password)

// IPs that see the admin dashboard instead of the customer portal (this laptop).
const ADMIN_IPS = ["127.0.0.1", "::1", "::ffff:127.0.0.1", PORTAL_IP];

// Simple PIN for admin API actions (change this).
const ADMIN_PIN = "admin123";

const UPSTREAM_DNS = [
  { address: "8.8.8.8", port: 53 },
  { address: "1.1.1.1", port: 53 },
];

const CAPTIVE_DNS_TTL_SECONDS = 8;

const BRAND_NAME = "quantumByteiNNOVATIONS";
const ASSISTANCE_PHONE = "254759587277";
const ASSISTANCE_WHATSAPP = "254759587277";

// M-Pesa pay destination shown to users when STK Push is not configured.
const MPESA_PAYBILL = "";
const MPESA_TILL = "";
const MPESA_ACCOUNT = "WIFI";

// Optional Daraja credentials — leave empty to use manual M-Pesa code / voucher flow.
const MPESA_CONSUMER_KEY = "";
const MPESA_CONSUMER_SECRET = "";
const MPESA_PASSKEY = "";
const MPESA_SHORTCODE = "";

// Paystack configuration for prompt-based payments.
const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY || "";
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || "";
const PAYSTACK_CURRENCY = process.env.PAYSTACK_CURRENCY || "KES";

const SUPABASE_PROJECT_ID = process.env.SUPABASE_PROJECT_ID || "";
const SUPABASE_URL = process.env.SUPABASE_URL || (SUPABASE_PROJECT_ID ? `https://${SUPABASE_PROJECT_ID}.supabase.co` : "");
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY && SUPABASE_ANON_KEY);
// When true, mask client IPs before sending to remote telemetry/storage for privacy.
const MASK_IPS = true;
const PAYSTACK_ENABLED = Boolean(PAYSTACK_PUBLIC_KEY && PAYSTACK_SECRET_KEY && PAYSTACK_CURRENCY);
// Default mobile money provider for Paystack Charge API (override with env if needed)
const PAYSTACK_MOBILE_PROVIDER = process.env.PAYSTACK_MOBILE_PROVIDER || 'MPESA';

const PACKAGES = [
  {
    id: "1h",
    name: "1 HOUR UNLIMITED",
    price: 2,
    originalPrice: 5,
    durationMinutes: 60,
    durationLabel: "1 HOUR",
    devices: 1,
    featured: false,
  },
  {
    id: "3h",
    name: "3 HOURS UNLIMITED",
    price: 5,
    originalPrice: 10,
    durationMinutes: 180,
    durationLabel: "3 HOURS",
    devices: 1,
    featured: false,
  },
  {
    id: "12h",
    name: "12 HOURS UNLIMITED",
    price: 10,
    originalPrice: 20,
    durationMinutes: 12 * 60,
    durationLabel: "12 HOURS",
    devices: 1,
    featured: false,
  },
  {
    id: "24h",
    name: "24 HOURS UNLIMITED",
    price: 15,
    originalPrice: 30,
    durationMinutes: 24 * 60,
    durationLabel: "24 HOURS",
    devices: 1,
    featured: true,
  },
  {
    id: "7d1",
    name: "7 DAYS UNLIMITED",
    price: 75,
    originalPrice: 150,
    durationMinutes: 7 * 24 * 60,
    durationLabel: "7 DAYS",
    devices: 1,
    featured: false,
  },
  {
    id: "7d2",
    name: "7 DAYS 2 DEVICE UNLIMITED",
    price: 125,
    originalPrice: 250,
    durationMinutes: 7 * 24 * 60,
    durationLabel: "7 DAYS",
    devices: 2,
    featured: false,
  },
  {
    id: "1m1",
    name: "1 MONTH 1 DEVICE UNLIMITED",
    price: 225,
    originalPrice: 450,
    durationMinutes: 30 * 24 * 60,
    durationLabel: "1 MONTH",
    devices: 1,
    featured: false,
  },
  {
    id: "1m2",
    name: "1 MONTH 2 DEVICES UNLIMITED",
    price: 375,
    originalPrice: 750,
    durationMinutes: 30 * 24 * 60,
    durationLabel: "1 MONTH",
    devices: 2,
    featured: false,
  },
];

// Pre-generated voucher codes: { code, packageId }
const VOUCHERS = [];

// For Windows ICS, the server prefers the hotspot-facing address for captive portal traffic.
// PORTAL_IP is used for redirect URLs and captive portal detection.
// The actual hotspot clients will access it via the PORTAL_IP (for example 192.168.137.1).
const HTTP_PORT = Number(process.env.HTTP_PORT || process.env.PORT || 80);
const DNS_PORT = 53;
// Prefer the hotspot address first so clients connecting to the Wi-Fi hotspot reach the portal.
// Fall back to 0.0.0.0 when the hotspot address is not available on this host.
const HTTP_BIND_IP = process.env.HTTP_BIND_IP || process.env.BIND_HOST || DEFAULT_BIND_HOST;
const DNS_BIND_IP = process.env.DNS_BIND_IP || process.env.BIND_HOST || DEFAULT_DNS_BIND_HOST;
let ACTUAL_HTTP_PORT = process.env.PORT ? Number(process.env.PORT) : HTTP_PORT;

function getHttpPortCandidates(requestedPort = HTTP_PORT) {
  const basePort = Number(requestedPort) || HTTP_PORT;
  const unique = [basePort, 8080, 8000, 80]
    .filter((value, index, values) => Number.isInteger(value) && values.indexOf(value) === index)
    .map((value) => Number(value));
  return unique.filter((port) => port !== 0);
}

const DNS_WHITELIST_SUFFIXES = [
  "safaricom.co.ke",
  "mpesa.com",
];

module.exports = {
  PORTAL_IP,
  HOTSPOT_SSID,
  ADMIN_IPS,
  ADMIN_PIN,
  UPSTREAM_DNS,
  CAPTIVE_DNS_TTL_SECONDS,
  PACKAGES,
  BRAND_NAME,
  ASSISTANCE_PHONE,
  ASSISTANCE_WHATSAPP,
  MPESA_PAYBILL,
  MPESA_TILL,
  MPESA_ACCOUNT,
  MPESA_CONSUMER_KEY,
  MPESA_CONSUMER_SECRET,
  MPESA_PASSKEY,
  MPESA_SHORTCODE,
  PAYSTACK_PUBLIC_KEY,
  PAYSTACK_SECRET_KEY,
  PAYSTACK_CURRENCY,
  PAYSTACK_ENABLED,
  VOUCHERS,
  HTTP_PORT,
  DNS_PORT,
  HTTP_BIND_IP,
  DNS_BIND_IP,
  ACTUAL_HTTP_PORT,
  getHttpPortCandidates,
  DNS_WHITELIST_SUFFIXES,
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  SUPABASE_ANON_KEY,
  SUPABASE_ENABLED,
  MASK_IPS,
  PAYSTACK_MOBILE_PROVIDER,
};
