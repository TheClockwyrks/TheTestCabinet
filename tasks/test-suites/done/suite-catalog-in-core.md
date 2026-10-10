# Core Resolves A Suite Definition Into A Runnable Version

Give `crates/core` a suite catalog beside its test case catalog, and lower each
test case definition a suite offers onto a `TestCaseVersion`. This is the seam
that lets the existing run pipeline execute a suite without any change to the
dispatcher, the driver, the definition store, or the run record.

## Current state

`crates/core/src/test_case.rs` holds the only catalog the repo has.
`TestCaseCatalog::case_folders` walks `test-cases/<type>/<difficulty>/<slug>/`,
`version_names` counts a subdirectory as a version only when it holds the
folder's manifest, `read_slug` reads identity through a lightweight parse, and
`resolve` reads the manifest and validates that the version folder is
self-contained.

Game jams are the precedent for lowering a smaller authored format onto the
resolved model. A jam folder is discovered through the same walk, read as a
`GameJamManifest`, and handed to `GameJamManifest::into_case`, which produces a
`Manifest` plus the implicit variant a jam runs, so that one resolution path and
all of its validation are reused.

Everything downstream consumes the resolved value.
`crates/core/src/engine.rs` resolves an engine slug to a `ResolvedEngine`,
`crates/core/src/prompt.rs` renders the prompt in strict mode with escaping
disabled, `crates/core/src/seeding.rs` seeds the workspace files and the spec
files, and `resolve_run_image` in `crates/core/src/harness.rs` picks the run
image from the test type, the asset kind and the asset dimension.

Nothing reads `test-suites/`. The format is specified in full under
[`test-suites/`](../../apps/docs/src/content/docs/test-suites/), and the typed
model and version-folder walk land at `crates/core/src/test_suite/` through
[`suite-model-and-canonical-toml.md`](../spec-cabinet/suite-model-and-canonical-toml.md).

## Design

A `TestSuiteCatalog` lands beside the model in `crates/core/src/test_suite/`,
rooted at the `test-suites/` checkout that
[`test-suites-submodule.md`](test-suites-submodule.md) delivers. It lists
`<slug>/v<major>.<minor>.<patch>/` folders, reads a version's identity from
`suite.toml`, and resolves an offered test case into a `TestCaseVersion` through
the version-folder walk.

A suite version is a frozen unit, as
[the overview](../../apps/docs/src/content/docs/test-suites/overview.md) states,
so resolution checks that the folder name is `v` followed by the declared
`version` and that the declared `slug` matches the suite directory. Resolution
failures carry the suite slug, the version, and the file that caused them
through a new error variant in `crates/core/src/error.rs`, parallel to
`InvalidTestCase`.

### Catalog identity

A definition's catalog identity is `<suite slug>-<definition file stem>` at the
suite's version, so `carom/v1.0.0/test-cases/end-to-end.toml` resolves as
`carom-end-to-end` at `v1.0.0`. The resolved version carries an implicit variant
named `base`, since a definition declares no variants and the run pipeline
selects exactly one variant per run.

Resolution exposes the identity and a check for whether it collides with an
authored test case slug, and refuses a collision it is asked about.
Catalog-wide collision detection runs where both catalogs are held at once, in
[`suite-ingestion.md`](suite-ingestion.md).

### Type mapping

The definition `type` and the type table decide the resolved `test_type`,
`asset_kind` and `asset_dimension`:

| Definition type | Resolved                                                                 |
| --------------- | ------------------------------------------------------------------------ |
| `end-to-end`    | `EndToEnd`                                                               |
| `full-stack`    | `FullStack`                                                              |
| `sprite`        | `AssetGeneration` with `Sprite`, or `SpriteSheet` when `sheet` is true   |
| `voxel`         | `AssetGeneration` with `VoxelModel`, or `VoxelAnimation` when `animated` |
| `blender`       | `AssetGeneration` with `BlenderProp`                                     |
| `particle`      | `AssetGeneration` with `Particle2d`                                      |
| `music`         | `AssetGeneration` with `Music`                                           |
| `audio-fx`      | `AssetGeneration` with `SfxSynth`                                        |

A `performance`, `adversarial` or `puzzle` definition is refused with an error
naming the type, because
[the definition page](../../apps/docs/src/content/docs/test-suites/test-case-definition.md)
states their keys as to be determined.

Every definition resolves to `AssetDimension::TwoD`, which selects the 2D
full-stack image. The suite format declares no dimension, so the dimension is
held in the defaults table below alongside the other values the format leaves
out.

### Engines and workspaces

A code-producing definition's `engines` list resolves through
`crates/core/src/engine.rs`, and each slug must be one the engine catalog knows.
The resolved version sets `engine_format`, so the per-engine rules the existing
resolution enforces hold unchanged.

`[workspaces]` names one directory per engine under `workspaces/<slug>/`. The
resolver enumerates each directory into the `WorkspaceFile` list the
`EngineWorkspaces` map carries, keyed by the engine the definition binds the
directory to, with the destination relative to the workspace directory. The
resolved keys are exactly the definition's engines, so every supported engine
finds an entry.

`[build]` lowers onto `BuildCommands` and `[toolchain]` onto
`ToolchainCommands`, and `max_runtime_hours` normalizes to
`max_runtime_seconds` through `runtime_hours_to_seconds`.

### Identity, prose and visibility

The resolved `name` and `difficulty` come from the definition. The resolved
`tags`, `summary`, `description_path` and `changelog_path` come from the suite's
`suite.toml`, `description.md` and `changelog.md`, since a suite version owns the
prose presenting every test case it offers.

The resolved `experimental` is true when either the suite manifest or the
definition declares it, so a suite still being iterated on keeps every case it
offers out of a deployment that has not opted in.

### Seeded specifications

The definition's `specifications` list selects whole specifications, defaulting
to every specification the suite declares. Each selected specification renders
to one Markdown file whose body is its `specification.md` prose followed by its
requirements, written at `specs/<path>` from the specification's declared `path`,
as
[the definition page](../../apps/docs/src/content/docs/test-suites/test-case-definition.md)
and [specifications](../../apps/docs/src/content/docs/test-suites/specifications.md)
settle.

Rendering happens at resolution into a file inside the suite's resolved
materials, and the resolved version carries a `SpecFile` naming that file as the
source and `specs/<path>` as the destination, so `crates/core/src/seeding.rs`
seeds it with no new branch. A requirement renders as its RFC 2119 `text` under
its `<specification id>/<requirement id>` identity, so a reader of the seeded
document and a reader of a result name the same requirement.

### The prompt

The definition's `prompt` is a Handlebars template under the version folder,
rendered in strict mode with escaping disabled against exactly the context
[the definition page](../../apps/docs/src/content/docs/test-suites/test-case-definition.md)
documents: `workspace`, `engine` with its `slug`, `name` and `docs`, and
`specifications` with each entry's `id`, `name`, `summary` and absolute
in-container `path`.

The `PromptContext` in `crates/core/src/prompt.rs` carries a variant, a voxel
volume, a time budget and a `specs` list, none of which a suite definition has a
counterpart for. Add a suite context to that module and render it through the
existing strict, no-escape registry, so a reference to any variable outside the
documented set is a render error rather than a blank.

### Tables the suite format leaves out

An asset-producing definition names an asset and the flag its type carries,
while asset-generation resolution requires the tables its kind implies: a
`CanvasSpec`, `ToolSpec` and `OutputSpec` for a sprite kind, a `SheetSpec` for a
sprite sheet, a `VoxelSpec` for a voxel kind, a `ModelSpec` for an animated
voxel, a `ParticleSpec` for a particle kind, and an `AudioSpec` for an audio
kind. The suite format declares none of them, and the asset's `asset.toml`
carries only identity, kind, specification and files.

Resolve these from per-kind defaults held in one table in the suite module, with
each default stated next to the kind it serves, and hold the resolved asset
dimension there too. The defaults are the seam where the format will grow, so
they live in one place a later key replaces rather than being spread through the
lowering.

An end-to-end definition seeds the suite's assets from `assets/<id>/` as
workspace files, which is what lets the model write only code.

### Out of scope

Requirement pass and fail outcomes come from the suite's validators and are
decided by
[`requirement-outcomes-from-validators.md`](requirement-outcomes-from-validators.md).
Reading the checkout on the backend is
[`suite-ingestion.md`](suite-ingestion.md), the `tcab` surface is
[`cli-reads-test-suites.md`](cli-reads-test-suites.md), and exercising a resolved
version on the cluster is
[`run-a-suite-on-the-local-cluster.md`](run-a-suite-on-the-local-cluster.md).

## Done when

- [ ] `TestSuiteCatalog` lists the suites and versions in a checkout and reads a
      version's identity without a full resolve.
- [ ] Every offered definition type resolves to a runnable `TestCaseVersion`
      carrying the mapped test type, asset kind, engines, workspaces, build and
      toolchain.
- [ ] A resolved version carries the definition's name and difficulty, the
      suite's tags, summary, description and changelog, and is experimental when
      either the suite manifest or the definition declares it.
- [ ] A seeded specification renders its prose followed by its requirements at
      the path the specification declares, under `specs/`.
- [ ] The prompt renders against exactly the documented context, and a reference
      to any other variable is a render error.
- [ ] An asset-producing definition of every offered asset kind resolves with
      the tables that kind requires filled from the defaults table.
- [ ] A `performance`, `adversarial` or `puzzle` definition is refused with an
      error naming the type.
- [ ] A resolved identity colliding with an authored test case slug is refused.
- [ ] A version folder whose name disagrees with the declared version, and a
      suite directory disagreeing with the declared slug, are both refused.
- [ ] Every definition type in the fixture suite at
      `crates/core/src/testdata/test-suite/` resolves.
- [ ] Gates green.
