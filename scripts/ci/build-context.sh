#!/usr/bin/env bash
# Verifies that every file a Dockerfile COPYs out of the build context survives
# `.dockerignore`.
#
# WHY THIS EXISTS. `.dockerignore` is an ALLOWLIST — `*`, then explicit `!`
# re-inclusions — so the default answer for any path is "not in the context". A
# `COPY` whose source was never re-included therefore does not warn: the build dies
# with `failed to compute cache key: "/path": not found`, preceded by the giveaway
# `transferring context: 2B`. Nothing else in this repository can see that. The Rust
# suite, the lints and the front-end builds all pass on a tree
# whose images cannot be built at all, and the image builds themselves run only on
# master/staging, after the gates — so the defect lands, and is
# found by whoever next needs a run container. It has happened twice: once when the
# Blender image added its two authoring helpers, and once when the gg toolchain
# builder added the Java arm's installer, which broke the `-gg` variant of EVERY
# language rather than only Java's.
#
# What it checks, per tracked Dockerfile, for every `COPY`/`ADD` that reads the
# build context (`--from=` copies read an earlier stage, and remote `ADD` sources
# read the network — neither touches the context), and for every `RUN` bind mount
# of a context path (`--mount=type=bind,source=<path>` without `from=`), which reads
# the context exactly as a COPY does and fails the same way:
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
# A Dockerfile with a sibling ignore file can therefore answer to ITS file or to the
# ROOT one depending on who builds it, and a source admitted by one and not the other
# is a build that works for whoever added it and fails for the next person on the
# other runtime. None of this project's own Dockerfiles has one today; the check stays
# so that the first one to gain a sibling is held to both.
#
# So this gate checks every Dockerfile against the root allowlist, and additionally
# against its sibling one where it has it. The failure message names the file that
# rejected the source, which is the file to widen.
#
# WHICH DOCKERFILES. Every one built from the repository root: `deployments/images/*`
# and `.devcontainer/ubuntu.dockerfile`, whose compose service sets
# the context to the repository root so that its last layer can run gg's toolchain
# installers against the pins under the gg checkout's packages/. The template's two CI images
# (`ci/images/rust.Dockerfile`, `ci/images/web.Dockerfile`) copy only the
# devcontainer's install scripts, through their own sibling ignore files, and the
# template answers for them, so they are left out by name (TEMPLATE_DOCKERFILES
# below). The project's own CI image, `ci/images/rust-browser.Dockerfile`, is
# checked like any other Dockerfile with a sibling ignore file.
#
# Whole-context copies (`COPY . .`) are inspected for neither of the two checks: they
# take whatever the allowlist admits, which is exactly the question the allowlist
# answers. A DIRECTORY source is a weaker version of the same thing — `COPY dir dst`
# copies the directory's surviving contents — so it is checked for whether the copy
# transfers *anything*, not for whether the directory itself was re-included. That
# distinction is load-bearing rather than pedantic: the devcontainer image once copied
# `./packages`, whose allowlist entry was the glob
# `!/packages/gg-sandbox-*/*-version.sh` — the directory was ignored, the nine files
# under it were not, and the build worked. What the check still catches is the real
# failure: a directory none of whose contents survive, which copies nothing at all.
#
# The evaluation mirrors Docker's own: patterns apply in order, the last one to match
# wins, a `!` pattern re-includes, and a path is ignored when it or any ancestor
# directory is. `*` and `?` do not cross `/`; `**` does.
#
# Needs no toolchain and no history — it reads the checked-out tree — so the
# `build-context` gate (ci/gates/build-context.py) runs it as a commit hook and in CI.
#
# SUBMODULES. A path the allowlist re-includes may lie in a submodule (the plan is
# for contracts' crates and the engines to arrive that way), and a submodule's
# files are not the superproject's: `git ls-files` lists the gitlink alone, and a
# checkout that has not initialized the submodule holds an empty directory there.
# So a source, a re-included tree or a baked-in path inside a submodule is
# checked against that submodule's own checkout, and one inside a submodule this
# checkout has not initialized cannot be checked at all: it is counted and named
# as unverified rather than failed, since no gate job initializes a submodule.
# `--submodules` prints the submodules the root allowlist admits any part of, one
# path per line, which is the set scripts/ci/submodules.sh initializes for a job
# that builds from this context (`init --build-context`). See "part four" below.
#
# Usage:
#   scripts/ci/build-context.sh
#   scripts/ci/build-context.sh --submodules
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tcab-lib.sh"

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
	done < <(tracked_files_under "$dir")
	return 1
}

# --- submodules -------------------------------------------------------------

# The path of every submodule .gitmodules declares, one per line.
submodule_paths() {
	[[ -f "$REPO_ROOT/.gitmodules" ]] || return 0
	git config -f "$REPO_ROOT/.gitmodules" --get-regexp '^submodule\..*\.path$' 2>/dev/null | awk '{ print $2 }'
}
mapfile -t SUBMODULES < <(submodule_paths)

# True when the submodule at `$1` is initialized here: its directory is the root
# of a checkout git can read. A `.git` directory and a `.git` file naming the
# gitdir (how `git submodule` lays one out) both qualify; a `.git` file whose
# gitdir is gone does not, since none of the submodule's files can be listed.
submodule_checked_out() {
	local top
	top="$(git -C "$REPO_ROOT/$1" rev-parse --show-toplevel 2>/dev/null)" || return 1
	[[ "$top" == "$(cd "$REPO_ROOT/$1" && pwd -P)" ]]
}

# The superproject's own tracked files matching the pathspecs given, one per line,
# never a path at or under a submodule. `git ls-files` lists a registered submodule
# as its gitlink alone, but a nested checkout git could not recognize as one (a
# `.git` file whose gitdir is missing, say) is indexed as ordinary files, and the
# files of another repository are not this one's to judge: each submodule runs
# this gate from its own checkout. A source the root allowlist re-includes inside
# a submodule is still checked, against that submodule's checkout, by the
# functions above.
superproject_files() {
	git -C "$REPO_ROOT" ls-files -- "$@" |
		awk -v subs="${SUBMODULES[*]}" '
			BEGIN { n = split(subs, sub_paths, " ") }
			{
				for (i = 1; i <= n; i++)
					if ($0 == sub_paths[i] || index($0, sub_paths[i] "/") == 1) next
				print
			}
		'
}

# The submodule `$1` lies in (the submodule's own path, or a path under it),
# printed; returns 1 when it lies in none.
submodule_of() {
	local path="$1" sub
	for sub in "${SUBMODULES[@]}"; do
		if [[ "$path" == "$sub" || "$path" == "$sub/"* ]]; then
			printf '%s\n' "$sub"
			return 0
		fi
	done
	return 1
}

# The submodule `$1` lies in when that submodule is NOT checked out here, so
# nothing about the path can be verified; returns 1 otherwise.
absent_submodule_of() {
	local sub
	sub="$(submodule_of "$1")" || return 1
	submodule_checked_out "$sub" && return 1
	printf '%s\n' "$sub"
}

# Every tracked file under `$1`, repository-relative, the files of a checked-out
# submodule at or under it included. `git ls-files` lists a submodule as its
# gitlink alone, so each submodule's own index is read for it; one that is not
# checked out contributes nothing, which its callers report as unverified.
tracked_files_under() {
	local dir="$1" sub
	superproject_files "$dir"
	for sub in "${SUBMODULES[@]}"; do
		submodule_checked_out "$sub" || continue
		if [[ "$dir" == "$sub" ]]; then
			git -C "$REPO_ROOT/$sub" ls-files | sed "s#^#$sub/#"
		elif [[ "$dir" == "$sub/"* ]]; then
			git -C "$REPO_ROOT/$sub" ls-files -- "${dir#"$sub/"}" | sed "s#^#$sub/#"
		elif [[ "$sub" == "$dir/"* ]]; then
			git -C "$REPO_ROOT/$sub" ls-files | sed "s#^#$sub/#"
		fi
	done
}

# The submodules the loaded allowlist admits any part of: the submodule itself
# (named, or under a re-included ancestor), or a path a re-inclusion names inside
# it. A re-inclusion carries no wildcard (the shape check below enforces it), so
# a prefix test of its text is exact.
context_submodules() {
	local sub index raw
	for sub in "${SUBMODULES[@]}"; do
		if context_includes "$sub"; then
			printf '%s\n' "$sub"
			continue
		fi
		for index in "${!DI_RAW[@]}"; do
			((DI_NEGATED[index] == 1)) || continue
			raw="${DI_RAW[$index]#/}"
			raw="${raw%/}"
			if [[ "$raw" == "$sub/"* ]]; then
				printf '%s\n' "$sub"
				break
			fi
		done
	done
}

if [[ "${1:-}" == "--submodules" ]]; then
	load_dockerignore "$REPO_ROOT/.dockerignore"
	context_submodules
	exit 0
fi
[[ $# -eq 0 ]] || {
	echo "usage: scripts/ci/build-context.sh [--submodules]" >&2
	exit 2
}

# Paths inside a submodule this checkout has not initialized, which a check met
# and could not verify, as "<submodule> <path>".
UNVERIFIED=()

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
!/apps/site
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
ui-common/packages/ui/src/index.ts ignored
apps/site/src/main.ts included
apps/docs/astro.config.mjs ignored
crates/gg/target/debug/gg ignored
crates/target ignored
target ignored
apps/site/node_modules/left-pad/index.js ignored
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

# Print `<line-number> COPY <source> /bind-mount` for every `--mount=type=bind` of a
# context path, so check_dockerfile holds the mounted source to the allowlist like a
# COPY's. A mount naming `from=` reads a stage or an image, never the context, and a
# bind mount without `source=` mounts the context root, which is the allowlist's own
# answer.
bind_mount_sources() {
	awk '
		/^[[:space:]]*#/ { next }
		{
			rest = $0
			while (match(rest, /--mount=[^[:space:]\\]+/)) {
				spec = substr(rest, RSTART + 8, RLENGTH - 8)
				rest = substr(rest, RSTART + RLENGTH)
				if (spec !~ /(^|,)type=bind(,|$)/ || spec ~ /(^|,)from=/) continue
				n = split(spec, fields, ",")
				for (i = 1; i <= n; i++) {
					if (fields[i] ~ /^(source|src)=/) {
						sub(/^(source|src)=/, "", fields[i])
						print NR, "COPY " fields[i] " /bind-mount"
					}
				}
			}
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
# The CI images, left out by name (see the header): each must still be tracked, so a
# template update that renames one fails here rather than letting the list rot.
TEMPLATE_DOCKERFILES=(ci/images/rust.Dockerfile ci/images/web.Dockerfile)
for template_dockerfile in "${TEMPLATE_DOCKERFILES[@]}"; do
	git ls-files --error-unmatch -- "$template_dockerfile" >/dev/null 2>&1 || {
		echo "error: $template_dockerfile is named in TEMPLATE_DOCKERFILES and is not tracked; update the list." >&2
		exit 1
	}
done
mapfile -t dockerfiles < <(
	superproject_files '*Dockerfile' '*.Dockerfile' '*.dockerfile' |
		grep -vxF -f <(printf '%s\n' "${TEMPLATE_DOCKERFILES[@]}") |
		sort
)
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
			if absent="$(absent_submodule_of "$normalized")"; then
				UNVERIFIED+=("$absent $dockerfile:$lineno copies '$source'")
				continue
			fi
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
	done < <(
		copy_instructions "$dockerfile"
		bind_mount_sources "$dockerfile"
	)
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

# --- what a COPY cannot tell you: the trees baked in with include_str! ---------


# Everything above reads `COPY` sources, and some build inputs are named by no `COPY`.
# microservice-driver's `crates/driver` and the engines repository's `crates/engines`
# BAKE three directories into the binaries verbatim — the built-in orchestrators'
# manifests and runner scripts and the harness manifests (the driver), and the engine
# manifests (engines) — with `include_str!` paths that climb out of `crates/` with
# `../../../`. Both are submodules the patch table sends cargo to. They ride
# in on the build stage's `COPY . .`, so the allowlist is the only thing that
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
# (the table was the since-dissolved core crate's then; it is
# `crates/engines/src/lib.rs` now), which reads as a broken checkout, and stopped
# `make local-up` from standing the cluster up at all. Every service image is built
# by the one cargo stage that compiles `test-cabinet-engines`, so a tree missing here
# takes all four of them down at once.
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
# root file.

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
mapfile -t rust_sources < <(superproject_files 'crates/*.rs' | grep -v '\.test\.rs$')
# The crates of every submodule the context admits compile in the same build, the
# patch table sending their sources there: the engines repository's engine table
# bakes in its manifests the same way. Read from each checkout's own index, and
# passed over for a submodule this checkout has not initialized, which part four
# names. Only a source the allowlist admits is read: a submodule may be admitted for
# a slice no image compiles (gg's crate enters with its manifest and the target files
# it names, because the patch table makes cargo load it, and nothing depends on it),
# and a source the context does not carry is compiled by no image.
while IFS= read -r context_sub; do
	[[ -n "$context_sub" ]] || continue
	submodule_checked_out "$context_sub" || continue
	while IFS= read -r context_source; do
		context_includes "$context_source" && rust_sources+=("$context_source")
	done < <(git -C "$REPO_ROOT/$context_sub" ls-files 'crates/*.rs' | grep -v '\.test\.rs$' | sed "s|^|$context_sub/|")
done < <(context_submodules)
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
	if absent="$(absent_submodule_of "$baked_resolved")"; then
		UNVERIFIED+=("$absent $baked_file:$baked_line bakes in '$baked_resolved'")
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

# --- what an allowlist lets in by accident -----------------------------------

# Everything above asks "does the context still contain what a build READS". This asks
# the other question, which nothing here used to ask: does it contain anything a build
# does NOT read. An allowlist makes that failure silent — `!/crates` re-includes a
# directory, not a file list, so every future untracked or generated file under it joins
# the context of every whole-context build without a line changing anywhere.
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
# Checked against EVERY allowlist that can apply, for the reason pass two above exists: a
# sibling allowlist that re-includes a directory whole is exactly the shape that lets
# ignored scratch in.
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

# --- what a COPY cannot tell you, part three: the paths the toolchain installers read ---

# gg's toolchain installers (`scripts/ci/install-gg-toolchains.sh` and the per-arm
# installers it runs, in the gg repository) are copied out of the `gg/` submodule into
# the devcontainer image (`.devcontainer/ubuntu.dockerfile`), along with a slice of gg's
# `packages/`, and they read pins, lockfiles and manifests out of that slice by
# `$REPO_ROOT/<path>`, the root being the gg checkout's. No COPY names those files, so
# nothing above sees them; a missing one fails the image build minutes in with cargo's
# "manifest path ... does not exist".
#
# So every tracked `$REPO_ROOT/<path>` literal in those installers, read as
# `gg/<path>`, must survive every allowlist an installer-running image is built
# against: the root one, and the sibling of each Dockerfile that names the installer.
# An image that runs no installer (the web CI image) keeps an empty context, and this
# check leaves it alone. Untracked paths (`node_modules/.bin/tsc`, which an installer
# probes and does without) are skipped. A `cargo fetch --manifest-path` needs two more
# things than the manifest: the lockfile beside it, which `--locked` reads, and —
# because the slice deliberately carries no `src/` — a manifest that names its
# `[lib] path` rather than having cargo discover it. gg's own build-context gate
# holds the same literals to its toolchains image's allowlist. A checkout that has
# not initialized `gg/` cannot be read, and the check is named as not made.
readonly INSTALLER_REPO="gg"
installer_checked=0
installer_inputs=()
installer_ignore_files=(".dockerignore")
if submodule_checked_out "$INSTALLER_REPO"; then
	# shellcheck disable=SC2016 # the `$REPO_ROOT` in both patterns is the literal text being matched.
	mapfile -t installer_paths < <(
		git -C "$REPO_ROOT/$INSTALLER_REPO" ls-files -z -- 'scripts/ci/install-*.sh' |
			xargs -0 -I{} grep -ohE '\$(\{REPO_ROOT\}|REPO_ROOT)/[A-Za-z0-9_./-]+' "$REPO_ROOT/$INSTALLER_REPO/{}" |
			sed -E 's#^\$(\{REPO_ROOT\}|REPO_ROOT)/##' | sort -u
	)
	((${#installer_paths[@]} > 0)) || {
		echo "error: no \$REPO_ROOT paths found in $INSTALLER_REPO/scripts/ci/install-*.sh; this check would pass vacuously." >&2
		exit 1
	}
	for path in "${installer_paths[@]}"; do
		git -C "$REPO_ROOT/$INSTALLER_REPO" ls-files --error-unmatch -- "$path" >/dev/null 2>&1 || continue
		installer_inputs+=("$INSTALLER_REPO/$path")
		[[ "$path" == */Cargo.toml ]] || continue
		installer_inputs+=("$INSTALLER_REPO/${path%Cargo.toml}Cargo.lock")
		grep -qE '^path *= *"src/lib\.rs"' "$REPO_ROOT/$INSTALLER_REPO/$path" && continue
		echo "error: $INSTALLER_REPO/$path is fetched by a toolchain installer from a slice with no src/, and does not name its [lib] path." >&2
		echo "       cargo then looks for src/lib.rs and fails before it fetches anything." >&2
		echo "       Fix: add 'path = \"src/lib.rs\"' under its [lib] table, in the gg repository." >&2
		problems=$((problems + 1))
	done
	# The root allowlist always applies; a sibling applies where an installer-running
	# Dockerfile has one. A Dockerfile must still run the installer, or the check is about
	# nothing.
	installer_dockerfiles=0
	for dockerfile in "${dockerfiles[@]}"; do
		grep -qE "^[^#]*$INSTALLER_REPO/scripts/ci/install-" "$REPO_ROOT/$dockerfile" || continue
		installer_dockerfiles=$((installer_dockerfiles + 1))
		[[ -f "$REPO_ROOT/$dockerfile.dockerignore" ]] && installer_ignore_files+=("$dockerfile.dockerignore")
	done
	((installer_dockerfiles > 0)) || {
		echo "error: no Dockerfile copies a $INSTALLER_REPO/scripts/ci/install-*.sh; the installer-input check would pass vacuously." >&2
		exit 1
	}
	for ignore_file in "${installer_ignore_files[@]}"; do
		load_dockerignore "$REPO_ROOT/$ignore_file"
		for path in "${installer_inputs[@]}"; do
			installer_checked=$((installer_checked + 1))
			# A directory (the guest a cargo fetch runs in) reaches the slice when anything
			# under it does; the files it is fetched with are inputs of their own.
			if [[ -d "$REPO_ROOT/$path" ]]; then
				context_includes_dir "$path" && continue
			else
				context_includes "$path" && continue
			fi
			echo "error: $ignore_file keeps '$path' OUT of the build context, and a toolchain installer reads it." >&2
			echo "       $INSTALLER_REPO/scripts/ci/install-*.sh run in images built against this allowlist, so the" >&2
			echo "       image build fails partway through the install. Fix: add '!/$path' to $ignore_file, with a comment." >&2
			problems=$((problems + 1))
		done
	done
else
	UNVERIFIED+=("$INSTALLER_REPO the paths its toolchain installers read, which the devcontainer image stages")
fi

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
# excluded on its first line. The one glob re-inclusion the root allowlist then held
# (`!/scripts/gg-*.sh`) was the reason the sender was there at all.
#
# THE RULE: a re-inclusion names a path, never a family. Excludes may still be globs —
# `**/node_modules/` is an exclude, and the sender handles those without walking.
#
# The families the globs used to admit without an edit (a new arm's installer, version
# file or gg helper) now arrive as directories: the gg slice's scripts are one
# re-inclusion of `gg/scripts`, and the arms' pins are held to the allowlist by the
# installer-input check above.
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
		echo "       Fix: replace the glob with one '!' line per file, or re-include the directory that holds them." >&2
		problems=$((problems + 1))
	done
done

# --- part four: submodules in the build context ------------------------------

# A submodule enters the context the way any path does, by a re-inclusion that
# names it or a path inside it; `*` at the top keeps every other submodule out,
# cold-storage's media included. What changes is who must provide its files: a
# build sees what the checkout it runs in has, and a fresh checkout leaves every
# submodule empty. So every job that builds an image from this context runs
# `scripts/ci/submodules.sh init --build-context`, which initializes exactly the
# set printed by `--submodules`, and a developer runs the same before a local
# image build. Here each admitted submodule is listed, and one this checkout has
# not initialized is named with every check that could not be made inside it.
load_dockerignore "$REPO_ROOT/.dockerignore"
mapfile -t context_subs < <(context_submodules)
for sub in "${context_subs[@]}"; do
	submodule_checked_out "$sub" && continue
	UNVERIFIED+=("$sub the root allowlist re-includes it or a path in it")
done

((problems == 0)) || {
	echo >&2
	echo "$problems build-context problem(s) found across ${#dockerfiles[@]} Dockerfiles, $baked_checked baked-in includes, $installer_checked installer inputs, ${#ignored_paths[@]} git-ignored paths and $shape_checked re-inclusions." >&2
	exit 1
}

# A count of CHECKS rather than of distinct paths: a Dockerfile with a sibling
# allowlist has its sources checked against both, which is the point.
echo "$checked context-source check(s) — every COPY across ${#dockerfiles[@]} Dockerfiles, against each allowlist that can apply to it (every RUN bind mount of a context path among them), plus the $baked_checked path(s) the workspace bakes in with include_str! — all survive."
echo "$installer_checked installer-input check(s) — ${#installer_inputs[@]} tracked path(s) $INSTALLER_REPO/scripts/ci/install-*.sh read, against each of the ${#installer_ignore_files[@]} allowlist(s) an installer-running image is built against — all survive."
echo "$ignored_checked exclusion check(s) — ${#ignored_paths[@]} git-ignored path(s) against each allowlist — none reach the build context."
echo "$shape_checked re-inclusion(s) across ${#ignore_files[@]} allowlist(s) name a path rather than a wildcard family."
if ((${#context_subs[@]} == 0)); then
	echo "No submodule is in the build context."
else
	echo "${#context_subs[@]} submodule(s) in the build context: ${context_subs[*]}."
fi
if ((${#UNVERIFIED[@]} > 0)); then
	echo "${#UNVERIFIED[@]} check(s) inside a submodule this checkout has not initialized were NOT made:"
	for entry in "${UNVERIFIED[@]}"; do
		echo "  ${entry%% *}: ${entry#* }"
	done
	echo "  Initialize them to check them: scripts/ci/submodules.sh init --build-context"
fi
