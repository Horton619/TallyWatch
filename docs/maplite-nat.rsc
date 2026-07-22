# TallyWatch base station — mAP lite as a NAT router (isolation alternative)
# -------------------------------------------------------------------------
# Use this ONLY if you want the beacons kept off the production LAN (a WiFi
# isolation boundary), or you don't want to hand-assign a static IP per beacon.
# The base station takes one static IP on the production subnet, hands out its
# own DHCP to beacons on a private WiFi subnet, and NATs their traffic out.
#
# Trade-off vs. bridge mode: beacons are on an isolated subnet, so the manager /
# Companion laptop must be ON the tally WiFi to reach them.
#
# Apply: WinBox -> New Terminal -> paste, OR /import file-name=maplite-nat.rsc
# Edit the CHANGE-ME / EDIT lines first.

# 1. WiFi security
/interface wireless security-profiles
add name=tally mode=dynamic-keys authentication-types=wpa2-psk \
    unicast-ciphers=aes-ccm group-ciphers=aes-ccm \
    wpa2-pre-shared-key="CHANGE-ME-wifi-key"

# 2. 2.4GHz AP
/interface wireless
set wlan1 mode=ap-bridge band=2ghz-b/g/n channel-width=20mhz \
    frequency=auto country="united states" \
    ssid="VEP-Tally" security-profile=tally disabled=no

# 3. Uplink (ether1): a STATIC IP on your production subnet
/ip address
add address=10.0.0.60/24 interface=ether1

# 4. Default route to your production gateway (delete if there is none)
/ip route
add dst-address=0.0.0.0/0 gateway=10.0.0.1

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

# 7. Admin password
/user set admin password="CHANGE-ME-admin-password"
