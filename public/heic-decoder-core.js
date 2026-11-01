// Shared, DOM-free HEVC decoding for a disposable browser worker or isolated
// server decoder. The caller owns cancellation and process/worker deadlines.
export const MAX_HEIC_INPUT_BYTES = 128 * 1024 * 1024;
export const MAX_HEIC_IMAGE_PIXELS = 64_000_000;
const SIZE = 2048;
const fail = code => { throw Object.assign(new Error("Photo decoding failed."), { code }); };
const validSize = (width, height) => Number.isSafeInteger(width) && Number.isSafeInteger(height)
  && width > 0 && height > 0 && Number.isSafeInteger(width * height) && width * height <= MAX_HEIC_IMAGE_PIXELS;

// The pinned 1.23.7 package mixes Embind handles and raw C exports. This one
// raw setter needs the opaque numeric pointer, never the Embind object. Set
// only the codec's pixel-area limit; preserve every other native security cap.
export function limitHeicDecoder(context, lib, maximumWidth = 8000) {
  const pointer = context?.$$?.ptr;
  if (lib.heif_get_version?.() !== "1.23.7" || typeof lib._heif_context_set_maximum_image_size_limit !== "function"
    || !Number.isSafeInteger(pointer) || pointer < 1 || pointer > 0xffffffff
    || !Number.isSafeInteger(maximumWidth) || maximumWidth < 1 || maximumWidth > 8000) fail("media_heic");
  lib._heif_context_set_maximum_image_size_limit(pointer, maximumWidth);
}

// The pinned libheif API returns its RGBA plane. Sample it directly into the
// small output; never copy the full plane into another RGBA buffer or canvas.
export function shrinkHeicPlane(channel) {
  const { width, height, stride, data } = channel ?? {};
  if (!validSize(width, height) || !Number.isSafeInteger(stride) || stride < width * 4
    || !ArrayBuffer.isView(data) || data.BYTES_PER_ELEMENT !== 1
    || data.byteLength < stride * (height - 1) + width * 4) fail("media_dimensions");
  const ratio = Math.min(1, SIZE / Math.max(width, height));
  const targetWidth = Math.max(1, Math.floor(width * ratio)), targetHeight = Math.max(1, Math.floor(height * ratio));
  const pixels = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y += 1) {
    const sy = Math.max(0, (y + 0.5) * height / targetHeight - 0.5), y0 = Math.floor(sy), y1 = Math.min(height - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < targetWidth; x += 1) {
      const sx = Math.max(0, (x + 0.5) * width / targetWidth - 0.5), x0 = Math.floor(sx), x1 = Math.min(width - 1, x0 + 1), fx = sx - x0;
      const a = y0 * stride + x0 * 4, b = y0 * stride + x1 * 4, c = y1 * stride + x0 * 4, d = y1 * stride + x1 * 4;
      const offset = (y * targetWidth + x) * 4;
      const sample = component => (data[a + component] * (1 - fx) + data[b + component] * fx) * (1 - fy)
        + (data[c + component] * (1 - fx) + data[d + component] * fx) * fy;
      const alpha = sample(3) / 255;
      for (let component = 0; component < 3; component += 1) {
        pixels[offset + component] = sample(component) * alpha + [245, 238, 242][component] * (1 - alpha);
      }
      pixels[offset + 3] = 255;
    }
  }
  return { pixels, width: targetWidth, height: targetHeight };
}

export async function decodeHeicPixels(bytes, lib) {
  if (!ArrayBuffer.isView(bytes) || bytes.BYTES_PER_ELEMENT !== 1 || bytes.byteLength < 1) fail("media_heic");
  if (bytes.byteLength > MAX_HEIC_INPUT_BYTES) fail("image_source_too_large");
  let context, handle, decoded;
  try {
    context = lib.heif_context_alloc(); if (!context) fail("media_heic");
    limitHeicDecoder(context, lib);
    // libheif owns container validation. Hand-written metadata inspection must
    // not reject valid derived images, property associations or transforms.
    const type = lib.heif_js_check_filetype(bytes);
    if (type !== lib.heif_filetype_result.heif_filetype_yes_supported) fail("media_heic");
    const parsed = lib.heif_context_read_from_memory(context, bytes);
    if (!parsed || parsed.code !== lib.heif_error_code.heif_error_Ok) fail("media_heic");
    const itemCount = lib.heif_context_get_number_of_items(context);
    if (!Number.isSafeInteger(itemCount) || itemCount < 1 || itemCount > 1024) fail("media_heic");
    handle = lib.heif_js_context_get_primary_image_handle(context);
    if (!handle || handle.code) fail("media_heic");
    // Check actual primary-image dimensions before pixel allocation. Native
    // security limits also protect coded dimensions; never decode auxiliaries.
    if (!validSize(lib.heif_image_handle_get_width(handle), lib.heif_image_handle_get_height(handle))) fail("media_dimensions");
    decoded = await lib.heif_js_decode_image2(handle, lib.heif_colorspace.heif_colorspace_RGB, lib.heif_chroma.heif_chroma_interleaved_RGBA);
    if (!decoded || decoded.code || !Array.isArray(decoded.channels) || decoded.channels.length > 4) fail("media_heic");
    const channel = decoded.channels.find(item => item.id === lib.heif_channel.heif_channel_interleaved);
    return shrinkHeicPlane(channel);
  } finally {
    if (decoded?.image) lib.heif_image_release(decoded.image);
    if (handle && !handle.code) lib.heif_image_handle_release(handle);
    if (context) lib.heif_context_free(context);
  }
}
