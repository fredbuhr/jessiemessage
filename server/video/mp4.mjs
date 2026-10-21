const MAX_PREFIX_BYTES = 65536;
const FTYP = Buffer.from("ftyp", "ascii");
const MP4_BRANDS = new Set([
  "isom", "iso2", "iso3", "iso4", "iso5", "iso6", "iso8", "iso9",
  "mp41", "mp42", "avc1", "dash", "M4V ",
]);

function invalid() {
  const error = new Error("The video container is unsupported.");
  error.code = "VIDEO_FORMAT";
  throw error;
}

/** Inspect only the initial, complete ftyp box. This is a conservative MP4
 * container check, not a decoder, track/codec check or a streamability claim.
 * Unknown compatible brands are permitted when the major brand is supported;
 * QuickTime/MOV and audio-only M4A major brands are deliberately not accepted.
 * The caller supplies at most the first 64 KiB, never the whole large video. */
export function validateMp4Prefix(prefix, totalBytes) {
  if (!Buffer.isBuffer(prefix) || !Number.isSafeInteger(totalBytes) || totalBytes < 16
    || prefix.length < 16 || prefix.length > MAX_PREFIX_BYTES || prefix.length > totalBytes) invalid();
  if (!prefix.subarray(4, 8).equals(FTYP)) invalid();

  const compactSize = prefix.readUInt32BE(0);
  let boxBytes = compactSize, headerBytes = 8;
  if (compactSize === 1) {
    if (prefix.length < 24) invalid();
    const extendedSize = prefix.readBigUInt64BE(8);
    if (extendedSize > BigInt(MAX_PREFIX_BYTES)) invalid();
    boxBytes = Number(extendedSize); headerBytes = 16;
  }
  // A zero-sized box extends to EOF; it is not accepted as this bounded header.
  if (boxBytes < headerBytes + 8 || boxBytes > MAX_PREFIX_BYTES
    || boxBytes > totalBytes || boxBytes > prefix.length || (boxBytes - headerBytes - 8) % 4 !== 0) invalid();

  const brand = (offset) => {
    for (let index = offset; index < offset + 4; index++) {
      if (prefix[index] < 0x20 || prefix[index] > 0x7e) invalid();
    }
    return prefix.toString("ascii", offset, offset + 4);
  };
  if (!MP4_BRANDS.has(brand(headerBytes))) invalid();
  // Minor version is an unrestricted unsigned 32-bit field, not a brand.
  for (let offset = headerBytes + 8; offset < boxBytes; offset += 4) brand(offset);
}
