// Speed measurements in real Chromium with the CPU slowed 4x (a mid-range phone). Same 5,000 students, five ways of drawing the list.
// Writes perf/last-run.md. Numbers depend on the machine; compare the rows with each other, not with someone else's table.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { frontendDir, median, openBrowser, PAGE, startServers } from "./lib.mjs";

const MODES = ["plain", "memo-inline", "memo", "virtual", "virtual-deferred"];
const RUNS = Number(process.env.RUNS ?? 3);
const THROTTLE = Number(process.env.THROTTLE ?? 4);

/** Runs inside the page. Types one letter at a time like a person and times each letter two ways:
 *  painted = until the browser has drawn the next frame after the letter (how it FEELS: does the box keep up?),
 *  settled = until the browser has nothing left to do (the list has caught up). */
async function typeAndMeasure(text) {
  const input = document.querySelector('input[type="search"]');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  const afterPaint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const idle = () => new Promise((r) => requestIdleCallback(() => r(), { timeout: 10000 }));
  const painted = [];
  const settled = [];
  let typed = "";
  for (const ch of text) {
    typed += ch;
    const t0 = performance.now();
    setter.call(input, typed);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await afterPaint();
    painted.push(performance.now() - t0);
    await idle();
    settled.push(performance.now() - t0);
  }
  return { painted, settled };
}

async function measureMode(browser, mode) {
  const rows = { load: [], elements: [], keyPainted: [], keySettled: [], clickPainted: [], rowsAfterKey: [], rowsAfterClick: [] };
  for (let run = 0; run < RUNS; run++) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
    await page.goto(`${PAGE}/?list=${mode}&perf`, { waitUntil: "commit" });
    await page.locator(".summary").waitFor({ timeout: 120000 });
    const load = await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now())))));
    rows.load.push(load);
    rows.elements.push(await page.evaluate(() => document.querySelectorAll("*").length));

    await page.evaluate(() => window.__perf.reset());
    const typing = await page.evaluate(`(${typeAndMeasure.toString()})("aarav")`);
    rows.keyPainted.push(Math.max(...typing.painted)); // the WORST letter, not the median: one slow letter is what a person feels
    rows.keySettled.push(Math.max(...typing.settled));
    rows.rowsAfterKey.push(await page.evaluate(() => window.__perf.get().row ?? 0));

    await page.getByLabel("Search by name").fill("");
    await page.locator(".summary", { hasText: "Showing 5,000" }).waitFor({ timeout: 120000 });
    await page.evaluate(() => window.__perf.reset());
    const clickMs = await page.evaluate(async () => {
      const button = document.querySelectorAll('[aria-pressed]')[3];
      const t0 = performance.now();
      button.click();
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      return performance.now() - t0;
    });
    rows.clickPainted.push(clickMs);
    rows.rowsAfterClick.push(await page.evaluate(() => window.__perf.get().row ?? 0));
    await context.close();
  }
  const m = (xs) => Math.round(median(xs));
  return {
    mode,
    load: m(rows.load),
    elements: m(rows.elements),
    keyPainted: m(rows.keyPainted),
    keySettled: m(rows.keySettled),
    rowsAfterKey: m(rows.rowsAfterKey),
    clickPainted: m(rows.clickPainted),
    rowsAfterClick: m(rows.rowsAfterClick),
  };
}

const stop = await startServers();
const browser = await openBrowser();
const results = [];
try {
  // wire size (no browser slow-down needed)
  const context = await browser.newContext();
  const gz = await context.request.get(`${PAGE}/api/students`, { headers: { "Accept-Encoding": "gzip" } });
  const plain = await context.request.get(`${PAGE}/api/students`, { headers: { "Accept-Encoding": "identity" } });
  const gzBytes = (await gz.body()).length; // Playwright may already decode; use the header when the server sent one
  const sent = Number(gz.headers()["content-length"] ?? gzBytes);
  const rawBytes = (await plain.body()).length;
  await context.close();

  for (const mode of MODES) {
    process.stdout.write(`measuring ${mode} ... `);
    const r = await measureMode(browser, mode);
    results.push(r);
    console.log(`load ${r.load} ms, ${r.elements} elements, worst letter ${r.keyPainted}/${r.keySettled} ms, click ${r.clickPainted} ms`);
  }

  const lines = [
    `# Last measurement run`,
    ``,
    `5,000 students, Chromium, CPU slowed ${THROTTLE}x, median of ${RUNS} runs (worst of the 5 letters in each run). Times in milliseconds.`,
    ``,
    `| Way of drawing the list | Page ready | Elements on page | Worst letter: until drawn | Worst letter: list caught up | Rows redrawn typing 5 letters | Click a row: until drawn | Rows redrawn by a click |`,
    `|---|---|---|---|---|---|---|---|`,
    ...results.map((r) => `| ${r.mode} | ${r.load} | ${r.elements} | ${r.keyPainted} | ${r.keySettled} | ${r.rowsAfterKey} | ${r.clickPainted} | ${r.rowsAfterClick} |`),
    ``,
    `List sent over the network: ${rawBytes.toLocaleString("en-US")} bytes uncompressed, ${sent.toLocaleString("en-US")} bytes with gzip (${(rawBytes / sent).toFixed(1)}x smaller).`,
    ``,
  ];
  mkdirSync(resolve(frontendDir, "perf"), { recursive: true });
  writeFileSync(resolve(frontendDir, "perf", "last-run.md"), lines.join("\n"));
  console.log("\n" + lines.join("\n"));
} finally {
  await browser.close();
  stop();
}
