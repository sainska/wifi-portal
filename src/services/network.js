const { exec } = require("child_process");

const macCache = new Map();
const MAC_CACHE_TTL_MS = 10_000;

function normalizeIp(ip) {
  if (!ip || typeof ip !== "string") return ip;
  return ip.replace(/^::ffff:/, "");
}

function normalizeMac(mac) {
  if (!mac || typeof mac !== "string") return null;
  return mac.trim().replace(/-/g, ":").toUpperCase();
}

function evaluateConnectionState({ ip, mac, arpEntries = [] } = {}) {
  const normalizedIp = normalizeIp(ip);
  const normalizedMac = normalizeMac(mac);
  const matches = (arpEntries || []).filter((entry) => {
    if (!entry) return false;
    const entryIp = normalizeIp(entry.ip);
    const entryMac = normalizeMac(entry.mac);
    if (normalizedIp && entryIp && entryIp !== normalizedIp) return false;
    if (normalizedMac && entryMac && entryMac !== normalizedMac) return false;
    return Boolean(entryIp || entryMac);
  });

  if (matches.length) {
    return { isConnected: true, source: "arp", matches };
  }

  return { isConnected: false, source: "arp", matches: [] };
}

function parseArpOutput(output, ip) {
  if (!output || !ip) return null;
  const lines = output.split(/\r?\n/);
  const normalizedIp = normalizeIp(ip);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!line.includes(normalizedIp)) continue;
    const parts = line.split(/\s+/);
    const match = parts.find((token) => token.match(/^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i));
    if (match) return normalizeMac(match);
    if (parts.length >= 2) {
      const candidate = parts[1];
      if (candidate.match(/^([0-9a-f]{2}[-]){5}[0-9a-f]{2}$/i)) {
        return normalizeMac(candidate);
      }
    }
  }

  // Fallback: parse any line containing a MAC address and the IP together in a loose format.
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const macMatch = line.match(/([0-9a-f]{2}[:-]){5}[0-9a-f]{2}/i);
    if (!macMatch) continue;
    const ipMatch = line.match(/(\d{1,3}\.){3}\d{1,3}/);
    if (ipMatch && normalizeIp(ipMatch[0]) === normalizedIp) {
      return normalizeMac(macMatch[0]);
    }
  }
  return null;
}

function getCachedMac(ip) {
  const entry = macCache.get(ip);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    macCache.delete(ip);
    return null;
  }
  return entry.mac;
}

function cacheMac(ip, mac) {
  if (!ip || !mac) return;
  macCache.set(ip, { mac, expiresAt: Date.now() + MAC_CACHE_TTL_MS });
}

const trafficCache = {
  expiresAt: 0,
  value: null,
};

function parseNbtstatOutput(output) {
  if (!output) return null;
  const lines = output.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^([\w\-\.]+)<00>\s+UNIQUE/i);
    if (match) {
      return match[1];
    }
  }
  return null;
}

function parseNetTrafficJson(jsonString) {
  try {
    const payload = JSON.parse(jsonString);
    const samples = Array.isArray(payload) ? payload : payload?.CounterSamples || payload;
    if (!samples || !samples.length) return null;

    const metrics = {};
    for (const row of samples) {
      const path = row.Path || row.path || row.PathName || "";
      const value = Number(row.CookedValue ?? row.cookedValue ?? row.Cooked ?? 0);
      const match = path.match(/Network Interface\\\((.+)\\\)(.+)$/i);
      if (!match) continue;
      const iface = match[1];
      const counter = match[2].replace(/^\\/, "");
      metrics[iface] = metrics[iface] || { upload: 0, download: 0 };
      if (/Bytes Received/i.test(counter)) {
        metrics[iface].download = value;
      } else if (/Bytes Sent/i.test(counter)) {
        metrics[iface].upload = value;
      }
    }

    const bestIface = Object.entries(metrics).sort(([, a], [, b]) => (b.download + b.upload) - (a.download + a.upload))[0];
    return bestIface ? { interfaceName: bestIface[0], ...bestIface[1] } : null;
  } catch {
    return null;
  }
}

async function getInterfaceTraffic() {
  if (Date.now() < trafficCache.expiresAt) {
    return trafficCache.value;
  }
  if (process.platform !== "win32") return null;

  const psCommand = `Get-Counter '\\\\Network Interface\\(*)\\Bytes Received/sec','\\\\Network Interface\\(*)\\Bytes Sent/sec' | Select-Object -ExpandProperty CounterSamples | Select-Object Path,CookedValue | ConvertTo-Json`;
  return new Promise((resolve) => {
    exec(`powershell -NoProfile -Command "${psCommand}"`, { timeout: 4000, windowsHide: true }, (error, stdout) => {
      if (error || !stdout) {
        trafficCache.expiresAt = Date.now() + 2000;
        trafficCache.value = null;
        return resolve(null);
      }
      const traffic = parseNetTrafficJson(stdout);
      trafficCache.expiresAt = Date.now() + 2000;
      trafficCache.value = traffic;
      resolve(traffic);
    });
  });
}

async function getDeviceName(ip) {
  ip = normalizeIp(ip);
  if (!ip || process.platform !== "win32") return null;
  return new Promise((resolve) => {
    exec(`nbtstat -A ${ip}`, { timeout: 3000, windowsHide: true }, (error, stdout) => {
      if (error || !stdout) return resolve(null);
      const name = parseNbtstatOutput(stdout);
      resolve(name);
    });
  });
}

async function getDeviceTraffic(ip) {
  const traffic = await getInterfaceTraffic();
  if (!traffic) return null;
  return {
    downloadSpeed: traffic.download,
    uploadSpeed: traffic.upload,
    interfaceName: traffic.interfaceName,
  };
}

async function getMacAddress(ip) {
  ip = normalizeIp(ip);
  if (!ip || ip.startsWith("127.") || ip === "::1") return null;

  const cached = getCachedMac(ip);
  if (cached) return cached;

  const cmd = process.platform === "win32" ? `arp -a ${ip}` : `arp -n ${ip}`;
  return new Promise((resolve) => {
    exec(cmd, { timeout: 3000, windowsHide: true }, (error, stdout) => {
      if (error || !stdout) {
        const fallback = process.platform === "win32" ? `arp -a` : `arp -a`;
        exec(fallback, { timeout: 3000, windowsHide: true }, (fallbackError, fallbackStdout) => {
          if (fallbackError || !fallbackStdout) return resolve(null);
          const mac = parseArpOutput(fallbackStdout, ip);
          if (mac) cacheMac(ip, mac);
          resolve(mac);
        });
        return;
      }
      const mac = parseArpOutput(stdout, ip);
      if (mac) cacheMac(ip, mac);
      resolve(mac);
    });
  });
}

async function getArpEntries() {
  if (process.platform !== "win32") return [];
  return new Promise((resolve) => {
    exec("arp -a", { timeout: 3000, windowsHide: true }, (error, stdout) => {
      if (error || !stdout) return resolve([]);
      const lines = stdout.split(/\r?\n/);
      const entries = [];
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith("Interface") || line.startsWith("Internet")) continue;
        const parts = line.split(/\s+/).filter(Boolean);
        if (parts.length < 3) continue;
        const ip = normalizeIp(parts[0]);
        const mac = normalizeMac(parts[1]);
        if (!ip || !mac) continue;
        entries.push({ ip, mac, type: parts[2] || "dynamic" });
      }
      resolve(entries);
    });
  });
}

module.exports = {
  getMacAddress,
  getDeviceName,
  getDeviceTraffic,
  evaluateConnectionState,
  getArpEntries,
};
