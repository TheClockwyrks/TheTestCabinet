// assets/fx-systems-loaded — the running build loads its three produced particle
// systems from its own served `assets/fx/` directory.
//
// specs/assets.md: "Every produced file is loaded at runtime", and of the systems
// in particular, "Play them with the provided runtime ... construct one from a
// parsed `system.json` and your 2D canvas context". A `system.json` sitting in
// the tree that the game never reads is a file rather than an effect, and this is
// the reading that tells the two apart.
//
// WHAT IS READ. Every request the build made, from the moment it started to the
// end of a chain driven through it. Three distinct files under `assets/fx/` have
// to have been asked for, and none of them may have failed to arrive.
//
// WHY A CHAIN IS DRIVEN RATHER THAN THE OPENING FRAMES READ. A build is entitled
// to fetch a system when it first needs it rather than at start-up, so a check
// that read only the load would fail a build that loads lazily and is otherwise
// conformant. The chain the scenario drives throws all three of the effects
// specs/assets.md names: the run clears four cells, so the clear burst is thrown;
// one of the four stands at `MAX_STRAIN`, so the flawed detonation is thrown
// where it clears; and the run is maximal at exactly four, so R8 creates a
// `brilliant` and the cut-gem flash is thrown where it arrives. Whichever moment
// a build reaches for its systems at, it has reached for all three by the end.
//
// WHY THE PATHS ARE COUNTED DISTINCTLY. The three effects are three systems, and
// a build that asked for one file three times has loaded one effect. The count is
// over distinct served paths below `assets/fx/`, so a build that asks for the
// same system twice is counted once.
//
// WHAT IS NOT ASKED. Which file is which effect, when in the drive each was
// fetched, and how a build composites what it got. specs/assets.md fixes no file
// name here, and how the runtime is driven is `assets/fx-systems-produced`'s
// question about the files themselves.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, assertLength } from "../assert";
import { MAX_STRAIN } from "../constants";
import {
  clearSetFromRuns,
  maximalRuns,
  quietRowsWithEscape,
  strainAt,
  swapped,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureStill,
  createHarness,
  loadBoard,
  swapAndResolve,
  type Harness,
} from "../harness";

/** The clear burst, the flawed detonation, and the cut-gem flash. */
const REQUIRED_SYSTEMS = 3;

/** The served directory specs/assets.md lands the particle systems under. */
const FX_SEGMENTS = ["assets", "fx"];

/** The kind the run is made of, and how many cells it holds. */
const RUN_KIND = "ruby";
const RUN_LENGTH = 4;

/**
 * The cells written over the filler.
 *
 * Three rubies stand in row 3 at columns 3, 4 and 6 and the fourth waits at
 * (5,2), so the swap that drops it in completes a run maximal at exactly four —
 * which is the R8 row that creates a `brilliant`. The ruby at (4,3) is at
 * `MAX_STRAIN`, so one of the four cells the step clears is a flawed gem. One
 * swap therefore throws every effect the specification asks for.
 */
const CELLS: readonly PlacedToken[] = [
  { col: 3, row: 3, token: "R0" },
  { col: 4, row: 3, token: "R3" },
  { col: 6, row: 3, token: "R0" },
  { col: 5, row: 2, token: "R0" },
];

/** The swap: the waiting ruby drops from (5,2) into the gap at (5,3). */
const FROM: CellRef = { col: 5, row: 2 };
const TO: CellRef = { col: 5, row: 3 };

/**
 * The produced system a request names, or `null` when it names none.
 *
 * A request is read as its path segments so the same reading serves a URL the
 * page asked the network for and a page-relative path a loader was handed. What
 * is answered is the path from `assets/fx/` down, which is how specs/assets.md
 * names a produced file: "a file committed at `public/assets/gems/ruby.png` is
 * served at `assets/gems/ruby.png` beside the page".
 */
function fxAsset(request: string): string | null {
  const segments = request.split(/[?#]/u)[0].split("/");
  for (let at = 0; at + 2 < segments.length; at += 1) {
    if (
      segments[at] === FX_SEGMENTS[0] &&
      segments[at + 1] === FX_SEGMENTS[1] &&
      segments[at + 2] !== ""
    ) {
      return segments.slice(at).join("/");
    }
  }
  return null;
}

/** Every distinct produced system named among `requests`. */
function fxAssets(requests: readonly string[]): string[] {
  const named = new Set<string>();
  for (const request of requests) {
    const asset = fxAsset(request);
    if (asset !== null) named.add(asset);
  }
  return [...named].sort();
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fetches three distinct particle systems from its own assets/fx/", async () => {
  const posed = quietRowsWithEscape(CELLS);

  // The scenario, established before the build is asked anything: the posed
  // board is at rest, the exchange produces exactly one maximal run of exactly
  // four rubies, the step's clear set is those four cells alone, and one of them
  // is flawed. So the chain throws a clear burst, a flawed detonation and the
  // flash of the `brilliant` R8 creates, and nothing else is going on.
  assertLength(maximalRuns(posed), 0, "maximal runs on the posed board");
  assertEqual(strainAt(posed, 4, 3), MAX_STRAIN, "the strain at (4,3)");
  const exchanged = swapped(posed, FROM, TO);
  const produced = maximalRuns(exchanged);
  assertLength(produced, 1, "maximal runs the exchange produces");
  assertLength(produced[0].cells, RUN_LENGTH, "cells in the run it produces");
  assertEqual(produced[0].kind, RUN_KIND, "the kind of the run it produces");
  assertLength(
    clearSetFromRuns(exchanged),
    RUN_LENGTH,
    "cells in the clear set the exchange seeds",
  );

  await loadBoard(h, posed);
  const { first } = await swapAndResolve(h, FROM, TO);
  await captureStill(h, "loaded");

  // The swap was accepted and its chain ran, so a build that loads its systems
  // when it first throws one has had every occasion to.
  assertEqual(first.chainStep, 1, "the chain step the swap opened");

  // Three distinct produced systems asked for, and every one of them arrived.
  const loaded = fxAssets(h.requests);
  assertGreaterThanOrEqual(
    loaded.length,
    REQUIRED_SYSTEMS,
    `distinct files under ${FX_SEGMENTS.join("/")}/ the build asked for, ` +
      `of ${JSON.stringify(loaded)}`,
  );
  assertLength(
    h.assetFailures.filter((failure) => fxAsset(failure.path) !== null),
    0,
    "produced particle systems the build asked for and did not get",
  );
});
