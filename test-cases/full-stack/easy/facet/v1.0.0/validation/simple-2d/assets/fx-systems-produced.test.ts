// assets/fx-systems-produced — the four produced particle systems ship with the
// build, and each of them actually emits.
//
// specs/assets.md, "Particle systems — particle-2d": "Produce these four" — the
// clear burst, the flawed detonation, the cut-gem flash, and the cut aura that
// runs at every `brilliant`, `star` and `prism` standing on the board — authored
// with `particle-2d`, whose "render step writes the `system.json` that is the
// asset", landed under `public/assets/fx/`. The same section rules out the
// substitute: "Individual particles are not placed and frames are not baked", and
// the closing list refuses a build that "paints a flat colored flash in place of
// the produced particle systems" or "leaves a cut stone standing still".
//
// WHY THE SYSTEMS ARE SIMULATED HERE. A `system.json` is not a picture, so
// nothing about a file's bytes says whether it is an effect or an empty shell. It
// is a system of "emitters, forces, and per-particle curves that is simulated
// live", and the only reading that decides that is to simulate it — with
// `@clockwyrks/particle-runtime`, which specs/assets.md names as the runtime
// the build plays them through and which is a dependency of the project already.
// A file that the runtime cannot construct a simulator from is not a produced
// system, and a system that emits no particle over its own whole duration is not
// an effect.
//
// WHY A REJECTED FILE IS NAMED IN THE FAILURE. An unplayable file and a broken
// runtime both leave the count short, and the count alone cannot tell them
// apart: a build whose systems are fine, read against a runtime that throws,
// would report the same `0` as a build that shipped four empty shells. So the
// reason each rejected file was turned away is kept as it is found and the first
// of them are named on the `Expected:` line, where a reviewer reads the verdict.
// Evidence only — the count is still the whole of the verdict.
//
// WHY THE CONTENTS ARE HASHED. Four files that are copies of one system are one
// effect under four names, and the specification asks for four that differ from
// one another in what they throw. Byte-identical files are counted once.
//
// WHAT IS NOT ASKED. Which file is which effect, how many particles each throws,
// and how heavy one is against another. specs/assets.md fixes no file name here,
// and its "visibly bigger and more violent" is a reviewer's reading rather than a
// figure. The systems also "vary from play to play, and that variation is
// correct", so nothing here compares one play against another.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import {
  ParticleSimulator,
  type ParticleSystem,
  type RenderParticle,
} from "@clockwyrks/particle-runtime";
import { assertGreaterThanOrEqual, assertNotNull, fail } from "../assert";
import { FX_DIR, REQUIRED_FX_SYSTEMS } from "../constants";
import { mediaDestination, siteRoot } from "../harness";

/**
 * How the systems are stepped: the size of a simulated frame, the least a system
 * is driven for, and the longest span one is driven for.
 *
 * A whole frame at a common rate, and a span generous enough to cover any effect
 * a chain step throws. Each system is driven over its own declared `durationMs`,
 * held to at least the floor below: three of the four are one-shots that throw
 * everything inside their own duration, and the fourth "runs on rather than
 * firing once", so a continuous emitter is given a stretch of time to emit in
 * rather than a single frame.
 */
const STEP_MS = 16;
const MIN_SPAN_MS = 1_000;
const MAX_SPAN_MS = 4_000;

/** One produced system, and the most particles a play of it held at once. */
interface Effect {
  path: string;
  system: ParticleSystem;
  peak: RenderParticle[];
}

/** One file that counted toward nothing: what to call it, and why it did. */
interface Rejection {
  name: string;
  why: string;
}

/** Every file below `root` whose name ends in `.json`, in path order. */
function jsonUnder(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root).sort()) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) found.push(...jsonUnder(path));
    else if (entry.toLowerCase().endsWith(".json")) found.push(path);
  }
  return found;
}

/**
 * Simulate one system and keep the busiest instant of the play, or answer `null`
 * when the file is not a system the runtime can play at all — recording why into
 * `rejected` when it is not.
 *
 * The play is driven from the system's own start over its own duration, so a
 * one-shot is read across the whole of the burst it declares rather than at an
 * instant that might fall before or after it.
 *
 * THE WHOLE PLAY IS GUARDED, not the construction alone. "A file that the
 * runtime cannot construct a simulator from is not a produced system" is one
 * half of what this function answers `null` for; the other is a file the runtime
 * constructs and then cannot step — a system.json missing a field the runtime
 * reads only once a particle is alive throws out of `step` or `capture` rather
 * than out of the constructor. Both are the same verdict, an unplayable file
 * that counts toward nothing, and letting the second escape would report the
 * item as a raw `TypeError` instead of as the count it fell short of.
 *
 * THE THROW IS KEPT EVEN SO. Catching it is what makes the item report a count;
 * writing the message down beside the file it came from is what keeps a broken
 * runtime distinguishable from a badly authored system.json, which a bare `0`
 * would not be. The third reason a file counts for nothing — it plays, and
 * throws no particle at all — is recorded the same way.
 */
function play(
  path: string,
  name: string,
  rejected: Rejection[],
): Effect | null {
  try {
    const system = JSON.parse(readFileSync(path, "utf8")) as ParticleSystem;
    const simulator = new ParticleSimulator(system);
    // The zero-time bursts have already fired at construction, so the opening
    // instant counts: a one-shot that throws everything at once is at its
    // busiest before a frame has run.
    let peak = simulator.capture();
    const span = Math.min(
      Math.max(system.durationMs ?? 0, MIN_SPAN_MS),
      MAX_SPAN_MS,
    );
    for (let elapsed = 0; elapsed < span; elapsed += STEP_MS) {
      simulator.step(STEP_MS);
      const live = simulator.capture();
      if (live.length > peak.length) peak = live;
    }
    if (peak.length === 0) {
      rejected.push({ name, why: "played, but threw no particle" });
      return null;
    }
    return { path, system, peak };
  } catch (error) {
    rejected.push({ name, why: String(error) });
    return null;
  }
}

/**
 * The rejected files, worded for the `Expected:` line, or nothing at all when
 * every file played.
 *
 * The first two by name, since a pair is enough to tell a runtime that throws on
 * everything from one file a build authored badly, and the rest counted.
 */
function describeRejections(rejected: readonly Rejection[]): string {
  if (rejected.length === 0) return "";
  const named = rejected
    .slice(0, 2)
    .map((rejection) => `${rejection.name}: ${rejection.why}`)
    .join("; ");
  const rest =
    rejected.length > 2 ? `, and ${rejected.length - 2} more like them` : "";
  return `; turned away ${named}${rest}`;
}

/**
 * The busiest instant of each system, side by side, as the item's evidence.
 *
 * Each particle is drawn as the disc the runtime's own canvas binding draws, at
 * its captured size, color and opacity, in the field the system declares. Its
 * linear color is gamma-encoded on the way out so the picture reads as the game
 * composites it. Evidence only: nothing here decides the verdict.
 */
function writeSystemSheet(outputId: string, effects: readonly Effect[]): void {
  const destination = mediaDestination(outputId, "png");
  if (destination === null || effects.length === 0) return;
  const cell = 240;
  try {
    const canvas = createCanvas(cell * effects.length, cell);
    const context = canvas.getContext("2d");
    context.fillStyle = "#15151a";
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (const [index, effect] of effects.entries()) {
      const field = effect.system.field;
      const scale = Math.min(
        cell / (field.width || 1),
        cell / (field.height || 1),
      );
      const originX = index * cell + (cell - field.width * scale) / 2;
      const originY = (cell - field.height * scale) / 2;
      for (const particle of effect.peak) {
        const [r, g, b] = particle.color.map((channel) =>
          Math.round(255 * Math.min(1, Math.max(0, channel)) ** (1 / 2.2)),
        );
        context.fillStyle = `rgba(${r}, ${g}, ${b}, ${particle.opacity})`;
        context.beginPath();
        context.arc(
          originX + particle.position[0] * scale,
          originY + particle.position[1] * scale,
          Math.max(0.5, particle.size * scale * 0.5),
          0,
          Math.PI * 2,
        );
        context.fill();
      }
    }
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, canvas.toBuffer("image/png"));
  } catch (error) {
    console.warn(`facet: could not write ${destination}: ${String(error)}`);
  }
}

it("ships four distinct particle systems the runtime plays", () => {
  const root = siteRoot();
  assertNotNull(root, "the built site, or the committed public/ tree");
  const fx = join(root as string, ...FX_DIR);
  if (!existsSync(fx)) {
    fail(`a produced ${FX_DIR.join("/")}/ directory under ${root}`, "absent");
  }

  const byHash = new Map<string, Effect>();
  const rejected: Rejection[] = [];
  for (const path of jsonUnder(fx)) {
    const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
    if (byHash.has(hash)) continue;
    const effect = play(path, path.slice(fx.length + 1), rejected);
    if (effect !== null) byHash.set(hash, effect);
  }
  const effects = [...byHash.values()];
  writeSystemSheet("systems", effects);

  assertGreaterThanOrEqual(
    effects.length,
    REQUIRED_FX_SYSTEMS,
    "distinct produced system.json files under assets/fx/ that " +
      "@clockwyrks/particle-runtime plays and that emit a particle" +
      describeRejections(rejected),
  );
});
