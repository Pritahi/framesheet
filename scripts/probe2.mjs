import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

await page.goto("http://localhost:4173", { waitUntil: "load" });
await page.waitForTimeout(7000); // retail autoplaying, passer crosses Zone_B ~7.4s

const probe = await page.evaluate(() => {
  const fs = window.__fs;
  const sig = fs.lastSignal;
  // raw raster diff between two analysis frames 100ms apart at t=7.5/7.6
  const c = document.createElement("canvas");
  c.width = 192;
  c.height = 108;
  const x = c.getContext("2d", { willReadFrequently: true });
  fs.source.pause();
  fs.source.seek(7.5);
  fs.source.renderInto(x, 192, 108);
  const a = x.getImageData(0, 0, 192, 108).data;
  fs.source.seek(7.6);
  fs.source.renderInto(x, 192, 108);
  const b = x.getImageData(0, 0, 192, 108).data;
  let changed = 0;
  let maxd = 0;
  for (let i = 0; i < a.length; i += 4) {
    const la = (a[i] * 77 + a[i + 1] * 151 + a[i + 2] * 28) >> 8;
    const lb = (b[i] * 77 + b[i + 1] * 151 + b[i + 2] * 28) >> 8;
    const d = Math.abs(la - lb);
    if (d > 18) changed++;
    if (d > maxd) maxd = d;
  }
  return {
    t: fs.source.currentTime,
    lastSignal: sig,
    rasterChangedPx: changed,
    rasterMaxDelta: maxd,
    canvasPixels: 192 * 108,
  };
});
console.log(JSON.stringify(probe, null, 2));
await browser.close();
console.log("PROBE2 DONE");
