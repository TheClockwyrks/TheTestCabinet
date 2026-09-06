// Refract — cascade/boards-are-solvable: every generated board is solvable.
//
// specs/modes/cascade.md "The generator": every board the generator emits is
// solvable under the rules in specs/beams.md — a board reaches the player only
// when a set of beams satisfying every rule is known to exist for it. The
// check proves it the only honest way: the generator is asked for five boards
// at every tier through `generateBoard` (specs/instrumentation.md), and each
// is SOLVED for real — snapshot the arrived board, run the spec-derived
// solver, trace the found beams through the build's own limits, assert the
// build agrees it is solved. Five boards at every tier crosses the whole
// ladder, MAX_TIER included. The last board, a MAX_TIER board, is solved on
// camera as the replay.
//
// RESIDUAL RISK, documented: the solver caps its node expansions as a runaway
// stop. A conformant generator could in principle emit a board the search
// cannot crack inside the cap; that failure names the cap so it is read for
// what it is rather than as proof of a dead end. Boards within 7x6 with 1-3
// channels resolve in milliseconds in practice.

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
      if (result.status === "unsolvable") {
        fail(
          `a solvable generated board (specs/modes/cascade.md: every board ` +
            `the generator emits is solvable)`,
          `${at} is unsolvable: ${result.reason ?? "no beam set satisfies the rules"}`,
        );
      }
      if (result.status === "limit") {
        fail(
          `a generated board the spec-derived solver can crack within its ` +
            `expansion cap (a documented residual risk of the cap, not proof ` +
            `of an unsolvable board)`,
          `${at} exhausted ${result.expansions} expansions`,
        );
      }

      if (tier !== MAX_TIER || round !== PER_TIER) {
        traceBeams(h, result.beams);
        assertEqual(
          h.snapshot().solved,
          true,
          `${at} solved by the solver's beams`,
        );
        return;
      }

      // The last board, on camera: channel by channel, a frame between, so
      // the recording shows the solve arriving rather than one finished still.
      await captureReplay(h, "solve", async () => {
        for (const channel of CHANNELS) {
          const cells = result.beams[channel];
          if (cells === undefined || cells.length === 0) continue;
          traceCells(h, cells);
          await h.advance(1);
        }
        assertEqual(
          h.snapshot().solved,
          true,
          `${at} solved by the solver's beams`,
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
