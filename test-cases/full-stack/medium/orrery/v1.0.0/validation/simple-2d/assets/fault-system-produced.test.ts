// assets/fault-system-produced — the fault system is produced.
//
// THE RULE, from The particle effects of `specs/assets.md`: "Produce each of these
// with `particle-2d` as a `system.json`, and play it live", and the Fault row names
// the file — `assets/particles/fault.json` — fired at "the position of the mote the
// fault of `specs/simulation.md` names, lowest in `y` and then lowest in `x` among
// them, or the anchor hex of the part it names when it names no mote". Where the
// files land roots the path: "Every produced file sits under `assets/` at the root
// of this repository, at the path named below, and is committed."
//
// WHAT MAKES A FILE A SYSTEM. The runtime, and nothing else: "Play them through
// `@clockwyrks/particle-runtime`, an installed dependency imported by its bare
// name, using its `./canvas` binding: a player is constructed over a parsed system
// and a 2D rendering context ... the package's own types are the authoritative API."
// So this point parses the file as JSON, hands it to the package's own simulator, and
// steps that simulator through the system's own duration. Whatever the runtime
// constructs over and plays without throwing is a system it accepts; no schema is
// restated here, because a schema written here would fail files the runtime happily
// plays.
//
// WHAT THIS POINT DOES NOT READ. Whether the system is authored ONE-SHOT is
// `fault-system-one-shot`, whether it differs from the other two is
// `particle-systems-distinct`, and whether the build PLAYS it through the runtime is
// `particles-played-through-runtime`. Where the fault effect is fired, and on which
// boundary, is the presentation category's.
//
// THE EVIDENCE is the fullest moment of one seeded play, plotted from the runtime's
// own captured particles. A file the runtime would not take leaves an empty ground
// with the file's name on it, which is the reading this point then fails with.

import { it } from "vitest";
import { fail } from "../assert";
import { PARTICLE_FILES, readSystem, showParticleSystem } from "./particles";

it("commits a fault.json the particle runtime accepts", async () => {
  const file = PARTICLE_FILES.fault;
  const read = await readSystem(file);
  showParticleSystem("system", file, read.particles);

  if (read.system === null) {
    fail(
      `a particle system @clockwyrks/particle-runtime accepts at ${file}`,
      read.reason,
    );
  }
});
