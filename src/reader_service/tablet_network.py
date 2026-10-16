"""Explicit, bounded LAN access for the tablet demo; desktop stays loopback."""
from __future__ import annotations

import ipaddress
import socket


_PRIVATE_NETWORKS = tuple(ipaddress.IPv4Network(value) for value in (
    "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
))


def is_private_ipv4(value: str) -> bool:
    # is_private also includes reserved/link-local addresses; the demo accepts
    # only RFC1918, including for the actual TCP peer (never forwarded headers).
    try:
        address = ipaddress.IPv4Address(value)
    except ipaddress.AddressValueError:
        return False
    return any(address in network for network in _PRIVATE_NETWORKS)


def validate_tablet_address(value: str, *, check_local: bool = True) -> str:
    if not is_private_ipv4(value):
        raise ValueError("Tablet LAN requires a specific RFC1918 IPv4 address; wildcard/public/loopback addresses are forbidden")
    if check_local:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
                probe.bind((value, 0))
        except OSError as exc:
            raise ValueError("Tablet LAN address is not assigned to this computer") from exc
    return value
