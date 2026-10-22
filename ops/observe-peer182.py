#!/usr/bin/env python3
"""One bounded, read-only TCP observation; never print endpoint identities."""
import ipaddress
import json
import os
from pathlib import Path
import re
import struct
import time

MAX_BYTES = 1024 * 1024
PRIVATE = tuple(map(ipaddress.ip_network, (
    "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7")))


def decode_endpoint(value, width):
    if width not in (8, 32) or not re.fullmatch(r"[0-9A-Fa-f]{%d}:[0-9A-Fa-f]{4}" % width, value):
        raise ValueError("invalid_endpoint")
    encoded, port = value.split(":")
    raw = b"".join(struct.pack("=I", int(encoded[i:i + 8], 16)) for i in range(0, width, 8))
    address = ipaddress.ip_address(raw)
    return getattr(address, "ipv4_mapped", None) or address, int(port, 16)


def category(address):
    if address.is_loopback:
        return "loopback"
    if any(address.version == net.version and address in net for net in PRIVATE):
        return "private"
    return "public" if address.is_global else "other"


def parse_table(text, uid, name):
    lines = text.splitlines()
    if name not in ("tcp", "tcp6") or not lines or not {"local_address", "st", "uid"}.issubset(lines[0].split()):
        raise ValueError("invalid_table")
    found = {}
    for line in lines[1:]:
        fields = line.split()
        if not fields:
            continue
        if len(fields) < 10 or not re.fullmatch(r"[0-9A-Fa-f]{2}", fields[3]):
            raise ValueError("invalid_row")
        if fields[3] != "01" or int(fields[7]) != uid:
            continue
        local, port = decode_endpoint(fields[1], 8 if name == "tcp" else 32)
        peer, _ = decode_endpoint(fields[2], 8 if name == "tcp" else 32)
        if port == 3000:
            found[(name, fields[9], fields[1], fields[2])] = peer
    return found


def read_table(path):
    with open(path, "rb") as handle:
        raw = handle.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError("table_over_limit")
    return raw.decode("ascii")


def observe():
    uid, deadline = os.geteuid(), time.monotonic() + 8
    reads, failures = {"tcp": 0, "tcp6": 0}, {"tcp": 0, "tcp6": 0}
    peers, connections, peak, samples = set(), set(), 0, 0
    while time.monotonic() < deadline:
        current, readable = {}, False
        for name in reads:
            try:
                rows = parse_table(read_table(Path("/proc/net") / name), uid, name)
            except (OSError, UnicodeError, ValueError):
                failures[name] += 1
                continue
            reads[name] += 1
            readable = True
            current.update(rows)
        if not readable:
            break
        samples += 1
        peers.update(current.values())
        connections.update(current)
        peak = max(peak, len(current))
        time.sleep(min(0.2, max(0, deadline - time.monotonic())))
    complete = all(reads.values()) and not any(failures.values())
    counts = {key: sum(category(peer) == key for peer in peers) for key in ("loopback", "private", "public", "other")}
    return {"type": "A11_private_tcp_observation", "status": "observed" if peers else "no_connection_observed" if any(reads.values()) else "unavailable",
            "scope": "local_port_3000_current_uid_established_only", "samples": samples,
            "completeTablesRead": complete, "partialObservation": not complete,
            "successfulTableReads": reads, "tableReadFailures": failures,
            "distinctPeersByCategory": counts, "distinctConnectionsObserved": len(connections),
            "peakConnectionsInOneSample": peak, "rawAddressesPrinted": False,
            "filesWritten": False, "networkRequestsGenerated": False}


if __name__ == "__main__":
    try:
        print(json.dumps(observe(), separators=(",", ":")))
    except (Exception, KeyboardInterrupt):
        print('{"type":"A11_private_tcp_observation","status":"failed","error":"observation_failed"}')
