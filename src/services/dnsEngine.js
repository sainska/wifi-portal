const dgram = require("dgram");
const config = require("../config");
const { isAuthorized, normalizeIp } = require("./db");
const network = require("./network");
const { resolveBindHost } = require("./bind");

// Convert "192.168.137.1" -> Buffer of 4 bytes
function ipToBytes(ip) {
  return Buffer.from(ip.split(".").map((n) => parseInt(n, 10)));
}

// Find where the QNAME ends in a DNS question section (label-length-prefixed,
// terminated by a 0x00 byte). Returns the offset of the byte AFTER the
// terminator.
function skipName(buf, offset) {
  while (offset < buf.length) {
    const len = buf[offset];
    if (len === 0) return offset + 1;
    // Compression pointer (top two bits set) — 2 bytes, then done for our purposes
    if ((len & 0xc0) === 0xc0) return offset + 2;
    offset += len + 1;
  }
  return offset;
}

function parseQName(buf, offset = 12) {
  const labels = [];
  while (offset < buf.length) {
    const len = buf[offset];
    if (len === 0) break;
    if ((len & 0xc0) === 0xc0) break;
    labels.push(buf.slice(offset + 1, offset + 1 + len).toString("ascii").toLowerCase());
    offset += len + 1;
  }
  return labels.join(".");
}

function isWhitelistedDomain(name) {
  return config.DNS_WHITELIST_SUFFIXES.some(
    (suffix) => name === suffix || name.endsWith(`.${suffix}`)
  );
}

// Build a DNS response that answers the (first) question with a captive
// response pointing at PORTAL_IP. For A queries, this is a normal A record.
// For AAAA queries, it returns an IPv4-mapped answer so modern clients can
// still reach the portal. Other query types also receive a non-empty reply to
// avoid DNS failures that can produce "limited connection" behavior.
function buildRedirectResponse(query) {
  const id = query.slice(0, 2);
  const reqFlags2 = query[2];
  const rd = reqFlags2 & 0x01;

  const qdcount = query.slice(4, 6);
  const nameEnd = skipName(query, 12);
  const qtype = query.readUInt16BE(nameEnd);

  const header = Buffer.alloc(12);
  id.copy(header, 0);
  header[2] = 0x80 | 0x04 | rd; // QR=1, AA=1, RD copied
  header[3] = 0x80; // RA=1
  qdcount.copy(header, 4); // QDCOUNT same as request
  header.writeUInt16BE(1, 6); // ANCOUNT
  header.writeUInt16BE(0, 8); // NSCOUNT
  header.writeUInt16BE(0, 10); // ARCOUNT

  const question = query.slice(12, nameEnd + 4); // name + qtype(2) + qclass(2)

  const useA = qtype !== 28;
  const answerLength = useA ? 16 : 28;
  const answer = Buffer.alloc(answerLength);
  let o = 0;

  answer.writeUInt16BE(0xc00c, o); o += 2; // pointer to name at offset 12
  answer.writeUInt16BE(useA ? 1 : 28, o); o += 2; // TYPE A or AAAA
  answer.writeUInt16BE(1, o); o += 2; // CLASS IN
  answer.writeUInt32BE(config.CAPTIVE_DNS_TTL_SECONDS, o); o += 4; // TTL
  answer.writeUInt16BE(useA ? 4 : 16, o); o += 2; // RDLENGTH

  if (useA) {
    ipToBytes(config.PORTAL_IP).copy(answer, o);
  } else {
    // Use an IPv4-mapped IPv6 answer for the portal.
    const mapped = Buffer.alloc(16, 0);
    mapped[10] = 0xff;
    mapped[11] = 0xff;
    ipToBytes(config.PORTAL_IP).copy(mapped, 12);
    mapped.copy(answer, o);
  }

  return Buffer.concat([header, question, answer]);
}

// Forward the raw query buffer to an upstream DNS server and resolve with
// the raw response buffer. Tries servers in order until one replies.
function forward(query, servers, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    let i = 0;
    tryNext();

    function tryNext() {
      if (i >= servers.length) return reject(new Error("No upstream DNS replied"));
      const { address, port } = servers[i++];
      const sock = dgram.createSocket("udp4");
      const timer = setTimeout(() => {
        sock.close();
        tryNext();
      }, timeoutMs);

      sock.once("message", (msg) => {
        clearTimeout(timer);
        sock.close();
        resolve(msg);
      });
      sock.once("error", () => {
        clearTimeout(timer);
        sock.close();
        tryNext();
      });
      sock.send(query, port, address);
    }
  });
}

function start() {
  const createServer = (bindHost, attempt = 1) => {
    const server = dgram.createSocket({ type: "udp4", reuseAddr: true });
    server.on("listening", () => {
      const address = server.address();
      console.log(`DNS captive-portal server listening on UDP ${address.address}:${address.port}`);
    });

    server.on("error", (err) => {
      if (err?.code === "EADDRNOTAVAIL") {
        // If we can't bind to the configured address, try 0.0.0.0
        if (bindHost !== "0.0.0.0" && attempt === 1) {
          console.warn(`DNS bind failed for ${bindHost}:53. The hotspot address is not available. Falling back to 0.0.0.0.`);
          server.close();
          createServer("0.0.0.0", 2);
          return;
        }
        console.warn(`DNS bind failed for ${bindHost}:53. The hotspot address is not available for DNS binding from this host.`);
        return;
      }

      if (err?.code === "EADDRINUSE") {
        if (attempt === 1 && bindHost !== "0.0.0.0") {
          // Try binding to all interfaces if the specific address is in use
          console.warn(`DNS bind failed for ${bindHost}:53 (port in use). Trying 0.0.0.0...`);
          server.close();
          createServer("0.0.0.0", 2);
          return;
        }
        console.warn(`DNS bind failed for ${bindHost}:53 because another service (Windows DNS, Resolver, etc.) is already using UDP 53. Set DNS_BIND_IP=off in .env to skip DNS binding and use only HTTP captive redirects.`);
        return;
      }

      console.warn(`DNS engine could not start: ${err?.message || err}`);
    });

    server.on("message", async (msg, rinfo) => {
      try {
        const clientIp = normalizeIp(rinfo.address);
        const mac = await network.getMacAddress(clientIp);
        const qname = parseQName(msg);
        const allowRealDns =
          isAuthorized(clientIp, mac) || isWhitelistedDomain(qname);

        if (allowRealDns) {
          const reply = await forward(msg, config.UPSTREAM_DNS);
          server.send(reply, rinfo.port, rinfo.address);
        } else {
          const reply = buildRedirectResponse(msg);
          server.send(reply, rinfo.port, rinfo.address);
        }
      } catch (err) {
        console.error("DNS handling error:", err.message);
      }
    });

    return server;
  };

  // Skip DNS binding if explicitly disabled via environment or config
  if (config.DNS_BIND_IP === "off" || config.DNS_BIND_IP === "disable" || config.DNS_BIND_IP === "disabled") {
    console.log("DNS binding disabled via configuration. Using HTTP-only captive portal.");
    return { bind: () => {}, close: () => {} };
  }

  const bindHost = config.DNS_BIND_IP || config.PORTAL_IP || "0.0.0.0";
  const server = createServer(bindHost);
  server.bind(config.DNS_PORT, bindHost, () => {
    const address = server.address();
    console.log(`DNS captive-portal server listening on UDP ${address.address}:${address.port}`);
  });

  return server;
}

module.exports = { start };
