// Automated validation for the Respawn item `critter-after-death`.
//
// After a death ends the crossing (with lives to spare), a fresh critter respawns on
// the near shore — on solid footing, with the crossing timer reset — not mid-strait
// and not on the water (specs/gameplay.md). The bear's matching fairness is
// `hunter.fair-reset-death`. See validation/_helpers.mjs.
//
// BOTH KINDS OF DEATH ARE DRIVEN. The rule is written about a death, not about a
// particular cause, so the item covers the two shapes a death comes in and asserts the
// same respawn of each:
//
//   * INFLICTED — a plow slides into a critter that is standing still. Nothing the
//     player did, and no input in flight when the crossing ends.
//   * SELF-INFLICTED — the player hops off the median into open water, driven through
//     the real key path with the key still down as the critter drowns, which is what a
//     hand at the keyboard is actually doing at that moment.
//
// The second is the one a posed death cannot reach, and the two genuinely differ: a
// build resolving the death within the tick that caused it hands the fresh critter
// straight back to a key that is still held, so it can be a tile up the road a tick
// after respawning. That is the controls working as specified (a held direction
// auto-repeats at the hop cooldown, specs/controls.md) rather than a broken respawn —
// so what this item reads is the RESPAWN INSTANT, the first moment the fresh crossing
// is live, which is the moment specs/gameplay.md is about. Where a held key takes the
// critter next belongs to `controls.one-tile`, not here.
//
// WHICH IS WHAT THE CLIP SHOWS, AND IT IS NOT A BUG. Because this item holds ArrowUp
// through the second death on purpose, the recording of it can show the fresh critter
// hop forward the moment it appears — on a build that hands a still-held key straight to
// it. That is this script's hand on the key, not the build stepping on its own, and both
// the death pause and the hop cooldown can be intact while it happens. `respawn.
// death-pause` is the item that decides whether the pause is there at all; do not read
// this clip as evidence about it.
//
// THE SWEEP MUST NOT LOOK FOR THE ANSWER. An earlier version waited for
// `phase === "crossing" && critter.row === ROW_NEAR` and then asserted that the
// critter's row was ROW_NEAR — the very fact it had just searched for. That assertion
// could not fail: against a build that respawned in the middle of the road the sweep
// simply timed out, and the verdict blamed "a fresh crossing begins after the death",
// which is a false diagnosis of a build whose crossing began perfectly well in the
// wrong place. So the sweep marks the fresh crossing by something that says nothing
// about position — the game is back in a live crossing — and every assertion reads a
// fact the predicate did not.

import {
  actUntilDeath,
  startCrossing,
  ICE_TOP,
  ROW_MEDIAN,
  ROW_NEAR,
  TICK,
  WATER_BOTTOM,
} from "../_helpers.mjs";

// Two deaths are driven, so the run needs lives to spare for both and still be playing
// after the second — a game over would end the crossing instead of respawning it.
const LIVES = 5;

// The clock is wound down before each death so the reset is TELLING. Posed at its full
// length the timer would read the same before and after, and "the timer is reset for
// the fresh crossing" would hold against a build that never touched it; from well short
// of full, only a real reset can satisfy it. It is also far longer than either death
// takes, so the timer cannot be what kills.
const START_TIMER = 12; // seconds — `setTimer` poses the clock, so not a tick count

// The inflicted death: a plow six tiles down the lane closing at six tiles a second, so
// it slides into a stationary critter in about a second.
const CRITTER_COL = 20;
const PLOW_COL = 26;
const PLOW_SPEED = 6;

// The camera time between the two deaths, and after the second.
//
// THE TWO DEATHS HAVE TO READ AS TWO EVENTS. `act` is the recording, and the second
// scenario used to be posed 0.3 s after the first respawn — so the fresh critter
// appeared on the near shore and was teleported to the median almost in the same breath.
// A reviewer saw a flicker, not a respawn, and certainly not two different causes of
// death. `REST_TICKS` holds on the first respawn where it lands, before anything is
// re-posed, which is the moment this item is about; `LEAD_TICKS` then shows the critter
// sitting on the median before the player's hop takes it into the water. Neither is
// read: `driveDeath` captures the respawn instant as it happens, so these spans are
// camera time and change nothing about the verdict.
const REST_TICKS = 120; // 1 s holding on the first respawn, before the re-pose
const LEAD_TICKS = 72; // 0.6 s on the median before the player's hop
const TAIL_TICKS = 90; // 0.75 s after the second respawn

export default function item() {
  // One entry per scenario, and the level's full timer length, for `assert` to read.
  const runs = [];
  let timerMax;

  /**
   * Drive one death and the fresh crossing that follows it, and keep what the
   * assertions read.
   *
   * Both sweeps poll a single tick at a time. The death sample must be the tick the
   * life was spent, and the fresh-crossing sample must be the first tick the crossing
   * is live again — on a build that resolves a death within the tick, a coarser poll
   * would skip past the respawn and read the critter wherever a still-held key had
   * since taken it, failing a build whose respawn landed exactly where it should.
   */
  const driveDeath = async (api, who, livesBefore) => {
    const died = await actUntilDeath(api, livesBefore, {
      max: 240,
      poll: TICK,
    });
    const fresh = await api.until(
      (s) => s.screen === "playing" && s.phase === "crossing",
      { max: 360, poll: TICK }, // 3 s — covers a build that pauses on the death
    );
    runs.push({ who, died, fresh, livesBefore });
  };

  return {
    id: "respawn.critter-after-death",

    // Pose the inflicted death: a stationary critter on an otherwise empty ice lane
    // with a plow sweeping into it, lives to spare, and a part-spent clock.
    //
    // The bear is taken off the board. A hunter that reached the critter would cost
    // the same life this item reads as the plow's, and the respawn it drove would be
    // the wrong scenario's.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLives", LIVES);
      await api.call("setTimer", START_TIMER);
      await api.call("setBear", 0, null);
      await api.call("setLane", ICE_TOP, {
        cols: [PLOW_COL],
        speed: PLOW_SPEED,
        dir: -1,
      });
      await api.call("placeCritter", CRITTER_COL, ICE_TOP);
      timerMax = (await api.snapshot()).timerMax;
    },

    // Both deaths and both respawns — what is checked, and the clip.
    async act(api) {
      // Inflicted: the plow arrives and the crossing ends without the player touching
      // anything.
      await driveDeath(api, "crushed", LIVES);

      // Stay on that respawn for a beat before touching anything, so the fresh critter
      // is seen where the rule says it lands.
      await api.advance(REST_TICKS);

      // Self-inflicted: pose the second scenario on the fresh crossing the first one
      // produced — open water above the median, the critter on the median, the clock
      // wound down again — then hop up into the water and HOLD the key through the
      // drowning, the way a hand at the keyboard does.
      await api.call("setBear", 0, null);
      await api.call("setTimer", START_TIMER);
      await api.call("setLane", WATER_BOTTOM, { cols: [] }); // open water, no floe
      await api.call("placeCritter", CRITTER_COL, ROW_MEDIAN);
      await api.advance(LEAD_TICKS);
      await api.call("keyDown", "ArrowUp"); // still down as the critter goes in
      await driveDeath(api, "drowned", LIVES - 1);
      await api.call("keyUp", "ArrowUp");
      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      for (const { who, died, fresh, livesBefore } of runs) {
        check.expectOk(`${who}: the death costs a life`, died.hit);
        check.expectOk(
          `${who}: a fresh crossing begins after the death`,
          fresh.hit,
        );
        check.expectEq(
          `${who}: the critter respawns on the near shore`,
          fresh.snap.critter.row,
          ROW_NEAR,
        );
        check.expectGt(
          `${who}: the respawn is clear of the water band, not in it`,
          fresh.snap.critter.row,
          WATER_BOTTOM,
        );
        check.expectEq(
          `${who}: the critter respawns on solid footing`,
          fresh.snap.critter.footing,
          "solid",
        );
        check.expectEq(
          `${who}: a life was spent on the death`,
          fresh.snap.lives,
          livesBefore - 1,
        );
        check.expectGt(
          `${who}: the crossing timer is reset for the fresh crossing`,
          fresh.snap.timer,
          timerMax - 1,
        );
      }
    },
  };
}
