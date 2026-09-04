// Orrery — posing the game with one produced file unavailable, and reading back
// that it is still a game. CASE-PROVIDED, and the SAME FILE in all three engine
// projects.
//
// NOT A `.test.ts`, so vitest never collects it. No entry of `test-case.toml`
// names it and it decides no point: it is the arrangement half of the "a missing
// file leaves the game running" checks in this directory, and it ASSERTS NOTHING.
// It stands the world up, hands the readings back, and the suite that called it
// reads the verdict.
//
// THE RULE THOSE CHECKS SHARE, from the close of `specs/assets.md`'s "Where the
// files land, and how they are loaded": "A load that fails leaves the game
// running. The game still initializes, still ticks, still takes keyboard and
// pointer input, and still draws a legible field, tray, and tape panel when a
// sprite, a sheet frame, a system, or a sound is unavailable, so a missing file
// costs the game its polish rather than its playability." Four kinds of file, one
// sentence: what differs between the checks is WHICH file is withheld, and that
// is the pattern {@link withoutFile} builds.
//
// A FILE THE BUILD NEVER REQUESTS CANNOT BE WITHHELD, and that is the honest
// outcome rather than a gap. A bundler is free to inline a small produced PNG or
// a small produced `system.json` into the bundle, which is still the committed
// file and is still conformant; such a build makes no request to refuse, so what
// a check then observes is a game that never missed anything. The requirement is
// about a load that FAILS, and no load happened.

import { BARE, ORIGIN, WEST } from "../fixtures";
import { SPEEDS, type ScreenName, type SimStatusName } from "../constants";
import { FIELD_REGION, TAPE_REGION, TRAY_REGION, type Region } from "../field";
import {
  advanceCycles,
  dragFromTray,
  openBareRun,
  openChallengeDocument,
  openTitle,
  pressAction,
  setSpeed,
  textIn,
  type Harness,
  type PixelRect,
  type TextDraw,
} from "../harness";

/**
 * The pattern that withholds ONE produced file, named by its path from the
 * repository root, under all three engines.
 *
 * `HarnessOptions.withoutAssets` tests a request's own path, and the two states
 * spell that path differently. In this process the build asks its loader for the
 * path `specs/assets.md` fixes, so the request is `assets/sprites/motes/sol.png`
 * itself; in a browser the request is for the BUNDLER's name for the same file,
 * which keeps the stem and the extension and puts a content hash between them —
 * `/assets/sol-C7eSjQc3.png`. Both are matched, and nothing else is: anchoring on
 * the extension keeps a stem such as an aperture sheet's `0` from matching a
 * chunk whose hash happens to carry it.
 */
export function withoutFile(file: string): RegExp {
  const name = file.slice(file.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const stem = escaped(name.slice(0, dot));
  const extension = escaped(name.slice(dot));
  return new RegExp(`(?:${escaped(file)}|/${stem}-[^/]*${extension})$`);
}

/** A literal, as a regular expression matches it. */
function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One region of `specs/editor.md`, as two frames drew it. */
export interface DrawnRegion {
  /** What to call it in a failure message. */
  name: string;
  /** The rectangle `specs/editor.md` fixes for it. */
  region: Region;
  /** The region on an empty machine, and with two parts placed on it. */
  before: PixelRect;
  after: PixelRect;
}

/** Everything {@link playThrough} read, for the suite that called it. */
export interface PlayedThrough {
  /** The screen the game stood up on, one frame after a reset. */
  screen: ScreenName;
  /** The run's speed step, posed at its lowest and then pressed upward. */
  speed: { before: number; after: number };
  /** The machine's parts before and after two tray drags placed two. */
  parts: { before: number; after: number };
  /** What a live run reached after one whole cycle of game time. */
  run: { cycle: number | undefined; status: SimStatusName | undefined };
  /** The field, the tray and the tape panel, drawn before and after. */
  regions: readonly DrawnRegion[];
  /** The runs of text the last frame drew inside the tray. */
  trayText: readonly TextDraw[];
  /** The runs of text the last frame drew inside the tape panel. */
  tapeText: readonly TextDraw[];
}

/** Which tray entry is the permitted `arm`, and which is the challenge's rise. */
const ARM_SLOT = 0;
const RISE_SLOT = 1;

/** The lowest speed step, which the press below is read as a rise from. */
const SLOWEST = 0;

/**
 * How many `speed-up` presses the sweep makes before it gives up and lets the
 * suite report a game that read none of them.
 *
 * `SPEEDS.length` is the number of steps there are, so a build that read every
 * press would already be at the last one; the bound is a small multiple of it, so
 * a game whose loop has not started yet has room to start and a game that reads
 * no key at all still reaches a verdict.
 */
const PRESS_ATTEMPTS = 4 * SPEEDS.length;

/**
 * Drive the whole of the sentence, in the order it states it, and hand back what
 * every step left.
 *
 * INITIALIZES — a reset and one frame, which is the title screen the game opens
 * on. TAKES KEYBOARD INPUT — `speed-up` on a live run, which `specs/editor.md`
 * lists among the actions "the editor reads" while a run is active. TICKS — that
 * run, driven one whole cycle, so the cycle counter has a boundary to cross. TAKES POINTER INPUT — two tray drags,
 * the gesture `specs/editor.md` places a part with. DRAWS A LEGIBLE FIELD, TRAY
 * AND TAPE PANEL — the three regions read on an empty machine and again with an
 * arm on `ORIGIN` and the challenge's rise on `WEST`, which is one part per thing
 * those three regions show: the field draws what stands on it, the tray draws the
 * rise's entry as spent, and the tape panel gains the arm's row.
 *
 * WHY THE KEY PRESS IS `speed-up`, AND WHY IT IS SWEPT. The step is posed at
 * `0` first and pressed upward, and `specs/simulation.md` makes that press
 * MONOTONE and BOUNDED — "The speed actions of `specs/controls.md` move the
 * setting one step and stop at `0` and at `3`" — so however many of the presses
 * below the game reads, one or all of them, the step it lands on is above the one
 * it started from and never back at it. The press is
 * repeated because under no engine a press is delivered by the BUILD's own frame
 * loop rather than by a driven frame (`specs/instrumentation.md`: "the loop keeps
 * rendering and keeps reading the keys"), and a build is free to start that loop
 * once its produced files have settled — which is exactly what a check that
 * withheld one of them has just made slower. The sweep is bounded and reads an
 * observable after each press, so it decides either way rather than waiting on a
 * clock.
 *
 * THE WORLD IS `BARE` THROUGHOUT — one `sol` in, the same `sol` out, `arm` the
 * one permitted kind — so the tray is the three entries above and nothing else is
 * on the field to be mistaken for what was placed.
 */
export async function playThrough(h: Harness): Promise<PlayedThrough> {
  await openTitle(h);
  const opened = await h.snapshot();

  await openBareRun(h, { challenge: BARE });
  await setSpeed(h, SLOWEST);
  let speed = SLOWEST;
  for (let attempt = 0; attempt < PRESS_ATTEMPTS && speed === SLOWEST; ) {
    attempt += 1;
    speed = (await pressAction(h, "speed-up")).sim?.speed ?? SLOWEST;
  }

  await advanceCycles(h, 1);
  const ran = await h.snapshot();

  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  await h.advance(1);
  const empty = await h.snapshot();
  const before = await readRegions(h);

  await dragFromTray(h, ARM_SLOT, ORIGIN);
  await dragFromTray(h, RISE_SLOT, WEST);
  const calls = await h.frameCalls();
  const after = await readRegions(h);
  const built = await h.snapshot();

  return {
    screen: opened.screen,
    speed: { before: SLOWEST, after: speed },
    parts: {
      before: empty.editor.parts.length,
      after: built.editor.parts.length,
    },
    run: { cycle: ran.sim?.cycle, status: ran.sim?.status },
    regions: REGIONS.map((entry, i) => ({
      ...entry,
      before: before[i] as PixelRect,
      after: after[i] as PixelRect,
    })),
    trayText: textIn(calls, TRAY_REGION),
    tapeText: textIn(calls, TAPE_REGION),
  };
}

/** The three regions the sentence names, at the extents `specs/editor.md` fixes. */
const REGIONS: readonly { name: string; region: Region }[] = [
  { name: "the field", region: FIELD_REGION },
  { name: "the tray", region: TRAY_REGION },
  { name: "the tape panel", region: TAPE_REGION },
];

/** Each of the three regions, as the frame on the canvas drew it. */
async function readRegions(h: Harness): Promise<PixelRect[]> {
  const read: PixelRect[] = [];
  for (const { region } of REGIONS) {
    read.push(await h.pixelRect(region.x, region.y, region.w, region.h));
  }
  return read;
}
