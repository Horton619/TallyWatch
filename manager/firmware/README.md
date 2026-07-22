# Bundled firmware

The manager ships with a known-good firmware `.bin` so it can compare beacons and push
updates **immediately, offline, with zero setup** — the baseline for "are my beacons on
the latest?" without any network round-trip.

- `manifest.json` — the bundled version (committed; drives the version comparison).
- `TallyWatch-v*.bin` — the actual binary (git-ignored; produced by the bundle script,
  and included when the manager is packaged).

## Refreshing the bundle

Run this after changing firmware, before packaging the manager:

```sh
manager/tools/bundle-firmware.sh
```

It compiles the current firmware, drops the versioned `.bin` here, and rewrites
`manifest.json` from `FW_VERSION` in `TallyWatch.ino`.

The manager also checks GitHub Releases in the background: if a release is newer than
this bundled version, it downloads and prefers that instead — so the bundle is the
floor, GitHub is the ceiling.
