# frozen_string_literal: true

# The libraries a gg Ruby program may `require` — **this file decides the set**.
#
# `build.sh` reads the `require` lines below, compiles each named library out of the pinned Opal
# release's own sources (together with whatever else each one requires), and bakes the result into
# `crates/gg/src/sandbox/guests/ruby.component.wasm`. `tools/signatures.rb` reads the same lines,
# under the same `# --- … ---` headings, and emits them as the catalogue's `libraries` section,
# which is what the system prompt tells a model it may require.
#
# So the sentence a model reads and the modules the artifact carries come from one file. That is
# the rule the Python arm learned the hard way: its prompt claimed a whole standard library where
# the build had baked a curated subset of one, and nothing gated the sentence.
#
# **This file is not itself compiled into the guest.** It is a manifest that happens to be valid
# Ruby, because the thing it lists is a list of `require` lines and there is no better way to write
# one down.
#
# What a program gets *without* requiring anything is Opal's corelib: `String`, `Array`, `Hash`,
# `Set`, `Struct`, `Range`, `Enumerable`, `Enumerator` (`lazy` included), `Comparable`, `Time`,
# `Math`, `Random`, `Regexp`, `Rational`, `Complex`, `Proc`, `Method`, `Kernel#format` and the
# exception hierarchy — plus pattern matching, which is corelib in Opal only if it is baked, and is.
#
# Two absences a study should record, because they are facts about the artifact rather than
# policies: there is no `bigdecimal` (Opal's needs a JavaScript big-number library gg does not
# carry), and there is no `fileutils`, `socket` or `net/http` (Opal ships those only for its Node
# and browser platforms, and this guest is neither).

# --- Data, text and encoding ---
require "json"
require "base64"
require "securerandom"
require "erb"
require "shellwords"
require "strscan"
require "stringio"
require "uri"

# --- Time ---
require "time"
require "date"

# --- Structure ---
require "set"
require "ostruct"
require "delegate"
require "forwardable"
require "singleton"
require "observer"

# --- Paths and command lines ---
require "pathname"
require "optparse"

# --- Inspecting and measuring ---
require "pp"
require "prettyprint"
require "benchmark"
require "logger"
