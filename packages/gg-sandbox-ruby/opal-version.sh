# shellcheck shell=bash
# shellcheck disable=SC2034  # every variable here is read by the scripts that source this file

# The Opal release this package's artifacts are built from — the host-side compiler `build.sh` cuts
# in step 2, and the runtime it bakes into the guest component in step 6.
#
# ONE pin, in one file, because the two have to be the same Opal. The compiler emits
# JavaScript against a runtime's private conventions — how a method is defined, how a `send` is
# dispatched, what a block closes over — and a program compiled by one Opal and evaluated against
# another's runtime does not fail cleanly. Two pins in two scripts would be one edit away from
# exactly that. (The two used to be cut by two scripts, which is what made this file's existence
# load-bearing rather than merely tidy; they are one script now, and one pin in one place is still
# what `install-gg-build-tools.sh` and this arm's artifact crate both read.)
#
# `opal-compiler` is Opal's own compiler with a self-hosted JavaScript build, and it depends on
# `opal-runtime`, which is the runtime. Both come out of the one install.
OPAL_COMPILER_VERSION="3.0.0"

# The Opal RELEASE that package bundles, and therefore the version of the `opal` RubyGem whose
# `stdlib/` and `opal/` trees `build.sh` fetches for the Ruby sources of the libraries a program may
# require. npm ships Opal's runtime and its self-hosted compiler; it does not ship the standard
# library's sources, and those have to be the same release for the same reason the runtime and the
# compiler do.
#
# `build.sh` checks this against the version the compiler it just cut reports rather than trusting
# the comment above, so a bump to `OPAL_COMPILER_VERSION` that forgets this one fails the build.
OPAL_VERSION="1.7.3"

# `componentize-js`, which bakes the guest. Pinned for the reason the TypeScript guest pins it: a
# componentiser is not byte-reproducible, so a floating version would rewrite 14 MB of
# `include_bytes!` — and recompile `crates/gg` — on any machine that happened to resolve a newer
# one. It is the SAME release the ECMAScript guest is baked with, deliberately —
# this guest is that guest plus a runtime, and two engines would be a difference between the arms
# nobody chose.
COMPONENTIZE_VERSION="0.21.0"
