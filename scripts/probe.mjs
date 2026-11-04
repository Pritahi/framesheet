import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") console.log("CONSOLE", m.type(), m.text().slice(0, 300));
});

await page.goto("http://localhost:4173", { waitUntil: "load" });

// read debug handle if present
const has = await page.evaluate(() => typeof window.__fs !== "undefined");
console.log("has __fs:", has);

for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(2500);
  const s = await page.evaluate(() => {
    const fs = window.__fs;
    if (!fs) return null;
    return {
      t: fs.source?.currentTime?.toFixed(1),
      playing: fs.source?.playing,
      dur: fs.source?.duration,
      zones: fs.zones.map((z) => ({ n: z.name, m: z.mode, en: z.enabled })),
      phases: fs.phases,
      live: Object.keys(fs.live),
      events: fs.events.length,
      version: fs.version,
    };
  });
  console.log(`[${(i + 1) * 2.5}s]`, JSON.stringify(s));
}
await page.screenshot({ path: "probe.png" });
await browser.close();
console.log("PROBE DONE");
