# The game-jam run-container image for The Test Cabinet.
#
# Every game-jam run (a case authored as a `game-jam.toml`, `type` game-jam)
# executes in this one image. A jam is a full-stack-style build — the model designs
# and builds a complete browser game AND produces its own 2D assets during the run —
# but a jam is deliberately NOT a full-stack test case, so it resolves its own image
# (see `harness::resolve_run_image`) rather than borrowing the full-stack one. Giving
# jams a dedicated image lets a deployment pin/override the jam image independently
# (`TCAB_CONTAINER_IMAGE_GAME_JAM`) and keeps the two run types decoupled.
#
# It is built `FROM` the full-stack-2d image, so it inherits everything a jam needs:
#   - the six 2D asset-generation binaries on `PATH` (`draw`, `draw-sheet`,
#     `particle-2d`, `sfx-synth`, `sfx-sample`, `music`) and the two baked audio
#     packs, so a jam produces its own art, effects, and sound during the run;
#   - the base-wasm Rust + `wasm32-unknown-unknown` + `wasm-bindgen`/`wasm-pack`
#     toolchain, so a model MAY author its game's core in Rust and ship it as a
#     committed wasm build input (exactly as an end-to-end/full-stack build may) —
#     the compiled wasm is a build INPUT, not a build step, so `npm run build` must
#     bundle the committed `.wasm` and must NOT invoke `cargo`/`wasm-pack`; and
#   - the unprivileged `node` run user, `/work` working directory, Node build
#     toolchain, git, and the Chromium system libraries.
#
# Nothing is added on top of the full-stack-2d image except this image's own
# identity: the whole point is a separately-pinnable jam image with the same
# capabilities. `date` (coreutils, from the Debian base) is present so a model can
# run it to read the current time and judge how much of its time budget remains —
# the budget itself is stated in the jam prompt (`{{time_limit_hours}}`). The build
# below asserts `date` is on `PATH` so the image can never ship without it.
#
# The build context is the repository root, matching the other images (see
# `containers/build.sh`).

# `BASE_IMAGE` is the image to extend — the full-stack-2d image built alongside this
# one. Declared BEFORE the first `FROM` so it is a global build arg the `FROM` below
# can consume. `build.sh` passes the full-stack-2d image it just built (e.g. the
# local `test-cabinet-full-stack-2d:latest`, or a registry-qualified tag) so this
# image is always `FROM` the matching full-stack-2d.
ARG BASE_IMAGE=test-cabinet-full-stack-2d:latest

FROM ${BASE_IMAGE}

# Assert coreutils `date` is present (it is, via the Debian base) so a jam run can
# always check the wall-clock time against its budget. This fails the build rather
# than shipping an image where `date` is somehow missing. Runs as the inherited
# unprivileged `node` user; the base already sets `WORKDIR /work` and the keep-alive
# CMD, so nothing else is needed here.
RUN command -v date >/dev/null || { echo "date is not on PATH" >&2; exit 1; }
