# shellcheck shell=bash
# shellcheck disable=SC2034  # every variable here is read by the scripts that source this file

# The Ruby arm's REFLECTION pin, in one place.
#
# Sourced by `signatures.sh` (which reflects the catalogue) and by
# `scripts/ci/install-gg-toolchains.sh` (which puts the gem on the machine ahead of the build, so a
# `cargo build` never discovers halfway through that it wants to talk to rubygems.org). Two copies
# of this number in two scripts would be one edit away from a machine that pre-installs one YARD and
# reflects with another.
#
# It is a file of its own rather than a line in `opal-version.sh` because the two pins answer to
# different artifacts and different people: `opal-version.sh` pins the Opal that COMPILES a model's
# Ruby program, and every version in it has to agree with the committed guest it was baked into.
# This pins the tool that READS the SDK's documentation, which touches nothing committed at all.
#
# Not a script to run: it only sets variables.

# The YARD release the catalogue is reflected with. Pinned for the reason every other arm's
# documentation tool is pinned: a reflector that changed what it extracts would change what a model
# is told about this arm on the next build, with nothing in the diff of the checkout to say why.
#
# The Ruby INTERPRETER is deliberately not pinned. What has to be the same across a devcontainer, an
# Azure agent, a GitHub runner and an image build is the reflector, not the thing it runs on — YARD
# is pure Ruby, it parses source rather than loading it, and every machine that builds gg already
# ships a Ruby that runs it.
YARD_VERSION="0.9.37"
