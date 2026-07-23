# Platformer Hero Run Cycle — `v1.0.0`

This is version `v1.0.0` of the **Platformer Hero Run Cycle** test case: an
asset-generation case (`asset_kind = "sprite-sheet"`) that asks a model to draw a
side-view platformer mascot as a **six-frame run cycle** — six separate 48×48
transparent frames — using only the `draw-sheet` tool, one recorded operation at a
time.

`platformer-hero-run` is the catalog slug for this case. It is a **generic,
reusable** character-animation case, not tied to any particular game: the subject is
simply an appealing platformer hero (rounded body, big friendly head, boots) running
to the right. There is no target sheet — the model draws toward the seeded brief and
is reviewed subjectively against it.

## What it is

The hero is stepped through the key poses of a run and read as one looping stride:

- **Contact** (frame 0) — lead foot plants, arms opposed, body at mid height.
- **Recoil / down** (frame 1) — body at its lowest, absorbing the landing.
- **Passing** (frame 2) — free leg swings under the body, figure rising.
- **High point / up** (frame 3) — push-off, body highest and briefly airborne.
- **Return** (frames 4–5) — the opposite foot reaches and plants, carrying momentum
  back into the contact of frame 0 for a seamless loop.

The whole point is animation: played back as the `run` sequence at 12 fps the frames
must read as a believable run — legs and arms swinging through a full stride with a
slight body bob — while staying the **same on-model character** with a clear
silhouette and bold outline in every frame, drawn in a fixed palette on
transparency.

## Layout

| Path | Seeded to run? | Purpose |
| --- | --- | --- |
| `specs/brief.md` | **Yes** | The self-contained drawing brief. |
| `prompt.hbs` | No | Rendered into the model's prompt; not seeded. |
| `test-case.toml` | No | Manifest: canvas, sheet frames/sequence, tool, output, reviews. |
| `variants/` | No | One TOML file per variant (listed in `variants`). |
| `description.md` | No | Site blurb. |
| `changelog.md` | No | This version's changelog entry. |
| `README.md` | No | This overview. |

A run receives the seeded brief, the `draw-sheet` binary, and pre-seeded blank
frames with empty per-frame action logs (one 48×48 transparent frame per index). Each
operation targets a frame with `--frame <index>`, appends to that frame's log, and
re-renders `frames/<index>.png`. There is **no target sheet and no operations
schema** — the binary's `--help` is the contract, and the recorded per-frame action
logs are the authoritative output the images are regenerated from.

## Validate

From the repo root, render the prompt and seed a run workspace for the default
variant:

```
tcab prompt --test-case platformer-hero-run --version v1.0.0 --variant base
tcab seed   --test-case platformer-hero-run --version v1.0.0 --variant base --out-dir <dir>
```

Both should exit 0: `prompt` prints the assembled instruction and `seed` lays out the
brief, the blank frames, and the empty action logs into the given directory.

## Variants

This case ships a single default variant — `base`, declared in `variants/base.toml`.
It seeds the common brief and is rated on the case's two scoring domains
(**Animation** and **Fidelity**); it adds no specs, review items, or domains of its
own, and declares no canvas or sheet override, so the frame size and sequence never
vary.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/asset-generation/medium/platformer-hero-run/v1.0.0/`). Each version is
self-contained and immutable once a run references it; design revisions land as new
version folders.
