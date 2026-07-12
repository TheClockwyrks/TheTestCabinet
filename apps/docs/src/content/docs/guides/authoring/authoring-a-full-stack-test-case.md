---
title: Authoring a Full-Stack Test Case
---

A [full-stack](/testing/full-stack/overview/) test case is an
[end-to-end](/testing/end-to-end/overview/) case — a single playable game a model
builds from a self-contained spec — with one addition: the model must **also
produce the game's own 2D assets during the run**, using the asset-generation
binaries on the run image's `PATH`, rather than being handed them. Authoring one
is therefore mostly the [end-to-end authoring
procedure](/guides/authoring/authoring-an-end-to-end-test-case/) plus an
**asset-production contract**. This guide covers only what full-stack adds; read
the [end-to-end guide](/guides/authoring/authoring-an-end-to-end-test-case/) first
for the shared craft (spec decomposition, `prompt.hbs`, references, proofs,
review items), and [Full-Stack Tests](/testing/full-stack/overview/) —
[overview](/testing/full-stack/overview/),
[manifests](/testing/full-stack/manifests/), and
[evaluation](/testing/full-stack/evaluation/) — for the authoritative schema and
rules.

The worked example is the **Hollowdeep** case
(`test-cases/full-stack/medium/hollowdeep/v1.0.0/`) — a sealed-colony survival sim
whose model must draw every sprite, author every particle overlay, and synthesize
every sound it plays. Read its files alongside this guide; a new case should look
like it.

## When full-stack is the right type

Full-stack sits between the two simpler types, and the choice is about **where the
art comes from**:

- If the game needs real art but you want to measure **only software
  development**, pre-provide the art and author a plain
  [end-to-end](/guides/authoring/authoring-an-end-to-end-test-case/) case — seeded
  fixed assets keep runs comparable and keep the test about code.
- If you want to measure **only asset creation** with no program, author an
  [asset-generation](/guides/authoring/authoring-an-asset-generation-test-case/)
  case.
- If you want to measure whether **one model can carry a whole small product** —
  art direction, effects, audio, *and* code — to a coherent whole, author a
  **full-stack** case. It collapses the two-run "one model draws, another builds"
  seam into a single run. See [Why it
  exists](/testing/full-stack/overview/#why-it-exists).

## What the model is handed

A full-stack run executes in the dedicated
[`test-cabinet-full-stack-2d`](/testing/full-stack/overview/#the-full-stack-2d-run-image)
run image — the base image plus **six** asset-generation binaries on `PATH`,
selected automatically by `type = "full-stack"`:

| Binary | Produces | Consumed as |
| --- | --- | --- |
| `draw` | a single sprite → PNG | a PNG the game draws |
| `draw-sheet` | a sprite sheet → per-frame PNGs | frames the game animates |
| `particle-2d` | a particle system → `system.json` | played live via `@test-cabinet/particle-runtime`'s `./canvas` binding |
| `sfx-synth` | a procedural sound effect → `.wav` | played via Web Audio |
| `sfx-sample` | a sampled effect over the baked `combat-core` pack → `.wav` | played via Web Audio |
| `music` | sequenced music over the baked `gm-lite` bank → `.wav` + `.mid` | played via Web Audio |

The image is **2D only** — no voxel, mesh, skinned, `ui`, or `material` tools —
because a full-stack program is a browser game built from sprite art, 2D particle
effects, and audio. Each binary's `--help` is its contract; the linked
[asset-generation binary pages](/testing/asset-generation/overview/) are the
authoritative reference for what each does.

The key mental model (see [Produced assets are build
inputs](/testing/full-stack/overview/#produced-assets-are-build-inputs)): the
produced files are **build inputs**, not separately-scored artifacts. There is no
action-log regeneration and no cheat detection — the model produces the files
once, commits them, and the build consumes them exactly as an end-to-end build
consumes seeded art. They are judged only as part of the running program a
reviewer plays.

## Procedure

Follow the [end-to-end procedure](/guides/authoring/authoring-an-end-to-end-test-case/#procedure)
end to end. The steps below **replace or add to** its numbered steps; everything
not mentioned is unchanged.

### 1. Confirm it qualifies, and pin the difficulty

Every [end-to-end design requirement](/testing/end-to-end/overview/#design-requirements)
still holds — inspired-but-not-a-clone, no API keys, no backend, a self-contained
static build through the [fixed build
interface](/testing/end-to-end/overview/#design-requirements). Two additions:

- The game's art must be **producible with the six 2D binaries**. If the concept
  genuinely needs 3D models, meshed geometry, or `ui`/`material` textures, it is
  not a full-stack case — the image ships no such tools.
- Because the model builds the game **and** produces a full asset set, a
  full-stack case is heavier than the same game would be as end-to-end. Set
  `difficulty` and `max_runtime_hours` accordingly (Hollowdeep is `hard` with
  eight hours).

### 2–5. Lay foundations, decompose the spec, write the prompt, author references

Unchanged from end-to-end, with two full-stack notes:

- **The prompt carries no asset-quality directive.** The harness auto-prepends
  the standing [full-stack quality
  directive](/testing/full-stack/overview/#the-standing-quality-directive)
  (`FULL_STACK_PREAMBLE` in `crates/core/src/prompt.rs`) at render time, telling
  the model to use the on-`PATH` binaries to author **real** assets rather than
  placeholder rectangles or silence. Cover only case-specific detail in
  `prompt.hbs`, exactly as an end-to-end prompt does.
- **References are still authored, never seeded, mockups.** The reviewer compares
  the produced build against them; they are not the produced art.

### 6. Write `specs/assets.md` — the asset-production contract

This is the spec that makes a case full-stack. It is a normal seeded spec, but its
job is to tell the model **what to produce and to what bar**. For every asset the
game needs, state:

- **which of the six binaries** produces it (`draw` for a static sprite,
  `draw-sheet` for an animated sheet, `particle-2d` for an overlay, `sfx-synth`/
  `sfx-sample`/`music` for sound);
- **where the produced file lands** in the workspace, and **how the build wires
  it in** (drawn directly, animated frame-by-frame, played through the particle
  runtime, played via Web Audio);
- the **quality bar** — the art direction, the motion, the feel of the effects,
  the character of the sound — in real, testable terms, the same way an
  end-to-end spec pins visual detail in real numbers.

Follow the general [asset-brief craft](/guides/authoring/authoring-an-asset-generation-test-case/):
set mood and tone, but do not over-prescribe — you are testing the model's
creativity, not its instruction-following. Keep `specs/assets.md` and the
produced-asset **review items** in lockstep: every produced asset the reviewer
must check should trace to a line in this spec.

### 7. Write the manifest

Author `test-case.toml` per the [end-to-end
schema](/testing/end-to-end/manifests/) with the full-stack
[differences](/testing/full-stack/manifests/):

- **`type = "full-stack"`** — the one field that identifies the type and selects
  the full-stack-2d image. A root key, so it sits above the first table header.
- **No `assets` list.** A full-stack case never pre-provides art.
- **No asset-generation tables.** `asset_kind`, `[sheet]`, `[canvas]`, `[tool]`,
  `[output]`, `[voxel]`, `[ui]`, `[material]`, `[particle]`, and `[audio]` are
  all **rejected at resolution** — declaring one is a mistake worth catching, not
  silently ignored. Everything about the produced assets belongs in
  `specs/assets.md`, not a manifest table.
- **`[build]` is required** and works exactly as end-to-end: explicit `install`
  and `build`, emitting a static site into `dist/`/`build/`/`out/`. `npm ci` is
  conventional (it requires a committed lockfile). Keep the build
  **self-contained** — it must bundle the committed asset files and **must not**
  invoke `draw` or the other binaries, which are absent at validation and rebuild
  time. A build that regenerates its own assets is a catastrophic load failure
  even if the game is complete.
- **`packages`** is allowed (full-stack and end-to-end are the only types that may
  declare it). Its most common use is
  `packages = ["@test-cabinet/particle-runtime"]` so the game can play a produced
  `system.json` through the runtime's `./canvas` binding; pair it with
  `init = "npm install && …"` (not `npm ci`) so the injected `file:` dependency
  resolves.
- **`[[domain]]` and `[[review_item]]`** must cover the **produced** assets as
  first-class quality dimensions, because the model made them. Word a domain (or
  items) for the art direction, a domain (or items) for the effects and sound —
  Hollowdeep uses a `simulation` domain for the code and a `presentation` domain
  for the produced art, motion, effects, and audio, and the overall rating is the
  **worst** across them, so crude un-produced art cannot hide behind solid code.
  See [Review](/testing/full-stack/evaluation/#review).
- **`[[reference]]`, `[[proof]]`, `[[check]]`, `variants`** work exactly as
  end-to-end.

### 8. Write the non-seeded docs

`description.md`, `changelog.md`, and any `README.md` — unchanged from end-to-end,
never seeded.

## Validate your work

There is no separate authoring linter — you validate by resolving and seeding, for
**every** variant:

```sh
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` catches strict-mode template errors and manifest problems (including any
forbidden asset-generation table); `seed` writes the seeded repository to disk so
you can confirm the seeded set — **including `specs/assets.md`** — is complete and
self-contained, and that no pre-provided `assets/` leaked in. Lint the specs and
prose with `npm run lint:specs`.

When the case is ready, exercise it end to end with
[Run a Test Case](/quickstarts/development/run-a-test-case/) (a full-stack run is
scheduled onto the full-stack-2d image automatically). Re-ingest the case before
running if a backend already has an older definition — see
[Running the Local Service Stack](/guides/development/running-the-local-service-stack/).

## Next steps

- [Full-Stack Tests → Evaluation](/testing/full-stack/evaluation/) — how a
  finished run is validated, reviewed, and scored, including how the reviewer
  judges the produced assets.
- [Creating an End-to-End Variant](/guides/authoring/creating-an-end-to-end-variant/) —
  variants work identically for a full-stack case.
- [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/) —
  assess a run of your case.
