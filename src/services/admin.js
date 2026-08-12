function getClientIp(req) {
  if (!req) return null;
  const forwarded = req.headers?.["x-forwarded-for"] || req.headers?.["x-real-ip"] || req.headers?.["cf-connecting-ip"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || null;
}

function normalizeIp(ip) {
  if (!ip || typeof ip !== "string") return null;
  return ip.replace(/^::ffff:/, "").trim();
}

function isPrivateIp(ip) {
  const normalized = normalizeIp(ip);
  if (!normalized) return false;
  if (normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost") return true;
  if (normalized.startsWith("10.")) return true;
  if (normalized.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)) return true;
  return false;
}

function isAdminRequest(req, config = {}) {
  const clientIp = normalizeIp(getClientIp(req));
  const adminPin = req?.headers?.["x-admin-pin"] || req?.query?.pin || req?.query?.adminPin || req?.body?.pin;
  const pinMatches = Boolean(config.ADMIN_PIN) && typeof adminPin === "string" && adminPin === config.ADMIN_PIN;
  const ipMatches = Boolean(clientIp && Array.isArray(config.ADMIN_IPS) && config.ADMIN_IPS.includes(clientIp));
  const localAdminOnly = ipMatches || (clientIp === "127.0.0.1" || clientIp === "::1" || clientIp === "localhost");
  return pinMatches || localAdminOnly;
}

module.exports = {
  getClientIp,
  normalizeIp,
  isPrivateIp,
  isAdminRequest,
};
