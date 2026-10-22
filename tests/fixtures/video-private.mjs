import path from "node:path";
import { bundle, key, origin } from "./crm-private.mjs";

export function videoBundle(mediaRoot, videoRoot) {
  const source = bundle(mediaRoot);
  return { ...source, video: { format: "jessiemessage-runtime-video", version: 1, origin,
    videoKey: key(7), videoRoot: videoRoot ?? path.resolve(source.media.mediaRoot, "../synthetic-video"),
    ownerBytes: "1073741824", totalBytes: "10737418240", minimumFreeBytes: "536870912" } };
}
