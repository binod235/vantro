import sharp from 'sharp';

// icon.png — 1024x1024, same blue V, content kept in the safe zone so
// capacitor-assets' adaptive-icon generation doesn't clip it.
const iconSize = 1024;
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${iconSize}" viewBox="0 0 ${iconSize} ${iconSize}">
  <rect width="${iconSize}" height="${iconSize}" fill="#2563eb"/>
  <text x="50%" y="50%" font-family="Arial, Helvetica, sans-serif" font-weight="700"
    font-size="${Math.round(iconSize * 0.56)}" fill="#ffffff" text-anchor="middle" dominant-baseline="central">V</text>
</svg>`;

// splash.png — 2732x2732, dark background with centred Vantro mark.
const splashSize = 2732;
const splashSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${splashSize}" height="${splashSize}" viewBox="0 0 ${splashSize} ${splashSize}">
  <rect width="${splashSize}" height="${splashSize}" fill="#0f172a"/>
  <rect x="${splashSize / 2 - 180}" y="${splashSize / 2 - 260}" width="360" height="360" rx="64" fill="#2563eb"/>
  <text x="50%" y="${splashSize / 2 - 80}" font-family="Arial, Helvetica, sans-serif" font-weight="700"
    font-size="220" fill="#ffffff" text-anchor="middle" dominant-baseline="central">V</text>
  <text x="50%" y="${splashSize / 2 + 220}" font-family="Arial, Helvetica, sans-serif" font-weight="600"
    font-size="64" fill="#94a3b8" text-anchor="middle" dominant-baseline="central">Vantro</text>
</svg>`;

await sharp(Buffer.from(iconSvg)).resize(iconSize, iconSize).png().toFile('resources/icon.png');
console.log('wrote resources/icon.png');

await sharp(Buffer.from(splashSvg)).resize(splashSize, splashSize).png().toFile('resources/splash.png');
console.log('wrote resources/splash.png');
