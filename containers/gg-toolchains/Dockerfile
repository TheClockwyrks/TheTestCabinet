# syntax=docker/dockerfile:1
# The **gg language-toolchain** BUILDER image for The Test Cabinet's run containers.
#
# This is NOT a run image: nothing ever executes in it and it is never published. It
# exists solely as a `COPY --from` source, exactly as `containers/tools` does, so the
# toolchains land in one place and every gg run image copies the same tree.
#
# Why this exists
# ---------------
# `gg`'s [responses-as-code] capability lets a model answer with a *program* rather than
# with tool calls, and the language that program is written in is a run variable — the
# point of the capability being to ask whether it changes how well a model works. A
# compiled language needs its compiler on the turn path, inside the run container, and gg
# itself is a single static binary copied in at run time: a binary copies fine, a JDK does
# not.
#
# It is a variant image rather than a layer on the shared run images because these
# toolchains exist for ONE harness. A run driven by Claude Code, Codex or any other CLI
# harness must not carry them — they are gigabytes a run that cannot use them would pull,
# and a model that found a Swift compiler on `PATH` in an end-to-end run would have been
# handed a capability no other arm of that comparison has. `containers/gg/Dockerfile` is
# the thin layer that puts this tree on top of a run image; `harness::gg_variant` in
# `crates/core` is what resolves a gg run to it.
#
# What goes in it
# ---------------
# One toolchain per program language gg can drive, all of them together. "Together" is not
# a convenience: a program's language is resolved **per agent**, so a single run may drive
# a C# agent and a Python agent at the same time, and an image carrying one language's
# compiler would be an image that cannot run that configuration at all.
#
# Everything installs under a single prefix, `/opt/gg/toolchains`, with executables in
# `/opt/gg/toolchains/bin`. Nothing may install into `/usr`, `/etc` or any other shared
# path: the consuming image copies `/opt/gg` and nothing else, so anything written
# elsewhere is silently dropped, and a package manager run here would additionally bind
# this tree to one distribution's library versions.
#
# Two constraints every toolchain added here must meet
# ----------------------------------------------------
# 1. **Relocatable and distribution-portable.** Every run image publishes a `-gg` variant,
#    so this tree is copied onto the Debian-bookworm-derived images *and* onto
#    `blender-gg`, whose parent is Ubuntu — and it is copied
#    to the same absolute path in both, so a toolchain that hard-codes a build-time prefix
#    or links a library only one of them ships is a toolchain that works on some gg runs
#    and not others. Prefer a statically linked or self-contained distribution; where that
#    is impossible, the language's own step is responsible for vendoring what it needs
#    under `/opt/gg`.
# 2. **Isolated per invocation, by construction.** Several compilers run CONCURRENTLY
#    inside one run — up to `limits.maxParallel` agents times a program chain of four — and
#    two silent-corruption bugs were measured from exactly that: a shared TeaVM build
#    strategy and a shared `purs` output tree each interleaved two agents' programs while
#    every process exited zero. A toolchain installed here must be usable with a
#    per-invocation working tree, output directory and process; anything that only works
#    through a shared daemon, a shared build cache or a fixed output path does not belong
#    in this image until it can. It need not be *told* to be isolated: the calling side
#    (`crates/gg/src/sandbox/language/compile.rs`) runs every compiler with its working
#    directory, `HOME`, `TMPDIR` and `XDG_*` roots inside that preparation's own tree, so a
#    toolchain that writes beside its input or into the user's cache is isolated without
#    being configured for it. What must NOT be installed here is a toolchain that can only
#    be driven through a process shared between compilations — and a toolchain worth
#    keeping warm is driven from a `CompilerPool`, which lends an instance exclusively.
#    `crates/gg/src/sandbox/language/isolation.rs` is the gate that holds every language to
#    this at 16-way concurrency, and it reproduces both measured bugs to prove it can.
#
# The layer is empty today, on purpose: this workflow builds the mechanism, and each
# toolchain arrives with the language that needs it. An empty `/opt/gg` costs a gg run
# nothing and means the resolution seam, the build, and the published variant images are
# all exercisable before the first compiler lands.

FROM debian:bookworm-slim AS build

# The tree every consuming image copies. `bin` is created up front because
# `containers/gg/Dockerfile` puts it on `PATH` unconditionally — an image whose `PATH`
# names a directory that does not exist is a confusing thing to debug, and a directory
# that exists and is empty is not.
RUN mkdir -p /opt/gg/toolchains/bin

# --- Toolchains -------------------------------------------------------------
# One block per program language, each installing under /opt/gg/toolchains and touching
# nothing outside it. Added with the language that needs them; see the header for the two
# constraints each must meet.

# --- Export just the tree ---------------------------------------------------
# `scratch` so this published-nowhere builder carries no base layers: it is only ever a
# `COPY --from` source, and keeping it to the toolchain tree alone means the gg run images
# pull the smallest possible thing out of the local image store.
FROM scratch
COPY --from=build /opt/gg /opt/gg
