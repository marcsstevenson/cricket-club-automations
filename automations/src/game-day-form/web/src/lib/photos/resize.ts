export class PhotoReadError extends Error {}

/** Decode, orient, shrink to maxSide and re-encode as JPEG (drops EXIF, including GPS). */
export async function resizePhoto(file: Blob, maxSide = 1600, quality = 0.8): Promise<Blob> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoReadError('decode');
  }
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new PhotoReadError('encode');
  return blob;
}
