#!/usr/bin/env node
// Node smoke test for the Foray browser-playback ABI — the REQUIRED gate before
// the renderer ships. It instantiates `foray-core.wasm` (the exact artifact the
// browser loads) through the same hand-rolled C ABI the renderer uses, loads a
// replay, steps to the end, and asserts:
//
//   * the ABI round-trips state JSON (alloc/replay_load/replay_board/replay_step),
//   * every per-tick snapshot is plausible (6 agents in-bounds, monotonic tick,
//     non-decreasing scores, valid roles),
//   * the reconstruction REACHES THE COMMITTED RESULT (winner/score/ended/ticks),
//   * replay_reset rewinds so playback can loop.
//
// This validates the wasm ABI + foray-core reconstruction WITHOUT a browser.
// Usage: `node smoke-test.mjs [path/to/replay.json] [path/to/foray-core.wasm]`

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const replayPath = process.argv[2] || join(here, "replay.json");
const wasmPath = process.argv[3] || join(here, "assets", "foray-core.wasm");

let failures = 0;
function check(cond, msg) {
  if (!cond) {
    console.error("  FAIL:", msg);
    failures++;
  }
}

function unpack(packed) {
  const v = BigInt.asUintN(64, packed);
  return { ptr: Number(v >> 32n), len: Number(v & 0xffffffffn) };
}

async function main() {
  const replay = JSON.parse(readFileSync(replayPath, "utf8"));
  const wasm = readFileSync(wasmPath);
  const { instance } = await WebAssembly.instantiate(wasm, {});
  const x = instance.exports;
  const mem = () => x.memory;

  // Sanity: the expected exports exist.
  for (const fn of ["alloc", "replay_load", "replay_board", "replay_step", "replay_reset"]) {
    check(typeof x[fn] === "function", `export ${fn} present`);
  }

  const readJson = (packed) => {
    const { ptr, len } = unpack(packed);
    if (len === 0) return null;
    const bytes = new Uint8Array(mem().buffer, ptr, len);
    return JSON.parse(new TextDecoder().decode(bytes));
  };

  // Load the replay through alloc + replay_load.
  const json = new TextEncoder().encode(JSON.stringify(replay));
  const ptr = x.alloc(json.length);
  new Uint8Array(mem().buffer, ptr, json.length).set(json);
  check(x.replay_load(ptr, json.length) === 1, "replay_load returned ok (1)");

  // The static board.
  const board = readJson(x.replay_board());
  check(board && board.width > 0 && board.height > 0, "board has positive dimensions");
  check(
    board.border_x > 0 && board.border_x < board.width,
    "border_x is between the side walls",
  );
  check(Array.isArray(board.walls), "board carries a walls list");
  check(Array.isArray(board.jelly_nodes), "board carries the jelly-node list");
  const wallSet = new Set(board.walls.map(([wx, wy]) => `${wx},${wy}`));

  // Step every frame, validating each snapshot.
  let frames = 0;
  let prevTick = -1;
  let prevRed = 0;
  let prevBlue = 0;
  let lastSnap = null;
  const validRoles = new Set(["soldier", "raider"]);
  let packed;
  while ((packed = x.replay_step()) !== 0n) {
    const snap = readJson(packed);
    frames++;
    lastSnap = snap;

    check(snap.tick > prevTick, `tick is monotonic at frame ${frames} (${snap.tick} > ${prevTick})`);
    prevTick = snap.tick;

    check(snap.agents.length === 6, `frame ${snap.tick}: six agents (3 per side)`);
    const redCount = snap.agents.filter((a) => a.team === "red").length;
    check(redCount === 3, `frame ${snap.tick}: three red agents`);

    for (const a of snap.agents) {
      check(
        a.x >= 0 && a.x < board.width && a.y >= 0 && a.y < board.height,
        `frame ${snap.tick}: agent ${a.team}:${a.id} in bounds`,
      );
      check(!wallSet.has(`${a.x},${a.y}`), `frame ${snap.tick}: agent ${a.team}:${a.id} not in a wall`);
      check(validRoles.has(a.role), `frame ${snap.tick}: agent role is valid (${a.role})`);
      // Role must match the half the agent stands on (renderer relies on this).
      const expected = a.x < board.border_x ? a.team === "red" : a.team === "blue";
      check(
        (a.role === "soldier") === expected,
        `frame ${snap.tick}: agent ${a.team}:${a.id} role matches its half`,
      );
    }

    check(snap.score.red >= prevRed, `frame ${snap.tick}: red score non-decreasing`);
    check(snap.score.blue >= prevBlue, `frame ${snap.tick}: blue score non-decreasing`);
    prevRed = snap.score.red;
    prevBlue = snap.score.blue;

    for (const [sx, sy] of snap.seeds) {
      check(!wallSet.has(`${sx},${sy}`), `frame ${snap.tick}: seed not in a wall`);
    }

    if (frames > 100000) {
      check(false, "stepped past a sane frame ceiling — possible non-termination");
      break;
    }
  }

  check(frames > 0, "stepped at least one frame");
  check(lastSnap && lastSnap.result, "the final frame carries a decided result");

  // The reconstruction must reach the COMMITTED result.
  const committed = replay.result;
  const got = lastSnap.result;
  check(got.winner === committed.winner, `winner matches committed (${got.winner} === ${committed.winner})`);
  check(got.ended === committed.ended, `ended matches committed (${got.ended} === ${committed.ended})`);
  check(got.ticks === committed.ticks, `ticks match committed (${got.ticks} === ${committed.ticks})`);
  check(
    got.score.red === committed.score.red && got.score.blue === committed.score.blue,
    `final score matches committed (${JSON.stringify(got.score)} === ${JSON.stringify(committed.score)})`,
  );
  check(frames === committed.ticks, `frame count equals committed ticks (${frames} === ${committed.ticks})`);

  // replay_reset rewinds: the first stepped frame must match the very first frame.
  x.replay_reset();
  const firstAgain = readJson(x.replay_step());
  check(firstAgain && firstAgain.tick === 1, `replay_reset rewinds to the first frame (tick ${firstAgain && firstAgain.tick})`);

  console.log(
    `\n${failures === 0 ? "PASS" : "FAIL"}: stepped ${frames} frames; ` +
      `committed result = ${committed.winner ?? "draw"}/${committed.ended}/${committed.ticks} ticks, ` +
      `score red ${committed.score.red} blue ${committed.score.blue}`,
  );
  if (failures > 0) {
    console.error(`${failures} assertion(s) failed`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("smoke test threw:", err);
  process.exit(1);
});
