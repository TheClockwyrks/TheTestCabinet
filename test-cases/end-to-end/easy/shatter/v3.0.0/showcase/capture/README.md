# Showcase capture drivers

The two scripts here (re)record each variant's showcase media from that variant's
**reference implementation** — `gameplay.json.gz`, `mid-wave.png` and
`the-saucer.png` for `base`; `gameplay.json.gz`, `mid-wave.png` and
`torpedo-run.png` for `warhead` — by playing a REAL game: the title screen is
opened, `PLAY` is taken with a real key edge, and the ship is then flown for half
a minute with scripted keyboard input against the build's own rocks, well and
saucer. Several takes are flown, every one under the engine's recorder, and the
most watchable one is named for the showcase.

A driver is the case's validator harness reused as a recording rig. It is **not a
validator**: no review item names it, it lives outside `validation/` so a run never
loads it, and it is staged by hand.

## Nothing is posed mid-play

The only debug operation a take uses is `reset()`, which puts the game on its
title screen, and it runs before the game is opened. Everything after that is
keyboard input through the engine's own registered actions — turn, thrust, fire
and (under `warhead`) launch — so every rock that breaks, every wave that turns
over and every saucer that arrives is the build's own rules answering that input.

## How the pilot aims

Shatter's whole idea is that the well bends a shot, so "point at the rock and
fire" misses almost everything. The pilot therefore plans through the game's own
rules rather than through the build's internals: a candidate facing is flown
forward as a bullet under `specs/gravity.md`'s law and `specs/field.md`'s wrap —
the spec-derived oracle in `validation/geometry.ts`, the same arithmetic the
validators hold a build to — against every rock flown forward the same way. A shot
that has to curve around the star to reach its rock is found by that search
exactly as a straight one is, which is why the clips show both.

The trigger is pulled on the live world, never on a plan made earlier: on every
frame the gun's gate is open, the round the ship would fire _right now_ is flown
forward, and the key goes down only if that round lands.

Two rules sit over the aim. A ship at rest is a dull ship, so the pilot holds a
speed band — below `ROAM_MIN` it turns onto a chosen heading and burns until it is
over `ROAM_TARGET`, which is what puts the ship on the drifting, wrapping courses
the game is about. And anything closing on the ship inside `EVADE_SECONDS`
outranks the aim: the ship turns away from where that body will be and burns clear.

Under `warhead` a third rule sits above the gun: with the charge full and nothing
up, the pilot picks an armored rock, turns onto its bearing — a straight line,
since the well never pulls a torpedo — and presses the launch key once the rock is
inside `TORPEDO_CONE` of the nose. Everything after that press is the build's.

## Running one

Stage the validator project into the reference workspace and drop the variant's
driver in as a test:

```sh
cd references/structured-2d/<variant>
cp -r ../../../validation/structured-2d validation
cp ../../../showcase/capture/<variant>.showcase-capture.test.ts \
  validation/showcase-capture.test.ts
# Let the capture keep more frames than the validators' 300-frame replay cap:
sed -i 's/^const MAX_REPLAY_FRAMES = 300;$/const MAX_REPLAY_FRAMES = Number(\
  process.env.TCAB_SHOWCASE_MAX_REPLAY_FRAMES ?? "300",\
);/' validation/harness.ts
NODE_OPTIONS=--max-old-space-size=8192 \
  TCAB_VALIDATION_MEDIA_DIR=/tmp/showcase-out \
  TCAB_SHOWCASE_MAX_REPLAY_FRAMES=2200 \
  npx vitest run --config validation/vitest.config.ts \
    --disableConsoleIntercept validation/showcase-capture.test.ts
```

`--disableConsoleIntercept` is what lets the ratings reach the terminal: the
runner otherwise holds a passing test's console output back.

The outputs land under `$TCAB_VALIDATION_MEDIA_DIR/validation/showcase-capture.test.ts/`,
one set per take under a `take-NN-` prefix: `take-NN-gameplay.json.gz`,
`take-NN-mid-wave.png` and `take-NN-the-saucer.png` (`take-NN-torpedo-run.png`
under `warhead`). The run prints a rating for every take and names the best;
copy that take's replay and two stills into `showcase/<variant>/` without the
prefix, then delete the staged `validation/` copy so the reference stays
byte-clean.

## The knobs

| Variable                          | Default | What it does                                                                                                                                                                                                                                         |
| --------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TCAB_VALIDATION_MEDIA_DIR`       | unset   | Where the media is written. Unset writes nothing, which is how a rating pass alone is run.                                                                                                                                                           |
| `TCAB_SHOWCASE_MAX_REPLAY_FRAMES` | `300`   | The harness's replay cap, patched by the `sed` above to read this. The game runs at 120 ticks a second, so a cap between half and all of a take's ticks thins it to exactly 60 frames a second; `2200` does that for any take from 18 to 36 seconds. |
| `TCAB_SHOWCASE_TAKES`             | `3`     | How many takes are flown at each phase.                                                                                                                                                                                                              |
| `TCAB_SHOWCASE_PHASES`            | `0,1,2` | The roam-heading rotations flown, so takes differ beyond what the game's own draws vary.                                                                                                                                                             |
| `TCAB_SHOWCASE_MIN_SECONDS`       | `26`    | The earliest a take may end.                                                                                                                                                                                                                         |
| `TCAB_SHOWCASE_MAX_SECONDS`       | `36`    | The hard ceiling, past which a take ends wherever it stands.                                                                                                                                                                                         |
| `TCAB_SHOWCASE_QA_STILLS`         | unset   | `1` writes a still every three seconds, for eyeballing a take.                                                                                                                                                                                       |

## How a take is judged

Every take is rated on what makes a watchable half-minute: rocks broken, waves
turned over, the saucer's visit, lives kept, the longest stretch with nothing
breaking, and whether it ended on a settled beat — the `WAVE N` banner if the
take reached one, otherwise a breath after a rock came apart. Under `warhead`
torpedoes launched and detonations landed count too. The winner is named at the
end of the run.

One rating term is not about how good a take looks. specs/saucer.md puts 25 to
35 seconds between one saucer leaving and the next arriving, and **the reference
implementations do not honour that gap when a saucer is SHOT DOWN**: the arrival
clock is only reset when a visit ends by reaching `SAUCER_LIFETIME`, so a saucer
destroyed by a bullet is replaced within a tick. A take in which a saucer arrives
inside `SAUCER_GAP_MIN` of the last one leaving is therefore passed over, so the
showcase does not present that defect as the game. The pilot also does not aim at
the saucer at all — a visit that plays out whole shows the hunt, which is the
mechanic the clip is for.

## Why every take is recorded

The game draws its wave layouts, its saucer's arrivals and its aim errors at
random, so no take can be flown a second time and come out the same, and a take
rated with the recorder off could not then be re-run under it. Each take
therefore runs under the recorder from the start and writes its media under a
prefix of its own, and the rating decides which set is kept. A recorded frame
carries the engine's own frame number and running clock, which count from when
the harness was created rather than from when the take began; playback is
unaffected, because a player paces itself off the per-frame deltas.

## The committed media

| Variant   | Take                  | Cap  | What it turned out to be                                                                                                                                                                                                                               |
| --------- | --------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `base`    | take 5 of 9 (phase 1) | 2200 | 26.0 s. Opens on the title; wave 1 cleared and the `WAVE 2` banner run; the saucer arriving at 18.0 s and hunting to the end. 48 rocks broken for 3 460 points, no ship lost. Rated 138, the best of its run.                                          |
| `warhead` | take 6 of 9 (phase 1) | 2200 | 27.3 s. Opens on the title; four torpedo runs launched and all four detonated; wave 1 cleared with the banner; the saucer arriving at 18.0 s and shot down at 18.6 s. 35 rocks broken for 2 720 points, one ship lost. Rated 193, the best of its run. |

Both were the best-rated take of one run over the default phases, three takes
each, recorded at `TCAB_SHOWCASE_MAX_REPLAY_FRAMES=2200`, which thins each to
60 frames a second. `base`'s replay is 0.8 MB and `warhead`'s 1.2 MB.
