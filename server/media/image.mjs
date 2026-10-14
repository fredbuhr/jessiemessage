import { createHash, timingSafeEqual } from "node:crypto";
import { fork } from "node:child_process";

export const MAX_IMAGE_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 512 * 1024;
const WORKER_URL = new URL("./image-worker.mjs", import.meta.url);
const ERROR_CODES = new Set(["MEDIA_INPUT", "MEDIA_FORMAT", "MEDIA_UNAVAILABLE"]);

export class MediaImageError extends Error {
  constructor(code) {
    super(code === "MEDIA_BUSY" ? "Image processing is busy." : "Image processing failed.");
    this.name = "MediaImageError";
    this.code = code;
    if (code === "MEDIA_BUSY") this.retryAfter = 5;
  }
}

export function imageFormat(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_IMAGE_INPUT_BYTES) {
    throw new MediaImageError("MEDIA_INPUT");
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  throw new MediaImageError("MEDIA_FORMAT");
}

function output(result) {
  if (!result || !Buffer.isBuffer(result.full) || result.full.length < 3
    || result.full.length > MAX_IMAGE_INPUT_BYTES || imageFormat(result.full) !== "jpeg"
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
      }, 10_000);
      timer?.unref?.();
      child.on("message", (message) => {
        if (finished || result || failure) return;
        try {
          if (message?.ok !== true) {
            failure = new MediaImageError(ERROR_CODES.has(message?.code) ? message.code : "MEDIA_UNAVAILABLE");
          } else result = output(message.result);
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
      child.send({ bytes: job.bytes }, (error) => {
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

  return function normalize(bytes) {
    try { imageFormat(bytes); } catch (error) { return Promise.reject(error); }
    if (active && queue.length >= 2) return Promise.reject(new MediaImageError("MEDIA_BUSY"));
    return new Promise((resolve, reject) => {
      queue.push({ bytes: Buffer.from(bytes), resolve, reject });
      pump();
    });
  };
}

export const normalizeImage = createImageNormalizer();
