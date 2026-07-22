# TallyWatch base station — mAP lite as a plain bridged access point
# ------------------------------------------------------------------
# Default for TallyWatch: the mAP lite is a transparent L2 bridge between its
# WiFi and its Ethernet port. Beacons get STATIC IPs on the production LAN
# (set per beacon, in the beacon setup page or the TallyWatch Manager), so they
# sit on the same network as the Companion control laptop — no NAT, no DHCP.
#
# Apply: WinBox -> New Terminal -> paste, OR upload this file and run
#   /import file-name=maplite-bridge.rsc
# Edit the three CHANGE-ME / EDIT lines first.

# 1. WiFi security (WPA2-PSK)
/interface wireless security-profiles
add name=tally mode=dynamic-keys authentication-types=wpa2-psk \
    unicast-ciphers=aes-ccm group-ciphers=aes-ccm \
    wpa2-pre-shared-key="CHANGE-ME-wifi-key"

# 2. Bridge WiFi + Ethernet into one L2 segment (no NAT, no DHCP)
/interface bridge
add name=bridge-tally
/interface bridge port
add bridge=bridge-tally interface=ether1
add bridge=bridge-tally interface=wlan1

# 3. 2.4GHz AP. default-forwarding=yes keeps client isolation OFF so the wired
#    Companion laptop can reach the WiFi beacons.
/interface wireless
set wlan1 mode=ap-bridge band=2ghz-b/g/n channel-width=20mhz \
    frequency=auto country="united states" \
    ssid="VEP-Tally" security-profile=tally \
    default-forwarding=yes disabled=no

# 4. A static management IP for the base station itself, on the production subnet
/ip address
add address=10.0.0.61/24 interface=bridge-tally

# 5. Admin password
/user set admin password="CHANGE-ME-admin-password"
