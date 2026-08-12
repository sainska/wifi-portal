// ── EDIT THESE FOR YOUR SETUP ────────────────────────────────────────────────

const PORTAL_IP = "192.168.137.1";
const HOTSPOT_SSID = "FREE FAST WiFi";

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

const HTTP_PORT = 80;
const DNS_PORT = 53;

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
  VOUCHERS,
  HTTP_PORT,
  DNS_PORT,
  DNS_WHITELIST_SUFFIXES,
};
