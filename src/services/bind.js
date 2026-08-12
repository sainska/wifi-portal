function resolveBindHost(configuredHost, error) {
  if (configuredHost && error?.code === 'EADDRNOTAVAIL') {
    return '0.0.0.0';
  }
  return configuredHost || '0.0.0.0';
}

function selectPreferredHost(candidateAddresses, preferredPrefixes = ['192.168.137.', '192.168.0.', '10.0.0.', '172.16.']) {
  const addresses = (candidateAddresses || [])
    .filter(Boolean)
    .map((item) => String(item).trim())
    .filter((item) => item && !item.startsWith('127.') && !item.startsWith('::') && !item.startsWith('169.254.'));

  if (!addresses.length) {
    return '192.168.137.1';
  }

  // Prefer Windows ICS default addresses in order
  for (const prefix of preferredPrefixes) {
    const match = addresses.find((address) => address.startsWith(prefix));
    if (match) {
      return match;
    }
  }

  // Fall back to any non-loopback address
  return addresses[0];
}

/**
 * Get all non-loopback network interfaces suitable for hotspot operation.
 * Filters out IPv6, loopback, and link-local addresses.
 */
function getHotspotCandidates() {
  const os = require('os');
  const candidates = [];
  const interfaces = os.networkInterfaces();
  
  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs || []) {
      // Only IPv4, not loopback, not link-local
      if (addr.family === 'IPv4' && !addr.internal && !addr.address.startsWith('169.254.')) {
        candidates.push({ name, address: addr.address });
      }
    }
  }
  
  return candidates;
}

module.exports = { resolveBindHost, selectPreferredHost, getHotspotCandidates };
