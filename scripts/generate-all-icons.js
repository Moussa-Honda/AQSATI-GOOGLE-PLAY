import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const sourceFile = path.resolve('public/logo-aqsati.jpg');

async function run() {
  console.log('Generating icons from:', sourceFile);

  const image = sharp(sourceFile);
  const metadata = await image.metadata();
  console.log(`Source dimensions: ${metadata.width}x${metadata.height}`);

  // Base 1024x1024 PNG buffer
  const base1024Png = await sharp(sourceFile)
    .resize(1024, 1024, { fit: 'cover' })
    .png({ quality: 100 })
    .toBuffer();

  // 1. Web & PWA Icons
  const publicIconsDir = path.resolve('public/icons');
  if (!fs.existsSync(publicIconsDir)) {
    fs.mkdirSync(publicIconsDir, { recursive: true });
  }

  const sizes = [48, 72, 96, 128, 180, 192, 256, 512];
  for (const s of sizes) {
    const pngPath = path.join(publicIconsDir, `icon-${s}.png`);
    const webpPath = path.join(publicIconsDir, `icon-${s}.webp`);

    await sharp(base1024Png).resize(s, s).png().toFile(pngPath);
    await sharp(base1024Png).resize(s, s).webp().toFile(webpPath);
    console.log(`Generated ${s}x${s} icon`);
  }

  // Named copies for web
  await sharp(base1024Png).resize(192, 192).png().toFile(path.join(publicIconsDir, 'aqasti-icon-192.png'));
  await sharp(base1024Png).resize(512, 512).png().toFile(path.join(publicIconsDir, 'aqasti-icon-512.png'));
  await sharp(base1024Png).resize(180, 180).png().toFile(path.join(publicIconsDir, 'apple-touch-icon.png'));
  await sharp(base1024Png).resize(180, 180).png().toFile(path.join(publicIconsDir, 'aqasti-apple-touch-icon.png'));
  await sharp(base1024Png).resize(180, 180).png().toFile(path.resolve('public/apple-touch-icon.png'));
  await sharp(base1024Png).resize(64, 64).png().toFile(path.resolve('public/favicon.png'));

  // SVG wrappers so that any <img src="/logo-mark.svg" /> or /logo-aqasti.svg displays the new logo
  const b64_512 = (await sharp(base1024Png).resize(512, 512).png().toBuffer()).toString('base64');
  const svgWrapper = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <image href="data:image/png;base64,${b64_512}" x="0" y="0" width="512" height="512" />
</svg>`;

  fs.writeFileSync(path.resolve('public/logo-mark.svg'), svgWrapper, 'utf8');
  fs.writeFileSync(path.resolve('public/logo-aqasti.svg'), svgWrapper, 'utf8');
  fs.writeFileSync(path.resolve('public/favicon.svg'), svgWrapper, 'utf8');
  console.log('Updated logo-mark.svg, logo-aqasti.svg, and favicon.svg');

  // 2. Android Mipmap Icons
  const androidResDir = path.resolve('android/app/src/main/res');
  const androidMipmaps = [
    { dir: 'mipmap-mdpi', iconSize: 48, fgSize: 108 },
    { dir: 'mipmap-hdpi', iconSize: 72, fgSize: 162 },
    { dir: 'mipmap-xhdpi', iconSize: 96, fgSize: 216 },
    { dir: 'mipmap-xxhdpi', iconSize: 144, fgSize: 324 },
    { dir: 'mipmap-xxxhdpi', iconSize: 192, fgSize: 432 }
  ];

  for (const m of androidMipmaps) {
    const targetDir = path.join(androidResDir, m.dir);
    if (fs.existsSync(targetDir)) {
      // ic_launcher.png
      await sharp(base1024Png).resize(m.iconSize, m.iconSize).png().toFile(path.join(targetDir, 'ic_launcher.png'));
      // ic_launcher_round.png
      await sharp(base1024Png).resize(m.iconSize, m.iconSize).png().toFile(path.join(targetDir, 'ic_launcher_round.png'));
      // ic_launcher_foreground.png (scaled inside 108dp canvas with comfortable padding)
      const innerSize = Math.round(m.fgSize * 0.75);
      const padding = Math.round((m.fgSize - innerSize) / 2);
      const innerBuf = await sharp(base1024Png).resize(innerSize, innerSize).png().toBuffer();
      
      await sharp({
        create: {
          width: m.fgSize,
          height: m.fgSize,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
      })
      .composite([{ input: innerBuf, top: padding, left: padding }])
      .png()
      .toFile(path.join(targetDir, 'ic_launcher_foreground.png'));

      console.log(`Updated Android icons in ${m.dir}`);
    }
  }

  // 3. iOS AppIcon
  const iosIconPath = path.resolve('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
  if (fs.existsSync(path.dirname(iosIconPath))) {
    await sharp(base1024Png).resize(1024, 1024).png().toFile(iosIconPath);
    console.log('Updated iOS AppIcon-512@2x.png (1024x1024)');
  }

  console.log('All icons successfully generated!');
}

run().catch(err => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
