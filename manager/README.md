# TallyWatch Manager

A desktop app (Electron) to discover, monitor, and update TallyWatch beacons on a
show network. Visual Entropy Productions.

## What it does

- **Discovers** beacons automatically via mDNS (`_tallywatch._tcp`) — no typing IPs.
- **Dashboard** — each beacon's Companion state, WiFi signal, current color, firmware
  version, and uptime, live.
- **Identify** — flash a beacon's LED to physically find which unit is which.
- **Rename** — give beacons friendly names ("Camera 1"); stored on the device.
- **Update over WiFi** — pushes firmware to beacons over the isolated show network.

## The firmware update model (isolated networks)

Show networks are air-gapped, so beacons can't reach GitHub. The manager is the
courier:

1. **When your laptop has internet** (at the shop), click **Check for Updates** — it
   reads the latest GitHub Release, downloads the firmware `.bin`, and caches it
   locally.
2. **On the isolated show network**, click **Update** on a beacon — it pushes the
   cached `.bin` to that beacon, which flashes itself and reboots.

> **Discovery requires being on the beacon subnet.** Because the base station NATs
> the beacons onto their own WiFi subnet, join the **tally WiFi** on your laptop to
> see and manage them — the app shows which network you're on as a reminder.

## Setup

```sh
cd manager
npm install
npm start
```

## GitHub source (Settings ⚙)

Defaults to `Horton619/TallyWatch`. If the repo is **private**, add a GitHub access
token in Settings so the manager can read releases and download the `.bin`. (A public
repo needs no token.)

## Status

Firmware endpoints and the app architecture are built; end-to-end discovery/OTA is
pending validation against real beacons and a published GitHub Release.
