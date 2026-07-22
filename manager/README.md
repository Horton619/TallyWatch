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

## The firmware update model (zero-click awareness)

The manager **ships with a known-good firmware baked in** (`firmware/`), so the moment
it launches — offline, no clicks — it knows the current version and flags which beacons
are behind. A fleet bar summarizes ("1 of 3 need v1.0.0") with one-click **Update all**;
each beacon shows **✓ Latest** or an accented **Update → vX** button.

- **Bundled firmware is the floor.** Always available to push, fully offline.
- **GitHub is the ceiling.** In the background (when the laptop has internet) the
  manager checks GitHub Releases; if there's something *newer than the bundle*, it
  downloads and prefers that — surfaced quietly, never blocking.

Because show networks are air-gapped, the beacons never touch GitHub — the manager is
the courier: it carries firmware (bundled, or pulled from GitHub while online) and
pushes it to beacons over the isolated network.

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
