# Cinematic Trailer Cue — `v1.0.0`

An audio asset-generation test case (`asset_kind = "music"`). It asks a model to
compose an epic orchestral trailer cue, a grand, heroic blockbuster teaser, using
only the `music` sequencer binary, one recorded operation at a time. There is no
target clip; the model composes to match the written brief.

The cue is epic, heroic, and emotional. It opens sparse and tense, builds through
rising staccato and pizzicato ostinatos and soaring french horns over thunderous
taiko and bass-drum hits, and crests on a full choir-and-brass climax before a
short resolving tail. It is `44100 Hz`, stereo, and about 30 seconds long, up to
the 30000 ms cap. It builds to an ending and need not loop. The mood and dynamic
arc are prescribed, while the key, tempo, structure, and instrument choices are
the model's, so the case rewards compositional creativity over
instruction-following.

## Layout

| File | Seeded? | Purpose |
| --- | --- | --- |
| `test-case.toml` | manifest | Metadata, `[audio]` (format + `instrument_bank = "cinematic@0.1.0"`), `[tool]` (`music`), `[output]`, domain. |
| `specs/brief.md` | seeded | The self-contained brief: the mood, the build from tension to climax, length, the instrumentation (model's choice), and the stereo image. |
| `variants/base.toml` | — | The single default variant. |
| `prompt.hbs` | rendered | The instruction handed to the harness (points at the brief and the tool). |
| `description.md` | — | Site-facing blurb. |
| `README.md` | — | This overview. |

## The instrument bank

The case names `instrument_bank = "cinematic@0.1.0"`, a `name@version` palette
baked into the `music` run-container image rather than a path in this repo. The
audio is not committed here; the run is scheduled onto the image carrying that
bank, so the curated orchestral palette is already present: tremolo and ensemble
strings, solo cello, pizzicato strings, french horns, low brass, trumpet, choir,
oboe, flute, celesta, harp, and an orchestral percussion kit of taiko, bass drum,
and cymbal. The brief describes the palette and leaves the choice of instruments
to the model. Core emits the rendered `clip.wav` and a portable `clip.mid`
automatically, and neither is manifest-declared.

## Validate

```sh
tcab prompt --test-case cinematic-trailer --version v1.0.0 --variant base
tcab seed   --test-case cinematic-trailer --version v1.0.0 --variant base --out-dir <dir>
```

`prompt` renders the instruction, catching strict-mode template and manifest
errors. `seed` writes the seeded repository so you can confirm the brief is
self-contained.
