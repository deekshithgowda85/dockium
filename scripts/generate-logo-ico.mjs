import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import pngToIco from "png-to-ico";

const projectRoot = process.cwd();
const outDir = path.join(projectRoot, "electron", "assets");
const tempDir = path.join(projectRoot, "scripts", ".tmp-logo");
const outIco = path.join(outDir, "dockium.ico");

const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44.169 45.988" width="500" height="500"><path d="M 21.955078 0 A 1.029 1.029 0 0 0 21.292969 0.28125 A 11.988 11.988 0 0 0 18 7.9882812 A 11.982 11.982 0 0 0 21.292969 15.699219 L 22.169922 16.578125 L 23.5 17.900391 L 28.585938 22.986328 L 23.5 28.074219 L 24.292969 28.867188 A 13.886 13.886 0 0 1 28.171875 37.988281 A 11.481 11.481 0 0 1 27.880859 40.521484 L 43.292969 25.109375 A 3 3 0 0 0 43.292969 20.867188 L 22.705078 0.28125 A 1.029 1.029 0 0 0 21.955078 0 z M 16.289062 5.4550781 L 0.87695312 20.867188 A 3 3 0 0 0 0.87695312 25.109375 L 21.462891 45.699219 A 1 1 0 0 0 22.876953 45.699219 A 11.982 11.982 0 0 0 26.169922 37.992188 A 11.988 11.988 0 0 0 22.876953 30.285156 L 15.583984 22.988281 L 20.669922 17.900391 L 19.876953 17.107422 A 13.877 13.877 0 0 1 16 7.9882812 A 11.478 11.478 0 0 1 16.289062 5.4550781 z"/></svg>`;

const sizes = [16, 24, 32, 48, 64, 128, 256];

const html = (size) => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body {
        margin: 0;
        width: ${size}px;
        height: ${size}px;
        background: transparent;
        overflow: hidden;
      }
      .wrap {
        width: 100%;
        height: 100%;
        display: grid;
        place-items: center;
      }
      svg {
        width: ${Math.max(1, Math.floor(size * 0.9))}px;
        height: ${Math.max(1, Math.floor(size * 0.9))}px;
        fill: #1f2937;
      }
    </style>
  </head>
  <body>
    <div class="wrap">${svgMarkup}</div>
  </body>
</html>`;

await fs.mkdir(outDir, { recursive: true });
await fs.mkdir(tempDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const pngFiles = [];
for (const size of sizes) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(html(size));
  const pngPath = path.join(tempDir, `logo-${size}.png`);
  await page.screenshot({ path: pngPath, omitBackground: true });
  pngFiles.push(pngPath);
}

await browser.close();

const icoBuffer = await pngToIco(pngFiles);
await fs.writeFile(outIco, icoBuffer);

for (const file of pngFiles) {
  await fs.unlink(file).catch(() => {});
}
await fs.rmdir(tempDir).catch(() => {});

console.log(outIco);
