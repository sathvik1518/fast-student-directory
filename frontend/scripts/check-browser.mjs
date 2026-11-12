// Real-browser check: the built page + the real Python server, in Chromium. Exit code 0 only if every check passes.
import { openBrowser, PAGE, startServers } from "./lib.mjs";

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
}
async function check(name, fn) {
  try {
    const detail = await fn();
    record(name, true, typeof detail === "string" ? detail : "");
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error));
  }
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}

const stop = await startServers();
const browser = await openBrowser();
try {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await context.newPage();
  const consoleProblems = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleProblems.push(m.text());
  });
  page.on("pageerror", (e) => consoleProblems.push(String(e)));
  const rows = () => page.locator('[role="listitem"]');
  const summary = () => page.locator(".summary");

  await check("loads 5,000 students from the real server", async () => {
    await page.goto(PAGE);
    await summary().waitFor();
    expect((await summary().textContent()) === "Showing 5,000 of 5,000 students", `summary was ${await summary().textContent()}`);
  });

  await check("only a few rows exist in the page, not 5,000", async () => {
    const count = await rows().count();
    expect(count > 5 && count < 30, `${count} rows`);
    const nodes = await page.evaluate(() => document.querySelectorAll("*").length);
    expect(nodes < 400, `${nodes} elements in the page`);
    return `${count} rows, ${nodes} elements`;
  });

  await check("the server query count is shown (1 query)", async () => {
    expect(((await page.locator(".footnote").textContent()) ?? "").includes("ran 1 database query"), await page.locator(".footnote").textContent());
  });

  await check("the broken-records notice counts all 4", async () => {
    expect(((await page.locator(".notice").textContent()) ?? "").startsWith("4 records have a problem"), await page.locator(".notice").textContent());
  });

  await check("scrolling to the very end shows the last student", async () => {
    await page.locator(".scroller").evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.waitForFunction(() => [...document.querySelectorAll('[role="listitem"]')].some((li) => li.getAttribute("aria-posinset") === "5000"));
    const last = rows().last();
    expect(((await last.getAttribute("aria-posinset")) ?? "") === "5000", `last posinset ${await last.getAttribute("aria-posinset")}`);
  });

  await check("a search narrows the list and jumps back to the top", async () => {
    await page.getByLabel("Search by name").fill("aarav");
    await page.waitForFunction(() => !document.querySelector(".summary").textContent.includes("of 5,000 students") || !document.querySelector(".summary").textContent.startsWith("Showing 5,000"));
    const top = await page.locator(".scroller").evaluate((el) => el.scrollTop);
    expect(top === 0, `scrollTop ${top}`);
    const texts = await rows().allTextContents();
    expect(texts.length > 0 && texts.every((t) => /aarav/i.test(t)), "not every row matches");
  });

  await check("the 4 broken records each show a warning, and nothing else breaks", async () => {
    await page.getByLabel("Search by name").fill("");
    await page.getByLabel("Show only broken records").check();
    await page.waitForFunction(() => document.querySelector(".summary").textContent.startsWith("Showing 4 of"));
    const alerts = await page.locator('[role="listitem"] [role="alert"]').allTextContents();
    expect(alerts.length === 4, `${alerts.length} warnings`);
    expect(alerts.some((a) => a.includes("Record #7 ")), "no warning for #7");
    return alerts.join(" | ");
  });

  await check("clicking a normal row opens its card; Close closes it", async () => {
    await page.getByLabel("Show only broken records").uncheck();
    await page.waitForFunction(() => document.querySelector(".summary").textContent.startsWith("Showing 5,000"));
    await rows().nth(1).locator("button").click();
    const card = page.getByRole("region", { name: "Student details" });
    await card.waitFor();
    expect(((await card.textContent()) ?? "").includes("Student number"), "card has no details");
    await card.getByRole("button", { name: "Close" }).click();
    await card.waitFor({ state: "detached" });
  });

  await check("keyboard: Tab reaches a row and Enter opens its card", async () => {
    await page.getByLabel("Search by name").focus();
    await page.keyboard.press("Tab"); // Class
    await page.keyboard.press("Tab"); // Sort
    await page.keyboard.press("Tab"); // checkbox
    await page.keyboard.press("Tab"); // the scroll box itself
    await page.keyboard.press("Tab"); // first row button
    await page.keyboard.press("Enter");
    await page.getByRole("region", { name: "Student details" }).waitFor();
  });

  await check("the page logged no errors while all of that happened (broken-row errors excepted)", async () => {
    const unexpected = consoleProblems.filter((m) => !/Record #|BrokenRecordError|The above error occurred|Student #/.test(m));
    expect(unexpected.length === 0, unexpected.slice(0, 3).join(" || "));
    return `${consoleProblems.length} expected broken-row messages`;
  });

  await check("?list=banana falls back to the real list", async () => {
    await page.goto(`${PAGE}/?list=banana`);
    await summary().waitFor();
    const count = await rows().count();
    expect(count < 30, `${count} rows`);
  });

  await check("server unreachable: a plain message and Try again works", async () => {
    await page.route("**/api/students", (route) => route.abort());
    await page.goto(PAGE);
    await page.getByText("Cannot reach the server. Is it running?").waitFor();
    await page.unroute("**/api/students");
    await page.getByRole("button", { name: "Try again" }).click();
    await summary().waitFor();
  });

  await check("server error 500: says the status", async () => {
    await page.route("**/api/students", (route) => route.fulfill({ status: 500, body: "boom" }));
    await page.goto(PAGE);
    await page.getByText("The server answered 500.").waitFor();
    await page.unroute("**/api/students");
  });

  await check("server sends junk: a message, not an endless 'Loading'", async () => {
    await page.route("**/api/students", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"not":"a list"}' }));
    await page.goto(PAGE);
    await page.getByText("not a student list").waitFor();
    await page.unroute("**/api/students");
  });

  await check("responses are compressed (gzip)", async () => {
    const response = await page.request.get(`${PAGE}/api/students`, { headers: { "Accept-Encoding": "gzip" } });
    const encoding = response.headers()["content-encoding"];
    expect(encoding === "gzip", `content-encoding was ${encoding}`);
  });

  await context.close();
} finally {
  await browser.close();
  stop();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} of ${results.length} browser checks passed.`);
process.exit(failed === 0 ? 0 : 1);
