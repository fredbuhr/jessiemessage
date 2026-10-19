import { isIP } from "node:net";

export const PARENT_PEER_HEADER = "x-jessie-parent-peer";
const peers = new WeakMap();

// Only the explicitly configured, loopback-bound managed child trusts the
// parent's stamp. Public requests and arbitrary forwarding headers never do.
export function bindParentPeer(request) {
  const local = request.socket?.remoteAddress;
  const stamp = request.headers?.[PARENT_PEER_HEADER];
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(local) || typeof stamp !== "string" || !isIP(stamp)) {
    throw new TypeError("The managed request peer could not be verified.");
  }
  peers.set(request, stamp);
}

export function peerAddress(request) { return peers.get(request) ?? request.socket?.remoteAddress; }
