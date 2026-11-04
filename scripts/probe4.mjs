import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:4173", { waitUntil: "load" });
await page.waitForTimeout(14000); // play through customer1 + passer1
const snap = await page.evaluate(() => {
  const fs = window.__fs;
  return {
    t: fs.source.currentTime.toFixed(1),
    events: fs.events.map((e) => ({ n: e.num, z: e.zoneName, m: e.mode, s: +e.start.toFixed(1), e: +e.end.toFixed(1), d: +e.duration.toFixed(1) })),
    phases: fs.phases,
  };
});
console.log(JSON.stringify(snap, null, 1));
await browser.close();
console.log("PROBE4 DONE");
