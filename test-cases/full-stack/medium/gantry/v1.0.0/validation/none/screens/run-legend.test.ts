// run — the run screen carries a legend for the utilization ramp.
//
// `specs/ui.md` § Run lists among the run screen's readouts "A legend for the
// utilization ramp (`specs/overview.md`), so the member coloring reads." The
// ramp itself is the build's: `specs/overview.md` leaves the art direction to it
// and states only what a player must read at a glance — "each member's color
// reads its utilization on a monotone ramp from slack to its limit". So what can
// be decided here is that the ramp is DRAWN somewhere as a ramp, and not what
// colours it runs between.
//
// WHAT IS READ, AND WHERE. `specs/overview.md` fixes where a readout lives:
// "the 3D viewport fills the stage, and over it the screen-space readouts are
// drawn on a 2D layer composited on top of the picture, laid out in logical stage
// units." So the legend is on that 2D layer, and reading its pixels reads the
// legend without reading a single member: the members are in the picture
// underneath, which is a different surface. That is also what satisfies the
// "away from the members" half of the requirement — a colour found on the readout
// layer is by construction not a member's.
//
// WHAT COUNTS AS A RAMP. A run of adjacent opaque pixels, across a row or down a
// column, whose colour walks smoothly — no step larger than `MAX_STEP` in any
// channel — through at least `MIN_SHADES` different colours over at least
// `MIN_LENGTH` logical units, travelling at least `MIN_TRAVEL` in some channel
// end to end. A bar of discrete swatches and a bar painted as a gradient both
// read that way; a solid panel, a rule, and antialiased text do not, being either
// one colour or a jump between two.
//
// THE FIGURES ARE THIS FILE'S, NOT THE SPECIFICATION'S, and that is the honest
// limit of this check: `specs/ui.md` asks for a legend and fixes neither its
// size, its form, nor its colours. They are set where a legend a player could
// read a ramp off passes and an ordinary panel does not.
//
// THE RUN IS AN ISOLATED ONE — the minimal crane, an empty yard, one long slew —
// because the legend is a fixture of the run screen rather than of any
// particular run.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue, fail } from "../assert";
import { SLEW_MAX_RATE } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Something for the run to be doing while the run screen is read. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "slew", target: 253, rate: SLEW_MAX_RATE }],
  },
];

/**
 * Ticks into the run, so every member has been solved and coloured.
 *
 * TWO, BECAUSE THE SOLVE IS THE RUN'S FIRST. `run.forces` "is empty until a
 * run's first solve" (specs/instrumentation.md), which the first tick runs, and
 * the second tick is there for a build that draws the solve the tick before it
 * reached. The legend is a fixture of the run screen rather than of any
 * particular tick, so nothing later in the run is what this reads.
 */
const SETTLE = 2;

/** What a run of pixels has to do to read as a ramp. */
const MIN_LENGTH = 48;
const MIN_SHADES = 8;
const MIN_TRAVEL = 48;
const MAX_STEP = 24;

/** Below this alpha the readout layer is showing the picture underneath. */
const OPAQUE = 200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** One run of pixels that reads as a ramp, or `null` where there is none. */
interface Ramp {
  across: "row" | "column";
  at: number;
  from: number;
  length: number;
  shades: number;
  travel: number;
}

/**
 * The longest ramp the readout layer draws, or `null`.
 *
 * The layer is found as the canvas the page will hand a 2D context for: an
 * engineless build draws its picture through WebGL and its readouts on the 2D
 * layer `specs/overview.md` requires over it, and a WebGL canvas hands back no
 * 2D context at all.
 */
async function longestRamp(harness: Harness): Promise<Ramp | null> {
  return harness.page.evaluate(
    ([minLength, minShades, minTravel, maxStep, opaque]) => {
      interface Found {
        across: "row" | "column";
        at: number;
        from: number;
        length: number;
        shades: number;
        travel: number;
      }
      let best: Found | null = null;

      const scan = (
        across: "row" | "column",
        at: number,
        pixels: readonly (readonly [number, number, number, number])[],
      ): void => {
        let start = 0;
        let shades = 1;
        for (let index = 1; index <= pixels.length; index += 1) {
          const here = pixels[index];
          const before = pixels[index - 1]!;
          const broken =
            here === undefined ||
            here[3] < opaque ||
            before[3] < opaque ||
            Math.abs(here[0] - before[0]) > maxStep ||
            Math.abs(here[1] - before[1]) > maxStep ||
            Math.abs(here[2] - before[2]) > maxStep;
          if (!broken) {
            if (
              here[0] !== before[0] ||
              here[1] !== before[1] ||
              here[2] !== before[2]
            ) {
              shades += 1;
            }
            const head = pixels[start]!;
            const length = index - start + 1;
            const travel = Math.max(
              Math.abs(here[0] - head[0]),
              Math.abs(here[1] - head[1]),
              Math.abs(here[2] - head[2]),
            );
            if (
              length >= minLength &&
              shades >= minShades &&
              travel >= minTravel &&
              (best === null || length > best.length)
            ) {
              best = { across, at, from: start, length, shades, travel };
            }
            continue;
          }
          start = index;
          shades = 1;
        }
      };

      for (const canvas of Array.from(document.querySelectorAll("canvas"))) {
        let context: CanvasRenderingContext2D | null = null;
        try {
          context = canvas.getContext("2d");
        } catch {
          context = null;
        }
        if (context === null) continue;
        const { data, width, height } = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        );
        const pixelAt = (
          x: number,
          y: number,
        ): readonly [number, number, number, number] => {
          const base = (y * width + x) * 4;
          return [
            data[base]!,
            data[base + 1]!,
            data[base + 2]!,
            data[base + 3]!,
          ];
        };
        for (let y = 0; y < height; y += 1) {
          const row = [];
          for (let x = 0; x < width; x += 1) row.push(pixelAt(x, y));
          scan("row", y, row);
        }
        for (let x = 0; x < width; x += 1) {
          const column = [];
          for (let y = 0; y < height; y += 1) column.push(pixelAt(x, y));
          scan("column", x, column);
        }
      }
      return best;
    },
    [MIN_LENGTH, MIN_SHADES, MIN_TRAVEL, MAX_STEP, OPAQUE] as const,
  );
}

it("draws the utilization ramp as a legend on the run screen", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);
  const state = await runTicks(h, SETTLE);

  assertTrue(
    state.screen === "run" && state.run.phase === "running",
    "the run screen showing a run in progress, so its readouts are the ones " +
      `specs/ui.md lists (screen "${state.screen}", run "${state.run.phase}")`,
  );
  assertTrue(
    state.run.forces.length > 0,
    "the run solving the crane's members, so there are utilizations for a " +
      "ramp to read (specs/statics.md)",
  );

  const ramp = await longestRamp(h);
  if (ramp === null) {
    fail(
      "a legend for the utilization ramp on the run screen: a run of at " +
        `least ${MIN_LENGTH} units carrying at least ${MIN_SHADES} shades and ` +
        `travelling at least ${MIN_TRAVEL} in some channel, drawn on the 2D ` +
        "readout layer over the picture (specs/ui.md, specs/overview.md)",
      "the readout layer draws no such run of colour anywhere across or down " +
        "the stage",
    );
  }

  await h.capture("legend", "The utilization legend on the run screen");
});
