import { mkdir, readdir } from 'node:fs/promises';
import { join, parse } from 'node:path';
import sharp from 'sharp';

const SRC = 'assets-src/mascots';
const OUT = 'web/static/mascots';

const files = (await readdir(SRC)).filter((f) => /\.(png|jpe?g)$/i.test(f));
if (!files.length) {
  console.error(`No images in ${SRC}. Download the Mascots folder from SharePoint first.`);
  process.exit(1);
}
await mkdir(OUT, { recursive: true });

for (const f of files) {
  const name = parse(f).name.toLowerCase();
  const trimmed = await sharp(join(SRC, f)).flatten({ background: '#ffffff' }).trim({ background: '#ffffff', threshold: 20 }).toBuffer();
  const { width = 1, height = 1 } = await sharp(trimmed).metadata();
  const side = Math.max(width, height);
  const pad = Math.round(side * 0.06);
  const square = await sharp(trimmed)
    .resize({ width: side, height: side, fit: 'contain', background: '#ffffff' })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: '#ffffff' })
    .toBuffer();
  for (const [suffix, px] of [['', 512], ['-sm', 128]] as const) {
    await sharp(square).resize(px, px).webp({ quality: 82 }).toFile(join(OUT, `${name}${suffix}.webp`));
  }
  console.log(`✓ ${name}`);
}
