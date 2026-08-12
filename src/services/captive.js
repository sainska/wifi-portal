const path = require("path");
const network = require("./network");

function portalUrl(config) {
  const port = config.ACTUAL_HTTP_PORT || config.HTTP_PORT || 80;
  const host = config.PORTAL_IP;
  return port === 80 ? `http://${host}/` : `http://${host}:${port}/`;
}

function clientIp(req, db) {
  return db.normalizeIp(req.socket.remoteAddress);
}

async function isGuest(req, db, isAdminRequest) {
  const ip = clientIp(req, db);
  if (db.isAuthorized(ip) || isAdminRequest(req)) {
    return false;
  }
  const mac = await network.getMacAddress(ip);
  return !db.isAuthorized(ip, mac);
}

function attach(app, config, db, isAdminRequest) {
  const loginUrl = () => portalUrl(config);
  // login.html lives at the project-level `public` folder, not inside src/services
  const loginPage = path.join(__dirname, '..', '..', 'public', 'login.html');
  const isCaptiveProbe = (reqPath) => {
    const normalized = (reqPath || '').toLowerCase();
    if (!normalized || normalized === '/') return true;
    return normalized.startsWith('/generate_204') ||
           normalized.startsWith('/gen_204') ||
           normalized.startsWith('/ncsi.txt') ||
           normalized.startsWith('/success.txt') ||
           normalized.startsWith('/canonical.html') ||
           normalized.startsWith('/connecttest') ||
           normalized.startsWith('/hotspot-detect') ||
           normalized.includes('hotspot-detect') ||
           normalized.includes('connecttest') ||
           normalized.includes('ncsi') ||
           normalized.includes('success.txt') ||
           normalized.includes('canonical.html') ||
           normalized.includes('fwlink') ||
           normalized.includes('redirect') ||
           normalized.includes('captive') ||
           normalized.includes('portal') ||
           normalized.includes('wifi');
  };

  const CAPTIVE_PATHS = [
    "/generate_204",
    "/gen_204",
    "/hotspot-detect.html",
    "/library/test/success.html",
    "/connecttest.txt",
    "/redirect",
    "/ncsi.txt",
    "/success.txt",
    "/canonical.html",
    "/fwlink",
    "/check_network_status.txt",
    "/captive.html",
    "/captive-portal.html",
    "/wifi-test.html",
  ];

  CAPTIVE_PATHS.forEach((route) => {
    app.get(route, async (req, res) => {
      if (await isGuest(req, db, isAdminRequest)) {
        return res.redirect(302, loginUrl());
      }
      if (route.includes("204")) {
        return res.status(204).end();
      }
      if (route.includes("connecttest") || route.includes("ncsi") || route.endsWith(".txt")) {
        return res.type("text/plain").send("Microsoft Connect Test");
      }
      return res
        .type("text/html")
        .send("<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>");
    });
  });

  // Phones pop "Sign in to network" when these return non-success.
  app.get("/captive", async (req, res) => {
    if (await isGuest(req, db, isAdminRequest)) {
      return res.redirect(302, loginUrl());
    }
    res.redirect(302, loginUrl());
  });

  const portalHosts = new Set([
    config.PORTAL_IP,
    "localhost",
    "127.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
  ]);

  app.use(async (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (!(await isGuest(req, db, isAdminRequest))) return next();
    if (req.path.startsWith("/api/")) return next();
    if (req.path === "/admin" || req.path.startsWith("/admin")) return next();

    const host = (req.hostname || "").toLowerCase();
    if (!host || !portalHosts.has(host)) {
      return res.redirect(302, loginUrl());
    }

    if (isCaptiveProbe(req.path) || req.path === "/" || req.path === "") {
      return res.sendFile(loginPage);
    }

    return res.redirect(302, loginUrl());
  });

  app.get("/", async (req, res, next) => {
    if (isAdminRequest(req)) return next();
    if (await isGuest(req, db, isAdminRequest)) {
      return res.sendFile(loginPage);
    }
    next();
  });
}

module.exports = { attach, portalUrl };
