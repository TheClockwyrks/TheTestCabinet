# The procedural sound-effect run-container image for The Test Cabinet.
#
# Every procedural sound-effect run (a case with `asset_kind = "sfx-synth"`) executes
# in this one image. It is the base run-container image plus the baked-in `sfx-synth`
# binary, the tool a synthesis run builds a sound from oscillators and noise with (see
# the asset-generation docs under
# `apps/docs/src/content/docs/testing/asset-generation/audio-binaries.md`). The audio
# tools render a `.wav` and a waveform/spectrogram PNG on the CPU, so — like the
# sprite image and unlike the voxel family — this image needs no Mesa/Vulkan runtime.
#
# The binary is baked in rather than installed at run time because, unlike a harness
# CLI, it is part of The Test Cabinet itself and core validates the emitted `.wav`
# with the same library it uses. This image copies it out of
# `tool-sfx-synth:<commit>`, the image tool-sfx-synth's pipeline publishes, at the
# commit the driver pins, which is the superrepo's `tool-sfx-synth` gitlink, so the
# binary and what validates its output stay in lockstep (a run records the
# orchestrator commit and the image digest, so a mismatch is auditable). See
# `containers/build.sh` and `scripts/ci/tool-images.sh`.

# `BASE_IMAGE` is the base image to extend. Declared BEFORE the first `FROM` so it is a
# global build arg the run-image `FROM` below can consume; `build.sh` passes the base
# image it just built.
ARG BASE_IMAGE=test-cabinet-base:latest

# `TOOL_SFX_SYNTH_IMAGE` is the `tool-sfx-synth` image the binary is copied out of:
# `testcabinet.azurecr.io/tool-sfx-synth:<commit>` at the commit the driver pins, or,
# for a local build without PUSH, the image `build.sh` has just built from the
# `tool-sfx-synth/` checkout (`scripts/ci/tool-images.sh` names the reference).
# Declared BEFORE the first `FROM` for the same reason `BASE_IMAGE` is: an `ARG`
# after a `FROM` is scoped to that stage.
ARG TOOL_SFX_SYNTH_IMAGE=test-cabinet-tool-sfx-synth:latest

# Resolve the tool image to a named stage. `COPY --from=` cannot interpolate a
# build arg directly ("variable expansion is not supported for --from"), so it
# has to arrive through a `FROM`; the `COPY --from=tool-sfx-synth` line below then
# names this stage.
FROM ${TOOL_SFX_SYNTH_IMAGE} AS tool-sfx-synth

# --- The run image: the base, plus `sfx-synth` ------------------------------
# `FROM` the base built alongside this image (the global `BASE_IMAGE` arg above).
FROM ${BASE_IMAGE}

# Bake in the `sfx-synth` binary from the tool-sfx-synth image, which carries it in
# `/usr/local/bin`. That directory is on PATH and root-owned (COPY writes as root
# regardless of the inherited `USER node`); the unprivileged run user only executes
# it. The base image already sets `USER node`, `WORKDIR /work`, and the keep-alive
# CMD, so nothing else is needed here.
COPY --from=tool-sfx-synth /usr/local/bin/sfx-synth /usr/local/bin/sfx-synth
