# Showcase capture driver

`base.showcase-capture.test.ts` (re)records the base variant's showcase from a
reference implementation — `solving-a-challenge.json.gz`, `machine.png`,
`running.png` and `solved.png` — playing a REAL sitting. The title screen is
opened, `EXTRAS` is chosen with a key press, a challenge is taken off its select
screen, a machine is built on the field with pointer drags out of the tray and
instruction keys into the tape panel, and the machine is then run until it has
delivered its product six times and the challenge completes. Several takes are
auditioned, one per challenge, and the most watchable is replayed under the
engine's recorder. Nothing is posed mid-play.

A driver is the validator harness reused as a recording rig. It is not a
validator: no review item names it, it lives outside `validation/` so a run never
loads it, and it is staged by hand.

## What is driven, and what is only read

`guides/authoring/authoring-a-case-showcase.md`: "Arranging the input is
authoring; posing the outcome through the debug surface is fabrication." So every
frame is driven through the two doors a player has — the runtime's own keyboard
(`h.tap`, `h.hold`, `h.release`) and its own pointer (`h.mousePress`,
`h.mouseGlide`, `h.mouseRelease`), each of which dispatches a real event at the
surface and runs the frame that delivers it. Nothing is placed, posed, spawned,
loaded, tallied or completed through `specs/instrumentation.md`'s surface.

The surface is used for exactly two things, and both are READS. `snapshot()` is
how the driver knows where the game got to. `referenceSolution` is how it knows
what machine to build: it hands back the build's own answer as a solution
document, and the driver turns that document back into the gestures that would
have produced it — a drag out of the right tray slot onto the right hex,
`part-cw`/`part-grow` on the live ghost to turn and lengthen it before the
release, a lay along a track's cells, and one instruction key per tape cell. What
lands on the field is the build's own machine, put there by the build's own
editor.

## The seeded art

The driver serves the workspace's own `assets/` directory and decodes what it
serves, which a showcase has to. Orrery is a full-stack case: each reference
PRODUCED its sprites, aperture sheets, particle systems and cues during authoring
and committed them under `assets/`, and the game loads them at runtime the way a
page does. In process there is no server to fetch a sheet from and no
`createImageBitmap` to decode one with — so the case harness's own
`installAssetHost` supplies the browser's half of that contract and nothing else:
a `fetch` that reads the committed file, a `createImageBitmap` that decodes it,
and an `AudioContext` that decodes a produced `.wav` far enough for the cue to
bind. It also names the class a decoded frame is, because the engine's recorder
keeps a picture it recognizes and writes a marker the replay player skips for one
it does not.

That much every check gets. What the driver adds is the REFUSAL: before it
records anything it warms the game up, and it throws rather than record if the
loader reported a failure or if the warm frame drew no decoded image at all. A
clip drawn entirely from a build's fallback shapes would be a picture of a bare
Node process rather than of the game.

## Which challenge a take is drawn from

The Extras shelf, always. `specs/modes/campaign.md` opens the course on challenge
`1` and leaves "every other challenge locked" until the one before it is
completed, so a single sitting can only ever reach `campaign:1` — a three-part
opener that runs well under the length a preview wants. `specs/modes/extras.md`'s
shelf is "open from the start", every row of it can be entered, and its ten
challenges span the whole machine.

## Running it

Stage the validator project into a copy of the reference workspace and drop the
driver in as a test. Linking the reference's entries rather than copying them
keeps `node_modules` and `dist` shared and leaves the reference tree untouched:

```sh
CASE=test-cases/full-stack/medium/orrery/v1.0.0
ENGINE=structured-2d                  # or simple-2d
WORK=/tmp/orrery-showcase

REF="$(realpath "$CASE/references/$ENGINE/base")"
rm -rf "$WORK" && mkdir -p "$WORK"
for f in $(ls -A "$REF"); do ln -s "$REF/$f" "$WORK/$f"; done
rm -f "$WORK/validation" && mkdir -p "$WORK/validation"
cp -r "$CASE/validation/$ENGINE/." "$WORK/validation/"
cp "$CASE/showcase/capture/base.showcase-capture.test.ts" \
  "$WORK/validation/showcase-capture.test.ts"
# Let the capture keep more frames than the validators' 300-frame replay cap:
sed -i 's/const MAX_REPLAY_FRAMES = 300;/const MAX_REPLAY_FRAMES = \
  Number(process.env.TCAB_SHOWCASE_MAX_REPLAY_FRAMES ?? "300");/' \
  "$WORK/validation/harness.ts"

cd "$WORK"
TCAB_VALIDATION_MEDIA_DIR=/tmp/showcase-out \
  TCAB_SHOWCASE_MAX_REPLAY_FRAMES=2400 \
  NODE_OPTIONS=--max-old-space-size=8192 \
  npx vitest run --config validation/vitest.config.ts \
    validation/showcase-capture.test.ts
```

The outputs land under
`$TCAB_VALIDATION_MEDIA_DIR/validation/showcase-capture.test.ts/`; copy the
replay and the three stills into `showcase/base/`. Nothing above writes into
`references/`, so there is no staged copy to remove afterwards — `git status`
over the reference tree is the check.

The driver only ever imports `./harness`, `./constants`, `./field` and
`./formats`, all of which carry the same names in all three engine projects, so
it stages into any of them, and it has been type-checked and run in all three.
The two in-process projects are the cheap route, though — a take costs a few
seconds there against the better part of a minute under `none`, which drives
Chromium out of process and records through the injected recorder rather than the
engine's.

## The knobs

| Variable                          | Default                                    | What it does                                                                                                                                                                                        |
| --------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TCAB_VALIDATION_MEDIA_DIR`       | unset                                      | Where the media is written. Unset writes nothing, which is what makes an audition free.                                                                                                             |
| `TCAB_SHOWCASE_MAX_REPLAY_FRAMES` | `300`                                      | The harness's replay cap, patched to read this. A take is driven at 60 frames a second, so this is roughly `60 × seconds`; `2400` holds a forty-second take whole.                                  |
| `TCAB_SHOWCASE_TAKE`              | unset                                      | `<mode>:<number>`, one-based, as the select screen numbers a challenge. Naming one records it and auditions nothing, which is how the committed take is reproduced without paying for the audition. |
| `TCAB_SHOWCASE_TAKES`             | `campaign:1` and all nine reachable Extras | The takes auditioned when none is named.                                                                                                                                                            |
| `TCAB_SHOWCASE_MIN_SECONDS`       | `20`                                       | The shortest a take may be and still be considered.                                                                                                                                                 |
| `TCAB_SHOWCASE_MAX_SECONDS`       | `40`                                       | The longest.                                                                                                                                                                                        |
| `TCAB_SHOWCASE_SPEED_TAPS`        | `0`                                        | How many times `speed-up` is pressed once the run is under way. `0` leaves the whole run at the three cycles a second a run opens at, which is the pace an arm's swing reads at.                    |
| `TCAB_SHOWCASE_SPEED_AFTER`       | `12`                                       | Which cycle those presses land on.                                                                                                                                                                  |
| `TCAB_SHOWCASE_QA_STILLS`         | unset                                      | `1` writes a still every `TCAB_SHOWCASE_QA_EVERY` frames, across the whole take, for eyeballing one.                                                                                                |
| `TCAB_SHOWCASE_QA_EVERY`          | `120`                                      | How often that is.                                                                                                                                                                                  |

The audition runs every take in its own harness inside one process, so give it
`NODE_OPTIONS=--max-old-space-size=8192`.

## Why it is reproducible

The capture is deterministic. The field, the shelf and every challenge on it are
fixed data in the build; the machine comes from the build's own reference
solution; and every gesture the driver makes is a pure function of that document
and of the snapshot, at a fixed frame length. So a take auditioned with the
recorder off replays identically under it — which is what makes an audition worth
anything — and the three committed stills come back byte-identical run to run.

One caveat on byte-identity, which is weaker than identity of the sitting: a
recorded frame carries the engine's own frame number and its running clock, and
both count from when the harness was created rather than from when the recorder
was armed. Each take gets a fresh harness here, so the recorded file is the same
whether or not an audition ran before it; a driver changed to reuse one would
write the same sitting with a different time origin. Playback is unaffected,
because a player paces itself off the per-frame deltas.

The committed media: `extras:8`, Aetherfall, chosen by the default audition,
recorded against `references/structured-2d/base` at cap `2400` — a 30.9 s sitting
held whole at 60 frames a second, 1857 frames and 248 KB, ending on the solved
panel.
