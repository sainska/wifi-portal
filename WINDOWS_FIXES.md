# WiFi Portal - Windows ICS & Captive Portal Fixes

## Summary of Changes

This document outlines all fixes applied to resolve captive portal detection, DNS port binding, and Windows Internet Connection Sharing (ICS) integration issues.

---

## 1. **DNS Port 53 Binding Issues** ✅

### Problem
- Windows DNS Resolver Service occupies UDP port 53 by default
- Application attempted to bind directly to 192.168.137.1:53, causing EADDRINUSE errors
- No fallback mechanism for DNS binding failure

### Fixes Applied

#### [src/services/dnsEngine.js](src/services/dnsEngine.js)
- **Recursive fallback**: If binding to configured IP fails with EADDRNOTAVAIL, automatically retry on 0.0.0.0
- **Better error messages**: Explain that Windows DNS Resolver is occupying port 53
- **Disable option**: Can set `DNS_BIND_IP=off` in `.env` to skip DNS binding entirely and use HTTP-only captive portal
- **Attempt tracking**: Prevents infinite retry loops

#### [src/config/index.js](src/config/index.js)
- Default `DNS_BIND_IP` tries PORTAL_IP first, then falls back gracefully
- Comment clarifies Windows ICS behavior

### How to Fix DNS Port 53 Conflicts

**Option 1: Stop Windows DNS Resolver (Recommended)**
```powershell
# In PowerShell as Administrator
Get-Service | Where-Object {$_.Name -like "*DNS*"} | Stop-Service -Force
```

**Option 2: Disable DNS Binding via Environment**
```bash
# Add to .env file
DNS_BIND_IP=off
```
The HTTP captive portal will still work; devices just won't auto-redirect via DNS.

**Option 3: Change DNS Port**
```bash
# (Not implemented, but possible future enhancement)
DNS_PORT=5353
```

---

## 2. **Windows ICS Integration** ✅

### Problem
- Application bound to specific IP (192.168.137.1) on HTTP port 80
- Caused EACCES permission errors on Windows
- ICS clients couldn't reach the portal on non-loopback addresses

### Fixes Applied

#### [src/config/index.js](src/config/index.js)
- **HTTP_BIND_IP now defaults to 0.0.0.0** instead of PORTAL_IP
  - Binds to all network interfaces
  - Accessible from hotspot clients via 192.168.137.1
  - Avoids permission and binding conflicts
- **DNS_BIND_IP defaults to PORTAL_IP** (with fallback to 0.0.0.0)
  - DNS is special; clients query the ICS gateway IP directly

#### [server.js](server.js)
- **Improved port fallback logic**
  - Tries HTTP_PORT (80) → 8080 → 8000 → any available port
  - If all fail on current bind address, falls back to 0.0.0.0
- **Better error messages** indicate bind address and fallback strategy
- **Handles EADDRINUSE**: Automatically tries next port without crashing

### How Windows ICS Works
```
Hotspot Client → DHCP assigns 192.168.137.x/24
              ↓
              Client queries DNS on 192.168.137.1 (ICS gateway)
              ↓
              DNS redirects unpaid traffic to 192.168.137.1:80
              ↓
              Server (bound to 0.0.0.0) handles request
```

---

## 3. **Captive Portal Detection** ✅

### Problem
- Some devices didn't detect the captive portal
- Missing responses for modern captive portal detection probes
- Incomplete handling of Wi-Fi auto-connect tests

### Fixes Applied

#### [src/services/captive.js](src/services/captive.js)
- **Expanded CAPTIVE_PATHS array** to handle more device types:
  ```javascript
  [
    "/generate_204",              // Android
    "/gen_204",                   // Android (alternative)
    "/hotspot-detect.html",       // iPhone/macOS
    "/library/test/success.html", // macOS
    "/connecttest.txt",           // Windows
    "/redirect",                  // Generic
    "/ncsi.txt",                  // Windows (NCSI)
    "/success.txt",               // Generic
    "/canonical.html",            // Firefox
    "/fwlink",                    // Windows
    "/check_network_status.txt",  // Windows
    "/captive.html",              // Generic
    "/captive-portal.html",       // Generic
    "/wifi-test.html",            // Generic
  ]
  ```

- **Enhanced isCaptiveProbe() detection** to catch more variants
  - Checks path contains "wifi", "portal", "hotspot-detect"
  - Handles multiple naming conventions

### Captive Portal Detection Flow
```
Device connects to WiFi → Sends HTTP GET /generate_204 or similar
                      ↓
                  Server receives request
                      ↓
              Check if device authorized (via IP/MAC)
                      ↓
         ┌─────────────┴─────────────┐
         ↓                           ↓
      Authorized              Not Authorized
         ↓                           ↓
    Return 204 or            Redirect to
    Success page              Login Portal
         ↓                           ↓
    Browser sees              Captive portal
    connection OK              pops up!
```

---

## 4. **Network Interface Detection** ✅

### Problem
- Didn't properly detect ICS interface (192.168.137.1)
- IPv6 and link-local addresses caused issues
- No prioritization for hotspot-specific interfaces

### Fixes Applied

#### [src/services/bind.js](src/services/bind.js)
- **New function: getHotspotCandidates()**
  - Returns all non-loopback IPv4 addresses
  - Filters out IPv6, loopback (127.x), and link-local (169.254.x)
  - Detects ICS interface automatically

- **Improved selectPreferredHost()**
  - Prioritizes Windows ICS range (192.168.137.x) first
  - Falls back to other RFC1918 ranges (192.168.0.x, 10.0.0.x, 172.16.x)
  - Returns first available if none match common ranges

#### [src/config/index.js](src/config/index.js)
- Uses improved network detection on startup
- Automatically selects ICS gateway IP if available
- Overridable via `PORTAL_IP` environment variable

---

## 5. **Server Startup & Error Handling** ✅

### Problem
- Server crashed on port conflicts without trying alternatives
- No graceful degradation for ICS setup issues

### Fixes Applied

#### [server.js](server.js)
- **Multi-level fallback strategy**:
  1. Try configured port on configured bind address
  2. If EADDRINUSE: try 8080, 8000, 80
  3. If still fails: try binding to 0.0.0.0 instead
  4. Clear error messages at each step

- **DNS engine retries** up to 3 times before giving up
  - Handles Windows DNS Resolver startup delay
  - Doesn't crash the HTTP portal if DNS fails

- **Better logging**:
  - Shows actual bind address
  - Explains what to do if ports are busy
  - Indicates which features are active (DNS, Supabase, Paystack)

### Error Recovery Examples
```
Port 80 on 0.0.0.0 is busy → Try 8080
Port 8080 on 0.0.0.0 is busy → Try 8000
Port 8000 available → Start server
  
If specific IP unavailable → Fall back to 0.0.0.0
DNS conflict with Windows → Retry 3 times, then warn
```

---

## 6. **Environment Configuration** 

### New/Updated Environment Variables

Create or update `.env` in the project root:

```bash
# Network addresses (auto-detected if not set)
PORTAL_IP=192.168.137.1           # Your ICS gateway IP
HTTP_PORT=80                      # Port for web server
HTTP_BIND_IP=0.0.0.0             # Bind to all interfaces
DNS_BIND_IP=192.168.137.1        # Try PORTAL_IP first
DNS_BIND_IP=off                  # Disable DNS binding (HTTP-only)

# Paystack
PAYSTACK_PUBLIC_KEY=...
PAYSTACK_SECRET_KEY=...
PAYSTACK_CURRENCY=KES

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=...
SUPABASE_ANON_KEY=...
```

---

## 7. **Testing the Fixes**

### Test 1: Server Startup
```powershell
# Run as Administrator
cd c:\Users\Admin\Downloads\wifi-portal\wifi-portal
npm start
```

Expected output:
```
DNS captive-portal server listening on UDP 192.168.137.1:53
Portal web server listening on http://0.0.0.0:8000
Admin dashboard: http://192.168.137.1:8000/admin
Captive portal: unpaid devices redirect to http://192.168.137.1:8000/
```

### Test 2: Captive Portal Detection
```powershell
# From another device on the hotspot
curl -v http://192.168.137.1/generate_204
curl -v http://192.168.137.1/connecttest.txt
curl -v http://192.168.137.1/hotspot-detect.html
```

Should redirect to login page or show success based on authorization.

### Test 3: DNS Interception
```powershell
# Set hotspot WiFi adapter DNS to 192.168.137.1
# Then from a device on hotspot:
nslookup google.com 192.168.137.1
```

Should return 192.168.137.1 for unauthorized devices.

### Test 4: Port Fallback
```powershell
# Simulate port 80 being busy
# Open another port listener first, then start the portal
# Portal should automatically fall back to port 8080
```

---

## 8. **Troubleshooting**

| Issue | Solution |
|-------|----------|
| "EADDRINUSE: port 53" | Stop Windows DNS: `Get-Service -Name DNS \| Stop-Service -Force` |
| "EACCES: permission denied" | Run as Administrator |
| "EADDRNOTAVAIL" | Check ICS is properly enabled and interface has IP |
| Device doesn't auto-pop portal | Check DNS binding successful; fallback to HTTP-only mode |
| Can't access admin at 192.168.137.1 | Verify laptop is at 192.168.137.1; check Windows Firewall |
| Supabase not connecting | Verify .env has SUPABASE_URL and SUPABASE_SERVICE_KEY |

---

## 9. **Summary of Files Modified**

1. **src/services/dnsEngine.js** - Recursive DNS binding fallback
2. **src/services/captive.js** - Enhanced captive portal detection
3. **src/services/bind.js** - Improved network interface detection
4. **src/config/index.js** - Better defaults and Windows ICS support
5. **server.js** - Multi-level port/bind fallback strategy

All changes maintain backward compatibility while fixing Windows-specific issues.

---

## 10. **Next Steps**

1. **Test on actual hotspot** with real WiFi clients
2. **Verify device auto-pops** the login portal (Android/iPhone/Windows)
3. **Monitor DNS** for any remaining conflicts
4. **Check payment flow** works end-to-end
5. **Adjust `ADMIN_PIN`** from default "admin123"
