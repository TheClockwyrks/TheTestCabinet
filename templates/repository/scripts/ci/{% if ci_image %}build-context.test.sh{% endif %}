#!/usr/bin/env bash
# Table test for build-context.sh. Run it directly:
# scripts/ci/build-context.test.sh
#
# Each case runs a copy of the script in a throwaway git repository holding a
# small Rust workspace, a Dockerfile and an allowlist that pass, then breaks
# the one thing the case names. The subject is that each kind of break fails,
# naming the file to fix, and that a repository carrying no crate passes with
# no toolchain to hold a pin to.
set -uo pipefail

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly CI_DIR
pass=0
fail=0

ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad() {
	fail=$((fail + 1))
	printf 'FAIL  %s\n' "$1"
	shift
	printf '        %s\n' "$@"
}

check_equal() { # label expected actual
	if [ "$2" = "$3" ]; then
		ok "$1"
	else
		bad "$1" "expected: $2" "got:      ${3:-<empty>}"
	fi
}

check_contains() { # label needle haystack
	if grep -qF -- "$2" <<<"$3"; then
		ok "$1"
	else
		bad "$1" "expected output containing: $2" "got: ${3:-<empty>}"
	fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
# A commit hook's variables would point git at the repository being committed to.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX GIT_COMMON_DIR GIT_OBJECT_DIRECTORY \
	GIT_ALTERNATE_OBJECT_DIRECTORIES

# In the kit the script carries a conditional name; in a render it is itself.
source_script="$CI_DIR/build-context.sh"
[ -f "$source_script" ] || source_script="$CI_DIR/{% if ci_image %}build-context.sh{% endif %}"

# A repository that passes: a workspace, the Dockerfile at the root and an
# allowlist naming what it copies.
fresh_repo() {
	local repo
	repo="$(mktemp -d "$tmp/repoXXXXXX")"
	mkdir -p "$repo/scripts/ci" "$repo/crates/one/src" "$repo/.cargo" "$repo/docs"
	cp "$source_script" "$repo/scripts/ci/build-context.sh"
	printf '[toolchain]\nchannel = "1.97.1"\n' >"$repo/rust-toolchain.toml"
	printf '[workspace]\nmembers = ["crates/*"]\n' >"$repo/Cargo.toml"
	printf '# lock\n' >"$repo/Cargo.lock"
	printf '[net]\ngit-fetch-with-cli = true\n' >"$repo/.cargo/config.toml"
	printf 'fn main() {}\n' >"$repo/crates/one/src/main.rs"
	printf 'notes\n' >"$repo/docs/notes.md"
	cat >"$repo/Dockerfile" <<'DOCKERFILE'
# syntax=docker/dockerfile:1
FROM docker.io/library/rust:1.97.1-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY .cargo .cargo
COPY ./crates \
     crates
COPY . .
RUN cargo build --release
FROM debian:bookworm-slim
COPY --from=build /src/target/release/one /usr/local/bin/one
ADD https://example.invalid/file /tmp/file
DOCKERFILE
	cat >"$repo/.dockerignore" <<'IGNORE'
# The workspace.
*
!/Cargo.toml
!/Cargo.lock
!/.cargo
!/rust-toolchain.toml
!/crates
**/target
IGNORE
	git -C "$repo" init --quiet
	git -C "$repo" add -A
	printf '%s' "$repo"
}
run() { (cd "$tmp" && "$1/scripts/ci/build-context.sh" 2>&1); }

echo "--- a repository whose Dockerfile reads only what its allowlist admits ---"
repo="$(fresh_repo)"
out="$(run "$repo")"
check_equal "passes" "0" "$?"
check_contains "counting what it checked" "5 context-source check(s) across 1 Dockerfile(s)" "$out"
check_contains "and the Rust pin" "1 Rust pin(s) name rust-toolchain.toml's channel, 1.97.1." "$out"

echo "--- an allowlist that drops a file the Dockerfile copies ---"
repo="$(fresh_repo)"
sed -i '\#^!/Cargo.lock$#d' "$repo/.dockerignore"
out="$(run "$repo")"
check_equal "fails" "1" "$?"
check_contains "naming the source and the allowlist" "Dockerfile:4 copies 'Cargo.lock', which .dockerignore keeps OUT of the build context." "$out"
check_contains "and the fix" "add '!/Cargo.lock' to .dockerignore" "$out"

echo "--- an allowlist that drops a directory the Dockerfile copies ---"
repo="$(fresh_repo)"
sed -i '\#^!/crates$#d' "$repo/.dockerignore"
out="$(run "$repo")"
check_equal "fails" "1" "$?"
check_contains "naming the continued COPY's line and the directory" "Dockerfile:6 copies the directory './crates'" "$out"

echo "--- a directory whose files alone are named back in ---"
repo="$(fresh_repo)"
printf 'COPY docs /docs\n' >>"$repo/Dockerfile"
printf '!/docs/notes.md\n' >>"$repo/.dockerignore"
out="$(run "$repo")"
check_equal "passes, since the copy transfers what survives" "0" "$?"

echo "--- a Dockerfile that copies a path that does not exist ---"
repo="$(fresh_repo)"
printf 'COPY scripts/no-such-helper.sh /tmp/\n' >>"$repo/Dockerfile"
out="$(run "$repo")"
check_equal "fails" "1" "$?"
check_contains "naming it" "copies 'scripts/no-such-helper.sh', which does not exist in the repository." "$out"

echo "--- a sibling allowlist that drops what the root one admits ---"
repo="$(fresh_repo)"
mkdir -p "$repo/images"
printf 'FROM scratch\nCOPY Cargo.toml /\n' >"$repo/images/tool.Dockerfile"
printf '*\n' >"$repo/images/tool.Dockerfile.dockerignore"
git -C "$repo" add -A
out="$(run "$repo")"
check_equal "fails" "1" "$?"
check_contains "naming the sibling file" "images/tool.Dockerfile:2 copies 'Cargo.toml', which images/tool.Dockerfile.dockerignore keeps OUT" "$out"

echo "--- a Rust pin other than the toolchain's ---"
repo="$(fresh_repo)"
sed -i 's/rust:1.97.1-bookworm/rust:1.80.0-bookworm/' "$repo/Dockerfile"
out="$(run "$repo")"
check_equal "fails" "1" "$?"
check_contains "naming the pin and the channel" "Dockerfile:2 pins Rust 1.80.0, and rust-toolchain.toml's channel is 1.97.1." "$out"

echo "--- an ARG RUST_VERSION default other than the toolchain's ---"
repo="$(fresh_repo)"
sed -i '1a ARG RUST_VERSION=1.0.0' "$repo/Dockerfile"
out="$(run "$repo")"
check_equal "fails" "1" "$?"
check_contains "naming it" "Dockerfile:2 pins Rust 1.0.0" "$out"

echo "--- an unprefixed rust image ---"
repo="$(fresh_repo)"
sed -i 's#docker.io/library/rust:1.97.1#rust:1.96.0#' "$repo/Dockerfile"
out="$(run "$repo")"
check_equal "is a pin too" "1" "$?"
check_contains "naming it" "pins Rust 1.96.0" "$out"

echo "--- a repository carrying no crate, whose image builds an npm workspace ---"
repo="$(fresh_repo)"
git -C "$repo" rm --quiet -r --cached rust-toolchain.toml Cargo.toml Cargo.lock .cargo crates
rm -r "$repo/rust-toolchain.toml" "$repo/Cargo.toml" "$repo/Cargo.lock" "$repo/.cargo" "$repo/crates"
printf '{"private": true}\n' >"$repo/package.json"
printf '{}\n' >"$repo/package-lock.json"
cat >"$repo/Dockerfile" <<'DOCKERFILE'
# syntax=docker/dockerfile:1
FROM docker.io/library/node:24-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY . .
RUN npm ci && npm run build
FROM docker.io/nginxinc/nginx-unprivileged:1-bookworm
COPY --from=build /src/dist /usr/share/nginx/html
DOCKERFILE
printf '*\n!/package.json\n!/package-lock.json\n**/node_modules\n' >"$repo/.dockerignore"
git -C "$repo" add -A
out="$(run "$repo")"
check_equal "passes with no toolchain to hold a pin to" "0" "$?"
check_contains "counting what it checked" "2 context-source check(s) across 1 Dockerfile(s)" "$out"
check_contains "saying it holds no Rust pin" "No rust-toolchain.toml, and no Dockerfile pins Rust." "$out"
sed -i 's#docker.io/library/node:24-bookworm-slim#docker.io/library/rust:1.97.1-bookworm#' "$repo/Dockerfile"
out="$(run "$repo")"
check_equal "a Rust pin there fails" "1" "$?"
check_contains "naming the missing channel" "Dockerfile:2 pins Rust 1.97.1, and rust-toolchain.toml names no channel to hold it to." "$out"

echo "--- no Dockerfile at the root ---"
repo="$(fresh_repo)"
git -C "$repo" rm --quiet --cached Dockerfile
rm "$repo/Dockerfile"
out="$(run "$repo")"
check_equal "fails" "1" "$?"
check_contains "saying the image jobs build it" "no Dockerfile is tracked at the repository root" "$out"

echo
echo "build-context.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
