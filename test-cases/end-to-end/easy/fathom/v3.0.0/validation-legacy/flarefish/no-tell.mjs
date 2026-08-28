// flarefish.no-tell: no amber bulb and no ping — between flares its body is unrevealed
// unless your light or sonar reaches it (the sampled pixel is not amber).
//
// THE CLIP IS THE FLARE DYING, AND THAT IS WHAT MAKES THE CHECK READABLE. An earlier form
// posed the pair, sampled one pixel, and captured a still of the result — a still of
// nothing, being a patch of dark trench. It is not possible to tell from that picture
// whether the build correctly shows no tell, or whether there is simply no Flarefish
// there, or whether the whole scene failed to draw.
//
// So the scenario now films the one moment that settles it. The Flarefish is caught mid
// flare, when its bloom lights the area and it is plainly, visibly there
// (`specs/predators/flarefish.md`), and the clip runs through the fade until the bloom is
// gone. What a reviewer watches is a Flarefish that was unmistakably present going dark —
// which is exactly the claim, and is unavailable to a build that draws an amber bulb or
// pings, because either would still be there after the flare died.
//
// The two samples make the same point in the verdict: amber where the flare was, and no
// amber in the same place once it has faded. The first is the control the old form
// lacked, and it is why "not amber" here cannot pass by drawing nothing at all.
//
// WAITING FOR THE FLARE IS SKIPPED, NOT FILMED. Flares come about every `7 s`
// (`specs/predators/flarefish.md`) and a clip has eight; `skipUntil` runs that wait
// instantly in both passes, so the recording opens on the bloom rather than on six seconds
// of an empty screen.
import {
  denAllExcept,
  isAmber,
  luminance,
  poseApart,
  pred,
  quietBoard,
  sampleColor,
  startPlaying,
  ticksFor,
  unmetPrecondition,
} from "../_helpers.mjs";

// Long enough to meet a flare on any conforming cadence — `7 s` between them, and the
// scenario may start just after one.
const WAIT_TICKS = ticksFor(20);

// How bright the flaring Flarefish's own tile must read for the control to count it as
// plainly drawn. The unlit trench sits in the low single digits (see
// `fog/unrevealed-black`), so this is far above fog without fixing how bright a bloom is.
const FLARE_LIT_FLOOR = 60;

export default function item() {
  let p;
  let litCol;
  let darkCol;
  let sawFlare = false;

  return {
    id: "flarefish.no-tell",

    async arrange(api) {
      await startPlaying(api);
      // EIGHT TILES OFF, IN A SEALED RING. The Flarefish has to complete a flare for this
      // item to have anything to watch, and it only flares while wandering: "while chasing
      // it stops flaring" (`specs/predators/flarefish.md`). Its own bloom reaches `192 px`
      // through rock, so a forager posed two tiles away is inside the first bloom, gets
      // fixed on, and the Flarefish never flares again — `flaring` never once reads true.
      // Eight tiles is `256 px`: outside the bloom, and far outside the `128 px` its
      // light-sense reaches while the forager sits dim, so the wander holds and the flares
      // keep coming.
      const board = await poseApart(api, 8);
      await denAllExcept(api, ["flarefish"]);
      await api.call("setPredator", "flarefish", {
        tx: board.far.tx,
        ty: board.far.ty,
        mode: "wander",
      });
      await quietBoard(api, board.near);
    },

    async act(api) {
      // Skipped, not filmed: the wait for the next flare.
      const bloom = await api.skipUntil((s) => pred(s, "flarefish").flaring === true, {
        max: WAIT_TICKS,
        poll: 6,
      });
      sawFlare = bloom.hit;
      if (!sawFlare) {
        // No flare inside twenty seconds. Whether it flares at all, and how often, is
        // `flarefish/flare-cadence`'s verdict — without one there is nothing here to watch
        // go dark.
        throw unmetPrecondition(
          "the Flarefish did not flare within 20 s, so there was no bloom to watch fade",
        );
      }
      p = pred(await api.snapshot(), "flarefish");
      await api.settle(120); // a real frame, so the bloom has been painted before sampling
      litCol = await sampleColor(api, p.x, p.y);

      // Filmed, in real time: the bloom fading out and the body going dark with it.
      await api.advance(ticksFor(2));
      p = pred(await api.snapshot(), "flarefish");
      await api.settle(120);
      darkCol = await sampleColor(api, p.x, p.y);
      await api.screenshot("notell");
    },

    async assert(api, check) {
      // The control: it really was there, and really was drawn, a moment ago. Read as
      // BRIGHTNESS, not hue — the flare is the Flarefish's own orange light show
      // (`specs/assets.md`), and what matters here is that the spot was unmistakably lit,
      // not which warm colour a build paints its bloom.
      check.expectGt(
        "the Flarefish is plainly visible while its flare blooms",
        luminance(litCol),
        FLARE_LIT_FLOOR,
      );
      check.expectOk(
        "and once the flare has faded it shows nothing of itself — no bulb, no ping",
        !isAmber(darkCol),
      );
    },
  };
}
