# Showcase capture drivers

The scripts here (re)record each variant's replay and its stills from that
variant's reference implementation — `gameplay.json.gz`, `sonar-sweep.png` and
`hunted.png` for base, `dive.json.gz`, `window.png` and `sonar.png` for kindle —
playing a REAL dive: the title menu is opened and `DIVE` chosen with a key press, the
forager is then steered with scripted arrow-key input against the build's own
predators, several takes are auditioned (fresh trenches × play style), each
recorded as it runs under the engine's recorder, and the most watchable one is
kept. Nothing is posed mid-play.

A driver is the validator harness reused as a recording rig. It is not a
validator: no review item names it, it lives outside `validation/` so a run
never loads it, and it is staged by hand.

## The seeded art

Each driver serves the workspace's own `assets/` directory and decodes what it
serves, which a validator never does and a showcase has to. Fathom is seeded
with seven sprite sheets, and the build draws every creature and every wall from
its sheet where the sheet arrived and from a shape in code where it did not. In
process there is no server to fetch a sheet from and no `createImageBitmap` to
decode one with, so a validator checks that fallback — exactly right for a check
about where a body is or what color it burns, and exactly wrong for a clip
meant to show a visitor the game. A driver supplies the browser's half of that
contract and nothing else: the build asks the engine's own loader for the same
paths under the same asset root, and what changes is only that the answer
arrives. Each also names the class a decoded frame is, because the engine's
recorder keeps a picture it recognizes and writes a marker the replay player
skips for one it does not.

To run one, stage the validator project into the reference workspace and drop
the variant's driver in as a test:

```sh
cd references/structured-2d/<variant>
cp -r ../../../validation/structured-2d validation
cp ../../../showcase/capture/<variant>.showcase-capture.test.ts \
  validation/showcase-capture.test.ts
# Let the capture keep more frames than the validators' 300-frame replay cap:
sed -i 's/const MAX_REPLAY_FRAMES = 300;/const MAX_REPLAY_FRAMES = \
  Number(process.env.TCAB_SHOWCASE_MAX_REPLAY_FRAMES ?? "300");/' \
  validation/harness.ts
TCAB_VALIDATION_MEDIA_DIR=/tmp/showcase-out \
  TCAB_SHOWCASE_MAX_REPLAY_FRAMES=2100 \
  npx vitest run --config validation/vitest.config.ts \
    validation/showcase-capture.test.ts
```

The outputs land under `$TCAB_VALIDATION_MEDIA_DIR/validation/showcase-capture.test.ts/`;
copy the replay and the stills into `showcase/<variant>/`, then delete the
staged `validation/` copy so the reference stays byte-clean.

## The knobs

Where the two drivers default differently, both are given.

| Variable | Default | What it does |
| --- | --- | --- |
| `TCAB_VALIDATION_MEDIA_DIR` | unset | Where the media is written. Unset writes nothing, so the run only judges. |
| `TCAB_SHOWCASE_MAX_REPLAY_FRAMES` | `300` | The harness's replay cap, patched to read this. A clip is recorded at 60 frames a second, so this is roughly `60 × seconds`; `2100` holds a thirty-five-second take whole. |
| `TCAB_SHOWCASE_TAKES` | `4` | How many takes of each of the three play styles are auditioned, each on a fresh trench. |
| `TCAB_SHOWCASE_MIN_SECONDS` | `26` | The earliest the clip may end. |
| `TCAB_SHOWCASE_QUIET_SECONDS` | base `33`, kindle `32` | When a merely calm frame is allowed to end a take that never took a drifter. |
| `TCAB_SHOWCASE_MAX_SECONDS` | base `38`, kindle `35` | The hard ceiling, past which the take ends wherever it stands. |
| `TCAB_SHOWCASE_TAKE` | unset | `<style>` records one take of that style and auditions nothing. |
| `TCAB_SHOWCASE_QA_STILLS` | unset | `1` writes a still every few seconds, for eyeballing a take. |

Both drivers run their whole audition inside one process, so give them
`NODE_OPTIONS=--max-old-space-size=8192`.

## Why every take is recorded

A take opens on whatever trench the game lays out for that reset, and every
creature's wandering is the game's own draw, so no take can be run a second
time. Each take is therefore recorded as it runs, under outputs prefixed
`take-<n>-`, and judged afterward; the winner's recording and stills lose the
prefix and the other takes' files are deleted, so what is left under the media
directory is the showcase's own three outputs. Because the drivers keep every
take's recording until the audition ends, an audition costs disk as well as
time, which is what the take count is for.

The committed media: base, a style-1 take at cap 2100 — a 31.2 s dive held
whole at 60 frames a second. Kindle, a style-2 take at the same cap — a 34.1 s
dive thinned to 2045 frames, which is 60 frames a second.
