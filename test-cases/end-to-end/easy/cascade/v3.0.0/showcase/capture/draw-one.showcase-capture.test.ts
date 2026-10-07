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
// The deal is the game's own, so a capture is an audition: several takes are
// played, each on the deal the game dealt, and the best of the ones the planner
// could win is the one kept. `showcase/capture/README.md` records how the
// committed take was chosen.

import { inject, it } from "vitest";
import { auditionTakes, knob, DEFAULT_PACE } from "./showcase-player";

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

/**
 * How many won takes are played before one is chosen, and how many deals may
 * be dealt looking for them. A deal the planner cannot win costs a page load and
 * a search and nothing more, so the deal budget is generous.
 */
const TAKES = 3;
const DEALS = 600;

it(
  "plays whole games of Draw One and records the best of them",
  async () => {
    const search = {
      maxMoves: knob("TCAB_SHOWCASE_MAX_MOVES", MAX_MOVES),
      maxNodes: knob("TCAB_SHOWCASE_MAX_NODES", MAX_NODES),
      weight: knob("TCAB_SHOWCASE_WEIGHT", WEIGHT),
    };

    const audition = await auditionTakes(
      inject("tcabBrowserWs"),
      inject("tcabUrl"),
      {
        turnCount: TURN_COUNT,
        outDir: process.env.TCAB_SHOWCASE_OUT,
        takes: knob("TCAB_SHOWCASE_TAKES", TAKES),
        deals: knob("TCAB_SHOWCASE_DEALS", DEALS),
        search,
        pace: DEFAULT_PACE,
        bitrate: process.env.TCAB_SHOWCASE_BITRATE ?? "380k",
        midStillAt: knob("TCAB_SHOWCASE_MID_STILL", 0.3),
        verbose: process.env.TCAB_SHOWCASE_VERBOSE === "1",
        report: (take, report) => {
          process.stdout.write(
            `draw-one take ${take}: ${report.moves} gestures, ${report.seconds}s, ` +
              `${report.turns} turns (longest run ${report.longestTurnRun}, ` +
              `${report.recycles} recycles), ${report.drags} drags, ` +
              `longest lull ${report.longestLull}s\n`,
          );
        },
      },
    );

    process.stdout.write(
      `draw-one: ${audition.played.length} of ${audition.dealt} deals won` +
        (audition.winner >= 0
          ? `, kept take ${audition.winner + 1}` +
            (process.env.TCAB_SHOWCASE_OUT !== undefined
              ? ` in ${process.env.TCAB_SHOWCASE_OUT}`
              : "")
          : "") +
        "\n",
    );
    if (audition.winner < 0) {
      throw new Error(
        `cascade: none of ${audition.dealt} deals could be won inside ${search.maxMoves} gestures`,
      );
    }
  },
  4 * 60 * 60_000,
);
