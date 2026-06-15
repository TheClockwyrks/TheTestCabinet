#!/usr/bin/env node
// Headless-browser driver for The Test Cabinet's validator.
//
// One tool serves two jobs, because both are "open a page at a fixed viewport,
// optionally drive it, and screenshot it":
//
//   * Render a reference mockup    — `--url file://…/menu.html` with no actions.
//   * Capture a produced build     — `--url http://127.0.0.1:PORT/` plus the
//                                     actions that drive it into the view.
//
// Usage:
//   node driver.mjs --url <url> --out <png> [--actions <json>]
//                   [--width <px>] [--height <px>] [--settle <ms>]
//
// `--actions` is a JSON array of steps, each one of:
//   { "type": "wait", "ms": 500 }            pause
//   { "type": "key",  "key": "Enter" }       press and release a key
//   { "type": "hold", "key": "ArrowUp",      hold a key down for a duration
//                     "ms": 300 }
//   { "type": "click", "x": 640, "y": 360 }  click a logical-pixel point
//
// Key names are Playwright key names (e.g. `Enter`, `ArrowUp`, `w`, `Escape`).

import { chromium } from "playwright";

/** Parse `--flag value` pairs into a plain object. */
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    }
  }
  return args;
}

/** Run one action step against the page. */
async function runStep(page, step) {
  switch (step.type) {
    case "wait":
      await page.waitForTimeout(Number(step.ms) || 0);
      break;
    case "key":
      await page.keyboard.press(String(step.key));
      break;
    case "hold":
      await page.keyboard.down(String(step.key));
      await page.waitForTimeout(Number(step.ms) || 0);
      await page.keyboard.up(String(step.key));
      break;
    case "click":
      await page.mouse.click(Number(step.x) || 0, Number(step.y) || 0);
      break;
    default:
      throw new Error(`unknown action step type: ${JSON.stringify(step.type)}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url || !args.out) {
    throw new Error("both --url and --out are required");
  }

  const width = Number(args.width) || 1280;
  const height = Number(args.height) || 720;
  // A short settle pause after load (and after the actions) lets a first
  // animation frame paint and webfonts settle before the screenshot.
  const settle = args.settle === undefined ? 400 : Number(args.settle);

  const actions = args.actions ? JSON.parse(args.actions) : [];
  if (!Array.isArray(actions)) {
    throw new Error("--actions must be a JSON array");
  }

  // Choosing the browser binary, in order of preference:
  //
  //  1. `TCAB_CHROMIUM_EXECUTABLE` — an explicit Chromium binary. Managed
  //     installs whose on-disk layout does not match what Playwright's path
  //     resolution expects (notably Nix's `playwright-driver.browsers`) can fail
  //     to find the bundled browser; pointing straight at a real Chromium (for
  //     example `${pkgs.chromium}/bin/chromium`) sidesteps that entirely.
  //  2. Otherwise `channel: "chromium"` — the full bundled Chromium in the new
  //     headless mode, rather than Playwright's default `chromium-headless-shell`
  //     (a separate download some installs omit).
  const executablePath = process.env.TCAB_CHROMIUM_EXECUTABLE;
  const launchOptions = { args: ["--no-sandbox"] };
  if (executablePath) {
    launchOptions.executablePath = executablePath;
  } else {
    launchOptions.channel = "chromium";
  }
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    // `load` rather than `networkidle`: a game loop keeps the network quiet but
    // never idles in the sense Playwright waits for, and self-contained builds
    // have nothing left to fetch once loaded.
    await page.goto(args.url, { waitUntil: "load", timeout: 30_000 });
    if (settle > 0) {
      await page.waitForTimeout(settle);
    }
    for (const step of actions) {
      await runStep(page, step);
    }
    if (settle > 0) {
      await page.waitForTimeout(settle);
    }
    // Encode as PNG explicitly rather than letting Playwright infer the format
    // from the path's extension: the validator captures to a temp file (e.g.
    // `.view.png.<uuid>.tmp`) and atomically renames it into place, so the path
    // handed to `--out` does not necessarily end in `.png`.
    await page.screenshot({ path: args.out, type: "png" });
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  process.stderr.write(`${err?.stack || err}\n`);
  process.exit(1);
});
