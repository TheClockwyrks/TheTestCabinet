# Run Container

These are the container images The Test Cabinet runs benchmarks inside. Every run
executes in an isolated container seeded with a fresh git repository, so a model
cannot reach the host or other runs' work (see
`../apps/docs/src/content/docs/components/core/execution.md`).

There is **one image per run kind**, selected by a run's
[test type](../apps/docs/src/content/docs/testing/) and — for asset-generation —
its [`asset_kind`](../apps/docs/src/content/docs/testing/asset-generation/manifests.md).
The full set is whatever [`build.sh`](#building) builds; the notable ones:

- the **base** image, the shared Node foundation every other image is built `FROM`
  (directly, or via **base-wasm**) except the self-contained blender image; it is
  not itself resolved as a run image;
- the **base-wasm** image, which every
  [end-to-end](../apps/docs/src/content/docs/testing/end-to-end/) run executes
  in — the base plus the shared **Rust → WebAssembly toolchain** (Rust with the
  `wasm32-unknown-unknown` target, `wasm-bindgen`, `wasm-pack`, and `binaryen`),
  so an end-to-end or full-stack build may author its core simulation in Rust and
  ship it as a **committed wasm build input** (the toolchain is present only while
  the run is live — a build's `npm ci && npm run build` must consume the committed
  `.wasm`, never invoke `cargo`/`wasm-pack`, exactly as it must not shell out to
  `draw`). It is the parent of the full-stack-2d, adversarial, and performance
  images;
- the **sprite** image, which every single-sprite
  [asset-generation](../apps/docs/src/content/docs/testing/asset-generation/overview.md)
  run (`asset_kind = "sprite"`) executes in — the base image plus the baked-in
  `draw` binary;
- the **sprite-sheet** image, which every sprite-sheet asset-generation run
  (`asset_kind = "sprite-sheet"`) executes in — the base image plus the baked-in
  `draw-sheet` binary;
- the **ui** image, which every UI asset-generation run (`asset_kind = "ui"`)
  executes in — the base image plus the baked-in `paint` and `ui` binaries (the
  layered raster painter and the crisp vector/text/nine-slice tool);
- the **material** image, which every PBR-material asset-generation run
  (`asset_kind = "material"`) executes in — the base image plus the baked-in
  `texture` and `pbr` binaries (the seamless map painter and the derivation/assembly
  tool);
- the **voxel** image, which every static-voxel asset-generation run
  (`asset_kind = "voxel-model"`) executes in — the base image plus the baked-in
  `voxel` binary;
- the **voxel-animation** image, which every rigged-voxel asset-generation run
  (`asset_kind = "voxel-animation"`) executes in — the base image plus the
  baked-in `voxel-anim` binary;
- the **mc** image, which every static Marching Cubes meshing run
  (`asset_kind = "mc-model"`) executes in — the base image plus the baked-in
  `mc` binary;
- the **mc-animation** image, which every rigged Marching Cubes meshing run
  (`asset_kind = "mc-animation"`) executes in — the base image plus the baked-in
  `mc-anim` binary;
- the **sn** image, which every static Surface Nets meshing run
  (`asset_kind = "sn-model"`) executes in — the base image plus the baked-in
  `sn` binary;
- the **sn-animation** image, which every rigged Surface Nets meshing run
  (`asset_kind = "sn-animation"`) executes in — the base image plus the baked-in
  `sn-anim` binary;
- the **dc** image, which every static Dual Contouring meshing run
  (`asset_kind = "dc-model"`) executes in — the base image plus the baked-in
  `dc` binary;
- the **dc-animation** image, which every rigged Dual Contouring meshing run
  (`asset_kind = "dc-animation"`) executes in — the base image plus the baked-in
  `dc-anim` binary;
- the **mc-skinned**, **sn-skinned**, and **dc-skinned** images, which every
  skinned-character meshing run (`asset_kind = "mc-skinned"` / `"sn-skinned"` /
  `"dc-skinned"`) executes in — the base image plus the baked-in `mc-skin` /
  `sn-skin` / `dc-skin` binary (a single continuous, skeleton-bound skin, one
  image per algorithm);
- the **blender** image, which every Blender character run
  (`asset_kind = "blender-character"`) executes in — a **self-contained `ubuntu:26.04`
  image** carrying **headless Blender** (installed from `apt`) and the baked-in
  **`tcab-blend`** runner (which runs a model's `build.py` under Blender to export a
  skinned, animated glTF). It is the **one run image not built `FROM` the shared base**:
  Blender ships no upstream Linux build for aarch64, so getting a modern, arch-parity
  Blender means taking it from a distro that packages it for both arches, and only Ubuntu
  (26.04 → Blender 5.0.x) does — the Debian base is stuck at Blender 3.4.x. See
  [`blender/Dockerfile`](blender/Dockerfile) for the full rationale;
- the **particle-2d** and **particle-3d** images, which every particle-effect run
  (`asset_kind = "particle-2d"` / `"particle-3d"`) executes in — the base image
  plus the baked-in `particle-2d` / `particle-3d` binary;
- the **sfx-synth** image, which every procedural sound-effect run
  (`asset_kind = "sfx-synth"`) executes in — the base image plus the baked-in
  `sfx-synth` binary;
- the **sfx-sample** image, which every sample-library sound-effect run
  (`asset_kind = "sfx-sample"`) executes in — the base image plus the baked-in
  `sfx-sample` binary **and the baked-in sample pack** (see
  [the sample library](#the-sample-library-and-instrument-bank) below);
- the **music** image, which every music run (`asset_kind = "music"`) executes in
  — the base image plus the baked-in `music` binary and the baked-in instrument
  bank;
- the **adversarial** image, which every
  [adversarial](../apps/docs/src/content/docs/testing/adversarial/overview.md)
  run executes in — **base-wasm** (which supplies the Rust + `wasm32-unknown-unknown`
  toolchain a model's controller builds to a wasm core module with in-container)
  plus the Foray tooling compiled from `crates/`: the baked-in `foray` CLI, the
  controller buildkit, and the reference modules + map; and
- the **performance** image, which every
  [performance](../apps/docs/src/content/docs/testing/performance/overview.md)
  run executes in — **base-wasm** (which supplies the Rust + `wasm32-unknown-unknown`
  toolchain a model's engine builds to a wasm core module with in-container) plus
  the Lattice tooling compiled from `crates/`: the baked-in `lattice` CLI, the
  engine buildkit, the reference engines, and the committed training scenarios.

With one exception, none is a per-harness image — a run installs the selected
harness's CLI into the image at run time, by running the harness's `install`
command (see [`../harnesses/README.md`](../harnesses/README.md)). Installing at
run time is what lets a run always pick up the harness's most recently published
version, rather than whatever was current when an image was last built. The
runner picks the image by test type and asset kind via
[`harness::resolve_run_image`](../crates/core/src/harness.rs).

### The exception: the `-gg` variants

`gg` is The Test Cabinet's own in-container harness, and under
[responses-as-code](../apps/docs/src/content/docs/gg/responses-as-code.md) a model
answers with a **program**. The language that program is written in is a run
variable, and a compiled language needs its **compiler on the turn path** — inside
the run container, on every turn. gg itself is a single static binary copied in at
run time, which works because a binary copies fine; a JDK does not.

So each run image has a `<name>-gg` variant: the same image plus the toolchain tree,
one `COPY` on top of its parent
([`gg/Dockerfile`](gg/Dockerfile), copying out of the builder in
[`gg-toolchains/Dockerfile`](gg-toolchains/Dockerfile)). Three facts shape it:

- **Every toolchain is present together.** A program's language is resolved *per
  agent*, so one run may drive a C# agent and a Python agent at the same time. An
  image carrying one language's compiler could not run that configuration at all.
- **It is a variant, not a layer on the shared image.** The toolchains are for one
  harness. A run driven by Claude Code or Codex must not pull gigabytes it cannot
  use — and a model that found a Swift compiler on `PATH` in an end-to-end run
  would have been handed a capability no other arm of that comparison has.
- **Every image has one, and the name is derived.** A program's language is resolved
  per agent, so a gg run of *any* kind — an asset-generation case, an adversarial
  case — may drive a compiled-language agent, and an image with no toolchains would
  fail every one of that agent's programs. `ImageSpec::gg_variant` in `crates/core`
  appends the suffix rather than consulting a list, [`image-names.sh`](image-names.sh)
  publishes one per name, and `every_resolvable_image_is_one_the_build_publishes`
  fails the build if what Rust resolves and what the build publishes disagree. It
  costs a doubled image set and CI matrix; what it buys is that there is no such
  thing as a gg run that resolves an image it cannot compile in.

## Layout

```
containers/
├── base/Dockerfile             # the shared Node foundation (toolchain, run user); not a run image itself
├── base-wasm/Dockerfile        # the end-to-end run image: base plus the shared Rust → wasm toolchain
├── tools/Dockerfile            # the shared asset-tooling BUILDER: every asset binary compiled in ONE
│                               #   cargo pass, exported as a `scratch` image. Not a run image and never
│                               #   published — the asset images below `COPY --from` it (see Building)
├── full-stack-2d/Dockerfile    # the full-stack run image: base-wasm plus the six 2D asset binaries + audio packs
├── game-jam/Dockerfile         # the game-jam run image: full-stack-2d plus its own identity (separately pinnable)
├── gg-toolchains/Dockerfile    # the gg LANGUAGE-TOOLCHAIN builder: every compiler a gg run's
│                               #   responses-as-code programs may need, under /opt/gg (purs+esbuild,
│                               #   a JDK+TeaVM, the Kotlin compiler, a pruned rustc, a pruned
│                               #   Swift + its wasm SDK, wasi-sdk, a pruned .NET). Not a run image —
│                               #   the `-gg` variants `COPY --from` it — but it IS published, so the
│                               #   tree inside them is pullable and pinned by digest on its own
├── gg-ci/Dockerfile            # the gg CI TOOLCHAIN image: the same eleven toolchains under a
│                               #   staged $HOME instead of /opt, so a CI job that must COMPILE gg
│                               #   copies them in rather than fetching 1.9 GB from five upstreams.
│                               #   Not a run image, not built by build.sh, not a `COPY --from`
│                               #   source — its own workflow builds it (see Building)
├── gg/Dockerfile               # ONE parameterized `<parent>-gg` variant: any run image plus that tree
├── sprite/Dockerfile           # the base image plus the baked-in `draw` binary
├── sprite-sheet/Dockerfile     # the base image plus the baked-in `draw-sheet` binary
├── ui/Dockerfile               # the base image plus the baked-in `paint` + `ui` binaries
├── material/Dockerfile         # the base image plus the baked-in `texture` + `pbr` binaries
├── voxel/Dockerfile            # the base image plus the baked-in `voxel` binary
├── voxel-animation/Dockerfile  # the base image plus the baked-in `voxel-anim` binary
├── mc/Dockerfile               # the base image plus the baked-in `mc` binary (Marching Cubes)
├── mc-animation/Dockerfile     # the base image plus the baked-in `mc-anim` binary
├── sn/Dockerfile               # the base image plus the baked-in `sn` binary (Surface Nets)
├── sn-animation/Dockerfile     # the base image plus the baked-in `sn-anim` binary
├── dc/Dockerfile               # the base image plus the baked-in `dc` binary (Dual Contouring)
├── dc-animation/Dockerfile     # the base image plus the baked-in `dc-anim` binary
├── mc-skinned/Dockerfile       # the base image plus the baked-in `mc-skin` binary (skinned character)
├── sn-skinned/Dockerfile       # the base image plus the baked-in `sn-skin` binary
├── dc-skinned/Dockerfile       # the base image plus the baked-in `dc-skin` binary
├── blender/                    # self-contained ubuntu:26.04 + headless Blender + `tcab-blend` (NOT FROM base)
│   ├── Dockerfile              #   (a `blender-character` run authors via a build.py bpy script)
│   ├── tcab-blend              #   the runner: execs `blender --background --python build.py`
│   └── tcab_blend_export.py    #   the bundled glTF export + preview helper build.py calls
├── particle-2d/Dockerfile      # the base image plus the baked-in `particle-2d` binary
├── particle-3d/Dockerfile      # the base image plus the baked-in `particle-3d` binary
├── sfx-synth/Dockerfile        # the base image plus the baked-in `sfx-synth` binary
├── sfx-sample/Dockerfile       # the base image plus the baked-in `sfx-sample` binary + sample pack
├── music/Dockerfile            # the base image plus the baked-in `music` binary + instrument bank
├── sample-packs/               # per-pack manifests (name/tags/license/sha256); the audio
│                               #   files are NOT committed — a pack is a content-addressed
│                               #   artifact the sfx-sample/music image builds pin by digest
├── adversarial/                # the base image plus the wasm toolchain + Foray tooling
│   ├── Dockerfile              #   (foray CLI, references + map, controller buildkit)
│   └── buildkit/Cargo.toml     #   de-workspaced root for the baked buildkit crates
├── performance/                # the base image plus the wasm toolchain + Lattice tooling
│   ├── Dockerfile              #   (lattice CLI, reference engines, training, engine buildkit)
│   └── buildkit/Cargo.toml     #   de-workspaced root for the baked buildkit crates
└── build.sh                    # builds (and optionally pushes) all images
```

## Base image

`base/` carries everything common to a run and nothing harness specific: `git`
(each run is a fresh repository), a Node.js build toolchain (test cases produce
web UIs that are built inside the container), the shared libraries a headless
Chromium links against (so a test case can install Playwright and Chromium
*itself* and drive its build in a real browser to verify it), system fonts (a
slim base ships none, so without them Chromium and Canvas text render no glyphs —
`fonts-dejavu-core` covers the monospace stack the test cases require), the
`curl`/`unzip` tooling the curl-piped harness installers rely on, and an
unprivileged `node` user whose home is configured so both a harness's install
command and a test case's init command can install software at run time without
root.

The base image deliberately does **not** install the Playwright npm package or
the Chromium browser binary. A test case that needs a browser provides Playwright
as a dependency in its [workspace](/testing/end-to-end/overview/#workspace) (for
example a `package.json` pinning `playwright`) and installs it with the case's
[init command](/testing/end-to-end/overview/#init) (`npm install` then
`npx playwright install chromium`). This keeps browser tooling a visible,
project-local dependency a model installs and uses through its own project,
rather than a global tool a model has to know is already on the machine. Only the
OS-level libraries Chromium links against live in the image, because the
unprivileged run user cannot `apt-get` them at init time.

It likewise installs **no agent harness** and **no Test Cabinet binary**. The
harness CLI is installed into the container at run time from the harness's
[manifest](../harnesses/README.md), the same way and for the same reason a test
case prepares its workspace with an init command. An asset-generation run never
touches a drawing tool from the base, and none of them compiles Rust, so neither a
drawing tool nor the Rust toolchain lives here — the drawing tools live in the
asset-generation images below, and the Rust toolchain lives in **base-wasm** (next).
The base is **not itself a run image**: it is the build-time parent that base-wasm
and the asset-generation images are each built `FROM`. End-to-end runs execute in
base-wasm.

The base run image carries nothing for the **shippable Test Cabinet packages**
(below): a case that declares
[`packages`](../apps/docs/src/content/docs/testing/end-to-end/manifests.md) has
them **vendored into its run repository at seed time**, so the produced tree is
self-contained. The packages that get vendored come from a host **package store**
baked into the [driver image](../deployments/images/services.Dockerfile), which is
the image that seeds runs.

## Rust/wasm base image (`base-wasm`)

`base-wasm/` is the base image plus the shared **Rust → WebAssembly toolchain**, and
it is the image **every end-to-end run executes in** (and the parent the full-stack-2d,
adversarial, and performance images are each built `FROM`). It exists as its own layer,
rather than folding the toolchain into the base, so the asset-generation images — which
never compile Rust — do not carry it; and it is shared, rather than installed per
dependent image, so the adversarial and performance images no longer install a Rust
toolchain of their own.

It bakes on top of the base:

- the **Rust toolchain** (pinned; `RUST_VERSION` in `base-wasm/Dockerfile`) with the
  `wasm32-unknown-unknown` target, so `cargo build --target wasm32-unknown-unknown`
  works in-container during a run;
- **`wasm-bindgen-cli`**, so a build can use the `wasm-bindgen` crate to pass rich
  values across the JS ↔ wasm boundary rather than hand-marshalling integers through
  linear memory — the ergonomic path for a browser simulation core. Its version is
  pinned and **must match** the `wasm-bindgen` crate a build depends on, so a case that
  uses it pins its crate to the same version; and
- **`wasm-pack`** plus **`binaryen`** (`wasm-opt`), the conventional build/optimize
  pipeline, present so an offline run never needs to fetch a matching optimizer.

The toolchain is installed system-wide and made world-readable so the unprivileged run
user can invoke `cargo`/`rustc`/`wasm-bindgen`/`wasm-pack` and the wasm target without
root; its cargo registry/cache is owned by the run user so a build can resolve its own
crate dependencies at run time. A `profile.d` snippet re-adds cargo's bin dir to the
`PATH` a login shell (`bash -lc`) sees, because Debian's `/etc/profile` otherwise resets
it.

Crucially, this toolchain — like the asset-generation binaries — is on `PATH` **only
while the run is live**. It is **not** present when a build is re-run to
[validate](../apps/docs/src/content/docs/components/core/validation.md) it or when the
published source is rebuilt (that rebuild is a bare, Node-only `npm ci && npm run build`
off the run container). So a build that uses Rust must **compile once during the run and
commit the resulting `.wasm`** (and any generated JS glue) as a build input its bundler
consumes directly; `npm run build` must **not** invoke `cargo`/`wasm-pack`, exactly as
it must not shell out to `draw`. The case's specification states that contract.

## The shippable Test Cabinet packages

Some produced assets are **not self-describing data** the way a sprite PNG is: a
[particle](../apps/docs/src/content/docs/testing/asset-generation/particle-binaries.md)
effect is a `system.json` a game plays by **simulating it live**, and a voxel/mesh
rig is **posed** at runtime. A game that consumes one needs the *runtime that
plays it*, not just the asset. Those runtimes already exist in this repo as the
`@test-cabinet/*` libraries the in-repo viewers use
([`@test-cabinet/particle-runtime`](../packages/particle-runtime),
[`@test-cabinet/voxel-runtime`](../packages/voxel-runtime)); an end-to-end case
names the ones it needs with the manifest's
[`packages`](../apps/docs/src/content/docs/testing/end-to-end/overview.md#packages)
key, and the run consumes them as ordinary installed dependencies.

Because these packages are private (never npm-published) and must match the format
the validator and review UI play, they are **staged from this repo into a host
package store** rather than fetched from a registry. The store lives at
`/opt/tcab-packages/@test-cabinet/<name>/` (world-readable) on the
[driver image](../deployments/images/services.Dockerfile) — the image that seeds
runs — each a publish-shaped copy: its `package.json` plus its built `dist/`. Any
dependency **between** two shippable packages (for example `particle-runtime`'s
type-only dependency on `run-record`) is rewritten to a relative `file:` path
within the store, so the staged set resolves with no npm-published
`@test-cabinet/*` package required.

Staging is done by [`scripts/stage-tcab-packages.mjs`](../scripts/stage-tcab-packages.mjs),
run in a builder stage of the shared services Dockerfile (the build context is the
repository root, so the stage can see `packages/`). The script builds the
npm workspace, then for each package in its **shippable list** copies the package's
`package.json` and the files its `files` field publishes into
`/opt/tcab-packages/@test-cabinet/<name>/`, pulling in and rewriting transitive
`@test-cabinet/*` dependencies. The runtime stage `COPY --from`s that tree in.

**How a case uses them, end to end.** A case declares
`packages = ["@test-cabinet/particle-runtime"]` **and** ships a workspace whose
`package.json` depends on it via an in-repo relative path:
`"@test-cabinet/particle-runtime": "file:./.tcab/packages/@test-cabinet/particle-runtime"`.
The harness does not modify that `package.json` — it only validates at resolution
that the shipped file declares each declared package via exactly this `file:` spec.
At seed time the core copies the declared packages (and their `@test-cabinet`
closure) out of the store into `.tcab/packages/` inside the run repo and commits
them, so the seeded workspace is ready to `npm install` and the relative `file:`
dependency resolves wherever the produced tree later lives — the run container, the
validation host, or a clone of the published repo — with no absolute path to break.
The model imports the library like any other dependency (see
[Packages](../apps/docs/src/content/docs/testing/end-to-end/overview.md#packages)).

**The lockstep rule** is the same one the baked binaries carry: the staged
package format must match what `crates/core` and the review UI expect, so **build
the base image from the same commit as the orchestrator**. The set of names a case
may declare is validated in `crates/core` (the `SHIPPABLE_PACKAGES` allowlist in
[`crates/core/src/test_case.rs`](../crates/core/src/test_case.rs)) and must stay in
lockstep with the script's shippable list — a name in one but not the other either
fails resolution (a case names a package the image lacks) or bakes an unused package.

### Adding a package to the shippable set

The set is meant to grow as more produced-asset runtimes are consumed by games.
To add one:

1. **Make the package shippable.** It must build to a `dist/` with a package
   `exports` map and a `files` field listing what to publish (as
   `packages/particle-runtime` and `packages/voxel-runtime` already do). It should
   be framework-agnostic and MIT-licensed; a peer dependency the *game* provides
   (for example `three`) is fine — the game installs it — but a hard dependency on
   an npm-published package the run container cannot reach offline is not.
2. **Add it to the shippable list** in
   [`scripts/stage-tcab-packages.mjs`](../scripts/stage-tcab-packages.mjs). Any
   `@test-cabinet/*` package it depends on is staged and rewritten automatically;
   it need not be listed separately unless a case imports it directly.
3. **Add its name to the `SHIPPABLE_PACKAGES` allowlist** in
   [`crates/core/src/test_case.rs`](../crates/core/src/test_case.rs) so a case may
   declare it. Keep this in lockstep with step 2.
4. **Rebuild the base image** (`./build.sh base`; for the local cluster,
   `make -C deployments/local run-images-e2e` to rebuild and re-import just the
   base, or `run-images` for the whole set). The asset-generation images inherit it
   via `FROM` the base.

## Asset-generation images

Asset-generation runs split by [`asset_kind`](../apps/docs/src/content/docs/testing/asset-generation/manifests.md):
a single-sprite case draws with `draw`, a sprite-sheet case draws with
`draw-sheet`. Each gets its own image so a run carries only the tool it uses:

- `sprite/` is the base image plus exactly the **`draw`** binary, the drawing tool
  a single-sprite
  [asset-generation](../apps/docs/src/content/docs/testing/asset-generation/overview.md)
  run uses.
- `sprite-sheet/` is the base image plus exactly the **`draw-sheet`** binary, the
  drawing tool a sprite-sheet run uses (`draw` plus a required `--frame` on every
  operation).
- `ui/` is the base image plus the **`paint`** and **`ui`** binaries, the
  [UI](../apps/docs/src/content/docs/testing/asset-generation/ui-binaries.md) tools a
  run uses to paint a high-resolution interface asset — `paint` for layered raster
  work (brushes, blend modes, masks, filters, effects) and `ui` for crisp vector
  shapes, text, and nine-slice. Both ship in the one image because a run interleaves
  them over a shared workspace.
- `material/` is the base image plus the **`texture`** and **`pbr`** binaries, the
  [material](../apps/docs/src/content/docs/testing/asset-generation/material-binaries.md)
  tools a run uses to build a tileable PBR material — `texture` for seamless map
  painting and `pbr` for baking normal/AO maps, setting uniforms, assembling
  `material.json`, and rendering the lit 3D preview.
- `voxel/` is the base image plus exactly the **`voxel`** binary, the sculpting
  tool a static-voxel run uses.
- `voxel-animation/` is the base image plus exactly the **`voxel-anim`** binary,
  the sculpting-and-rigging tool a rigged-voxel run uses.
- `mc/` and `mc-animation/` are the base image plus exactly the **`mc`** /
  **`mc-anim`** binary, the Marching Cubes meshing tool (static / rigged) a
  low-poly meshing run uses.
- `sn/` and `sn-animation/` are the base image plus exactly the **`sn`** /
  **`sn-anim`** binary, the Surface Nets meshing tool (static / rigged) a
  smooth mid-fidelity meshing run uses.
- `dc/` and `dc-animation/` are the base image plus exactly the **`dc`** /
  **`dc-anim`** binary, the Dual Contouring meshing tool (static / rigged) a
  high-fidelity, sharp-feature meshing run uses.
- `mc-skinned/`, `sn-skinned/`, and `dc-skinned/` are the base image plus exactly
  the **`mc-skin`** / **`sn-skin`** / **`dc-skin`** binary, the
  [skinned-character](../apps/docs/src/content/docs/testing/asset-generation/skinned-binaries.md)
  tool a run uses to sculpt one continuous body field, bind it to a
  model-invented skeleton, and animate it as a deforming skin — one image per
  algorithm (low-poly / smooth / sharp), each inherently rigged.
- `particle-2d/` and `particle-3d/` are the base image plus exactly the
  **`particle-2d`** / **`particle-3d`** binary, the
  [particle-effect](../apps/docs/src/content/docs/testing/asset-generation/particle-binaries.md)
  tool a run uses to author an emitter system the review UI and a game play by
  simulating it live.
- `sfx-synth/`, `sfx-sample/`, and `music/` are the base image plus exactly the
  **`sfx-synth`** / **`sfx-sample`** / **`music`** binary, the
  [audio](../apps/docs/src/content/docs/testing/asset-generation/audio-binaries.md)
  tool a run uses to render a `.wav`. The `sfx-sample` and `music` images
  additionally bake in a **sample pack** / **instrument bank** — the tool's fixed
  palette (see [the sample library](#the-sample-library-and-instrument-bank)).

Each meshing image bakes in its one binary the same way `sprite`/`voxel` do; the
`-animation` images add the rigging/F-curve authoring that
`voxel-anim` uses. The voxel-family binaries render their preview PNGs with a
`wgpu` renderer targeting Mesa (software Vulkan, headless), not the old
deterministic isometric rasterizer, and their output is judged from the emitted
data plus the rendered previews — there is no cheat-divergence check on these
binaries.

Every asset-generation Dockerfile is `FROM` the base — **except the `blender`
image**, which is a self-contained `ubuntu:26.04` image that re-creates the run
contract itself (see its bullet above and [`blender/Dockerfile`](blender/Dockerfile)) —
so each inherits the toolchain, the `node` run user, the `/work` working directory, and
the keep-alive `CMD`, and adds only its binary — or, for the `ui` and `material` images,
its two binaries. Unlike a harness CLI, these binaries are part
of The Test Cabinet itself and must match the orchestrator's own logic — the
orchestrator regenerates a `draw`/`draw-sheet` run's scored image from its action
log through the *same* library those tools use, and core's validator decodes the
emitted data every other kind produces (the UI images, PBR maps, geometry, particle
system, or `.wav`) — so each is
compiled from this repo (a multi-stage build in its Dockerfile) and baked in
rather than installed at run time. Because of this coupling, **build the images
from the same commit as the orchestrator**: a run records both the orchestrator
commit and the image digest, so a version mismatch (which would invalidate the
`draw`/`draw-sheet` cheat-divergence signal, and could desync any binary from the
validator that decodes its output) is auditable after the fact. Compiling the binaries is
why the build context is the repository root rather than each image's directory
(see `build.sh`); `build.sh` builds every asset-generation image `FROM` the base
it builds alongside them, so they all stay in lockstep.

### Adding a `COPY` from the build context

`.dockerignore` at the repository root is an **allowlist**: it ignores everything
(`*`) and then re-includes, by name, the paths a build actually reads. So a new
`COPY <path>` in any Dockerfile here needs a matching `!/<path>` line — otherwise
the build dies with `failed to compute cache key: "/<path>": not found`, preceded
by `transferring context: 2B`, and nothing in the repository has changed to
explain it. This has bitten twice (the Blender image's authoring helpers; the gg
toolchain builder's Java installer, which took every `-gg` variant down with it,
because `build.sh` is `set -euo pipefail` and builds that builder before all of
them). `scripts/ci/build-context.sh` is the gate: it reads every tracked
Dockerfile against `.dockerignore` and fails on a source that is missing or
excluded, so the mistake is caught at commit time rather than the next time
someone needs a run container. Run it after adding a `COPY`.

## The sample library and instrument bank

The [`sfx-sample`](../apps/docs/src/content/docs/testing/asset-generation/audio-binaries.md)
tool mixes over a **sample library** and the `music` tool plays a **instrument
bank** — the fixed audio palette each ships with, exactly as `draw` ships with its
drawing logic. Because a run container is isolated and offline, the palette is
**baked into the image at build time**; nothing is fetched at run time.

The audio files themselves are **not committed to this repository**. What lives
here is a per-pack **manifest** under `sample-packs/` (one `<pack>.toml` per pack)
that lists each sample's stable `name`, `tags`, `description`, **`license`** — which
must be CC0 or otherwise permissive so a produced clip is freely usable in a test
case and a published run — its source URL, and a **`sha256`** content hash. The
pack itself is a **separately-versioned, content-addressed artifact** (an
object-storage tarball / OCI artifact) assembled by
[`scripts/build-sample-pack.mjs`](../scripts/build-sample-pack.mjs), which fetches
the sources the manifest names, verifies each hash, normalizes them (sample rate,
loudness, trim, format), and packs them. The `sfx-sample` and `music` image builds
**pin a pack version by digest** and bake it in, so updating the palette is a new
pack version plus an image rebuild — versioned immutably with the image, and a case
names the pack it expects (`sample_pack` / `instrument_bank`) rather than any path
in this repo.

The **`music` image bakes every instrument bank** (`gm-lite`, plus the
domain-tailored **`cinematic`** and **`synthwave`** banks) as a per-name
subdirectory under `/opt/instrument-banks/`, so a case's
`instrument_bank = "<name>@<version>"` **selects** which palette the run plays
(resolved by `select_pack_dir` in `crates/audio-core/src/config.rs`);
`build.sh`'s `build_music_image` presigns and passes each bank. An `sfx-sample`
image still bakes its single sample pack. Adding a bank is: extend the `BANKS`
registry in [`scripts/curate-instrument-bank.mjs`](../scripts/curate-instrument-bank.mjs),
curate + publish it, then add its build args + subdir to `music/Dockerfile` and
`build_music_image`.

## Adversarial image

`adversarial/` is the **base-wasm** image plus **The Test Cabinet's own Foray
tooling** (`adversarial/Dockerfile` is `FROM` base-wasm, so it inherits the Node
toolchain, the shared **Rust toolchain with the `wasm32-unknown-unknown` target**,
the `node` run user, the `/work` working directory, and the keep-alive `CMD`). An
[adversarial](../apps/docs/src/content/docs/testing/adversarial/overview.md) run
asks the model to write a controller in Rust; the case's `[build]` commands
compile that controller to a wasm core module **inside this container at run
time**, which is why base-wasm carries the Rust toolchain (installed system-wide,
world-readable, with a run-user-owned cargo registry — see the **base-wasm** section
above). This image adds only the Foray tooling.

Like the asset-generation images, this one **also bakes in The Test Cabinet's own
tooling**, compiled from `crates/` in a multi-stage build and copied under
`/usr/local/bin` and `/opt/foray`:

- the **`foray` CLI** (`/usr/local/bin/foray`) — the binary a model runs its
  controller through to play local matches against the baselines. It hosts the
  *same* `foray-host` engine the validator scores with, so it must be built from
  this repo and kept in lockstep, not installed at run time;
- the **controller buildkit** (`/opt/foray/buildkit`) — fresh, source-only copies
  of `foray-core` and `foray-controller-sdk` (with a de-workspaced root manifest,
  [`adversarial/buildkit/Cargo.toml`](adversarial/buildkit/Cargo.toml), that
  re-supplies their `workspace = true` inheritance) that the seeded `controller`
  crate path-depends on to build — so the run workspace vendors nothing; and
- the **reference controllers** (`/opt/foray/references`, pre-built wasm + readable
  source) and the **canonical map** (`/opt/foray/maps`) — the baselines a model
  plays against. `$FORAY_HOME` is set to `/opt/foray` so specs and a model can name
  these by `$FORAY_HOME/references/…` rather than a hard-coded path.

The same coupling argument as the asset-generation binaries applies: the CLI, the
buildkit crates, and the reference modules must match the engine the validator
scores against, so **build this image from the same commit as the orchestrator**
(a run records both the orchestrator commit and the image digest, so a mismatch is
auditable). Compiling them is why the build context is the repository root rather
than the image's directory (see `build.sh`); the build also smoke-compiles the
buildkit standalone, so a buildkit root that has drifted from the repository's
workspace dependencies fails the image build.

## Performance image

`performance/` is the **base-wasm** image plus **The Test Cabinet's own Lattice
tooling** (`performance/Dockerfile` is `FROM` base-wasm, so it inherits the Node
toolchain, the shared **Rust toolchain with the `wasm32-unknown-unknown` target**,
the `node` run user, the `/work` working directory, and the keep-alive `CMD`). A
[performance](../apps/docs/src/content/docs/testing/performance/overview.md) run
asks the model to write a factory-simulation engine in Rust; the case's `[build]`
commands compile that engine to a wasm core module **inside this container at run
time**, exactly as the adversarial image compiles a controller — both inherit that
Rust toolchain from base-wasm (system-wide, world-readable, with a run-user-owned
cargo registry). This image adds only the Lattice tooling.

Like the adversarial image, this one **also bakes in The Test Cabinet's own
tooling**, compiled from `crates/` in a multi-stage build and copied under
`/usr/local/bin` and `/opt/lattice`:

- the **`lattice` CLI** (`/usr/local/bin/lattice`) — the binary a model runs to
  solve scenarios with the oracle and score its engine locally. It hosts the
  *same* `lattice-host` the validator scores with, so it must be built from this
  repo and kept in lockstep, not installed at run time;
- the **engine buildkit** (`/opt/lattice/buildkit`) — fresh, source-only copies of
  `lattice-core` and `lattice-sdk` (with a de-workspaced root manifest,
  [`performance/buildkit/Cargo.toml`](performance/buildkit/Cargo.toml), that
  re-supplies their `workspace = true` inheritance) that the seeded `engine` crate
  path-depends on to build — so the run workspace vendors nothing;
- the **training scenarios** (`/opt/lattice/training`, each
  `<name>/{scenario.json,expected.json}`) — the labelled practice set, copied from
  the case's version folder. `$LATTICE_HOME` is set to `/opt/lattice` so specs and
  a model can name these by `$LATTICE_HOME/training/…` rather than a hard-coded
  path. The **held-out scored set is never baked here** — it lives only with the
  case, so a model cannot reach it. Neither are the reference engines: the model's
  only route to the reference is the `lattice` CLI's oracle, which reports
  correctness and the model's own fuel, never the reference's.

The same coupling argument as the adversarial tooling applies: the CLI, the
buildkit crates, and the training set must match the types and checksum the
validator scores against, so **build this image from the same commit as the
orchestrator** (a run records both the orchestrator commit and the
image digest, so a mismatch is auditable). Compiling them is why the build context
is the repository root rather than the image's directory (see `build.sh`); the
build also smoke-compiles the buildkit standalone, so a buildkit root that has
drifted from the repository's workspace dependencies fails the image build.

## Building

Run on a machine with Docker (or Podman) available:

```sh
./build.sh                     # build all images (the base, every asset-generation kind, adversarial, performance, and the `-gg` variants)
./build.sh voxel-animation     # build ONLY the named image(s) — base is (re)built as needed for the FROM
./build.sh adversarial performance
DOCKER=podman ./build.sh       # build with Podman instead
```

### The shared asset-tooling builder

Every asset-generation image bakes in one or more binaries compiled from `crates/`,
and all of them get those binaries from a single builder image,
`tools/Dockerfile` → `test-cabinet-tools:latest`.

That builder runs ONE `cargo build` over the union of every asset tool's dependency
graph and exports the resulting binaries as a `scratch` image; each asset image then
resolves it through a `TOOLS_IMAGE` build arg and `COPY --from=tools /out/<bin>`.
(A `COPY --from` cannot interpolate a build arg directly, so each Dockerfile brings
the arg in through a `FROM ${TOOLS_IMAGE} AS tools` stage first — the same idiom
`BASE_IMAGE` already uses.)

This replaced a per-image `cargo build`, which recompiled the shared dependency
graph from scratch for every image: **1865 crate-compilations across the set where
only 182 distinct crates exist** — `syn`, `serde` and `proc-macro2` built 23 times
each, the ~90-crate `wgpu`/`naga` graph that the 13 rendering tools share built 13
times over, and `ui`/`material` compiling the *identical* `test-cabinet-paint` crate
twice. The builder also carries cargo registry/target cache mounts, so an
incremental rebuild costs only the crates that actually changed.

`build.sh` **always** rebuilds it when any consuming image is selected, rather than
reusing a present one the way it reuses the base. The base is a stable OS+toolchain
layer, but this image holds the compiled tooling — reusing a stale one would bake
yesterday's `voxel-anim` into today's run image. A no-change rebuild is near-instant.

It is deliberately **not** a run image: nothing executes in it, it never appears in
`image-names.sh`, and it is never pushed. The adversarial and performance images are
also not built from it — they compile to `wasm32-unknown-unknown` as well as the host
target and assemble their own standalone buildkits, so they keep their own build
stages (with the same cache mounts applied directly).

### The gg toolchain builder

`gg-toolchains/Dockerfile` is a second builder of exactly the same shape and for
exactly the same reason: it assembles every language toolchain a gg run's programs
may be compiled with under one prefix (`/opt/gg/toolchains`), exports it as a
`scratch` image, and each `-gg` variant resolves it through a `GG_TOOLCHAINS_IMAGE`
build arg and copies the tree out. It is not a run image and never appears in
`image-names.sh` — that list is the set of images a *run resolves*, and `build.sh`'s
`build_one` dispatches on it by name, so an entry would route `make run-images` through
the asset-image builder. (The Rust suite is not what blocks it: that test keeps a
`NOT_A_RUN_IMAGE` exception list, which already holds `base`.) Like the asset tooling it is **always**
rebuilt when any variant is selected, because it carries the compilers a run's
programs are judged by.

Unlike the asset tooling it **is** pushed under `PUSH=1`, and the difference between the
two is worth stating. The asset tooling is ~20 Rust binaries compiled from this checkout
behind cargo cache mounts, so a registry copy would save nothing. This tree is ~1.9 GB
fetched from five upstreams and pruned, and it is byte-identical in every `-gg` variant —
so publishing it means the tree inside those variants is pullable and pinned by digest on
its own terms rather than only inspectable by taking a run image apart, and
`./build.sh <name>-gg` can be pointed at the published tag through `GG_TOOLCHAINS_IMAGE`
instead of paying for the fetch again. The registry stores the layers once however many
variants carry them. Because it is not in `image-names.sh`, the `manifest` job in
`build-containers.yml` — which is driven by that list — fuses this one arch pair by name,
immediately after its loop.

Two constraints bind every toolchain added to it, and both are written down in the
Dockerfile's header. It must be **relocatable and distribution-portable** — the same
tree is copied to the same absolute path onto the Debian-based images and onto
`blender-gg`, whose parent is Ubuntu. And it must be drivable **isolated per invocation**:
several compilers run concurrently inside one run, and a shared build strategy and
a shared output tree have each been measured interleaving two agents' programs
while every process exited zero. The calling side supplies most of that — gg runs every
compiler with its working directory, `HOME`, `TMPDIR` and `XDG_*` roots inside that
preparation's own tree — so what this constrains is the toolchain that can *only* be
driven through a process shared between compilations. See
[per-agent compiler isolation](../apps/docs/src/content/docs/gg/program-languages.md#per-agent-compiler-isolation).

The tree carries **PureScript**'s toolchain today: `purs` and `esbuild`, both statically
linked, both a single file, and both pinned by
[`packages/gg-sandbox-purescript/purescript-version.sh`](../packages/gg-sandbox-purescript/purescript-version.sh)
and installed by
[`scripts/ci/install-purescript.sh`](../scripts/ci/install-purescript.sh) — which the
Dockerfile runs rather than duplicating, so a pin is edited in one place. (It used to pass
the two versions in as build args over `ARG` defaults that restated them; a default is a
second answer, correct only until somebody edits the version file, and it was reachable by
any `docker build -f` that skipped `containers/build.sh`.) What is *not* here is the library
set a PureScript program is compiled against: that is compiled at build time into a cargo
`OUT_DIR` and embedded in gg's binary, because this image is built separately from the
binary that runs in it and a library tree of a different vintage from the SDK compiled into
it would mean a model shown one surface and compiled against another.

It carries **Java**'s too, and that one is not a single file: a Temurin JDK (javac is a JDK,
not a JRE) and ~29 MB of TeaVM jars, pinned by
[`packages/gg-sandbox-java/java-version.sh`](../packages/gg-sandbox-java/java-version.sh) and
installed by [`scripts/ci/install-java.sh`](../scripts/ci/install-java.sh) — which the
Dockerfile runs rather than duplicating, so the list of jars exists once. A JDK is not
excluded by the "shared process" constraint above: gg drives it through a **pool** of warm
JVMs that lends each to one preparation at a time, which is what makes a warm build
(0.33–0.56 s) affordable where a cold one is 4–9 s, and what makes the measured TeaVM
corruption's precondition impossible. gg's own compiler driver is *not* here — it is one
`.java` file inside gg's binary, run by the JDK's single-file source-code launcher, for the
vintage reason PureScript's library set is not here either.

**Kotlin** rides on top of that, and adds ~67 MB of compiler jars and nothing else: a Kotlin
program is compiled to JVM bytecode and handed to the *same* TeaVM, so everything from
bytecode onwards already exists here. Its installer
([`scripts/ci/install-kotlin.sh`](../scripts/ci/install-kotlin.sh)) runs the Java one rather
than installing a second JDK beside it. One directory it writes is not a classpath: gg
compiles a model's program as a Kotlin **script** — because Kotlin refuses `object`,
`interface`, `enum class`, `typealias` and `private fun` as *local* declarations, so a
wrapper function would refuse five things a Kotlin author writes without thinking — and the
compiler loads its scripting plugin by four unversioned file names out of a `kotlin-home/lib`
tree the installer lays out.

**Rust** is the heaviest thing in the tree — **~376 MB** — and the first that is not a
compiler *for* a guest. Every arm above compiles a model's program into something an
interpreter already inside a committed component evaluates; `rustc` emits the component
itself, per turn, because there is no Rust runtime to commit. What is installed is a rustup
`minimal` toolchain pruned to `rustc`, its two shared libraries, the
`wasm32-unknown-unknown` standard library and `rust-lld` — with `cargo`, `rustdoc`, the
lint tools, the standard-library sources, the documentation share and the *host* standard
library all removed, none of which a cross-compile of a program with no proc macros
touches. A rustup toolchain directory is relocatable (`rustc` derives its sysroot from its
own path), and the Dockerfile proves it by compiling a `cdylib` with the pruned copy before
the layer is exported. Its version is not pinned in this image or in its package: it is
[`rust-toolchain.toml`](../rust-toolchain.toml)'s, because an `.rlib` is a
compiler-version-private format and the compiler here must be exactly the one that built
the library set inside gg's binary — so there is only one Rust release in the repository at
all. That set is not here, for the vintage reason PureScript's is not.

**Swift** is the second arm of that shape and the second heaviest thing in the tree —
**~835 MB**, against `rustc`'s 376 MB — because a Swift cross-compile needs a compiler, a
target SDK holding a wasm sysroot and standard library, *and* a vendored copy of the shared
libraries the published linker was built against. That last one is the whole reason its
install is a script rather than two `curl`s: the toolchain is built for Debian 12 and its
`lld` links against that distribution's `libxml2` soname, which the Debian-derived run images
have and `blender-gg`'s Ubuntu does not — and this tree is copied to the same absolute path in
both. So [`scripts/ci/install-swift.sh`](../scripts/ci/install-swift.sh) puts that library and
its closure under `<home>/lib`, and gg names that directory on `LD_LIBRARY_PATH` for every
compile. What is kept out of 3.3 GB is the driver, the front end, `clang`, `lld` and the
transitive closure of the shared objects those actually need — walked rather than copied by
directory, which is what leaves Foundation's networking half and `libcurl`'s system closure
behind; what goes with them is the editor services, the debugger, the formatter, the
documentation tool, the build system, the *host* standard library and 577 MB of Embedded Swift
resources for every target. The Dockerfile proves the pruning by compiling both a C file
and a Swift file for the wasm target with the pruned copy, because each of those exercises a
different half of what was deleted. The bindings a program is compiled against are not here,
for the vintage reason PureScript's library set is not.

**C++** is the third arm of that shape and the **lightest** of the three — ~200 MB, against
`rustc`'s 376 MB and Swift's 835 MB — because wasi-sdk is one relocatable tree holding a
clang, a `wasm-ld`, a wasi-libc sysroot and a libc++. It is also the least work to make
portable, and that is the toolchain rather than the script: `clang` finds its own sysroot
from its own path, every binary carries an `$ORIGIN/../lib` rpath, and the only things
outside the tree it needs are the two GCC-runtime sonames its Debian build links — so
[`scripts/ci/install-wasi-sdk.sh`](../scripts/ci/install-wasi-sdk.sh) copies exactly those
two in beside it, where that rpath finds them and nothing else in the image does. No
`LD_LIBRARY_PATH`, no closure walk. What is dropped out of ~650 MB is `lldb`, the lint and
format tools, the object utilities, the other linker drivers, `wasm-component-ld` — and, the
largest deletion by far, four of the wasi-sysroot's five *targets*, since gg compiles to
exactly the one its package pins. The Dockerfile proves the pruning by compiling both a C
file and a C++ one for the wasm target with the pruned copy, because a C++ compile
additionally needs libc++'s headers, its archives and `libunwind`, and a C compile touches
none of them. Two things are not here: the bindings a program is compiled against, for the
vintage reason PureScript's library set is not; and the **precompiled header** of the ~55
standard-library headers every program is compiled with — that one is built once per
*machine*, into a content-keyed shared directory, because a PCH is readable only by the clang
that wrote it.

Build-only mode tags every image as `test-cabinet-<name>:latest` locally (one per
directory alongside this README, plus the base). Those are exactly the names a runner
resolves (by test type and asset
kind) when its `TCAB_CONTAINER_REGISTRY` is set to an empty string, so a
locally-built image is used for offline development without pulling anything.
Override `IMAGE_TAG` / `IMAGE_NAME_PREFIX` to change the tag or name prefix.

With `PUSH=1` and `IMAGE_REGISTRY` set (e.g. `ghcr.io/theclockwyrks`), each image
is pushed and its pinned `repo@sha256:…` digest printed. Runners resolve the
published image directly from their own registry configuration; the script does
**not** register anything with the backend, which plays no part in container
distribution (see `../apps/docs/src/content/docs/components/core/execution.md`).

### The gg CI toolchain image

[`gg-ci/Dockerfile`](gg-ci/Dockerfile) is the odd one out in this directory: it is neither
a run image nor a builder anything here copies from. It exists for the machines that
**compile** gg rather than the containers that run it.

Since the eleven signature catalogues stopped being committed, `crates/gg/build.rs`
reflects each of them out of its arm's own SDK with its arm's own documentation tool on
every build — and since every arm's *artifacts* followed them, that same build also **runs**
those toolchains rather than only reading with them: it bakes four language runtimes and
links six compile targets. So a machine that cannot run `swiftc`, `javac`, `purs`, Roslyn and
the rest cannot run `cargo build --workspace` at all.
`scripts/ci/install-gg-toolchains.sh` is the one pinned list that makes a machine such a
machine, and it works; what it costs a cold CI agent is ten-ish minutes across five separate
upstreams, each of which is a way for a run to go red for a reason unrelated to the change
under test. This image is those ten minutes, done once, published, and pulled.

**Two tags, and a gg build wants the bigger one.** `:latest` is that eleven-arm run set;
`:build-latest` adds the unpruned .NET SDK and wasi-sdk that relinking the C# arm's guest
needs (`scripts/ci/install-gg-build-toolchains.sh`, ~1.5 GB more). The split was made when
that guest was committed and re-cut by hand, so only one job wanted the bigger tag; now that
`cargo build` re-cuts it, both `ci.yml` jobs pull `:build-latest`. `:latest` remains for
consumers that run gg or read its pins rather than compiling it — which is what the pruning
in the run installers exists for.

Three things about it are decisions rather than details:

- **It installs into a staged `$HOME` (`/gg-home`), not `/opt`.** That is what makes it a
  second image rather than a `--target` of `gg-toolchains`. The run tree lives at
  `/opt/gg/toolchains` because gg resolves it there inside a run container; the *build*
  path resolves through `$HOME`, and three of the eleven arms cannot be redirected away
  from it at all — `install-uv.sh` overwrites any inherited `UV_INSTALL_DIR`, YARD is a
  `--user-install` gem in `Gem.user_dir`, and the `wasm32-unknown-unknown` standard library
  is a rustup component. So this image runs the shared installer with **no overrides**: the
  defaults are the point.
- **It is not in `image-names.sh` and `build.sh` never builds it.** `make run-images` must
  not start a 1.9 GB build of something no run container will pull, and that list is the set
  of images a *run resolves* (asserted both ways by the Rust suite). It has its own
  workflow, [`build-gg-ci-image.yml`](../.github/workflows/build-gg-ci-image.yml), whose
  `paths:` are the closure of the pinned list expressed as globs, so a new arm is covered
  without an edit.
- **Hydrating from it never replaces the pinned installer.**
  [`scripts/ci/hydrate-gg-toolchains.sh`](../scripts/ci/hydrate-gg-toolchains.sh) copies the
  tree in *before* `rust-test.sh` / `contract-drift.sh` run `install-gg-toolchains.sh` as
  they always have. The image supplies the bytes; the pinned list verifies them, and repairs
  the one arm an image built before a pin moved has wrong. Every failure path in that
  script — no image yet, a fork, a registry hiccup — falls back to the full install and
  exits 0, because the commit that introduces all of this is by definition the commit
  before the image exists.

## Runtime contract

The testing harness — not this image — owns how a container is run. The image
only promises an environment that honors the following contract:

- **Working directory** is `/work`. The seeded repository is mounted there at run
  time; it is the harness's working directory.
- **Secrets** (API keys) are passed in **at run time as environment variables**
  and are never baked into the image or committed anywhere. The testing harness
  sets the variable the selected harness expects.
- **Network** is enabled at run time so the harness can install itself and reach
  model APIs and package registries. Isolation protects the host filesystem and
  other runs, not the network.
- **Lifecycle**: a container is started and left running (the base `CMD` keeps it
  alive); the testing harness installs the selected harness's CLI, then `exec`s
  the agent harness inside it, then stops the container when the run finishes.
- **User**: the image runs as uid 1000 (`node`). On a host whose checkout is
  owned by a different uid, the testing harness is responsible for reconciling
  ownership of the mounted repository.

## Status / validation

This definition is authored but **not yet built or validated** — that requires a
Docker host. When validating on Linux, build all images (`./build.sh`) and
confirm a container from each runs and keeps alive, that `draw` is on `PATH` in
the sprite image and `draw-sheet` is on `PATH` in the sprite-sheet image, that
each voxel-family binary (`voxel`, `voxel-anim`, `mc`, `mc-anim`, `sn`, `sn-anim`,
`dc`, `dc-anim`) is on `PATH` in its matching image, and
that the adversarial image gives the unprivileged run user `cargo`/`rustc` and the
`wasm32-unknown-unknown` target (e.g. `cargo --version` and a trivial
`cargo build --target wasm32-unknown-unknown` as `node`), `foray` on `PATH`
(`foray --version`), and a buildable controller against the baked buildkit — copy
a case's `controller/` and confirm `cargo build --release --target
wasm32-unknown-unknown -p controller` emits `controller.wasm` and
`foray simulate --red … --blue $FORAY_HOME/references/border-soldier.wasm --map
$FORAY_HOME/maps/mirror-32x16.toml --out replay.json` runs as `node`. Validating each
**harness** — that its
[install command](../harnesses/README.md) lands a working CLI on `PATH`, the
exact non-interactive flags, its token/usage reporting format, and which
environment variable carries the provider API key — is tracked alongside the
harness manifests and the adapters in `crates/core/src/harness_registry.rs`.
