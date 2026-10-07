// Refract — cascade/boards-are-solvable: every generated board is solvable.
//
// specs/modes/cascade.md "The generator": every board the generator emits is
// solvable under the rules in specs/beams.md — a board reaches the player only
// when a set of beams satisfying every rule is known to exist for it. The
// check proves it the only honest way: it SOLVES the boards for real. The
// generator is asked for five boards at every tier through `generateBoard`
// (specs/instrumentation.md), and each is read off the snapshot, solved by the
// solver, and the found beams drawn through the pointer operations; the game's
// own R9 is what says each board is solved.
//
// Documented residual risk: the solver is capped (DEFAULT_MAX_EXPANSIONS, a
// generous runaway stop), so a conformant generator could in principle emit a
// board the cap abandons; a `limit` verdict is reported distinctly from
// `unsolvable`. Every board within the tier ladder's stated shapes resolves
// in milliseconds in practice.
//
// The replay records the last board — a MAX_TIER board — being solved: the
// recorder is armed around that solve alone, never around the boards before it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import {
  captureReplay,
  createHarness,
  generateAtTiers,
  resetTo,
  traceBeams,
  traceCells,
  type Harness,
} from "../harness";
import { CHANNELS, MAX_TIER } from "../notation";
import { solve } from "../solver";

const PER_TIER = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("solves five generated boards at every tier, the last on camera", async () => {
  await resetTo(h);

  const generated = await generateAtTiers(
    h,
    PER_TIER,
    async ({ tier, round, board }) => {
      const at = `tier ${tier}, board ${round}`;
      const result = solve(board);
      if (result.status !== "solved") {
        fail(
          "a solvable generated board (specs/modes/cascade.md: every board " +
            "the generator emits is solvable; the spec-derived solver " +
            `reported '${result.status}' after ${result.expansions} ` +
            `expansions on ${at})`,
          board,
        );
      }

      if (tier !== MAX_TIER || round !== PER_TIER) {
        traceBeams(h, result.beams);
        assertEqual(
          h.snapshot().solved,
          true,
          `${at} is solved by the solver's beams (specs/beams.md R9)`,
        );
        return;
      }

      // The last board, on camera: channel by channel, a frame between, so
      // the recording shows the solve arriving rather than one finished still.
      await captureReplay(h, "solve", async () => {
        for (const channel of CHANNELS) {
          const beam = result.beams[channel];
          if (beam === undefined || beam.length === 0) continue;
          traceCells(
            h,
            beam.map((cell) => ({ col: cell.col, row: cell.row })),
          );
          await h.advance(1);
        }
        assertEqual(
          h.snapshot().screen,
          "solved",
          `${at} is solved by the solver's beams (specs/beams.md R9)`,
        );
        await h.advance(2);
      });
    },
  );

  assertEqual(
    generated.length,
    MAX_TIER * PER_TIER,
    "boards generated across the ladder",
  );
});
