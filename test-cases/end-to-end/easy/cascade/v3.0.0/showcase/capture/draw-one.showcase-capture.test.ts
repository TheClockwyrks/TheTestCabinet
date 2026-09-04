// Cascade — the showcase capture for the DRAW ONE variant. CAPTURE-ONLY.
//
// It is a vitest file so that it can borrow the validator project's own
// scaffolding: `globalSetup.ts` serves the reference build's `dist/` and starts
// the one Chromium, and `chromium.ts` finds that Chromium on whatever host this
// is run on. It is not a validator, it is staged into the reference workspace by
// hand (see `showcase/capture/README.md`), and nothing in `test-case.toml` names
// it.
//
// WHAT IT WRITES, into `TCAB_SHOWCASE_OUT`:
//
//   cascade-solved.webm   the leading entry: one game played from the deal to
//                         the victory cascade
//   mid-play.png          the table partway through that same game
//   the-cascade.png       the cascade burying the table, from the same game
//   title.png             the title screen the take opened on
//
// The committed seed is recorded in `showcase/capture/README.md` beside the
// takes it was chosen over.

import { inject, it } from "vitest";
import {
  captureTake,
  knob,
  sweepPlans,
  sweepRange,
  DEFAULT_PACE,
} from "./showcase-player";

/**
 * The deal the committed clip plays.
 *
 * Chosen by auditioning: every seed whose game the planner could win inside the
 * move budget was scored on how long the take runs, how long its longest stretch
 * of nothing but stock turns is, and how much of it is cards moving between
 * columns rather than off the stock. See `showcase/capture/README.md`.
 */
const SEED = knob("TCAB_SHOWCASE_SEED", 13);

/** One card a turn, which is what makes this variant Draw One. */
const TURN_COUNT = 1;

/**
 * How the plan is looked for.
 *
 * `MAX_MOVES` is the ceiling on a plan's length in gestures, and it is the
 * search's main prune as well as the clip's budget: at this pace a gesture is
 * about a third of a second, so a hundred of them is a little over half a
 * minute of play once the title screen, the deal and the cascade are added.
 * Lowering it makes the search quicker AND pickier, and finds fewer deals.
 */
const MAX_MOVES = 100;
const MAX_NODES = 70_000;
const WEIGHT = 3;

it(
  "plays a whole game of Draw One and records it",
  async () => {
    const search = {
      maxMoves: knob("TCAB_SHOWCASE_MAX_MOVES", MAX_MOVES),
      maxNodes: knob("TCAB_SHOWCASE_MAX_NODES", MAX_NODES),
      weight: knob("TCAB_SHOWCASE_WEIGHT", WEIGHT),
    };

    // The first pass of an audition: score the plans over a range of seeds and
    // stop. No browser is opened and nothing is played.
    const sweep = process.env.TCAB_SHOWCASE_SWEEP;
    if (sweep !== undefined && sweep !== "") {
      const { from, to } = sweepRange(sweep);
      const scored = sweepPlans(from, to, TURN_COUNT, search);
      process.stdout.write(
        `${scored.length} of ${to - from + 1} seeds solved inside ${search.maxMoves} gestures\n`,
      );
      return;
    }

    const seeds = (process.env.TCAB_SHOWCASE_SEEDS ?? String(SEED))
      .split(",")
      .map((entry) => Number(entry.trim()))
      .filter((entry) => Number.isFinite(entry));
    const record =
      process.env.TCAB_SHOWCASE_RECORD !== "0" && seeds.length === 1;
    const outDir = process.env.TCAB_SHOWCASE_OUT;

    for (const seed of seeds) {
      const report = await captureTake(
        inject("cascadeBrowserWs"),
        inject("cascadeUrl"),
        {
          turnCount: TURN_COUNT,
          seed,
          outDir: record ? outDir : undefined,
          record,
          search,
          pace: DEFAULT_PACE,
          bitrate: process.env.TCAB_SHOWCASE_BITRATE ?? "380k",
          midStillAt: knob("TCAB_SHOWCASE_MID_STILL", 0.3),
          verbose: process.env.TCAB_SHOWCASE_VERBOSE === "1",
        },
      );
      process.stdout.write(
        `draw-one seed ${report.seed}: ${report.moves} gestures, ${report.seconds}s, ` +
          `longest lull ${report.longestLull}s, longest turn run ${report.longestTurnRun}` +
          (report.files.length > 0
            ? `, wrote ${report.files.join(", ")}`
            : "") +
          "\n",
      );
    }
  },
  60 * 60_000,
);
