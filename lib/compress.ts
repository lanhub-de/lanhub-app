'use client';

// A phone photo of a notebook is 3–8 MB; scaled to 1600 px as a JPEG it is
// ~300 KB and reads just as well. Anything that cannot be decoded (HEIC on
// some browsers), small pictures, GIFs and SVGs go up as they are.
const MAX_SIDE = 1600;
const SKIP_BELOW = 400 * 1024;

export async function shrinkImage(file: { blob: Blob; name: string }): Promise<{ blob: Blob; name: string }> {
  const type = file.blob.type;
  if (!type.startsWith('image/') || /gif|svg/.test(type) || file.blob.size < SKIP_BELOW) return file;
  try {
    const bmp = await createImageBitmap(file.blob, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.fillStyle = '#fff'; // a transparent screenshot gets a white page, not a black one
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.8));
    if (!out || out.size >= file.blob.size) return file;
    return { blob: out, name: `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg` };
  } catch {
    return file;
  }
}
