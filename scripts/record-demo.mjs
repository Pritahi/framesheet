/**
 * FrameSheet demo recorder — drives the REAL built app (vite preview) in a
 * headless browser with a visible injected cursor and captures the screen.
 * Output: recordings/*.webm  (post-processed to framesheet-demo.mp4)
 *
 * Beats (~75s): real footage + CV mask → click-to-proof on a row →
 * checkout scenario → auto-calibrate → presets → zone drag → timeline jump
 * (floods the log incl. the 38s bottleneck) → cell B4 proof jump →
 * verify row → copy TSV → help tour → real footage outro.
 */

import { chromium } from "playwright";

const APP = "http://localhost:4173";
const W = 1600;
const H = 900;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  recordVideo: { dir: "recordings", size: { width: W, height: H } },
  permissions: ["clipboard-read", "clipboard-write"],
  acceptDownloads: true,
});
const page = await context.newPage();
const wait = (ms) => page.waitForTimeout(ms);

/* ---- visible cursor overlay so clicks read clearly on screen ---- */
await page.addInitScript(() => {
  window.addEventListener("DOMContentLoaded", () => {
    const c = document.createElement("div");
    c.id = "__cursor";
    c.style.cssText =
      "position:fixed;left:-40px;top:-40px;width:18px;height:18px;border-radius:50%;" +
      "background:rgba(16,185,129,.85);border:2px solid #fff;z-index:99999;pointer-events:none;" +
      "box-shadow:0 0 14px rgba(16,185,129,.9);transition:transform .12s ease-out";
    const ripple = document.createElement("div");
    ripple.id = "__clickfx";
    ripple.style.cssText =
      "position:fixed;left:-40px;top:-40px;width:34px;height:34px;border-radius:50%;" +
      "border:2px solid rgba(255,255,255,.9);z-index:99998;pointer-events:none;opacity:0;transition:all .25s ease-out;transform:translate(-17px,-17px) scale(.4)";
    document.body.append(c, ripple);
  });
});

async function cursorXY(x, y, click = false) {
  await page.evaluate(
    ({ x, y, click }) => {
      const c = document.getElementById("__cursor");
      if (c) c.style.transform = `translate(${x - 9}px,${y - 9}px)`;
      if (click) {
        const r = document.getElementById("__clickfx");
        if (r) {
          r.style.transform = `translate(${x - 17}px,${y - 17}px) scale(.4)`;
          r.style.opacity = "1";
          setTimeout(() => {
            r.style.opacity = "0";
            r.style.transform = `translate(${x - 17}px,${y - 17}px) scale(1.4)`;
          }, 60);
        }
      }
    },
    { x, y, click }
  );
  await page.mouse.move(x, y, { steps: 10 });
  if (click) {
    await page.mouse.down();
    await page.mouse.up();
  }
}

/** move cursor to the center of a locator, then click it */
async function act(sel, { exact = false } = {}) {
  const loc = typeof sel === "string" ? page.getByText(sel, { exact }).first() : sel;
  const b = await loc.boundingBox();
  if (!b) throw new Error(`no box for ${String(sel)}`);
  await cursorXY(b.x + b.width / 2, b.y + b.height / 2, true);
}

const beat = (name) => console.log("BEAT:", name);

/* ------------------------------ BEAT 1 · real ------------------------------ */
beat("boot + real footage");
await page.goto(APP, { waitUntil: "load" });
await wait(1400);
await act("Real footage", { exact: true });
await wait(1600);
beat("CV mask on");
await act("CV Mask", { exact: true });
await wait(8200); // let Zone_A payment event complete + rows appear
beat("row click-to-proof");
await act(page.getByTitle("Replay proof segment").first());
await wait(2400);
await act("CV Mask", { exact: true }); // mask off
await wait(600);

/* ----------------------------- BEAT 2 · checkout ---------------------------- */
beat("checkout scenario + auto-calibrate during idle floor");
await act("Checkout", { exact: true });
await wait(650);
await act(page.getByText("Auto-Calibrate").first());
await wait(2700); // sampling window + calibration toast
beat("presets");
await act(page.getByText("Long Dwell").first());
await wait(750);
await act(page.getByText("Quick Tap").first());
await wait(750);
await act(page.getByText("Standard").first());
await wait(700);
beat("zone drag (driver's-seat control)");
const stage = await page.locator(".aspect-video").boundingBox();
await cursorXY(stage.x + 0.71 * stage.width, stage.y + 0.585 * stage.height);
await wait(250);
await page.mouse.down();
await page.mouse.move(stage.x + 0.665 * stage.width, stage.y + 0.55 * stage.height, { steps: 14 });
await page.mouse.up();
await wait(800);
beat("timeline jump → event log floods (incl. 38s bottleneck)");
const tl = await page.locator("[data-timeline]").boundingBox();
await cursorXY(tl.x + 0.972 * tl.width, tl.y + tl.height * 0.45, true);
await wait(2600);
beat("cell B4 click-to-proof (=MAX_DURATION)");
await act(page.locator('[data-cell="B4"]'));
await wait(4200); // banner + zone flash + replay start
await page.screenshot({ path: "framesheet-screenshot.png" });
await act(page.getByTitle("Play / Pause [Space]", { exact: true })); // pause
await wait(600);

/* --------------------------- BEAT 3 · human-in-loop ------------------------- */
beat("verify row + copy for sheets");
await act(page.getByTitle(/Verify/).first());
await wait(900);
await act(page.getByTitle("Copy TSV for Google Sheets / Excel"));
await wait(1500);

/* ------------------------------ BEAT 4 · tour ------------------------------- */
beat("help tour + real outro");
await act("How it works", { exact: true });
await wait(3400);
await act("Try real footage now", { exact: true });
await wait(4200); // real clip reloads + plays, diagnostics-clean outro

await context.close(); // finalizes the recording
await browser.close();
console.log("RECORDED OK");
