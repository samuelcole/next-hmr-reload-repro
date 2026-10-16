// node repro.mjs [sessions=3]
//
// Session 1 builds Turbopack's dev cache: load /a, router.push("/b"), then load /c.
// Each later session restarts `next dev` on the same .next with a different
// NEXT_PUBLIC_VALUE, POSTs to a route handler, loads /a and counts document loads
// for 6 seconds. Expected: 1. Observed on 16.4.x: ~200 (the page reloads in a loop).
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { chromium } from "@playwright/test";

const sessions = Number(process.argv[2] ?? 3);
const port = 3826;
const base = `http://localhost:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

rmSync(".next", { recursive: true, force: true });
const results = [];
for (let s = 1; s <= sessions; s++) {
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(port)], {
    detached: true,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_VALUE: process.env.FIXED_VALUE ? "fixed" : `session-${s}-${Date.now()}`,
      // Server-only: read by /a's server component, or by nothing.
      SERVER_VALUE: process.env.SERVER_VARY ? `session-${s}-${Date.now()}` : "fixed",
      UNUSED_VALUE: process.env.UNUSED_VARY ? `session-${s}-${Date.now()}` : "fixed",
    },
  });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  while (!/Ready in/.test(log)) await sleep(100);

  if (!process.env.NO_POST) await fetch(`${base}/api/ping`, { method: "POST" });

  const browser = await chromium.launch();
  const page = await browser.newPage();
  let loads = 0;
  page.on("request", (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) loads++;
  });
  if (s === 1) {
    await page.goto(`${base}/a`);
    await sleep(2500);
    await page.evaluate(() => window.next.router.push("/b"));
    await sleep(2500);
    await page.goto(`${base}/c`);
    await sleep(2500);
  } else {
    await page.goto(`${base}/a`);
    await sleep(6000);
  }
  await browser.close();
  process.kill(-server.pid, "SIGTERM");
  await sleep(1500);
  results.push(s === 1 ? `session 1 (build cache): ${loads} loads of /a, /c` : `session ${s}: ${loads} loads of /a`);
}
console.log(results.join("\n"));
