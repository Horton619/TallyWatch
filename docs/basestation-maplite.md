# Base Station Setup — MikroTik mAP lite (RBmAPL-2nD)

The mAP lite is the TallyWatch base station: a matchbox-sized WiFi access point
that plugs into your wired production network and gives the beacons a network to
join. **One-time setup** — do it once, and it's permanent.

## Which mode — read this first

TallyWatch's production networks are **static IP, no DHCP**. For that, run the
mAP lite as a small **NAT router** (the config below):

- It takes **one static IP** on your production subnet — like any other piece of
  production gear you assign by hand.
- It hands out its *own* DHCP to the beacons on a private WiFi subnet, and NATs
  their traffic out to Companion.
- So you assign exactly **one** static IP (the base station); every beacon stays
  auto-config (DHCP on) with an identical SSID + Companion IP. Import one config
  to all of them.
- Beacons dial **outbound** to Companion's static IP — NAT is transparent, and
  Companion tells beacons apart by device ID, not source IP, so all of them
  behind one NAT IP is fine.

*(If you ever deploy on a network that DOES run DHCP and you'd rather have the
beacons sit directly on the production subnet, there's a
[bridge-mode variant](#alternative-bridge-mode) at the bottom.)*

---

## What you need

- MikroTik mAP lite (RBmAPL-2nD)
- Power: your production PoE switch, **or** the kit's PoE injector (TP-Link
  TL-POE160S) between a normal switch and the mAP lite
- A laptop with **WinBox** (MikroTik's free config tool) or a browser for WebFig
- Two IPs decided in advance:
  - a free **static IP** on your production subnet for the base station
  - your **Companion machine's IP** (you'll enter this on the beacons, not here)

---

## Steps

1. **Power the mAP lite** (PoE) and connect it to your network / laptop.
2. **Open WinBox → Neighbors tab**, connect to the mAP lite by its **MAC
   address** (works before it has an IP). Default login: user `admin`, no
   password.
3. **Start clean:** System → Reset Configuration → check **No Default
   Configuration** → Reset. It reboots; reconnect by MAC.
4. Open **New Terminal** and paste the script below (edit the marked lines).
5. Done — reconnect afterward at the static IP you set.

---

## The config (NAT) — paste into New Terminal

Edit the lines marked `EDIT`. The example puts the production subnet at
`10.0.0.x` and the base station at `10.0.0.60` — change these to match your
network. The beacon-side subnet (`192.168.50.x`) is private to the base station
and normally doesn't need changing.

```rsc
# --- TallyWatch base station: mAP lite as a NAT router for a static/no-DHCP LAN ---

# 1. WiFi security: WPA2-PSK with your tally password
/interface wireless security-profiles
add name=tally mode=dynamic-keys authentication-types=wpa2-psk \
    unicast-ciphers=aes-ccm group-ciphers=aes-ccm \
    wpa2-pre-shared-key="CHANGE-ME-wifi-key"                 ;# EDIT

# 2. Radio as a 2.4GHz access point broadcasting your tally SSID
/interface wireless
set wlan1 mode=ap-bridge band=2ghz-b/g/n channel-width=20mhz \
    frequency=auto country="united states" \
    ssid="VEP-Tally" security-profile=tally disabled=no      ;# EDIT ssid

# 3. Uplink (ether1): a STATIC IP on your production subnet
/ip address
add address=10.0.0.60/24 interface=ether1                    ;# EDIT

# 4. Default route to your production gateway (delete this line if there is none;
#    not needed to reach a Companion machine on the same subnet)
/ip route
add dst-address=0.0.0.0/0 gateway=10.0.0.1                   ;# EDIT / or remove

# 5. Beacon-side WiFi subnet + its own DHCP server (private to the base station)
/interface bridge
add name=bridge-lan
/interface bridge port
add bridge=bridge-lan interface=wlan1
/ip address
add address=192.168.50.1/24 interface=bridge-lan
/ip pool
add name=tally-pool ranges=192.168.50.10-192.168.50.200
/ip dhcp-server
add name=tally-dhcp interface=bridge-lan address-pool=tally-pool lease-time=1h disabled=no
/ip dhcp-server network
add address=192.168.50.0/24 gateway=192.168.50.1

# 6. NAT: masquerade beacon traffic out the production uplink
/ip firewall nat
add chain=srcnat out-interface=ether1 action=masquerade

# 7. Admin password — don't leave it blank
/user set admin password="CHANGE-ME-admin-password"          ;# EDIT
```

---

## Match the beacons to it

On every beacon's setup page:

- **Network** → add the tally WiFi (same `ssid` + key as step 1 above). Leave
  **DHCP on** — the base station hands out the beacon's IP.
- **Companion** → your Companion machine's **static IP** on the production subnet
  (e.g. `10.0.0.50`) + port `16622`.

Every beacon gets the **same** two values, so configure one, **Export Config**,
and **Import** it onto the rest — they're identical.

**Channel tip:** in an RF-busy venue, pin the radio to a clear channel — set
`frequency=2412` (ch 1), `2437` (ch 6), or `2462` (ch 11) in step 2.

---

## Verify

1. On a phone, confirm the tally SSID broadcasts and you can join with the key.
2. Power a configured beacon — it should stop breathing blue (joined WiFi), then
   stop breathing red (reached Companion), then mirror its assigned button.
3. In WinBox, **IP → DHCP Server → Leases** shows each beacon that has joined.

---

## Alternative: bridge mode

Only if you deploy on a network that **does** run DHCP, or you specifically want
the beacons sitting directly on the production subnet. In bridge mode the mAP lite
is a transparent L2 AP (no NAT, no DHCP of its own):

- On the mAP lite: one bridge containing `ether1` + `wlan1`, a static management
  IP on the bridge, and the same wireless AP config as above. No `/ip pool`,
  `/ip dhcp-server`, `/ip route`, or NAT lines.
- On each beacon: turn **DHCP off** and set a **unique static IP** per beacon on
  the production subnet, plus the production gateway and Companion's IP.

The cost is per-beacon static IP assignment — which is why NAT is the default for
a static-only shop.

---

## Compatibility notes

- Works on RouterOS v6 and v7 — the mAP lite's radio uses the legacy `wireless`
  driver on both.
- 2.4 GHz-only, matching the beacons (also 2.4 GHz-only).
- Nothing about the beacon↔Companion link depends on the AP mode: beacons dial
  **outbound** to Companion's IP, which works the same behind NAT or on a bridge.
