import test from "node:test";
import assert from "node:assert/strict";
import { validateMp4Prefix } from "../server/video/mp4.mjs";

function ftyp(major = "isom", compatible = ["isom", "mp42"], extended = false) {
  const header = extended ? 16 : 8;
  const bytes = Buffer.alloc(header + 8 + compatible.length * 4);
  bytes.writeUInt32BE(extended ? 1 : bytes.length, 0);
  bytes.write("ftyp", 4, "ascii");
  if (extended) bytes.writeBigUInt64BE(BigInt(bytes.length), 8);
  bytes.write(major, header, "ascii");
  bytes.writeUInt32BE(0xffffffff, header + 4);
  compatible.forEach((value, index) => bytes.write(value, header + 8 + index * 4, "ascii"));
  return bytes;
}
const rejects = (prefix, totalBytes = prefix?.length) => assert.throws(
  () => validateMp4Prefix(prefix, totalBytes),
  error => error.code === "VIDEO_FORMAT" && error.cause === undefined && !error.message.includes("ftyp"),
);

test("MP4 prefix accepts the documented conservative major brands and both box headers", () => {
  for (const major of ["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "iso8", "iso9", "mp41", "mp42", "avc1", "dash", "M4V "]) {
    for (const extended of [false, true]) {
      const prefix = ftyp(major, ["isom", "avc1", "hvc1"], extended);
      assert.equal(validateMp4Prefix(prefix, prefix.length), undefined);
      assert.equal(validateMp4Prefix(prefix, 100 * 1024 * 1024), undefined);
    }
  }
  const minimum = ftyp("mp42", []);
  assert.equal(minimum.length, 16);
  assert.equal(validateMp4Prefix(minimum, minimum.length), undefined);
});

test("MP4 prefix inspects only its initial ftyp box within the first 64 KiB", () => {
  const initial = ftyp();
  const prefix = Buffer.alloc(65536, 0x7f); initial.copy(prefix);
  const before = Buffer.from(prefix);
  assert.equal(validateMp4Prefix(prefix, 500 * 1024 * 1024), undefined);
  assert.deepEqual(prefix, before);
  rejects(Buffer.concat([prefix, Buffer.from([0])]), 500 * 1024 * 1024);
});

test("MP4 prefix rejects other containers, image/HTML signatures and ftyp found after another box", () => {
  rejects(Buffer.from("<!doctype html><html>video</html>"));
  rejects(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, ...Buffer.alloc(24)]));
  rejects(Buffer.from([0xff, 0xd8, 0xff, ...Buffer.alloc(29)]));
  rejects(Buffer.from("arbitrary-untrusted-binary-data"));
  const free = Buffer.alloc(8); free.writeUInt32BE(8); free.write("free", 4);
  rejects(Buffer.concat([free, ftyp()]));
  const wrongType = ftyp(); wrongType.write("moov", 4); rejects(wrongType);
  const highBitType = ftyp(); highBitType[4] |= 0x80; rejects(highBitType);
});

test("MP4 prefix rejects QuickTime, audio M4A and unsupported or malformed major brands", () => {
  for (const major of ["qt  ", "M4A ", "xxxx", "ISO2", "iso7", "\0som", "iso\x7f"]) rejects(ftyp(major));
  for (const compatible of ["\0som", "iso\x7f"]) rejects(ftyp("isom", [compatible]));
  const highBit = ftyp(); highBit[8] = 0xe9; rejects(highBit);
});

test("MP4 prefix rejects truncated, oversized, zero-sized or misaligned ftyp boxes", () => {
  for (const extended of [false, true]) {
    const complete = ftyp("isom", ["isom", "mp42"], extended);
    for (let length = 0; length < complete.length; length++) rejects(complete.subarray(0, length), complete.length);
  }
  for (const size of [0, 2, 8, 12, 15, 17, 19, 65537, 0xffffffff]) {
    const changed = ftyp(); changed.writeUInt32BE(size); rejects(changed);
  }
  for (const size of [0n, 1n, 16n, 23n, 25n, 65537n, 9007199254740993n, 0xffffffffffffffffn]) {
    const changed = ftyp("isom", ["mp42"], true); changed.writeBigUInt64BE(size, 8); rejects(changed);
  }
  const changed = ftyp(); changed.writeUInt32BE(32); rejects(changed, 1000);
});

test("MP4 prefix validates buffer and total byte bounds without leaking incidental exceptions", () => {
  const valid = ftyp();
  for (const prefix of [null, undefined, "ftyp", new Uint8Array(valid), {}, Buffer.alloc(0)]) rejects(prefix, valid.length);
  for (const total of [null, "24", NaN, Infinity, -1, 0, 15, 23, 24.5, Number.MAX_SAFE_INTEGER + 1]) rejects(valid, total);
  assert.throws(() => validateMp4Prefix(valid, undefined), { code: "VIDEO_FORMAT" });
  assert.equal(validateMp4Prefix(valid, Number.MAX_SAFE_INTEGER), undefined);
});
