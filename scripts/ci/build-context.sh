#!/usr/bin/env bash
# Verifies that every file a Dockerfile COPYs out of the build context survives
# `.dockerignore`.
#
# WHY THIS EXISTS. `.dockerignore` is an ALLOWLIST — `*`, then explicit `!`
# re-inclusions — so the default answer for any path is "not in the context". A
# `COPY` whose source was never re-included therefore does not warn: the build dies
# with `failed to compute cache key: "/path": not found`, preceded by the giveaway
# `transferring context: 2B`. Nothing else in this repository can see that. The Rust
# suite, `contract-drift.sh`, the lints and the front-end builds all pass on a tree
# whose images cannot be built at all, and the image builds themselves run only on
# master/staging, after the gates — so the defect lands, and is
# found by whoever next needs a run container. It has happened twice: once when the
# Blender image added its two authoring helpers, and once when the gg toolchain
# builder added the Java arm's installer, which broke the `-gg` variant of EVERY
# language rather than only Java's.
#
# What it checks, per tracked Dockerfile, for every `COPY`/`ADD` that reads the
# build context (`--from=` copies read an earlier stage, and remote `ADD` sources
# read the network — neither touches the context):
#   1. the source path exists in the repository, and
#   2. the allowlist that applies to THAT Dockerfile leaves it in the context.
#
# WHICH ALLOWLIST APPLIES — and the answer is "every one that can", because which file
# a builder reaches is not something a Dockerfile gets to decide. BuildKit reads
# `<dockerfile-path>.dockerignore` in preference to the context root's whenever that
# file exists. Buildah has a comparable rule and a different order, and in practice
# does not always land on the same answer: a devcontainer rebuild driven by
# podman-compose on a NixOS host read the ROOT allowlist and died on the first COPY —
# `no items matching glob ".../apt.sh" copied (1 filtered out using .dockerignore)` —
# which is how the root file came to carry `!/.devcontainer/…` entries at all.
#
# `.devcontainer/ubuntu.dockerfile` is the one Dockerfile here with a sibling ignore
# file, so it can answer to ITS file or to the ROOT one depending on who builds it, and
# a source admitted by one and not the other is a build that works for whoever added it
# and fails for the next person on the other runtime.
#
# So this gate checks every Dockerfile against the root allowlist, and additionally
# against its sibling one where it has it. The failure message names the file that
# rejected the source, which is the file to widen.
#
# Whole-context copies (`COPY . .`) are inspected for neither of the two checks: they
# take whatever the allowlist admits, which is exactly the question the allowlist
# answers. A DIRECTORY source is a weaker version of the same thing — `COPY dir dst`
# copies the directory's surviving contents — so it is checked for whether the copy
# transfers *anything*, not for whether the directory itself was re-included. That
# distinction is load-bearing rather than pedantic: `.devcontainer/ubuntu.dockerfile`
# copies `./packages`, whose allowlist entry is the glob
# `!/packages/gg-sandbox-*/*-version.sh` — the directory is ignored, the nine files under
# it are not, and the build works. What the check still catches is the real failure:
# a directory none of whose contents survive, which copies nothing at all.
#
# The evaluation mirrors Docker's own: patterns apply in order, the last one to match
# wins, a `!` pattern re-includes, and a path is ignored when it or any ancestor
# directory is. `*` and `?` do not cross `/`; `**` does.
#
# Needs no toolchain and no history — it reads the checked-out tree — so it runs as a
# pre-commit hook and as a standalone CI job.
#
# Usage:
#   scripts/ci/build-context.sh
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

# --- the .dockerignore matcher ----------------------------------------------

# Ordered pattern tables, filled by load_dockerignore: one anchored ERE per pattern,
# a parallel flag saying whether the pattern was negated (`!`, i.e. re-includes), and
# the pattern's own text (without the `!`), which the shape check at the foot of this
# file reads because a wildcard is a property of the pattern and not of its regex.
DI_REGEX=()
DI_NEGATED=()
DI_RAW=()

# Translate one .dockerignore pattern into an anchored ERE with Docker's glob
# semantics: `*` and `?` stop at a path separator, `**` spans them, and a leading
# `**/` also matches at the root (so `**/target` covers a top-level `target`).
pattern_to_regex() {
	local pattern="$1" out="" prefix="^" i char
	pattern="${pattern#/}"
	pattern="${pattern%/}"
	if [[ "$pattern" == '**/'* ]]; then
		prefix='^(.*/)?'
		pattern="${pattern#\*\*/}"
	fi
	for ((i = 0; i < ${#pattern}; i++)); do
		char="${pattern:i:1}"
		case "$char" in
		'*')
			if [[ "${pattern:i:2}" == '**' ]]; then
				out+='.*'
				((i++)) || true
			else
				out+='[^/]*'
			fi
			;;
		'?') out+='[^/]' ;;
		# Everything ERE treats as syntax, taken literally.
		'.' | '+' | '(' | ')' | '|' | '^' | '$' | '{' | '}' | '[' | ']' | \\) out+="\\$char" ;;
		*) out+="$char" ;;
		esac
	done
	printf '%s%s$' "$prefix" "$out"
}

# Read a .dockerignore into the pattern tables, dropping blanks and comments.
load_dockerignore() {
	local file="$1" line
	DI_REGEX=()
	DI_NEGATED=()
	DI_RAW=()
	while IFS= read -r line || [[ -n "$line" ]]; do
		line="${line%$'\r'}"
		# Trim surrounding whitespace; a pattern never has meaningful edges.
		line="${line#"${line%%[![:space:]]*}"}"
		line="${line%"${line##*[![:space:]]}"}"
		[[ -z "$line" || "$line" == '#'* ]] && continue
		if [[ "$line" == '!'* ]]; then
			DI_NEGATED+=(1)
			DI_RAW+=("${line#!}")
			DI_REGEX+=("$(pattern_to_regex "${line#!}")")
		else
			DI_NEGATED+=(0)
			DI_RAW+=("$line")
			DI_REGEX+=("$(pattern_to_regex "$line")")
		fi
	done <"$file"
}

# True when the path is still in the build context after every pattern has applied.
context_includes() {
	local path="$1" ignored=0 index regex candidate hit
	for index in "${!DI_REGEX[@]}"; do
		regex="${DI_REGEX[$index]}"
		hit=0
		candidate="$path"
		# A path is matched when it matches, or when any ancestor directory does —
		# an ignored directory takes everything under it.
		while :; do
			if [[ "$candidate" =~ $regex ]]; then
				hit=1
				break
			fi
			[[ "$candidate" == */* ]] || break
			candidate="${candidate%/*}"
		done
		if ((hit)); then
			if ((DI_NEGATED[index])); then ignored=0; else ignored=1; fi
		fi
	done
	((ignored == 0))
}

# True when a DIRECTORY source contributes anything at all to the build context.
# `COPY dir dst` copies what survives UNDER the directory, so a directory that the
# allowlist ignores while re-including files beneath it copies those files perfectly
# well — which is what a re-inclusion glob like `!/packages/gg-sandbox-*/*-version.sh`
# is for. Asking `context_includes` about the directory itself would call that a
# failure. Tracked files only (`git ls-files`), because untracked scratch is not a
# thing a build may depend on and walking `target/` here would be absurd.
context_includes_dir() {
	local dir="$1" file
	context_includes "$dir" && return 0
	while IFS= read -r file; do
		context_includes "$file" && return 0
	done < <(git -C "$REPO_ROOT" ls-files -- "$dir")
	return 1
}

# --- the matcher's teeth ----------------------------------------------------

# A gate nobody has watched fail is a gate nobody knows works. This drives the
# matcher over a synthetic allowlist of the shape this repository uses and asserts
# both answers, including the two shapes that have actually broken a build here: a
# file re-included by name, and a file under a re-included directory. The third
# shape — a re-inclusion that is a GLOB spanning one path segment
# (`!/packages/gg-sandbox-*/*-version.sh`, how the devcontainer's allowlist once
# admitted every arm's version file without naming the arms) — is still asserted
# even though no allowlist in the repository may use it any more (the shape check at
# the foot of this file says why): the matcher has to read what a rejected pattern
# WOULD have admitted, and its correctness rests entirely on `*` stopping at a `/`.
self_test() {
	local fixture failures=0 case_line path expected
	fixture="$(mktemp)"
	cat >"$fixture" <<'PATTERNS'
# a comment, and a blank line, both ignored

*
!/crates
!/scripts/ci/install-java.sh
!/apps/web
!/docs/*.md
!/vendor/**/keep.txt
!/packages/gg-sandbox-*/*-version.sh
**/target/
**/node_modules/
PATTERNS
	load_dockerignore "$fixture"
	rm -f "$fixture"

	while read -r path expected; do
		[[ -n "$path" ]] || continue
		if context_includes "$path"; then
			case_line="included"
		else
			case_line="ignored"
		fi
		if [[ "$case_line" != "$expected" ]]; then
			echo "error: matcher self-test: '$path' came back $case_line, expected $expected" >&2
			failures=$((failures + 1))
		fi
	done <<'CASES'
crates/gg/src/main.rs included
crates/Cargo.toml included
scripts/ci/install-java.sh included
scripts/ci/install-purescript.sh ignored
scripts/ci ignored
packages/gg-sandbox-java/java-version.sh included
packages/gg-sandbox-java/src/Main.java ignored
packages/gg-sandbox-swift/.build/debug/swift-version.sh ignored
packages/gg-sandbox-java ignored
packages/ui/src/index.ts ignored
apps/web/src/main.tsx included
apps/docs/astro.config.mjs ignored
crates/gg/target/debug/gg ignored
crates/target ignored
target ignored
apps/web/node_modules/left-pad/index.js ignored
Cargo.toml ignored
docs/overview.md included
docs/nested/overview.md ignored
vendor/one/two/keep.txt included
vendor/one/two/drop.txt ignored
CASES

	((failures == 0)) || {
		echo "error: the .dockerignore matcher is wrong; its verdicts below cannot be trusted." >&2
		exit 1
	}
}

# --- reading the Dockerfiles ------------------------------------------------

# Print `<line-number> <instruction and its arguments, one logical line>` for every
# COPY/ADD in the file, joining backslash continuations and dropping comment lines.
copy_instructions() {
	awk '
		{
			line = $0
			sub(/\r$/, "", line)
			if (pending != "") {
				# Inside a continuation: a comment line is a comment, not an argument.
				if (line ~ /^[[:space:]]*#/) next
				sub(/^[[:space:]]+/, "", line)
				if (line ~ /\\[[:space:]]*$/) {
					sub(/\\[[:space:]]*$/, "", line)
					pending = pending " " line
					next
				}
				print start, pending " " line
				pending = ""
				next
			}
			if (line ~ /^[[:space:]]*#/) next
			if (line !~ /^[[:space:]]*(COPY|ADD)[[:space:]]/) next
			sub(/^[[:space:]]+/, "", line)
			if (line ~ /\\[[:space:]]*$/) {
				sub(/\\[[:space:]]*$/, "", line)
				pending = line
				start = NR
				next
			}
			print NR, line
		}
	' "$1"
}

log "verify every Dockerfile COPY can see its source in the build context"
self_test

problems=0
checked=0
# `*.dockerfile` is the devcontainer's spelling, and it was outside this glob until
# that image started building from the repository root — so the one Dockerfile whose
# COPY paths this gate is most useful for was the one it silently skipped.
mapfile -t dockerfiles < <(git ls-files '*Dockerfile' '*.Dockerfile' '*.dockerfile' | sort)
((${#dockerfiles[@]} > 0)) || {
	echo "error: no tracked Dockerfiles found; this gate would pass vacuously." >&2
	exit 1
}

# Check one Dockerfile's context-reading COPY/ADD sources against the allowlist that
# is currently loaded. Both are named in every message: which Dockerfile, and which
# allowlist rejected the source — the caller runs this once per allowlist that can
# apply to that Dockerfile, so "which one" is the actionable half.
check_dockerfile() {
	local dockerfile="$1" ignore_file="$2"
	local lineno instruction arg source normalized from_stage
	local -a args positional

	while read -r lineno instruction; do
		[[ -n "$instruction" ]] || continue
		# shellcheck disable=SC2206  # deliberate word-splitting: Dockerfile arguments
		args=($instruction)
		# Drop the instruction keyword and every flag; keep the positional arguments.
		positional=()
		from_stage=""
		for arg in "${args[@]:1}"; do
			case "$arg" in
			--from=*)
				from_stage="${arg#--from=}"
				;;
			--*) ;;
			*) positional+=("$arg") ;;
			esac
		done
		# `--from=` reads an earlier stage or an external image, never the context.
		[[ -n "$from_stage" ]] && continue
		# The last positional argument is the destination.
		((${#positional[@]} >= 2)) || continue
		for source in "${positional[@]:0:${#positional[@]}-1}"; do
			# A remote ADD reads the network; a whole-context copy takes whatever the
			# allowlist admits, which is the allowlist's own answer.
			[[ "$source" == *://* ]] && continue
			[[ "$source" == '.' || "$source" == './' ]] && continue
			# A source built from a build arg (the `ADD --checksum=… ${PACK_URL}` pack
			# fetches) resolves at build time, not here; there is no path to check.
			[[ "$source" == *'$'* ]] && continue
			# A glob's expansion is the build context's business, not ours.
			[[ "$source" == *'*'* || "$source" == *'?'* || "$source" == *'['* ]] && continue
			normalized="${source#./}"
			checked=$((checked + 1))
			if [[ ! -e "$REPO_ROOT/$normalized" ]]; then
				echo "error: $dockerfile:$lineno copies '$source', which does not exist in the repository." >&2
				problems=$((problems + 1))
				continue
			fi
			# A directory source copies its surviving CONTENTS, so the question for it is
			# whether anything under it survives — see context_includes_dir.
			if [[ -d "$REPO_ROOT/$normalized" ]]; then
				if ! context_includes_dir "$normalized"; then
					echo "error: $dockerfile:$lineno copies the directory '$source', and $ignore_file keeps every tracked file under it OUT of the build context." >&2
					echo "       The build will fail with: failed to compute cache key: \"/$normalized\": not found" >&2
					echo "       Fix: re-include what that image reads in $ignore_file, with a comment saying which image needs it." >&2
					problems=$((problems + 1))
				fi
			elif ! context_includes "$normalized"; then
				echo "error: $dockerfile:$lineno copies '$source', which $ignore_file keeps OUT of the build context." >&2
				echo "       The build will fail with: failed to compute cache key: \"/$normalized\": not found" >&2
				echo "       Fix: add '!/$normalized' to the $ignore_file allowlist, with a comment saying which image needs it." >&2
				problems=$((problems + 1))
			fi
		done
	done < <(copy_instructions "$dockerfile")
}

# Pass one: the root allowlist, which can apply to every Dockerfile here — to all but
# one because it is the only ignore file their context has, and to that one because a
# builder may not reach its sibling file. Loaded once, being the same file for all.
load_dockerignore "$REPO_ROOT/.dockerignore"
for dockerfile in "${dockerfiles[@]}"; do
	check_dockerfile "$dockerfile" ".dockerignore"
done

# Pass two: the sibling allowlists, which BuildKit prefers for the Dockerfiles that
# have one. A separate pass rather than a per-Dockerfile switch so that the root file
# is parsed once rather than once per alternation.
for dockerfile in "${dockerfiles[@]}"; do
	sibling="$dockerfile.dockerignore"
	[[ -f "$REPO_ROOT/$sibling" ]] || continue
	load_dockerignore "$REPO_ROOT/$sibling"
	check_dockerfile "$dockerfile" "$sibling"
done

# --- what a COPY cannot tell you --------------------------------------------

# Everything above reads `COPY` sources, and there is one build input in this
# repository that no `COPY` names: the gg guest packages. The driver image's gg stage
# does `COPY . .` and then `cargo build`, and it is the BUILD — crates/gg/build.rs
# reflecting eleven signature catalogues, and the eleven crates under
# crates/gg-sandbox-artifacts/ running each arm's `packages/gg-sandbox*/build.sh` —
# that reads them. A whole-context copy is deliberately unchecked above, because it
# takes whatever the allowlist admits; so a `packages/gg-sandbox*` directory the
# allowlist forgets is invisible to every check in this file and to every other gate
# in the repository. It surfaces as a compiler or a `find` saying "no such file or
# directory" minutes into an image build, blamed on the arm rather than on the
# context.
#
# That has now happened: `packages/gg-sandbox-jvm`, the crossing the java and kotlin
# arms both compile, was split out of the java arm and the allowlist was not widened,
# which took `make local-rebuild` down. So the rule is asserted here rather than left
# to be rediscovered — the whole of every guest package rides along, which is what the
# root .dockerignore says in prose right above its own entries.
#
# The directory itself must survive, not merely something under it: these are read as
# trees, so `context_includes_dir`'s weaker question (does the copy transfer
# ANYTHING) would pass a package admitted only through the devcontainer's
# `*-version.sh` glob and still leave the build without an `src`.
#
# Root allowlist only, and here that phrase means what it says rather than "the file
# that happened to be loaded": this is a statement about the builds that COMPILE gg,
# every one of which reads the root allowlist. `.devcontainer/ubuntu.dockerfile` bakes
# toolchains from pins and compiles none of this, and its own narrower allowlist is
# correct to keep the arms' sources out — which is why the check below is not run
# against that file.
load_dockerignore "$REPO_ROOT/.dockerignore"
mapfile -t guest_packages < <(
	git ls-files 'packages/gg-sandbox*' | cut -d/ -f1-2 | sort -u |
		while IFS= read -r candidate; do
			[[ -d "$REPO_ROOT/$candidate" ]] && printf '%s\n' "$candidate"
		done
)
((${#guest_packages[@]} > 0)) || {
	echo "error: no packages/gg-sandbox* directories found; this check would pass vacuously." >&2
	exit 1
}
for package in "${guest_packages[@]}"; do
	checked=$((checked + 1))
	context_includes "$package" && continue
	echo "error: .dockerignore keeps '$package' OUT of the build context, and gg's build reads it." >&2
	echo "       No COPY names it — the driver image's gg stage copies the whole context and then" >&2
	echo "       compiles, so this fails as 'no such file or directory' from inside an arm's build." >&2
	echo "       Fix: add '!/$package' to the .dockerignore allowlist, with a comment saying what reads it." >&2
	problems=$((problems + 1))
done

# --- what a COPY cannot tell you, part two: the trees baked in with include_str! ---

# The gg guest packages are not the only build input no `COPY` names. `crates/core`
# BAKES three directories into the binaries verbatim — the built-in orchestrators'
# manifests and runner scripts, the harness manifests, and the engine manifests —
# with `include_str!` paths that climb out of `crates/` with `../../../`. They ride
# in on the same `COPY . .` the gg arms do, so the allowlist is the only thing that
# decides whether the compiler can read them, and nothing above looks at them.
#
# That has now happened too, and it is the worst-behaved shape of the three. When
# engines landed, `!/engines` was not added beside `!/orchestrators` and
# `!/harnesses`, and the failure is not Docker's `failed to compute cache key` — the
# COPY succeeds, having copied what it was allowed to — but a `cargo build` dying
# minutes later on
#
#     error: couldn't read `crates/core/src/../../../engines/none/engine.toml`
#
# which reads as a broken checkout, and stopped `make local-up` from standing the
# cluster up at all. Every service image compiles `test-cabinet-core`, so a tree
# missing here takes all six of them down at once.
#
# So the rule is asserted from the SOURCE rather than from a list kept in step by
# hand: every literal `include_str!`/`include_bytes!` path in a compiled Rust source
# is resolved against the file that writes it, and must survive the root allowlist.
# The next tree baked into a binary is then covered the day it is written, which is
# the property the hand-kept list did not have.
#
# `concat!(env!("OUT_DIR"), …)` includes carry no literal path and are skipped by the
# pattern: what they read is generated inside the image by a build script, so the
# context has no answer to give about them.
#
# `*.test.rs` sources are skipped, and deliberately: they compile only under
# `cfg(test)` and no image build runs tests, so demanding their includes survive would
# push real trees into the `COPY . .` cache key on behalf of files no image compiles —
# the exact cost the section below this one exists to keep out.
#
# Root allowlist only, for the reason the guest-package check gives: this is a
# statement about the builds that COMPILE this workspace, every one of which reads the
# root file. `.devcontainer/ubuntu.dockerfile` compiles none of it.

# Resolve `.`/`..` textually, without touching the filesystem: the answer must be the
# path AS THE ALLOWLIST WOULD SEE IT (repo-relative, no symlink resolution), which is
# not what `realpath` returns, and which must be computable for a path that a broken
# tree does not have on disk. Returns 1 for a path that climbs above the repository
# root, which is a Rust source no build could compile either.
normalize_path() {
	local path="$1" segment
	local -a out=()
	local IFS='/'
	# Unquoted on purpose: IFS='/' is what splits the path into segments.
	# shellcheck disable=SC2086
	for segment in $path; do
		case "$segment" in
		'' | '.') ;;
		'..')
			((${#out[@]} > 0)) || return 1
			out=("${out[@]:0:${#out[@]} - 1}")
			;;
		*) out+=("$segment") ;;
		esac
	done
	printf '%s\n' "${out[*]}"
}

# The same argument the matcher's self-test makes: a resolver nobody has watched
# resolve is a resolver nobody knows works, and this one is what decides which path
# the allowlist is asked about. The first case is the real one, verbatim.
self_test_normalize() {
	local failures=0 input expected got
	while read -r input expected; do
		[[ -n "$input" ]] || continue
		if got="$(normalize_path "$input")"; then :; else got="<above-root>"; fi
		if [[ "$got" != "$expected" ]]; then
			echo "error: normalize_path self-test: '$input' resolved to '$got', expected '$expected'" >&2
			failures=$((failures + 1))
		fi
	done <<'CASES'
crates/core/src/../../../engines/none/engine.toml engines/none/engine.toml
crates/gg/src/sandbox/language/../checkers/java.compiler.java crates/gg/src/sandbox/checkers/java.compiler.java
crates/gg/src/./templates/board.hbs crates/gg/src/templates/board.hbs
crates/core/src/../../../../escape.toml <above-root>
CASES
	((failures == 0)) || {
		echo "error: the include_str! path resolver is wrong; its verdicts below cannot be trusted." >&2
		exit 1
	}
}

self_test_normalize

load_dockerignore "$REPO_ROOT/.dockerignore"
mapfile -t rust_sources < <(git ls-files 'crates/*.rs' | grep -v '\.test\.rs$')
((${#rust_sources[@]} > 0)) || {
	echo "error: no compiled Rust sources found under crates/; this check would pass vacuously." >&2
	exit 1
}
baked_checked=0
while IFS= read -r hit; do
	[[ -n "$hit" ]] || continue
	baked_file="${hit%%:*}"
	baked_rest="${hit#*:}"
	baked_line="${baked_rest%%:*}"
	baked_text="${baked_rest#*:}"
	baked_path="${baked_text#*\"}"
	baked_path="${baked_path%\"}"
	baked_checked=$((baked_checked + 1))
	checked=$((checked + 1))
	if ! baked_resolved="$(normalize_path "$(dirname "$baked_file")/$baked_path")"; then
		echo "error: $baked_file:$baked_line includes '$baked_path', which climbs above the repository root." >&2
		problems=$((problems + 1))
		continue
	fi
	if [[ ! -e "$REPO_ROOT/$baked_resolved" ]]; then
		echo "error: $baked_file:$baked_line bakes in '$baked_resolved', which does not exist in the repository." >&2
		problems=$((problems + 1))
		continue
	fi
	context_includes "$baked_resolved" && continue
	echo "error: .dockerignore keeps '$baked_resolved' OUT of the build context, and $baked_file:$baked_line bakes it into the binary." >&2
	echo "       No COPY names it — the service and tooling images copy the whole context and then" >&2
	echo "       compile, so this fails minutes in as: error: couldn't read \`$(dirname "$baked_file")/$baked_path\`: No such file or directory." >&2
	echo "       Fix: add '!/$baked_resolved' (or its directory) to the .dockerignore allowlist, with a comment saying what bakes it in." >&2
	problems=$((problems + 1))
done < <(grep -Hno 'include_\(str\|bytes\)! *( *"[^"]*"' -- "${rust_sources[@]}" || true)

# --- what a COPY cannot tell you, part three: the host package store ---------

# The third build input no `COPY` names. The services image's `tcab-packages` stage
# (deployments/images/services.Dockerfile) does `COPY . .`, `npm ci`, and then
# `node scripts/stage-tcab-packages.mjs` — which reads the SHIPPABLE list in its own
# source, resolves each name to a directory under `packages/`, and bakes it into
# /opt/tcab-packages. A name in that list whose directory the allowlist forgets is
# invisible to every check above, because a whole-context copy is deliberately
# unchecked: it takes whatever the allowlist admits, and the stage then dies on
#
#     Error: shippable package @clockwyrks/<name> not found under packages/
#
# which reads as a broken checkout and takes EVERY service image down at once — they
# all share that Dockerfile. The `tcab-packages` stage is the driver's, but a
# multi-target build of that file builds it regardless.
#
# The list is read from the staging script rather than restated here, for the reason
# the include_str! check gives: the next package staged into the store is covered the
# day it is added, which a hand-kept list would not be. The transitive
# `@clockwyrks/*` dependencies are walked too, because the script stages the closure
# and `npm run build` compiles each member against its siblings.
#
# The directory itself must survive, not merely something under it: the script copies
# each package's `files` entries whole, so `context_includes_dir`'s weaker question
# (does the copy transfer ANYTHING) would pass a package admitted through some
# unrelated glob and still leave the store without a `dist/` or a `src/`.
#
# Root allowlist only, as above: this is a statement about the builds that STAGE the
# store, every one of which reads the root file.

STAGING_SCRIPT="scripts/stage-tcab-packages.mjs"

# The package names in the staging script's SHIPPABLE array, one per line. Read from
# the array's own text: every entry is a quoted name, and a `//` comment inside the
# array is dropped before the names are pulled out of the line.
shippable_names() {
	awk '
		/^const SHIPPABLE = \[/ { inside = 1; next }
		inside && /^\]/ { inside = 0; next }
		inside {
			line = $0
			sub(/\/\/.*/, "", line)
			while (match(line, /"[^"]+"/)) {
				print substr(line, RSTART + 1, RLENGTH - 2)
				line = substr(line, RSTART + RLENGTH)
			}
		}
	' "$REPO_ROOT/$STAGING_SCRIPT"
}

# The `packages/<dir>` holding the package named `$1`, by the `name` its manifest
# declares — which is what the staging script maps by, and is not always the
# directory name. Prints nothing and returns 1 when no manifest claims that name.
package_dir_for() {
	local name="$1" manifest
	for manifest in "${package_manifests[@]}"; do
		if grep -qE "^[[:space:]]*\"name\"[[:space:]]*:[[:space:]]*\"$name\"[[:space:]]*,?[[:space:]]*$" \
			"$REPO_ROOT/$manifest"; then
			dirname "$manifest"
			return 0
		fi
	done
	return 1
}

# The `@clockwyrks/*` names the manifest at `$1` uses as dependency KEYS, in any
# block. Deliberately not only `dependencies`: the staging stage also BUILDS each
# member, and a dev-time dependency on a sibling is a source tree that build reads.
# The manifest's own `"name"` line is not matched, the scoped name being its value.
tcab_dependency_names() {
	grep -oE '"@clockwyrks/[A-Za-z0-9._-]+"[[:space:]]*:' "$1" |
		sed -E 's/^"([^"]+)".*/\1/'
}

load_dockerignore "$REPO_ROOT/.dockerignore"
# Read off the filesystem rather than out of git, exactly as the staging script's own
# readdirSync does: a package added and not yet committed is a real build input, and a
# gate that ran before `git add` and rejected it would be wrong. The glob does not
# descend, so a workspace's own `node_modules` cannot be mistaken for a member.
package_manifests=()
for staged_manifest in "$REPO_ROOT"/packages/*/package.json; do
	[[ -f "$staged_manifest" ]] || continue
	package_manifests+=("${staged_manifest#"$REPO_ROOT/"}")
done
((${#package_manifests[@]} > 0)) || {
	echo "error: no packages/*/package.json found; this check would pass vacuously." >&2
	exit 1
}
mapfile -t staged_names < <(shippable_names)
((${#staged_names[@]} > 0)) || {
	echo "error: no SHIPPABLE names found in $STAGING_SCRIPT; this check would pass vacuously." >&2
	exit 1
}

# Breadth-first over the closure, exactly as the staging script's own `visit` walks it.
staged_seen=""
staged_queue=("${staged_names[@]}")
staged_checked=0
while ((${#staged_queue[@]} > 0)); do
	staged_name="${staged_queue[0]}"
	staged_queue=("${staged_queue[@]:1}")
	[[ "$staged_seen" == *"|$staged_name|"* ]] && continue
	staged_seen="$staged_seen|$staged_name|"
	if ! staged_dir="$(package_dir_for "$staged_name")"; then
		echo "error: $STAGING_SCRIPT stages '$staged_name', and no packages/*/package.json declares that name." >&2
		problems=$((problems + 1))
		continue
	fi
	for staged_dep in $(tcab_dependency_names "$REPO_ROOT/$staged_dir/package.json"); do
		staged_queue+=("$staged_dep")
	done
	staged_checked=$((staged_checked + 1))
	checked=$((checked + 1))
	context_includes "$staged_dir" && continue
	echo "error: .dockerignore keeps '$staged_dir' OUT of the build context, and $STAGING_SCRIPT stages '$staged_name' from it." >&2
	echo "       No COPY names it — the services image's package-store stage copies the whole context" >&2
	echo "       and then runs that script, so this fails as: Error: shippable package $staged_name" >&2
	echo "       not found under packages/ — which takes every image in services.Dockerfile down." >&2
	echo "       Fix: add '!/$staged_dir' to the .dockerignore allowlist, with a comment saying what stages it." >&2
	problems=$((problems + 1))
done

# --- what an allowlist lets in by accident -----------------------------------

# Everything above asks "does the context still contain what a build READS". This asks
# the other question, which nothing here used to ask: does it contain anything a build
# does NOT read. An allowlist makes that failure silent — `!/crates` re-includes a
# directory, not a file list, so every future untracked or generated file under it joins
# the context of all seven whole-context builds without a line changing anywhere.
#
# THE COST IS NOT DISK, IT IS THE CACHE. `COPY . .`'s cache key covers the whole context,
# so a file no build reads still invalidates it when it changes — and the first thing the
# services and tooling stages do on a miss is touch the tree and hand cargo a workspace it
# must compile from scratch. A `.DS_Store` rewritten because a Finder window was resized
# is therefore a ~19-crate rebuild, attributed to the Dockerfile by everyone who sees it.
#
# Machine-local output under a re-included tree (fetched binaries, `.DS_Store` files,
# generated schema trees, a `tsconfig.tsbuildinfo`) rides in exactly this way, and no gate
# that reads COPY sources can see it.
#
# THE RULE THIS ASSERTS: a path git ignores is not a build input. Ignored means generated,
# fetched, machine-local or scratch — every one of which is either reproduced inside the
# image or has no business in it — so the context should be exactly the tracked tree. It
# was, on the tree this check landed with, and that is a much easier invariant to keep
# than a list of the shapes that have leaked so far.
#
# UNTRACKED-BUT-NOT-IGNORED FILES ARE DELIBERATELY ALLOWED: a source file added and not yet
# committed is a real build input, and a gate that ran before `git add` and rejected it
# would be wrong.
#
# Checked against EVERY allowlist that can apply, for the reason pass two above exists:
# `.devcontainer/ubuntu.dockerfile.dockerignore` re-includes `!/.devcontainer` whole, which
# is exactly the shape that lets ignored scratch in.
#
# `--directory` collapses a wholly-ignored directory to one entry, so this neither walks
# `target/` nor reports ten thousand paths inside it; it is a few hundred entries on a
# working tree and a handful on a fresh clone. A fresh clone is also why the count is
# printed rather than asserted non-zero: on a runner that has built nothing there is
# genuinely nothing to check, and a vacuous pass should be visible rather than fatal.
mapfile -t ignored_paths < <(git -C "$REPO_ROOT" ls-files -o -i --exclude-standard --directory)

# Every allowlist in the repository: the root one, plus each sibling that exists.
ignore_files=(".dockerignore")
for dockerfile in "${dockerfiles[@]}"; do
	[[ -f "$REPO_ROOT/$dockerfile.dockerignore" ]] && ignore_files+=("$dockerfile.dockerignore")
done

ignored_checked=0
for ignore_file in "${ignore_files[@]}"; do
	load_dockerignore "$REPO_ROOT/$ignore_file"
	for path in "${ignored_paths[@]}"; do
		path="${path%/}"
		[[ -n "$path" ]] || continue
		ignored_checked=$((ignored_checked + 1))
		context_includes "$path" || continue
		echo "error: $ignore_file lets '$path' into the build context, and git ignores it." >&2
		echo "       Ignored means generated, fetched or machine-local, so no image reads it — but it" >&2
		echo "       still joins the COPY cache key, and rebuilds the Rust workspace whenever it changes." >&2
		echo "       Fix: re-exclude it at the FOOT of $ignore_file (last match wins), with a comment." >&2
		problems=$((problems + 1))
	done
done

# --- what a COPY cannot tell you, part four: the paths the toolchain installers read ---

# `scripts/ci/install-gg-toolchains.sh` and the per-arm installers it runs are copied into
# three images, the devcontainer, the Rust CI image and the driver image's gg stage, along
# with a slice of `packages/`, and they read pins, lockfiles and manifests out of that
# slice by `$REPO_ROOT/<path>`. No COPY names those files, so nothing above sees them; a
# missing one fails the image build minutes in with cargo's "manifest path ... does not
# exist".
#
# So every tracked `$REPO_ROOT/<path>` literal in those installers must survive every
# allowlist an installer-running image is built against: the root one, and the sibling of
# each Dockerfile that names the installer. An image that runs no installer (the web CI
# image) keeps an empty context, and this check leaves it alone. Untracked paths
# (`node_modules/.bin/tsc`, which an installer probes and does without) are skipped. A
# `cargo fetch --manifest-path` needs two more things than the manifest: the lockfile beside
# it, which `--locked` reads, and — because the slice deliberately carries no `src/` — a
# manifest that names its `[lib] path` rather than having cargo discover it.
installer_checked=0
# shellcheck disable=SC2016 # the `$REPO_ROOT` in both patterns is the literal text being matched.
mapfile -t installer_paths < <(
	git -C "$REPO_ROOT" ls-files -z -- 'scripts/ci/install-*.sh' |
		xargs -0 -I{} grep -ohE '\$(\{REPO_ROOT\}|REPO_ROOT)/[A-Za-z0-9_./-]+' "$REPO_ROOT/{}" |
		sed -E 's#^\$(\{REPO_ROOT\}|REPO_ROOT)/##' | sort -u
)
((${#installer_paths[@]} > 0)) || {
	echo "error: no \$REPO_ROOT paths found in scripts/ci/install-*.sh; this check would pass vacuously." >&2
	exit 1
}
installer_inputs=()
for path in "${installer_paths[@]}"; do
	git -C "$REPO_ROOT" ls-files --error-unmatch -- "$path" >/dev/null 2>&1 || continue
	installer_inputs+=("$path")
	[[ "$path" == */Cargo.toml ]] || continue
	installer_inputs+=("${path%Cargo.toml}Cargo.lock")
	grep -qE '^path *= *"src/lib\.rs"' "$REPO_ROOT/$path" && continue
	echo "error: $path is fetched by a toolchain installer from a slice with no src/, and does not name its [lib] path." >&2
	echo "       cargo then looks for src/lib.rs and fails before it fetches anything." >&2
	echo "       Fix: add 'path = \"src/lib.rs\"' under its [lib] table." >&2
	problems=$((problems + 1))
done
installer_ignore_files=(".dockerignore")
for dockerfile in "${dockerfiles[@]}"; do
	grep -q 'install-gg-toolchains\.sh' "$REPO_ROOT/$dockerfile" || continue
	[[ -f "$REPO_ROOT/$dockerfile.dockerignore" ]] && installer_ignore_files+=("$dockerfile.dockerignore")
done
((${#installer_ignore_files[@]} > 1)) || {
	echo "error: no Dockerfile names scripts/ci/install-gg-toolchains.sh; the installer-input check would cover only the root allowlist." >&2
	exit 1
}
for ignore_file in "${installer_ignore_files[@]}"; do
	load_dockerignore "$REPO_ROOT/$ignore_file"
	for path in "${installer_inputs[@]}"; do
		installer_checked=$((installer_checked + 1))
		context_includes "$path" && continue
		echo "error: $ignore_file keeps '$path' OUT of the build context, and a toolchain installer reads it." >&2
		echo "       scripts/ci/install-gg-toolchains.sh runs in images built against this allowlist, so the" >&2
		echo "       image build fails partway through the install. Fix: add '!/$path' to $ignore_file, with a comment." >&2
		problems=$((problems + 1))
	done
done

# --- what an allowlist's SHAPE costs, before a byte is transferred ------------

# Every check above is about WHICH paths an allowlist admits. This one is about how the
# allowlist is written, because one shape of pattern changes what the builder does with the
# paths it does NOT admit. BuildKit's context sender skips an ignored directory without
# entering it only while it can prove no negated pattern is rooted beneath it, and its
# proof is a string-prefix test over the negations. A negation that contains a wildcard
# (`*`, `?` or `[`) cannot be prefix-tested, so ONE such line anywhere in the file turns
# the optimisation off for EVERY directory: the sender then walks the whole working tree —
# node_modules, target/, tmp/, ~650,000 entries on a developer machine — to ship the few
# hundred kB it keeps. That is the difference between a two-second and a twenty-second
# context transfer on every image build, and it is the difference between a build that
# never touches tmp/ and one that dies because a single entry under it could not be
# lstat'ed. It did: `make local-rebuild` failed on `bad file descriptor` for a file inside
# a scratch directory's node_modules, which no image reads and which the allowlist had
# excluded on its first line. The one glob re-inclusion in the root allowlist
# (`!/scripts/gg-*.sh`) was the reason the sender was there at all.
#
# THE RULE: a re-inclusion names a path, never a family. Excludes may still be globs —
# `**/node_modules/` is an exclude, and the sender handles those without walking.
#
# THE OTHER HALF OF THE RULE is what the globs used to buy: a new arm's installer, version
# file or gg helper was admitted without an edit. An enumeration that falls behind fails
# the build minutes in rather than at the COPY, so for every family an allowlist admits by
# enumeration, every tracked file in that family must survive it. The families are the
# former globs, verbatim, so the check preserves exactly what each allowlist admitted.
shape_checked=0
for ignore_file in "${ignore_files[@]}"; do
	load_dockerignore "$REPO_ROOT/$ignore_file"
	for index in "${!DI_RAW[@]}"; do
		((DI_NEGATED[index] == 1)) || continue
		shape_checked=$((shape_checked + 1))
		[[ "${DI_RAW[$index]}" == *[\*\?\[]* ]] || continue
		echo "error: $ignore_file re-includes '!${DI_RAW[$index]}' with a wildcard, and a re-inclusion must name a path." >&2
		echo "       BuildKit skips an ignored directory only while every negation can be prefix-tested against it;" >&2
		echo "       one wildcard negation makes the context sender walk the whole working tree on every build." >&2
		echo "       Fix: replace the glob with one '!' line per file, and list the family below so the gate keeps it complete." >&2
		problems=$((problems + 1))
	done
done

# allowlist → the git pathspecs whose every tracked file it must admit.
enumerated_families_root=('scripts/gg-*.sh')
enumerated_families_devcontainer=('scripts/ci/install-*.sh' 'scripts/gg-*.sh' 'packages/gg-sandbox-*/*-version.sh')
family_checked=0
check_family() {
	local ignore_file="$1" pathspec="$2" path count=0
	load_dockerignore "$REPO_ROOT/$ignore_file"
	while IFS= read -r path; do
		[[ -n "$path" ]] || continue
		count=$((count + 1))
		family_checked=$((family_checked + 1))
		context_includes "$path" && continue
		echo "error: $ignore_file keeps '$path' OUT of the build context, and it admits '$pathspec' by enumeration." >&2
		echo "       That family used to be one glob line; it is a list now (a re-inclusion must not carry a" >&2
		echo "       wildcard), and this file is new to the list. Fix: add '!/$path' beside its siblings in $ignore_file." >&2
		problems=$((problems + 1))
	done < <(git -C "$REPO_ROOT" ls-files -- "$pathspec")
	((count > 0)) || {
		echo "error: no tracked file matches '$pathspec'; the $ignore_file family check would pass vacuously." >&2
		problems=$((problems + 1))
	}
}
for pathspec in "${enumerated_families_root[@]}"; do
	check_family ".dockerignore" "$pathspec"
done
# The devcontainer and the Rust CI image both carry gg's toolchains, so both
# allowlists enumerate the same three families.
for ignore_file in .devcontainer/ubuntu.dockerfile.dockerignore ci/images/rust.Dockerfile.dockerignore; do
	[[ -f "$REPO_ROOT/$ignore_file" ]] || continue
	for pathspec in "${enumerated_families_devcontainer[@]}"; do
		check_family "$ignore_file" "$pathspec"
	done
done

((problems == 0)) || {
	echo >&2
	echo "$problems build-context problem(s) found across ${#dockerfiles[@]} Dockerfiles, ${#guest_packages[@]} gg guest packages, $baked_checked baked-in includes, $staged_checked staged packages, $installer_checked installer inputs, ${#ignored_paths[@]} git-ignored paths, $shape_checked re-inclusions and $family_checked enumerated-family files." >&2
	exit 1
}

# A count of CHECKS rather than of distinct paths: a Dockerfile with a sibling
# allowlist has its sources checked against both, which is the point.
echo "$checked context-source check(s) — every COPY across ${#dockerfiles[@]} Dockerfiles, against each allowlist that can apply to it, plus the ${#guest_packages[@]} packages/gg-sandbox* trees the driver image's gg stage compiles, the $baked_checked path(s) the workspace bakes in with include_str! and the $staged_checked package(s) $STAGING_SCRIPT bakes into the host package store — all survive."
echo "$installer_checked installer-input check(s) — ${#installer_inputs[@]} tracked path(s) scripts/ci/install-*.sh read, against each of the ${#installer_ignore_files[@]} allowlist(s) an installer-running image is built against — all survive."
echo "$ignored_checked exclusion check(s) — ${#ignored_paths[@]} git-ignored path(s) against each allowlist — none reach the build context."
echo "$shape_checked re-inclusion(s) across ${#ignore_files[@]} allowlist(s) name a path rather than a wildcard family, and $family_checked file(s) of the families those allowlists enumerate all survive."
