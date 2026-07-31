// Automated validation for the Audio item `nuclear-crack`: a distinct cue plays when a
// heavy isotope decays and sheds a fragment, or reaches a stable nucleus
// (specs/assets.md: "the crack when a heavy or boss splits"). Audio is read from the
// Web Audio sources the build starts (see `api.audio`). Audio is armed with a real
// gesture first, then a real Reactor cracks a heavy isotope — the same set-up
// `fx.split` uses.
//
// The cue is measured across the ONE IMPACT that decays the isotope (`cueOnImpact`), which
// walks the Reactor's fire shot by shot until a decay lands: specs/matter.md pins the chain an
// isotope emits (α α β over 9 shells) but not which hit crosses which decay step, so the
// impact that decays it is found rather than assumed. Measuring the whole window instead would
// grow the log on the Reactor's shot cues alone (specs/assets.md, "the shot cue when a damage
// tower fires") and pass a build with no crack cue at all.
//
// A decay is detected by the EMISSION — a fresh free atom appearing at the isotope — which is
// what specs/matter.md says a decay step is: "each time its shells cross a decay step it emits
// a particle and transmutes into a lighter isotope". It is deliberately NOT detected by the
// "split" burst appearing, even though that burst marks the same event: whether the burst is
// timed correctly is `fx.split`'s verdict, not this one's, and keying off it made this item
// fail a build that plays its crack cue on every decay but flashes its split burst on every
// heavy HIT — the walk then stopped on a hit that had shed nothing, where no cue is due.

import {
  coverAndSpawn,
  armAudio,
  cueOnImpact,
  unitById,
} from "../_helpers.mjs";

const TAIL_TICKS = 90; // 90 ticks = 1.5 s, so the clip shows the flash and the shed particle
// A decay particle is emitted from its parent's own position (specs/board.md), so a fresh atom
// this close to the isotope came off it.
const CREDIT_RADIUS = 60;

export default function item() {
  let unitId;
  let cue;

  return {
    id: "audio.nuclear-crack",

    async arrange(api) {
      ({ unitId } = await coverAndSpawn(api, {
        kind: "reactor",
        type: "isotope",
      }));
      await armAudio(api);
    },

    async act(api) {
      // Every unit already on the board, so only a genuinely NEW one counts as an emission.
      const known = new Set((await api.snapshot()).matter.map((u) => u.id));
      /** True on the sample where the isotope has just shed a particle. */
      const emitted = (s) => {
        const parent = unitById(s, unitId);
        let shed = false;
        for (const u of s.matter) {
          if (known.has(u.id)) continue;
          known.add(u.id);
          if (u.type !== "atom" && u.type !== "noble") continue;
          // Credit it to the isotope while the isotope is still there to credit it to; once
          // the parent has burst on its last decay step, a fresh particle can only have come
          // from it (nothing else on the board makes matter).
          if (
            parent &&
            Math.hypot(u.x - parent.x, u.y - parent.y) > CREDIT_RADIUS
          )
            continue;
          shed = true;
        }
        return shed;
      };

      cue = await cueOnImpact(api, unitId, emitted, {
        // The Reactor reloads slowly (0.6/s), so give the walk room for several shots.
        shots: 8,
        approach: 900,
        window: 45,
      });
      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectOk("the heavy isotope decays and sheds a fragment", cue.hit);
      check.expectGt(
        "a nuclear-crack cue plays on the decay itself (Web Audio sources started)",
        cue.gained,
        0,
      );
    },
  };
}
