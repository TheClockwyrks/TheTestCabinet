# Showcase capture drivers

The scripts here (re)record each variant's `showcase/<variant>/gameplay.json.gz`
replay and `mid-match.png` still from its reference implementation, playing a
REAL Solo match: the left paddle is driven with scripted keyboard input against
the build's own AI, several takes are auditioned (seed × rally-book phase), and
the most watchable take is replayed under the engine's recorder. Nothing is
posed mid-play.

To run one, stage the validator project into the reference workspace and drop
the variant's driver in as a test:

```sh
cd references/structured-2d/<variant>
cp -r ../../../validation/structured-2d validation
cp ../../../showcase/capture/<variant>.showcase-capture.test.ts \
  validation/showcase-capture.test.ts
# Let the capture keep more frames than the validators' 300-frame replay cap:
sed -i 's/const MAX_REPLAY_FRAMES = 300;/const MAX_REPLAY_FRAMES = \\
  Number(process.env.TCAB_SHOWCASE_MAX_REPLAY_FRAMES ?? "300");/' \
  validation/harness.ts
TCAB_VALIDATION_MEDIA_DIR=/tmp/showcase-out \
  TCAB_SHOWCASE_MAX_REPLAY_FRAMES=1500 \
  npx vitest run --config validation/vitest.config.ts validation/showcase-capture.test.ts
```

The outputs land under `$TCAB_VALIDATION_MEDIA_DIR/validation/showcase-capture.test.ts/`;
copy `gameplay.json.gz` and `mid-match.png` into `showcase/<variant>/`, then
delete the staged `validation/` copy. `TCAB_SHOWCASE_MIN_SECONDS` /
`TCAB_SHOWCASE_MAX_SECONDS` bound the clip (gyre and multi shipped with
`18`/`32`-ish bounds so the thinned replay stays near 60 fps), and
`TCAB_SHOWCASE_QA_STILLS=1` writes a still every 4 s for eyeballing the take.

The capture is deterministic: the same seed and phase replay the identical
match, which is what lets a take be auditioned recorder-off and then re-run
recorder-on. The committed clips: base seed 1 phase 1 (cap 1500), gyre seed 1
phase 2 (cap 1500, min 18 max 32), multi seed 1 phase 1 (cap 1500, min 18
max 30).
