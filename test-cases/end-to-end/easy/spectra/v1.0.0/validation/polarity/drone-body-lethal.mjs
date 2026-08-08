// Automated validation for the Polarity sub-item `drone-body-lethal`.
//
// A drone body on the ship always costs a life on contact, regardless of band —
// even a drone of the ship's OWN band, so a body is never mistaken for a shieldable
// same-band bullet. A same-band drone is posed in the ship's lane and the ship is
// flown into it; the real body collision costs a life.
//
// The ship is driven ACROSS to the drone rather than the drone being posed on top
// of the ship, because a contact posed on the hull resolves on the first tick and
// the clip is then nothing but the READY hold that follows (see `LEAD_IN_TICKS`).
// Flown into, the contact itself is on screen, which is exactly what the rule
// says.
//
// WHY THE DRONE IS POSED `diving`. The variable this item holds up is BAND — its
// own title and description say so ("regardless of band — even a drone of the
// ship's own band, so it is never mistaken for a shield"). The old script posed the
// drone in `formation`, which quietly smuggled a second variable in: a formation
// slot sits at `y` 120–320 (`specs/playfield.md`), so a formation drone in the
// ship's lane at `y = 600` is a state the game's own geometry never produces, and a
// build that scopes its body collision to drones that have left the formation
// failed here over a situation no player can reach. Diving is the phase in which a
// body genuinely arrives at the ship, so posing the contact there tests the rule
// the item is about — and a build with no body collision at all still fails it.
//
// The swarm is held (`holdDrones`) so the posed diver stands still in the lane and
// is a target the ship can be driven into, rather than flying its dive path out of
// reach while the ship crosses.

import { startClean, holdDrones, spawnDrone } from "../_helpers.mjs";

// The drone sits this far along the lane from the ship's start. At the specified
// 360 px/s that is ~0.9 s of travel, so the approach is a readable run-up before
// the contact.
const SHIP_START_X = 560;
const DRONE_X = 900;

// Long enough for the ship to cross the gap several times over, so a build that
// moves more slowly than specified still arrives.
const APPROACH_MAX_TICKS = 360;

// After a posed fallback contact, how long the collision may take to resolve.
const CONTACT_MAX_TICKS = 60;

export default function item() {
  // The moment the life was lost.
  let r;

  return {
    id: "polarity.drone-body-lethal",

    // The drone is posed on the SHIP'S OWN band and in the ship's lane: same-band is
    // precisely the case a build might wrongly treat as shieldable, so that is the
    // one worth checking. It sits along the lane from the ship rather than on it, so
    // the contact is something the ship travels into.
    async arrange(api) {
      await startClean(api);
      await holdDrones(api);
      await api.call("setShipBand", "cyan");
      await api.call("setLives", 3);
      await api.call("setShipX", SHIP_START_X);
      await spawnDrone(api, {
        kind: "shard",
        band: "cyan",
        x: DRONE_X,
        y: 600,
        phase: "diving",
      });
    },

    async act(api) {
      // Fly into the drone. The key is held for the whole sweep, so the ship keeps
      // pressing against the body rather than stopping just short of it.
      await api.call("keyDown", "ArrowRight");
      r = await api.until((s) => s.lives < 3, { max: APPROACH_MAX_TICKS });
      await api.call("keyUp", "ArrowRight");

      // A build whose movement is broken would never reach the drone, and this item
      // is about the body rule, not about movement (`controls.move-right` owns
      // that). So if the ship never arrived, put the body on the hull directly and
      // read the same rule from that instead — the verdict stays about the
      // collision, and only the clip is the poorer for it.
      if (!r.hit) {
        await api.call("clearField");
        const s = await api.snapshot();
        await spawnDrone(api, {
          kind: "shard",
          band: "cyan",
          x: s.ship.x,
          y: 600,
          phase: "diving",
        });
        r = await api.until((x) => x.lives < 3, { max: CONTACT_MAX_TICKS });
      }

      // Hold past the hit so the clip shows the collision and the life dropping,
      // not just the frame the drone touches the ship.
      await api.advance(108); // 108 ticks = the old 900 ms
    },

    async assert(api, check) {
      check.expectOk("a same-band drone body still costs a life", r.hit);
      check.expectEq("a life is lost on body contact", r.snap.lives, 2);
    },
  };
}
