/**
 * Client-side image preparation for evidence photos.
 *
 * Every photo is decoded and drawn onto a canvas, then encoded again as
 * JPEG. Re-encoding drops all metadata, EXIF and GPS position included.
 * The longest side is capped at 1280 px and the quality is stepped down
 * until the file is at most 240 KB. That cap is the Arbiter's
 * MAX_IMAGE_BYTES (a larger body is treated like a wrong digest), and it
 * keeps the file under the 256 KiB IPFS chunk size, so it is one raw block
 * and its CID is the sha256 of the bytes (bafkrei...).
 */

export const MAX_SIDE_PX = 1280;
export const MAX_IMAGE_BYTES = 240 * 1024;

const QUALITY_START = 0.9;
const QUALITY_STEP = 0.08;
const QUALITY_FLOOR = 0.4;
/** Below the quality floor, shrink the image and start over. */
const SHRINK_FACTOR = 0.8;
const MIN_SIDE_PX = 320;

export interface PreparedImage {
  bytes: Uint8Array;
  blob: Blob;
  width: number;
  height: number;
  quality: number;
}

async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    // Applies the EXIF orientation before the metadata is dropped.
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("This file could not be read as an image.");
  }
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The browser could not encode the image."))),
      "image/jpeg",
      quality,
    );
  });
}

export async function prepareImage(file: Blob): Promise<PreparedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose an image file.");
  }
  const bitmap = await decode(file);
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    let scale = Math.min(1, MAX_SIDE_PX / longest);

    while (Math.round(longest * scale) >= MIN_SIDE_PX) {
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("The browser could not prepare the image.");
      // JPEG has no alpha: paint white under transparent pixels.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);

      for (let q = QUALITY_START; q >= QUALITY_FLOOR - 1e-9; q -= QUALITY_STEP) {
        const blob = await toJpeg(canvas, q);
        if (blob.size <= MAX_IMAGE_BYTES) {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          return { bytes, blob, width, height, quality: Math.round(q * 100) / 100 };
        }
      }
      scale *= SHRINK_FACTOR;
    }
    throw new Error("This image cannot be brought under 240 KB. Try a simpler photo.");
  } finally {
    bitmap.close();
  }
}
