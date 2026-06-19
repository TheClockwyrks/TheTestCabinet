import fs from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

// Bakes a still frame of the WebGL synthwave backdrop into a JPEG that the CSS
// fallback layers on top of its grid. The point: when a browser can't run WebGL
// (or the user prefers reduced motion), the backdrop still *looks* like the real
// scene — just frozen — instead of only the approximate CSS grid.
//
// It renders the real `SynthwaveScene` on a minimal, chrome-free page (see
// scripts/capture/), so the captured pixels are the pure scene with no topbar
// and no scanlines (those are re-applied over the still at runtime). Chromium is
// launched with software-rendering flags so it produces real WebGL output
// headlessly, mirroring scripts/screenshot.mjs.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAPTURE_ROOT = path.join(HERE, "capture");
// The baked stills live beside the fallback that consumes them, so every host
// that bundles `@test-cabinet/ui` (site, web console, desktop) emits them
// automatically.
const OUTPUT_DIR = path.resolve(
  HERE,
  "../../../packages/ui/src/app/components/backdrop",
);

// The decorative sun is a user toggle (`sunEnabled`, on by default), so we bake
// both states; the fallback swaps stills as the toggle changes, just like the
// WebGL scene mounts/unmounts the sun. The scene reads the choice from the
// persisted `ttc:settings` store, which we seed in localStorage before load.
const VARIANTS = [
  { file: "backdrop-still.jpg", sunEnabled: true },
  { file: "backdrop-still-no-sun.jpg", sunEnabled: false },
];

// Match the zustand `persist` envelope written by the app's appSettings store
// (key `ttc:settings`), so hydration picks up the choice we want.
function settingsSeed(sunEnabled) {
  return JSON.stringify({
    state: { sunEnabled, eventFeedStyle: "gutter" },
    version: 0,
  });
}

// A wide 16:9 capture covers the common aspect ratios when used as `cover`; the
// scene's horizon sits near the vertical middle, so center-cropping reads well.
const DEFAULT_VIEWPORT = { width: 1920, height: 1080 };
// Frames to let SwiftShader compile the scene's shaders and paint a stable frame
// before the shot. The grid scrolls seamlessly, so any settled frame composes
// the same — there's no special "first" frame to race for.
const DEFAULT_WAIT_MS = 2500;
const DEFAULT_QUALITY = 82;

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

// Ubuntu 26.04 has no native Playwright browser entry yet; reuse the 24.04
// artifacts (see the playwright-26.04 skill). Mirrors scripts/screenshot.mjs.
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

function resolveBrowserExecutable() {
  const configured = process.env.TTC_SCREENSHOT_BROWSER;
  if (configured) {
    return path.resolve(configured);
  }
  // Prefer a system browser if present; otherwise let Playwright use its managed
  // Chromium (returning null leaves `executablePath` unset).
  return (
    [
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/google-chrome",
    ].find((candidate) => fs.existsSync(candidate)) ?? null
  );
}

async function createCaptureServer() {
  // `configFile: false` + an explicit React plugin: the capture page is its own
  // tiny root, not the gallery app, so we don't want the site's vite.config.
  const server = await createServer({
    configFile: false,
    root: CAPTURE_ROOT,
    plugins: [react()],
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

async function main() {
  configurePlaywrightHostPlatformOverride();
  const { chromium } = await import("playwright");

  const server = await createCaptureServer();
  const browserExecutable = resolveBrowserExecutable();

  let browser = null;
  try {
    browser = await chromium.launch({
      args: WEBGL_ARGS,
      ...(browserExecutable ? { executablePath: browserExecutable } : {}),
    });

    await mkdir(OUTPUT_DIR, { recursive: true });
    for (const variant of VARIANTS) {
      const page = await browser.newPage({
        viewport: DEFAULT_VIEWPORT,
        deviceScaleFactor: 1,
      });
      try {
        const seed = settingsSeed(variant.sunEnabled);
        await page.addInitScript((value) => {
          window.localStorage.setItem("ttc:settings", value);
        }, seed);

        await page.goto(server.baseUrl, { waitUntil: "domcontentloaded" });
        // The scene mounts a <canvas>; wait for it, then let a few frames settle.
        await page.waitForSelector("canvas", { timeout: 20_000 });
        await page.waitForTimeout(DEFAULT_WAIT_MS);

        const outputPath = path.join(OUTPUT_DIR, variant.file);
        await page.screenshot({
          path: outputPath,
          type: "jpeg",
          quality: DEFAULT_QUALITY,
        });
        console.log(outputPath);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser?.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
