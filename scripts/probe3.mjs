import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

await page.goto("http://localhost:4173", { waitUntil: "load" });

for (const target of [3.5, 5.0, 6.5, 8.5]) {
  // poll until source time passes target
  for (let i = 0; i < 200; i++) {
    const t = await page.evaluate(() => window.__fs.source?.currentTime ?? 0);
    if (t >= target) break;
    await page.waitForTimeout(100);
  }
  const snap = await page.evaluate(() => {
    const fs = window.__fs;
    return {
      t: fs.source.currentTime,
      sigT: fs.lastSignal?.t,
      values: fs.lastSignal?.values,
      blobs: fs.lastBlobs,
      phases: fs.phases,
    };
  });
  console.log(JSON.stringify(snap, null, 1));
}
await browser.close();
console.log("PROBE3 DONE");
