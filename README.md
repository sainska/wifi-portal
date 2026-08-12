# WiFi Billing Portal (Windows + Tenda F3)

This turns your Windows laptop into the "brain" of your hotspot: the Tenda F3
just broadcasts WiFi, and your laptop shows a login/payment page to new
devices, then lets paid devices browse normally.

**How it works:** every WiFi client's DNS is pointed at your laptop. If a
device hasn't paid, every domain it looks up resolves to your laptop's IP, so
its browser lands on the payment page (and phones/laptops will usually
auto-pop the "Sign in to network" prompt on their own, since that's exactly
what that prompt is designed to detect). Once paid, DNS queries for that
device are forwarded to real DNS servers, so it browses normally.

---

## 1. Wire up the network

1. **Modem/uplink → Laptop.** Connect your actual internet source (modem,
   fiber ONT, another router, etc.) to your laptop — via Ethernet if
   possible, or a second WiFi adapter/USB WiFi dongle if your laptop only has
   one built-in adapter.
2. **Laptop → Tenda F3 (LAN port).** Connect an Ethernet cable from your
   laptop to any **LAN port** on the F3 (not the WAN port).
3. **Put the F3 in Access Point mode** (or just leave its WAN port unused):
   log into `192.168.0.1`, go to **System Tools → Working Mode / Wireless
   Repeating**, and set it so it's just broadcasting WiFi rather than trying
   to route/DHCP on its own. If your F3 firmware doesn't have an explicit "AP
   mode", the simplest fix is: don't plug anything into its WAN port, and
   turn its DHCP server **off** under **Advanced → DHCP Server**, so it
   doesn't hand out conflicting IP addresses.
   - Make sure the WiFi network is configured as open/no password. The portal
     depends on clients being able to connect to the SSID without entering a
     wireless password, then the captive portal will redirect them to the
     package page.
4. **Enable Internet Connection Sharing (ICS) on Windows:**
   - Open **Control Panel → Network and Sharing Center → Change adapter
     settings**.
   - Right-click your **internet-facing adapter** (the uplink) → Properties
     → **Sharing** tab → check **"Allow other network users to connect
     through this computer's Internet connection"** → select the adapter
     connected to the F3 as the home networking connection.
   - Windows will set the F3-facing adapter's IP to **192.168.137.1** and
     start handing out 192.168.137.x addresses to WiFi clients automatically.
   - Run `ipconfig` afterward and confirm the adapter facing the F3 shows
     `192.168.137.1`. If Windows picked a different IP, update `PORTAL_IP` in
     `config.js` to match.

## 2. Install Node.js

Download and install the LTS version from https://nodejs.org if you don't
have it already.

## 3. Install and run this app

Open **Command Prompt as Administrator** (required — binding port 53 and 80
needs admin rights), then:

```cmd
cd path\to\wifi-portal
npm install
npm start
```

You should see:

```
Portal web server listening on http://192.168.137.1:80
DNS captive-portal server listening on UDP :53
```

Leave this window open — closing it stops the hotspot's billing logic (ICS
itself will keep sharing internet, but new devices won't get the payment
gate without this running).

## 4. Test it

1. Connect a phone to the F3's WiFi.
2. It should either auto-pop a "Sign in to network" screen, or opening any
   website in a browser should land on the payment page.
3. Pick a package, and for testing (before you wire up real payments), type
   **PAID** as the payment reference — this triggers the demo "always
   succeed" path in `payment.js`.
4. The phone should show "You're connected!" and normal browsing should work
   within about 10 seconds (DNS cache TTL).

## 5. Wire up real payments

Edit `payment.js` — replace the demo logic in `verifyPayment()` with a real
check against your payment provider (M-Pesa Daraja STK Push, Stripe,
Paystack, etc.). The function just needs to return
`{ success: true/false, message }`.

## 6. Adjust your packages/prices

Edit the `PACKAGES` array in `config.js`.

## 7. Connect the admin portal to Supabase

1. Open Supabase and create a new project.
2. Run the SQL in `supabase.sql` to create the tables:
   - `payments`
   - `pending_payments`
   - `used_codes`
   - `authorized_devices`
3. Set environment variables before starting the app:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `SUPABASE_ANON_KEY`
4. Start the portal with these vars available in the environment.

If you do not set environment variables, the app will fall back to the embedded Supabase project values in `config.js`.

---

## Important limitations (read this before relying on it for real billing)

- **This is a DNS-based captive portal**, the same basic technique used by
  cafés/airports for years. It reliably shows the payment page to ordinary
  devices. It does **not** forcibly block internet access at the network
  level — Windows Internet Connection Sharing forwards all traffic
  regardless of payment status. A technically-minded user could bypass
  payment by manually setting their device's DNS to `8.8.8.8` instead of
  using what your network hands out, or by using an app/browser with
  DNS-over-HTTPS enabled.
- For most everyday customers (people who just connect and expect the normal
  "tap to sign in" flow), this works well. If you expect tech-savvy users
  trying to dodge payment, or you want airtight enforcement, that really
  needs a router built for it — a small **MikroTik** device (~$25–40) has a
  proper Hotspot feature with real firewall-level enforcement, and is
  genuinely the more robust option if this grows into a serious business. I
  can help you set that up too if you'd rather go that route later.
- **Keep the laptop running.** If it sleeps, restarts, or the Node process
  stops, new devices will just get normal internet with no payment gate
  (ICS keeps sharing regardless), and already-connected devices may lose
  DNS resolution until you restart the app.
- Data is stored in a plain `authorized.json` file next to the app — fine for
  a small setup, but back it up / move to a real database if you scale up.

## Automatic startup helper

A new helper script is included: `register-hotspot-task.ps1`

1. Run PowerShell as Administrator.
2. `cd` into the project folder.
3. Run:
   ```powershell
   .\register-hotspot-task.ps1
   ```
4. This creates a scheduled task named `WiFi Portal Startup and Daily Refresh`.

The task:

- runs `restart-portal.ps1` at system startup
- runs `restart-portal.ps1` once per day
- runs with highest privileges under the current user account
- keeps the portal/hotspot startup enabled even if no clients are connected

If you want to inspect the task later, use:

```powershell
Get-ScheduledTask -TaskName 'WiFi Portal Startup and Daily Refresh' | Get-ScheduledTaskInfo
```
