# shellcheck shell=bash
# shellcheck disable=SC2034  # every variable here is read by the scripts that source this file

# The Opal release this package's two committed artifacts are built from — sourced by both
# `compiler.sh` (which cuts the host-side compiler) and `build.sh` (which bakes the guest around
# Opal's runtime).
#
# ONE pin, in one file, because the two artifacts have to be the same Opal. The compiler emits
# JavaScript against a runtime's private conventions — how a method is defined, how a `send` is
# dispatched, what a block closes over — and a program compiled by one Opal and evaluated against
# another's runtime does not fail cleanly. Two pins in two scripts would be one edit away from
# exactly that.
#
# `opal-compiler` is Opal's own compiler with a self-hosted JavaScript build, and it depends on
# `opal-runtime`, which is the runtime. Both come out of the one install.
OPAL_COMPILER_VERSION="3.0.0"

# `componentize-js`, which bakes the guest. Pinned for the reason the TypeScript guest pins it: the
# component is a binary in the repository, so a silent toolchain bump would land as an unexplained
# multi-megabyte diff. It is the SAME release the ECMAScript guest is baked with, deliberately —
# this guest is that guest plus a runtime, and two engines would be a difference between the arms
# nobody chose.
COMPONENTIZE_VERSION="0.21.0"
