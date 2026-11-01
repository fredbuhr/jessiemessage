import { createHash, timingSafeEqual } from "node:crypto";
import { fork } from "node:child_process";
import { detectExtraImageFormat } from "./extra-image-codecs.mjs";

export const MAX_IMAGE_INPUT_BYTES = 10 * 1024 * 1024;
export const MAX_PREPARATION_INPUT_BYTES = 128 * 1024 * 1024;
export const MAX_PREPARATION_OUTPUT_BYTES = 2 * 1024 * 1024;
export const MAX_PREPARATION_PIXELS = 64_000_000;
export const RAW_IMAGE_HINTS = Object.freeze(["dng", "nef", "arw", "cr2", "cr3", "raf", "rw2", "orf", "pef", "srw"]);
const MAX_THUMBNAIL_BYTES = 512 * 1024;
const WORKER_URL = new URL("./image-worker.mjs", import.meta.url);
const ERROR_CODES = new Set(["MEDIA_INPUT", "MEDIA_FORMAT", "MEDIA_DIMENSIONS", "MEDIA_UNAVAILABLE"]);

export class MediaImageError extends Error {
  constructor(code) {
    super(code === "MEDIA_BUSY" ? "Image processing is busy." : "Image processing failed.");
    this.name = "MediaImageError";
    this.code = code;
    if (code === "MEDIA_BUSY") this.retryAfter = 5;
  }
}

export function imageFormat(bytes, { preparation = false } = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > (preparation ? MAX_PREPARATION_INPUT_BYTES : MAX_IMAGE_INPUT_BYTES)) {
    throw new MediaImageError("MEDIA_INPUT");
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (preparation && bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) return "gif";
  if (preparation && bytes.length >= 4 && ["49492a00", "4d4d002a", "49492b00", "4d4d002b"].includes(bytes.subarray(0, 4).toString("hex"))) return "tiff";
  if (preparation && bytes.length >= 16 && bytes.toString("ascii", 4, 8) === "ftyp") {
    const length = bytes.readUInt32BE(0);
    const header = length === 1 ? 16 : 8;
    const size = length === 1 && bytes.length >= 24 ? Number(bytes.readBigUInt64BE(8)) : length || bytes.length;
    if (Number.isSafeInteger(size) && size >= header + 8 && size <= bytes.length && (size - header) % 4 === 0) {
      let heic = false, avif = false;
      for (let offset = header; offset < size; offset += 4) {
        if (offset === header + 4) continue;
        const brand = bytes.toString("ascii", offset, offset + 4);
        if (["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"].includes(brand)) heic = true;
        if (["avif", "avis"].includes(brand)) avif = true;
      }
      if (heic && !avif) return "heic";
    }
  }
  if (preparation) {
    const extra = detectExtraImageFormat(bytes);
    if (extra) return extra;
  }
  throw new MediaImageError("MEDIA_FORMAT");
}

function output(result, preparation) {
  if (!result || !Buffer.isBuffer(result.full) || result.full.length < 3
    || result.full.length > (preparation ? MAX_PREPARATION_OUTPUT_BYTES : MAX_IMAGE_INPUT_BYTES) || imageFormat(result.full) !== "jpeg"
    || !Buffer.isBuffer(result.thumbnail) || result.thumbnail.length < 3
    || result.thumbnail.length > MAX_THUMBNAIL_BYTES || imageFormat(result.thumbnail) !== "jpeg"
    || ![result.width, result.height].every((n) => Number.isInteger(n) && n >= 1 && n <= 2048)
    || ![result.thumbnailWidth, result.thumbnailHeight].every((n) => Number.isInteger(n) && n >= 1 && n <= 480)
    || !Buffer.isBuffer(result.digest) || result.digest.length !== 32
    || !timingSafeEqual(result.digest, createHash("sha256").update(result.full).digest())) {
    throw new MediaImageError("MEDIA_UNAVAILABLE");
  }
  return {
    full: result.full, thumbnail: result.thumbnail, width: result.width, height: result.height,
    thumbnailWidth: result.thumbnailWidth, thumbnailHeight: result.thumbnailHeight, digest: result.digest,
  };
}

// Dependencies are injectable for lifecycle tests, never from request data or
// environment. The normal application export below fixes the process and timer.
export function createImageNormalizer({ forkProcess = fork, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const queue = [];
  let active = false;

  function pump() {
    if (active || queue.length === 0) return;
    active = true;
    const job = queue.shift();
    let child;
    let timer;
    let finished = false;
    let result;
    let failure;
    function finish(error) {
      if (finished) return;
      finished = true;
      if (timer !== undefined) clearTimer(timer);
      job.bytes.fill(0);
      active = false;
      if (error) job.reject(error);
      else job.resolve(result);
      pump();
    }
    function stop() {
      try { child?.kill("SIGKILL"); } catch { /* No decoder details escape. */ }
    }
    try {
      child = forkProcess(WORKER_URL, [], {
        execArgv: ["--max-old-space-size=96"],
        // Some runtimes expose execPath as "node" rather than an absolute
        // filename. Keep the startup PATH, but discard NODE_OPTIONS and other
        // inherited process hooks and credentials.
        env: { NODE_ENV: "production", PATH: process.env.PATH },
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        serialization: "advanced",
      });
      timer = setTimer(() => {
        failure = new MediaImageError("MEDIA_UNAVAILABLE");
        stop();
        // SIGKILL prevents native work surviving the deadline. The slot remains
        // reserved until exit, so a slow exit cannot overlap another decoder.
      }, job.preparation ? 30_000 : 10_000);
      timer?.unref?.();
      child.on("message", (message) => {
        if (finished || result || failure) return;
        try {
          if (message?.ok !== true) {
            failure = new MediaImageError(ERROR_CODES.has(message?.code) ? message.code : "MEDIA_UNAVAILABLE");
          } else result = output(message.result, job.preparation);
        } catch { failure = new MediaImageError("MEDIA_UNAVAILABLE"); }
        stop();
      });
      child.on("error", () => {
        failure = new MediaImageError("MEDIA_UNAVAILABLE");
        stop();
        // A failed spawn has no running child and may not emit exit.
        if (!child.pid) finish(failure);
      });
      child.once("exit", () => finish(failure || (result ? null : new MediaImageError("MEDIA_UNAVAILABLE"))));
      child.send({ bytes: job.bytes, preparation: job.preparation }, (error) => {
        if (error && !finished) {
          failure = new MediaImageError("MEDIA_UNAVAILABLE");
          stop();
        }
      });
    } catch {
      stop();
      if (child?.pid) {
        failure = new MediaImageError("MEDIA_UNAVAILABLE");
      } else finish(new MediaImageError("MEDIA_UNAVAILABLE"));
    }
  }

  return function normalize(bytes, { preparation = false } = {}) {
    if (typeof preparation !== "boolean") return Promise.reject(new MediaImageError("MEDIA_INPUT"));
    try { imageFormat(bytes, { preparation }); } catch (error) { return Promise.reject(error); }
    if (active && queue.length >= 2) return Promise.reject(new MediaImageError("MEDIA_BUSY"));
    return new Promise((resolve, reject) => {
      queue.push({ bytes: Buffer.from(bytes), preparation, resolve, reject });
      pump();
    });
  };
}

export const normalizeImage = createImageNormalizer();

// Originals travel straight from the authenticated request into the disposable
// child's stdin. Only the bounded JPEG result crosses IPC; the parent never
// retains or copies the original. This does not use the prepared-asset queue.
export function createImagePreparer({ forkProcess = fork, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let active = false;
  return function prepare(source, { declaredBytes = null, hint = null } = {}) {
    if (!source || !["on", "once", "off", "listeners", "pause", "resume"].every(name => typeof source[name] === "function")
      || source.aborted || source.destroyed || source.readableEnded || hint !== null && !RAW_IMAGE_HINTS.includes(hint)
      || declaredBytes !== null && (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0 || declaredBytes > MAX_PREPARATION_INPUT_BYTES)) {
      return Promise.reject(new MediaImageError("MEDIA_INPUT"));
    }
    if (active) return Promise.reject(new MediaImageError("MEDIA_BUSY"));
    active = true;
    return new Promise((resolve, reject) => {
      let child, bodyTimer, decodeTimer, result, failure, received = 0;
      let ended = false, finished = false;
      const ignoreError = () => {};
      const clearTimers = () => { if (bodyTimer !== undefined) clearTimer(bodyTimer); if (decodeTimer !== undefined) clearTimer(decodeTimer); };
      const detach = () => {
        source.pause(); source.off("data", onData); source.off("end", onEnd); source.off("aborted", onAborted);
        source.off("error", onAborted); source.off("close", onClose);
        // A disconnected request can emit a transport error after cleanup.
        if (!source.listeners("error").includes(ignoreError)) source.on("error", ignoreError);
      };
      const finish = () => {
        if (finished) return;
        finished = true; clearTimers(); detach(); active = false;
        if (failure) reject(failure);
        else if (result) resolve(result);
        else reject(new MediaImageError("MEDIA_UNAVAILABLE"));
      };
      const stop = (error) => {
        if (finished || failure) return;
        failure = error; clearTimers(); detach();
        try { child?.stdin?.destroy(); } catch { /* No transport details escape. */ }
        try { child?.kill("SIGKILL"); } catch { /* Retain the place until exit. */ }
        if (!child?.pid) finish();
      };
      function onData(chunk) {
        if (finished || failure || ended) return;
        if (!Buffer.isBuffer(chunk)) { stop(new MediaImageError("MEDIA_INPUT")); return; }
        received += chunk.length;
        if (received > MAX_PREPARATION_INPUT_BYTES) { stop(new MediaImageError("MEDIA_TOO_LARGE")); return; }
        if (declaredBytes !== null && received > declaredBytes) { stop(new MediaImageError("MEDIA_INPUT")); return; }
        try { if (!child.stdin.write(chunk)) source.pause(); }
        catch { stop(new MediaImageError("MEDIA_UNAVAILABLE")); }
      }
      function onEnd() {
        if (finished || failure || ended) return;
        if (received === 0 || declaredBytes !== null && received !== declaredBytes) { stop(new MediaImageError("MEDIA_INPUT")); return; }
        ended = true; clearTimer(bodyTimer); bodyTimer = undefined; detach();
        decodeTimer = setTimer(() => stop(new MediaImageError("MEDIA_UNAVAILABLE")), 30_000); decodeTimer?.unref?.();
        try { child.stdin.end(); } catch { stop(new MediaImageError("MEDIA_UNAVAILABLE")); }
      }
      function onAborted() { stop(new MediaImageError("MEDIA_INPUT")); }
      function onClose() { if (!ended) onAborted(); }
      try {
        child = forkProcess(WORKER_URL, [], {
          execArgv: ["--max-old-space-size=96"], env: { NODE_ENV: "production", PATH: process.env.PATH },
          stdio: ["pipe", "ignore", "ignore", "ipc"], serialization: "advanced",
        });
        child.once("exit", finish);
        child.on("error", () => stop(new MediaImageError("MEDIA_UNAVAILABLE")));
        child.stdin.on("error", () => stop(new MediaImageError("MEDIA_UNAVAILABLE")));
        child.stdin.on("drain", () => { if (!ended && !finished && !failure) source.resume(); });
        child.on("message", (message) => {
          if (finished || failure || result) return;
          if (!ended) { stop(new MediaImageError("MEDIA_UNAVAILABLE")); return; }
          try {
            if (message?.ok !== true) { stop(new MediaImageError(ERROR_CODES.has(message?.code) ? message.code : "MEDIA_UNAVAILABLE")); return; }
            result = output(message.result, true);
            clearTimers();
            try { child.kill("SIGKILL"); } catch { /* Retain the place until exit. */ }
          } catch { stop(new MediaImageError("MEDIA_UNAVAILABLE")); }
        });
        bodyTimer = setTimer(() => stop(new MediaImageError("MEDIA_TIMEOUT")), 120_000); bodyTimer?.unref?.();
        child.send({ preparation: true, stream: true, declaredBytes, hint }, error => { if (error) stop(new MediaImageError("MEDIA_UNAVAILABLE")); });
        if (!failure && !finished) {
          source.once("end", onEnd); source.once("aborted", onAborted); source.once("error", onAborted); source.once("close", onClose); source.on("data", onData);
        }
      } catch { stop(new MediaImageError("MEDIA_UNAVAILABLE")); }
    });
  };
}

export const prepareImageStream = createImagePreparer();
