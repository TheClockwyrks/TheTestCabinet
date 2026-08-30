// Deepcore — economy.fill-stops-at-the-credits. STUB: NOT YET AUTHORED.
//
// Filling to full stops when the Credits run out
//
// Fill-to-full buys only as far as the Credits reach, so a miner with 20
// Credits and a tank 60 short leaves with 20 more fuel and a balance of 0
// rather than a refused purchase or a debt.
//
// Automated validation: pose a tank short by more than the balance can cover,
// fill to full and hold the fuel gained against the balance and the balance at
// 0.
//
// `test-case.toml` declares this suite as `economy/fill-stops-at-the-credits.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (short (image)) around the drive.

import { test } from "vitest";

test("Filling to full stops when the Credits run out", () => {
  throw new Error(
    "Deepcore validator `economy/fill-stops-at-the-credits` is declared in test-case.toml but has not been authored yet.",
  );
});
