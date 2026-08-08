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
//
// A second mode drives a case's **debug API** for automated validation:
//   node driver.mjs --mode script --url <url> --script <mjs> --handle <name>
//                   --out-dir <dir> --outputs <json> --result <json-path>
//                   [--width <px>] [--height <px>] [--tick-hz <n>]
//
// It loads the served build, waits for `window.<handle>` to be installed, imports
// `<mjs>` and runs the validation item it exports, then writes a JSON result to
// `--result`. `--outputs` is a JSON array of `{ id, kind }` (kind is `image` or
// `video`) the item is expected to produce into `--out-dir` as `<id>.png`/
// `<id>.webm`.
//
// The item is an `{ id, arrange, act, assert }` triple and is run TWICE: once with
// time advancing instantly to decide the verdict, once in real time to record the
// media, so a clip depicts the game at the speed it actually runs rather than at
// the speed of the driver's round trips. `--tick-hz` is the case's fixed
// simulation rate, which is what relates those two clocks; omit it for a case
// whose debug API is specified in seconds. See `validation.mjs` for the runtime,
// `crates/core/src/browser.rs` (the caller), and the end-to-end instrumentation
// docs for the contract. Infra failures (no Playwright,
// no Chromium) exit non-zero so the caller degrades; a build/script failure is
// reported in the result with `ran: false` and exits zero (the caller gates on it).

import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { TtcVerdictStop, createTtc } from "./ttc.mjs";
import {
  RECORD,
  VALIDATE,
  instantiate,
  isPreconditionUnmet,
  makeSilentCheck,
  runPass,
} from "./validation.mjs";

/**
 * Import Playwright's `chromium`, resolving the package across the layouts our
 * supported hosts produce:
 *
 *   * A walkable `node_modules/playwright` (an `npm install` in the devcontainer
 *     or CI) — a bare `import "playwright"` already finds this.
 *   * Playwright provided only on `NODE_PATH`, as Nix's `playwright-driver`
 *     exposes it. ESM bare-specifier resolution does *not* consult `NODE_PATH`,
 *     so a static `import "playwright"` throws `ERR_MODULE_NOT_FOUND` on such a
 *     host even though the package is right there. CommonJS `require.resolve`
 *     *does* honor `NODE_PATH`, so we resolve through `createRequire` and import
 *     the resolved absolute path — covering the `node_modules` layout too.
 *   * Only `playwright-core` present — it carries the browser automation and,
 *     unlike the full `playwright` package, has no browser-download postinstall,
 *     so it installs cleanly on hosts where that postinstall cannot.
 *
 * The resolved module may be CommonJS; under dynamic `import()` its exports can
 * surface either as named exports or under `default`, so both are checked.
 */
async function importChromium() {
  const require = createRequire(import.meta.url);
  const failures = [];
  for (const pkg of ["playwright", "playwright-core"]) {
    try {
      const entry = require.resolve(pkg);
      const ns = await import(pathToFileURL(entry).href);
      const chromium = ns.chromium ?? ns.default?.chromium;
      if (chromium) {
        return chromium;
      }
      failures.push(`${pkg}: resolved (${entry}) but exposes no \`chromium\``);
    } catch (err) {
      failures.push(`${pkg}: ${err?.message || err}`);
    }
  }
  throw new Error(
    `could not load Playwright (install it, or point NODE_PATH at it); tried:\n${failures
      .map((line) => `  - ${line}`)
      .join("\n")}`,
  );
}

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

/**
 * Discover Chromium binaries Playwright has already downloaded, newest first.
 *
 * Playwright resolves the browser for the *exact* revision its own version
 * pins; when the installed build is a different revision (or uses the newer
 * `chrome-linux64` layout), that resolution misses even though a perfectly good
 * Chromium is sitting in the cache. This scans the cache directory for any full
 * `chromium-<rev>` build with a real `chrome` binary so the launch can fall back
 * to it. Both the legacy `chrome-linux` and current `chrome-linux64` layouts are
 * checked; the highest revision wins.
 */
function discoverCachedChromium() {
  const base =
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    path.join(os.homedir(), ".cache", "ms-playwright");

  let entries;
  try {
    entries = fs.readdirSync(base);
  } catch {
    return [];
  }

  const candidates = [];
  for (const entry of entries) {
    // Only full Chromium builds (`chromium-<rev>`), not `chromium_headless_shell`.
    const match = /^chromium-(\d+)$/.exec(entry);
    if (!match) {
      continue;
    }
    for (const layout of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
      const candidate = path.join(base, entry, layout);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        candidates.push({ revision: Number(match[1]), path: candidate });
      } catch {
        // Not present in this layout; try the next.
      }
    }
  }

  candidates.sort((a, b) => b.revision - a.revision);
  return candidates.map((candidate) => candidate.path);
}

/**
 * Launch Chromium, trying each strategy in order of preference and falling back
 * on failure:
 *
 *  1. `TCAB_CHROMIUM_EXECUTABLE` — an explicit Chromium binary. Managed installs
 *     whose on-disk layout does not match what Playwright's path resolution
 *     expects (notably Nix's `playwright-driver.browsers`) can fail to find the
 *     bundled browser; pointing straight at a real Chromium (for example
 *     `${pkgs.chromium}/bin/chromium`) sidesteps that entirely.
 *  2. `channel: "chromium"` — the full bundled Chromium in the new headless mode,
 *     rather than Playwright's default `chromium-headless-shell` (a separate
 *     download some installs omit). This is what resolves on a host whose cache
 *     matches Playwright's pinned revision.
 *  3. Any cached `chromium-<rev>` build found on disk, newest first — covers an
 *     environment whose installed Chromium revision differs from the one
 *     Playwright pins (e.g. a newer `chrome-linux64` build in a container).
 *
 * Earlier strategies keep working exactly as before; the cache fallback only
 * runs when they fail, so existing hosts are unaffected.
 */
async function launchBrowser(chromium) {
  const attempts = [];
  const explicit = process.env.TCAB_CHROMIUM_EXECUTABLE;
  if (explicit) {
    attempts.push({
      label: `TCAB_CHROMIUM_EXECUTABLE (${explicit})`,
      options: { executablePath: explicit },
    });
  }
  attempts.push({
    label: 'channel "chromium"',
    options: { channel: "chromium" },
  });
  for (const cached of discoverCachedChromium()) {
    attempts.push({
      label: `cached Chromium (${cached})`,
      options: { executablePath: cached },
    });
  }

  const failures = [];
  for (const attempt of attempts) {
    try {
      return await chromium.launch({
        args: ["--no-sandbox"],
        ...attempt.options,
      });
    } catch (err) {
      failures.push(`  - ${attempt.label}: ${err?.message || err}`);
    }
  }
  throw new Error(`could not launch Chromium; tried:\n${failures.join("\n")}`);
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

/**
 * Build the driver `api` handed to a debug script. Every operation is a thin
 * wrapper over `page.evaluate` against `window[handle]` (so the script drives the
 * exact same debug surface a build ships) plus the two capture affordances a
 * synthesized proof needs. `producedImages` records which declared image outputs
 * the script actually screenshotted, so the caller can flag a missing one.
 */
function makeScriptApi(page, handle, outDir, producedImages) {
  const call = (method, args) =>
    page.evaluate(
      ([h, m, a]) => {
        const target = window[h];
        if (!target) throw new Error(`window.${h} is not installed`);
        if (typeof target[m] !== "function") {
          throw new Error(`window.${h}.${m} is not a function`);
        }
        return target[m](...a);
      },
      [handle, method, args],
    );
  return {
    // Core debug-API operations, by name, so a script reads like the spec.
    reset: (options) => call("reset", options === undefined ? [] : [options]),
    step: (seconds) => call("step", [seconds]),
    snapshot: () => call("snapshot", []),
    // A generic call into any case-declared control operation.
    call: (method, ...args) => call(method, args),
    // Deliver a genuine, browser-trusted key tap through Chromium's own input
    // pipeline — NOT the debug API. Two things separate this from a debug
    // `press`/`keyDown`: it dispatches a real DOM `keydown`/`keyup` the build's
    // own listeners catch, and it counts as the user gesture Chromium's autoplay
    // policy requires. A build is free to feed the debug API through a purely
    // logical input path (the contract only asks that injected input reach the
    // same game handling the keyboard does), and to create or resume its
    // AudioContext lazily from a real DOM interaction rather than from that
    // logical path — both are conformant. When it does, driving input through
    // the debug API never unlocks its audio, so no cue is ever scheduled and the
    // `audio` probe reads nothing though the build plays fine for a real player.
    // A real tap here arms such a build. `code` is a `KeyboardEvent.code`; pass a
    // key the game does not bind so arming never disturbs game state.
    userKey: (code) => page.keyboard.press(String(code)),
    // The pointer counterpart to `userKey`: a genuine, browser-trusted click at
    // viewport coordinates `(x, y)` through Chromium's own input pipeline. It
    // dispatches the real `pointerdown`/`mousedown`/`mouseup`/`click` sequence a
    // build's listeners catch and counts as the autoplay gesture — for a build
    // that takes its first interaction (and unlocks audio) from a pointer rather
    // than a key. The driver cannot know a build's UI layout, so the caller passes
    // coordinates it expects to be INERT — a field corner, typically — and arming
    // never triggers a game action (placing a unit, firing, moving a menu).
    userClick: (x, y) => page.mouse.click(Number(x) || 0, Number(y) || 0),
    // A genuine, browser-trusted DOUBLE-click on the game surface: the real
    // `pointerdown`/`pointerup` pair twice, with the second carrying `clickCount:
    // 2`, so Chromium emits the `dblclick` event too.
    //
    // It exists because a double-click is the one gesture nothing else here can
    // render. A build may recognize the double on the `dblclick` event, on the
    // second release, or on the second press, and that choice decides which of the
    // gesture's OWN events land after the action it triggers — which is where a
    // build that undoes what it just did gives itself away. None of the other
    // primitives reach that: a debug `doubleClick` op is the recognition alone, not
    // the events around it; injected pointer ops call a build's handlers directly
    // and so bypass the DOM listeners its double detection lives in (usually keyed
    // on wall-clock timing, which injected ops never satisfy); and two `userClick`s
    // in a row each carry `clickCount: 1`, so a build watching for `dblclick` never
    // sees one. Composing the missing events by hand only fabricates input no
    // player produces — an unpaired release, say, which a build is free to read as
    // a click or ignore, and which then decides a check on a distinction no
    // specification draws.
    //
    // Unlike `userClick`, which takes viewport pixels because it only needs an
    // inert corner to arm audio with, this takes NORMALIZED coordinates over the
    // largest canvas — `(u, v)` fractions in `[0, 1]`, exactly as `pixel` does —
    // because it must land on an exact game element, and a caller knows where that
    // element is in the field's logical space, not in the viewport.
    userDoubleClick: async (u, v) => {
      const point = await page.evaluate(
        ([fu, fv]) => {
          const canvases = Array.from(document.querySelectorAll("canvas"));
          if (canvases.length === 0) {
            throw new Error("no <canvas> element to double-click");
          }
          // The game surface is the largest canvas on the page.
          let canvas = canvases[0];
          for (const c of canvases) {
            if (c.width * c.height > canvas.width * canvas.height) canvas = c;
          }
          // Its on-screen rect, so a fraction of the drawing surface maps to the
          // viewport point Chromium dispatches at however the build sizes, scales
          // or letterboxes it.
          const r = canvas.getBoundingClientRect();
          return { x: r.left + fu * r.width, y: r.top + fv * r.height };
        },
        [u, v],
      );
      await page.mouse.dblclick(point.x, point.y);
    },
    // Real wall-clock pause: unlike `step` (which advances the simulation
    // instantly), this lets the build's render loop animate on screen, so a video
    // output captures real motion.
    wait: (ms) => page.waitForTimeout(Number(ms) || 0),
    // Capture a still for a declared image output as `<id>.png`.
    screenshot: async (id) => {
      const file = path.join(outDir, `${id}.png`);
      await page.screenshot({ path: file, type: "png" });
      producedImages.add(String(id));
    },
    // Read the reporter-side audio probe: the timeline of every Web Audio source
    // node the build has `start()`ed since the page loaded (see the init script in
    // `openSession`). Each entry is `{ t }`, a `performance.now()` timestamp, so a
    // check can confirm a build fired a cue on an event by comparing the log length
    // before and after driving that event. It reads what the build actually
    // scheduled through the Web Audio API — no value the game merely reports — so a
    // build cannot pass by claiming a sound it never plays. Returns a copy of the
    // log (empty if the build never touched Web Audio).
    audio: () =>
      page.evaluate(() =>
        Array.isArray(window.__ttcAudioProbe)
          ? window.__ttcAudioProbe.slice()
          : [],
      ),
    // Reflect the debug API surface without invoking it: for each name in `names`,
    // report `typeof window[handle][name]`, plus the handle's `version`. A sanity
    // check uses this to confirm every required operation is present as a function
    // (and the handle carries a version) without calling — and mutating through —
    // each operation.
    probe: (names) =>
      page.evaluate(
        ([h, ns]) => {
          const target = window[h] || {};
          const ops = {};
          for (const n of ns) ops[n] = typeof target[n];
          return { version: target.version, ops };
        },
        [handle, names],
      ),
    // Read the color the build actually RENDERED at a normalized point of its
    // largest canvas — `(u, v)` are fractions in `[0, 1]` across the drawing
    // surface (0,0 = top-left, 1,1 = bottom-right), so a caller converts a
    // logical coordinate to a fraction with the field size and never has to know
    // the canvas's pixel dimensions or device-pixel ratio. Returns the sampled
    // `{ r, g, b, a }` (0–255) straight from the canvas backing store, so a color
    // check reads the pixels the game drew rather than any value it merely
    // reports — a build cannot pass by returning a color it does not paint.
    pixel: (u, v) =>
      page.evaluate(
        ([fu, fv]) => {
          const canvases = Array.from(document.querySelectorAll("canvas"));
          if (canvases.length === 0) {
            throw new Error("no <canvas> element to sample a pixel from");
          }
          // The game surface is the largest canvas on the page.
          let canvas = canvases[0];
          for (const c of canvases) {
            if (c.width * c.height > canvas.width * canvas.height) canvas = c;
          }
          const ctx = canvas.getContext("2d");
          if (!ctx || typeof ctx.getImageData !== "function") {
            throw new Error("the game canvas has no readable 2D context");
          }
          const px = Math.min(
            canvas.width - 1,
            Math.max(0, Math.floor(fu * canvas.width)),
          );
          const py = Math.min(
            canvas.height - 1,
            Math.max(0, Math.floor(fv * canvas.height)),
          );
          const d = ctx.getImageData(px, py, 1, 1).data;
          return { r: d[0], g: d[1], b: d[2], a: d[3] };
        },
        [u, v],
      ),
  };
}

/** Drive a case's debug API through a validation script (see the usage banner). */
async function runScript(args) {
  for (const required of ["url", "script", "handle", "out-dir", "result"]) {
    if (!args[required]) {
      throw new Error(`--${required} is required in --mode script`);
    }
  }
  const width = Number(args.width) || 1280;
  const height = Number(args.height) || 720;
  const outDir = args["out-dir"];
  const handle = args.handle;
  const outputs = args.outputs ? JSON.parse(args.outputs) : [];
  if (!Array.isArray(outputs)) {
    throw new Error("--outputs must be a JSON array");
  }
  const videoOutput = outputs.find((o) => o.kind === "video");
  // The case's fixed simulation rate, from its `[instrumentation]` manifest. It is
  // what lets the runtime express one `advance(ticks)` as an exact step in the
  // validate pass and as the right wall-clock duration in the record pass. Absent
  // for a real-time-clocked case, whose debug API is specified in seconds.
  const tickHz = args["tick-hz"] ? Number(args["tick-hz"]) : null;
  fs.mkdirSync(outDir, { recursive: true });

  // Record the result even when the script fails, so the caller can gate on it.
  const writeResult = (result) =>
    fs.writeFileSync(args.result, JSON.stringify(result));

  // Playwright and Chromium not being available is an infra failure, not a build
  // failure — let it throw so the caller (browser.rs) degrades rather than gates.
  const chromium = await importChromium();
  const browser = await launchBrowser(chromium);
  // A video output records the whole context; Playwright writes the `.webm` on
  // context close, so record into a temp dir and move it to `<id>.webm` after.
  const videoDir = videoOutput
    ? fs.mkdtempSync(path.join(os.tmpdir(), "tcab-clip-"))
    : null;

  const consoleErrors = [];
  const producedImages = new Set();
  let result;

  // The context the current pass runs in. Each pass gets a fresh one: only the
  // record pass's context carries a `recordVideo`, and Playwright only writes the
  // `.webm` when that context closes.
  let context = null;

  /**
   * Open a context and page at the build's URL and wait for the debug handle.
   * `video` decides whether this context records. Returns the page, or null if the
   * handle never appeared — a non-conformant build, not an error.
   */
  const openSession = async ({ video }) => {
    context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      ...(video && videoDir
        ? { recordVideo: { dir: videoDir, size: { width, height } } }
        : {}),
    });
    // Instrument the Web Audio API before any of the build's own script runs, so a
    // check can tell whether a build actually played a synthesized cue on an event
    // (see `api.audio`). Every synthesized source — an oscillator, a buffer source,
    // a constant source — must be `start()`ed to make a sound, and all of them share
    // the `AudioScheduledSourceNode` base class, so wrapping that one `start` records
    // every cue exactly once, whatever the build synthesizes with. It records only
    // that a source started (a timestamp), never any audio data, and no-ops if the
    // browser lacks Web Audio. This is reporter-side only and is never seeded.
    await context.addInitScript(() => {
      const log = [];
      window.__ttcAudioProbe = log;
      const record = () => {
        try {
          log.push({ t: performance.now() });
        } catch {
          log.push({ t: 0 });
        }
      };
      const wrap = (proto) => {
        const desc = proto && Object.getOwnPropertyDescriptor(proto, "start");
        if (!desc || typeof desc.value !== "function") return false;
        const original = desc.value;
        proto.start = function (...args) {
          record();
          return original.apply(this, args);
        };
        return true;
      };
      // Wrap the shared base class so any source kind that inherits `start`
      // unchanged is caught for free, then ALSO wrap every concrete subclass that
      // redefines its own `start`. This is not redundant: per the Web Audio spec,
      // `AudioBufferSourceNode.start(when, offset, duration)` takes extra optional
      // parameters beyond the base `AudioScheduledSourceNode.start(when)`, so
      // Chromium gives it its OWN `start` on `AudioBufferSourceNode.prototype` that
      // SHADOWS the base one — wrapping only the base never sees a decoded/sampled
      // clip play (only a plain oscillator or constant source, which inherit
      // `start` unchanged and so are already caught by the base wrap). Each `wrap`
      // call is a no-op when its target has no own `start`, so calling all four
      // unconditionally is safe and catches every kind regardless of which
      // prototype a given browser happens to put `start` on.
      const Base = window.AudioScheduledSourceNode;
      if (Base) wrap(Base.prototype);
      if (window.OscillatorNode) wrap(window.OscillatorNode.prototype);
      if (window.AudioBufferSourceNode)
        wrap(window.AudioBufferSourceNode.prototype);
      if (window.ConstantSourceNode) wrap(window.ConstantSourceNode.prototype);
    });
    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) =>
      consoleErrors.push(String(err?.message || err)),
    );
    await page.goto(args.url, { waitUntil: "load", timeout: 30_000 });
    // The debug API is a gate: a build that never installs the handle has not met
    // the contract. Wait a bounded time, then report a non-conformant build.
    try {
      await page.waitForFunction((h) => Boolean(window[h]), handle, {
        timeout: 10_000,
      });
    } catch {
      return null;
    }
    return page;
  };

  try {
    const page = await openSession({ video: false });
    if (!page) {
      result = {
        ran: false,
        handleFound: false,
        preconditionUnmet: false,
        detail: `window.${handle} was not installed within 10s`,
        verdicts: [],
        producedOutputs: [],
        consoleErrors,
      };
      await context.close();
      await browser.close();
      writeResult(result);
      return;
    }

    const api = makeScriptApi(page, handle, outDir, producedImages);
    const mod = await import(pathToFileURL(path.resolve(args.script)).href);

    // PASS 1 — validate. Exact stepping on the build's manual clock decides the
    // verdict. The item records its assertions through the reporter-side `ttc` kit
    // (see `ttc.mjs`), kept off the model's `api` so that surface stays the model's
    // own contract. A hard `assert*()` failure aborts the pass by throwing a
    // `TtcVerdictStop`; unwind it into the FAILED verdict it carries (a decided
    // outcome), rather than letting it fall through to the outer catch, which would
    // report the build as never having conformed.
    const ttc = createTtc();
    // The item names the verdict it backs, so the id lives with the checks rather
    // than being threaded in from the caller.
    const check = ttc.checkOne(instantiate(mod).id);
    let returned;
    let hardStopped = false;
    try {
      await runPass(instantiate(mod), api, {
        mode: VALIDATE,
        tickHz,
        check,
      });
      returned = check.verdict();
    } catch (err) {
      if (err instanceof TtcVerdictStop) {
        returned = { verdicts: err.ttcVerdicts };
        hardStopped = true;
      } else {
        throw err;
      }
    }

    // PASS 2 — record. Same item, real time, no decisions: it re-poses the scenario
    // with `arrange` and replays `act` at the speed the game actually runs, so the
    // media depicts exactly what pass 1 checked. Run it even when pass 1 failed —
    // a reviewer looking at a failed check wants to see the failure — and treat any
    // failure here as "no media", never as a verdict, since the verdict is already
    // decided. A fresh context is what scopes the recording to this pass alone.
    if (outputs.length > 0) {
      await context.close();
      try {
        const recordPage = await openSession({ video: Boolean(videoOutput) });
        if (recordPage) {
          await runPass(
            instantiate(mod),
            makeScriptApi(recordPage, handle, outDir, producedImages),
            {
              mode: RECORD,
              tickHz,
              check: makeSilentCheck(check.id),
            },
          );
        }
      } catch (err) {
        consoleErrors.push(
          `recording pass did not complete: ${err?.message || err}`,
        );
      }
    }
    const rawVerdicts = returned.verdicts ?? {};
    // A verdict's value is a list of assertions — the individual mechanical facts
    // the script checked, each `{ label, pass, expected?, actual? }`, exactly as a
    // code test framework records every `assert`. A comparison assertion carries the
    // observed `actual` and required `expected` so a failing one shows the mismatch;
    // a bare boolean fact carries neither. The verdict passes iff every assertion
    // passed. Both the passing and the failing assertions are carried through as its
    // proof. (A bare boolean is still accepted for a legacy script: one implicit
    // assertion.)
    const verdicts = Object.keys(rawVerdicts).map((id) => {
      const value = rawVerdicts[id];
      const assertions = Array.isArray(value)
        ? value.map((a) => {
            const assertion = {
              label: String(a.label ?? ""),
              pass: a.pass === true || a.pass === "pass",
            };
            if (a.expected !== undefined && a.expected !== null)
              assertion.expected = String(a.expected);
            if (a.actual !== undefined && a.actual !== null)
              assertion.actual = String(a.actual);
            return assertion;
          })
        : [];
      const pass = Array.isArray(value)
        ? assertions.length > 0 && assertions.every((a) => a.pass)
        : value === true || value === "pass";
      return { id, pass, assertions };
    });

    // Close the page/context so a recorded video is finalized before we look for it.
    await context.close();

    // Confirm every declared output landed. An image is produced by an
    // `api.screenshot(id)` call; the single video is the recorded clip, moved into
    // place here. A declared-but-missing output is a script conformance failure.
    const producedOutputs = [];
    const missing = [];
    for (const output of outputs) {
      if (output.kind === "video") {
        const clip = fs
          .readdirSync(videoDir)
          .find((name) => name.endsWith(".webm"));
        if (clip) {
          // Playwright records into a temp dir under the OS tmpdir, which is often
          // a different filesystem than `outDir` (the repo tree) — a plain rename
          // then fails with EXDEV ("cross-device link not permitted"). Copy across
          // the boundary and drop the temp source instead, so the clip lands
          // regardless of how the two directories are mounted.
          const src = path.join(videoDir, clip);
          const dst = path.join(outDir, `${output.id}.webm`);
          try {
            fs.renameSync(src, dst);
          } catch (err) {
            if (err && err.code === "EXDEV") {
              fs.copyFileSync(src, dst);
              fs.rmSync(src, { force: true });
            } else {
              throw err;
            }
          }
          producedOutputs.push(output.id);
        } else {
          missing.push(output.id);
        }
      } else if (producedImages.has(String(output.id))) {
        producedOutputs.push(output.id);
      } else {
        missing.push(output.id);
      }
    }

    // A hard `assert*()` stop is a decided (failed) verdict, not a nonconformant
    // build: keep `ran` true so the run gates on the failed verdict rather than on
    // the debug-API contract. Such a script legitimately stops before capturing its
    // declared media, so a missing output there is expected, not a conformance fault.
    result = {
      ran: hardStopped || missing.length === 0,
      handleFound: true,
      preconditionUnmet: false,
      detail: hardStopped
        ? "validation stopped early on a failed hard assertion"
        : missing.length === 0
          ? null
          : `script did not produce declared output(s): ${missing.join(", ")}`,
      verdicts,
      producedOutputs,
      consoleErrors,
    };
  } catch (err) {
    // A throw inside the drive (a missing/misbehaving control op, a malformed
    // return) is a build/script conformance failure — reported, not fatal.
    //
    // Except when it carries the unmet-precondition marker: the API answered
    // correctly and the item simply could not find a spot in this build's world to
    // pose its scenario (see `PRECONDITION_UNMET`). That is inconclusive, not a
    // contract failure, so it is reported separately and does not gate the run.
    const unmet = isPreconditionUnmet(err);
    result = {
      ran: false,
      handleFound: true,
      preconditionUnmet: unmet,
      detail: unmet
        ? `precondition not satisfiable against this build: ${err.message}`
        : String(err?.message || err),
      verdicts: [],
      producedOutputs: [],
      consoleErrors,
    };
    try {
      await context.close();
    } catch {
      // Already closing/closed.
    }
  } finally {
    await browser.close();
    if (videoDir) fs.rmSync(videoDir, { recursive: true, force: true });
  }
  writeResult(result);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === "script") {
    await runScript(args);
    return;
  }
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

  // Load Playwright first (see `importChromium` for why a bare import is not
  // enough on every host), then choose and launch the browser binary, falling
  // back across strategies so the same driver works on hosts whose Chromium
  // matches Playwright's pinned revision and in environments where it does not.
  // See `launchBrowser`.
  const chromium = await importChromium();
  const browser = await launchBrowser(chromium);
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
