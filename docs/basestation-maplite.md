# Base Station Setup — MikroTik mAP lite (RBmAPL-2nD)

The mAP lite is the TallyWatch base station: a matchbox-sized WiFi access point
that plugs into your wired production network and gives the beacons a network to
join. **One-time setup** — do it once, and it's permanent.

## Which mode — read this first

**Default: bridge mode.** The mAP lite is a plain access point — a transparent L2
bridge between its WiFi and its Ethernet port. Beacons get **static IPs on the
production LAN** (the same subnet as your Companion control laptop), so:

- The manager runs **right on the Companion laptop** — no separate WiFi to join.
- The mAP lite is a dumb AP; beacons are first-class devices on your control network.
- You assign a static IP per beacon — which is exactly how you already address every
  other piece of production gear, so it's no extra concept. Set them in each beacon's
  setup page, or from the **TallyWatch Manager** (each beacon has a "network" editor).

The one trade-off: bridge mode puts a WiFi AP directly on your control LAN, so use a
strong WPA2 key. If your security posture needs wireless kept *off* the control
network, use [NAT mode](#alternative-nat-isolation) instead.

## What you need

- MikroTik mAP lite (RBmAPL-2nD)
- Power: your production PoE switch, or the kit's PoE injector (TP-Link TL-POE160S)
- A laptop with **WinBox** (MikroTik's free tool) or a browser for WebFig
- A free **static IP** on your production subnet for the base station's management

## Steps (bridge mode)

1. **Power the mAP lite** (PoE) and connect it to your network / laptop.
2. **WinBox → Neighbors** → connect by **MAC address** (works before it has an IP).
   Default login: user `admin`, no password.
3. **System → Reset Configuration** → check **No Default Configuration** → Reset.
   Reconnect by MAC.
4. **New Terminal** → paste [`maplite-bridge.rsc`](maplite-bridge.rsc) (edit the
   `CHANGE-ME` lines first), or upload it and run `/import file-name=maplite-bridge.rsc`.
5. Reconnect afterward at the static management IP you set.

Then, on each beacon (setup page or the TallyWatch Manager): **DHCP off**, a unique
**static IP** on the production subnet, your gateway, and Companion's IP. Give every
beacon the same tally SSID as saved network #1 so they auto-join.

## Verify

1. On a phone, confirm the tally SSID broadcasts and joins with the key.
2. Power a configured beacon — it should stop breathing blue (WiFi), then red
   (Companion), then mirror its button.
3. From the Companion laptop, the TallyWatch Manager should discover it on the LAN.

## Alternative: NAT (isolation)

Use [`maplite-nat.rsc`](maplite-nat.rsc) only if you want beacons kept off the
production LAN (WiFi isolation) or you'd rather not hand-assign per-beacon static IPs.
The base station takes one static IP, hands out its own DHCP to beacons on a private
subnet, and NATs them out to Companion. Cost: beacons are isolated, so the manager /
Companion laptop must be **on the tally WiFi** to reach them.

## Compatibility notes

- Works on RouterOS v6 and v7 — the mAP lite's radio uses the legacy `wireless`
  driver on both.
- 2.4 GHz-only, matching the beacons.
- Beacons dial **outbound** to Companion's IP, so bridge or NAT both work; bridge just
  keeps everything on one flat, directly-reachable subnet.
