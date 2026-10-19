#!/usr/bin/env bash
# Table test for gg-release.sh. Run it directly: scripts/ci/gg-release.test.sh
#
# A copy of the script runs in a throwaway tree holding its own pin file, with `uname`
# stubbed to the machine the case declares, against a release container laid out on disk
# and named by a file:// TCAB_GG_RELEASE_URL: a small `gg` answering --version and a
# `gg-reference.tar.gz` the case builds. The subject is what each subcommand prints and,
# for `fetch`, that <out-dir> receives `gg` and `gg-reference/` only once both are checked.
# The last cases read the checkout's own pin and the driver's base URL.
set -uo pipefail

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly CI_DIR
REPO_ROOT="$(cd "$CI_DIR/../.." && pwd)"
readonly REPO_ROOT
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

check_absent() { # label path
	if [ -e "$2" ] || [ -L "$2" ]; then
		bad "$1" "expected $2 to be absent"
	else
		ok "$1"
	fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

repo="$tmp/repo"
mkdir -p "$repo/scripts/ci" "$repo/crates/driver" "$repo/bin"
cp "$CI_DIR/gg-release.sh" "$CI_DIR/tcab-lib.sh" "$repo/scripts/ci/"
printf '0.7.1\n' >"$repo/crates/driver/gg-release-version"
cat >"$repo/bin/uname" <<'STUB'
#!/usr/bin/env bash
echo "${STUB_UNAME_M:-x86_64}"
STUB
chmod +x "$repo/bin/uname"

# A release container on disk: v<version>/ with the binary for <target> reporting
# <reports>, and the reference tarball (without its index when told so).
release() { # version target reports [no-index]
	local dir="$tmp/releases/v$1"
	rm -rf "$dir" "$tmp/ref"
	mkdir -p "$dir" "$tmp/ref/gg-reference"
	printf '#!/usr/bin/env bash\necho "gg %s"\n' "$3" >"$dir/gg-$2"
	# A download does not keep the executable bit.
	chmod 0644 "$dir/gg-$2"
	[[ "${4:-}" == no-index ]] || echo '{"languages":[]}' >"$tmp/ref/gg-reference/index.json"
	echo '{}' >"$tmp/ref/gg-reference/rust.json"
	tar -czf "$dir/gg-reference.tar.gz" -C "$tmp/ref" gg-reference
}

run() { # args...
	(cd "$tmp" && PATH="$repo/bin:$PATH" TCAB_GG_RELEASE_URL="${URL-file://$tmp/releases}" \
		"$repo/scripts/ci/gg-release.sh" "$@" 2>&1)
}

echo "--- version and toolchains-image ---"
out="$(run version)"
check_equal "version exits 0" "0" "$?"
check_equal "and prints the pin" "0.7.1" "$out"
out="$(run toolchains-image)"
check_equal "the toolchain image is the pinned version's" \
	"testcabinet.azurecr.io/test-cabinet-gg-toolchains:0.7.1" "$out"
out="$(TCAB_GG_RELEASE_VERSION=v0.8.0-rc1 run version)"
check_equal "TCAB_GG_RELEASE_VERSION overrides the pin, its v dropped" "0.8.0-rc1" "$out"
out="$(TCAB_GG_RELEASE_VERSION=0.8.0-rc1 run toolchains-image)"
check_equal "and the toolchain image follows it" \
	"testcabinet.azurecr.io/test-cabinet-gg-toolchains:0.8.0-rc1" "$out"
printf 'latest\n' >"$repo/crates/driver/gg-release-version"
out="$(run version)"
check_equal "a pin that is not a version fails" "1" "$?"
check_contains "naming the file" "'latest' is not a gg release version" "$out"
printf '0.7.1\n' >"$repo/crates/driver/gg-release-version"
out="$(run nonsense)"
check_equal "an unknown subcommand is a usage error" "2" "$?"
out="$(run fetch)"
check_equal "fetch without a directory is a usage error" "2" "$?"

echo "--- fetch ---"
release 0.7.1 x86_64-unknown-linux-musl 0.7.1
out="$(run fetch "$tmp/out")"
check_equal "fetch exits 0" "0" "$?"
check_contains "after running the binary" "gg 0.7.1" "$out"
check_contains "and printing its digest" \
	"$(sha256sum "$tmp/releases/v0.7.1/gg-x86_64-unknown-linux-musl" | cut -d' ' -f1)  gg-x86_64-unknown-linux-musl" "$out"
check_equal "into gg and gg-reference/ alone" "gg
gg-reference" "$(ls "$tmp/out")"
check_equal "the binary executable" "755" "$(stat -c %a "$tmp/out/gg")"
check_equal "the documents the tarball's" "index.json
rust.json" "$(ls "$tmp/out/gg-reference")"

out="$(cd "$tmp" && PATH="$repo/bin:$PATH" TCAB_GG_RELEASE_URL="file://$tmp/releases" \
	"$repo/scripts/ci/gg-release.sh" fetch rel 2>&1)"
check_equal "a relative directory is the caller's" "0" "$?"
check_equal "not the repository's" "gg
gg-reference" "$(ls "$tmp/rel")"

out="$(URL="file://$tmp/releases///" run fetch "$tmp/slash")"
check_equal "a base URL with trailing slashes works" "0" "$?"

release 0.7.1 aarch64-unknown-linux-musl 0.7.1
out="$(STUB_UNAME_M=aarch64 run fetch "$tmp/arm")"
check_equal "an aarch64 machine takes the aarch64 binary" "0" "$?"
check_contains "by its name" "gg 0.7.1 for aarch64-unknown-linux-musl" "$out"

out="$(STUB_UNAME_M=riscv64 run fetch "$tmp/riscv")"
check_equal "an architecture gg is not built for fails" "1" "$?"
check_contains "naming it" "gg publishes no binary for riscv64" "$out"

release 0.7.1 x86_64-unknown-linux-musl 0.7.0
out="$(run fetch "$tmp/wrong")"
check_equal "a binary reporting another version fails" "1" "$?"
check_contains "naming what it reported" "reports 'gg 0.7.0', not gg 0.7.1" "$out"
check_absent "and leaves no gg behind" "$tmp/wrong/gg"

release 0.7.1 x86_64-unknown-linux-musl 0.7.1 no-index
out="$(run fetch "$tmp/noindex")"
check_equal "a tarball without the index fails" "1" "$?"
check_contains "naming it" "holds no gg-reference/index.json" "$out"
check_absent "and leaves no gg behind" "$tmp/noindex/gg"

out="$(TCAB_GG_RELEASE_VERSION=9.9.9 run fetch "$tmp/missing")"
status=$?
check_equal "a version that was never published fails (curl's status)" "true" "$([ "$status" -ne 0 ] && echo true)"
check_absent "with nothing fetched" "$tmp/missing/gg"

release 0.7.1 x86_64-unknown-linux-musl 0.7.1
mkdir -p "$tmp/again/gg-reference"
touch "$tmp/again/gg-reference/stale.json"
out="$(run fetch "$tmp/again")"
check_equal "fetching over an earlier fetch succeeds" "0" "$?"
check_absent "and replaces its documents" "$tmp/again/gg-reference/stale.json"

echo "--- the checkout's own pin ---"
out="$("$REPO_ROOT/scripts/ci/gg-release.sh" version 2>&1)"
check_equal "the checkout's pin reads" "0" "$?"
check_equal "as the one line of crates/driver/gg-release-version" \
	"$(tr -d '[:space:]' <"$REPO_ROOT/crates/driver/gg-release-version")" "$out"
check_contains "which gg_exec.rs compiles in as DEFAULT_RELEASE_VERSION" \
	'include_str!("../gg-release-version")' "$(cat "$REPO_ROOT/crates/driver/src/gg_exec.rs")"
script_base="$(sed -nE 's/^readonly DEFAULT_BASE_URL="([^"]+)"$/\1/p' "$CI_DIR/gg-release.sh")"
driver_base="$(grep -A1 'pub const DEFAULT_RELEASE_BASE_URL' "$REPO_ROOT/crates/driver/src/gg_exec.rs" |
	sed -nE 's/.*"([^"]+)".*/\1/p')"
check_equal "the base URL is the driver's DEFAULT_RELEASE_BASE_URL" "$driver_base" "$script_base"

echo
echo "gg-release.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
