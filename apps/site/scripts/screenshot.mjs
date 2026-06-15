import fs from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { URL } from "node:url";
import { createServer } from "vite";

// Screenshot helper for the gallery site. By default it boots a temporary Vite
// server (loading the project's vite.config, so the React plugin and dev-only
// run proxy apply) and captures a route. The backdrop is WebGL, so Chromium is
// launched with software-rendering flags; pass --reduced-motion to exercise the
// CSS fallback instead and --sun to pre-enable the banded sun.

const DEFAULT_VIEWPORT = { width: 1440, height: 900 };
const DEFAULT_SELECTOR = "#root";
// Frames to let the WebGL scene warm up (and its lazy chunk load) before the
// shot. Overridable with --wait.
const DEFAULT_WAIT_MS = 1500;

const UBUNTU_2604_PLAYWRIGHT_HOST_PLATFORMS = new Map([
  ["x64", "ubuntu24.04-x64"],
  ["arm64", "ubuntu24.04-arm64"],
]);

// Software-rendering flags so Chromium produces real WebGL output headlessly.
const WEBGL_ARGS = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swrast",
  "--ignore-gpu-blocklist",
];

function usage() {
  console.error(`Usage:
  npm run screenshot -- [route] [output-file] [options]

Options:
  --width <px>            Viewport width (default ${DEFAULT_VIEWPORT.width})
  --height <px>           Viewport height (default ${DEFAULT_VIEWPORT.height})
  --full-page            Capture the full scrollable page
  --selector <css>       Wait for this selector (default ${DEFAULT_SELECTOR})
  --wait <ms>            Extra settle time for WebGL frames (default ${DEFAULT_WAIT_MS})
  --sun                  Pre-enable the banded sun via localStorage
  --reduced-motion       Emulate prefers-reduced-motion (CSS fallback)
  --base-url <url>       Screenshot an already-running server instead
  --browser-executable <path>

Examples:
  npm run screenshot -- / tmp/screenshots/index.png
  npm run screenshot -- / tmp/screenshots/sun.png --sun
  npm run screenshot -- / tmp/screenshots/reduced.png --reduced-motion`);
}

function parsePositiveInteger(value, optionName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer.`);
  }
  return parsed;
}

function parseArgs(argv) {
  const positional = [];
  const options = {
    width: DEFAULT_VIEWPORT.width,
    height: DEFAULT_VIEWPORT.height,
    fullPage: false,
    selector: DEFAULT_SELECTOR,
    waitMs: DEFAULT_WAIT_MS,
    sun: false,
    reducedMotion: false,
    baseUrl: null,
    browserExecutable: process.env.TTC_SCREENSHOT_BROWSER ?? null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--width") {
      options.width = parsePositiveInteger(argv[++index], "--width");
    } else if (arg === "--height") {
      options.height = parsePositiveInteger(argv[++index], "--height");
    } else if (arg === "--full-page") {
      options.fullPage = true;
    } else if (arg === "--selector") {
      options.selector = argv[++index];
    } else if (arg === "--wait") {
      options.waitMs = parsePositiveInteger(argv[++index], "--wait");
    } else if (arg === "--sun") {
      options.sun = true;
    } else if (arg === "--reduced-motion") {
      options.reducedMotion = true;
    } else if (arg === "--base-url") {
      options.baseUrl = argv[++index];
    } else if (arg === "--browser-executable") {
      options.browserExecutable = argv[++index];
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (options.baseUrl && !options.baseUrl.endsWith("/")) {
    options.baseUrl = `${options.baseUrl}/`;
  }

  const route = positional[0] ?? "/";
  const safeRouteName =
    route
      .replace(/^https?:\/\//i, "")
      .replace(/^#?\/?/, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "") || "index";
  const outputPath = positional[1]
    ? path.resolve(positional[1])
    : path.resolve("tmp/screenshots", `${safeRouteName}.png`);

  return { route, outputPath, ...options };
}

function isAbsoluteHttpUrl(value) {
  return value.startsWith("http://") || value.startsWith("https://");
}

function routeToUrl(baseUrl, route) {
  if (isAbsoluteHttpUrl(route)) {
    return route;
  }
  if (route.startsWith("/")) {
    return new URL(route.slice(1), baseUrl).toString();
  }
  return new URL(route, baseUrl).toString();
}

async function createViteServer() {
  const server = await createServer({
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  await server.listen();
  const baseUrl = server.resolvedUrls?.local[0];
  if (!baseUrl) {
    await server.close();
    throw new Error("Unable to resolve Vite server URL.");
  }
  return { baseUrl, close: () => server.close() };
}

function resolveBrowserExecutable(configured) {
  if (configured) {
    return path.resolve(configured);
  }
  // Prefer Playwright's managed Chromium; fall back to a system browser.
  return (
    [
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/google-chrome",
    ].find((candidate) => fs.existsSync(candidate)) ?? null
  );
}

// Ubuntu 26.04 has no native Playwright browser entry yet; reuse the 24.04
// artifacts (see the playwright-26.04 skill).
function configurePlaywrightHostPlatformOverride() {
  if (process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE) {
    return;
  }
  let osRelease = "";
  try {
    osRelease = fs.readFileSync("/etc/os-release", "utf8");
  } catch {
    return;
  }
  const isUbuntu2604 =
    /^ID=ubuntu$/m.test(osRelease) && /^VERSION_ID="?26\.04"?$/m.test(osRelease);
  if (process.platform !== "linux" || !isUbuntu2604) {
    return;
  }
  const hostPlatform = UBUNTU_2604_PLAYWRIGHT_HOST_PLATFORMS.get(process.arch);
  if (hostPlatform) {
    process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE = hostPlatform;
  }
}

async function main() {
  configurePlaywrightHostPlatformOverride();
  const options = parseArgs(process.argv.slice(2));
  const { chromium } = await import("playwright");

  const server =
    options.baseUrl || isAbsoluteHttpUrl(options.route)
      ? null
      : await createViteServer();
  const baseUrl = options.baseUrl ?? server?.baseUrl ?? "";
  const browserExecutable = resolveBrowserExecutable(options.browserExecutable);

  let browser = null;
  try {
    browser = await chromium.launch({
      args: WEBGL_ARGS,
      ...(browserExecutable ? { executablePath: browserExecutable } : {}),
    });
    const page = await browser.newPage({
      viewport: { width: options.width, height: options.height },
      deviceScaleFactor: 1,
      ...(options.reducedMotion ? { reducedMotion: "reduce" } : {}),
    });

    if (options.sun) {
      await page.addInitScript(() => {
        window.localStorage.setItem("ttc:backdrop:sun", "true");
      });
    }

    await page.goto(routeToUrl(baseUrl, options.route), {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector(options.selector, { timeout: 10000 });
    await page.waitForTimeout(options.waitMs);

    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await page.screenshot({
      path: options.outputPath,
      fullPage: options.fullPage,
    });
    console.log(options.outputPath);
  } finally {
    await browser?.close();
    await server?.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  usage();
  process.exit(1);
});
