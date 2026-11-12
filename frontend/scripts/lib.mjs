// Shared helpers for the two browser scripts: start the Python server, build the page, serve it, open Chromium.
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
export const frontendDir = resolve(here, "..");
export const backendDir = resolve(frontendDir, "..", "backend");
export const API = "http://127.0.0.1:8000";
export const PAGE = "http://127.0.0.1:4173";
const isWindows = process.platform === "win32";
const python = process.env.PYTHON ?? (isWindows ? "python" : "python3");
const npx = isWindows ? "npx.cmd" : "npx";
// Run vite straight from node_modules (not through npx) so there is ONE process to stop, not a parent and a hidden child.
const viteJs = resolve(frontendDir, "node_modules", "vite", "bin", "vite.js");

async function waitFor(url, label, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${label} did not start (waited 20 s for ${url})`);
}

/** Starts the Python server and the built page. Returns a stop() that always cleans up. */
export async function startServers() {
  const build = spawnSync(process.execPath, [viteJs, "build", "--logLevel", "error"], { cwd: frontendDir, stdio: "inherit" });
  if (build.status !== 0) throw new Error("vite build failed");
  const children = [];
  const run = (cmd, args, cwd, env = {}) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, ...env }, detached: !isWindows });
    children.push(child);
    return child;
  };
  run(python, ["-m", "uvicorn", "app.main:create_app", "--factory", "--port", "8000", "--log-level", "warning"], backendDir);
  run(process.execPath, [viteJs, "preview", "--logLevel", "error"], frontendDir);
  const stop = () => {
    for (const c of children) {
      try {
        if (isWindows) spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"]);
        else process.kill(-c.pid, "SIGTERM"); // the whole group: nothing is left running after the script ends
      } catch {
        /* already gone */
      }
    }
  };
  try {
    await waitFor(`${API}/api/health`, "The Python server");
    await waitFor(PAGE, "The page server");
  } catch (error) {
    stop();
    throw error;
  }
  return stop;
}

/** Needs the Chromium that Playwright installs:  npx playwright install chromium
 *  (CHROMIUM_PATH can point at a Chrome/Chromium you already have.) */
export async function openBrowser() {
  return chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
}

export function median(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
