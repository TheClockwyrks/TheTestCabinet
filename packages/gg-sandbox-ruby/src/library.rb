# frozen_string_literal: true

# The libraries a gg Ruby program may `require` — **this file decides the set**.
#
# `build.sh` reads the `require` lines below, compiles each named library out of the pinned Opal
# release's own sources (together with whatever else each one requires), and bakes the result into
# the `ruby.component.wasm` it writes into `$GG_ARTIFACTS_OUT_DIR` — the `OUT_DIR` of
# `crates/gg-sandbox-artifacts/ruby`, which is where gg `include_bytes!`s it from.
# `tools/signatures.rb` reads the same lines,
# under the same `# --- … ---` headings, and emits them as the catalogue's `libraries` section —
# which gg quotes back to a model on a COMPILE FAILURE. No system prompt carries a package
# inventory any more: the mistake this set prevents — a program written against something that is
# not below — is one the compile DETECTS, so the set is delivered on the turn that made it, beside
# the diagnostic that made it relevant, rather than read every turn by a program that requires
# nothing.
#
# So the sentence a model reads and the modules the artifact carries come from one file. That is
# the rule the Python arm learned the hard way: it claimed a whole standard library where the build
# had baked a curated subset of one, and nothing gated the claim.
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
#
# And one presence that is weaker than its name: `SecureRandom` here is **not** cryptographically
# secure. Baking this component prints, once per entry point, "Can't get a Crypto.getRandomValues
# interface or Crypto.randomBytes" — the engine `componentize-js` bakes exposes neither, so Opal
# falls back to the ordinary PRNG behind `Kernel#rand`. It is fine for an id and wrong for a secret,
# and a program that needs the second does not have it. (This is a quality caveat and not a
# determinism one: `SecureRandom.hex`, `rand` and `Time.now` all differ between two instantiations
# of the committed artifact, so `wizer` has not frozen a seed into the snapshot.)

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
