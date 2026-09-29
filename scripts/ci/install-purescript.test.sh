#!/usr/bin/env bash
# Table test for install-purescript.sh. Run it directly:
# scripts/ci/install-purescript.test.sh
#
# A copy of the script runs in a throwaway repository whose
# purescript-version.sh pins purs and esbuild, with a stand-in fetch.sh serving
# release tarballs built here, `uname` stubbed to the platform the case
# declares, and HOME in a temporary directory. The subject is the asset each
# platform fetches, where the two binaries land, and that matching ones are left
# alone.
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

check_lacks() { # label needle haystack
	if grep -qF -- "$2" <<<"$3"; then
		bad "$1" "expected no output containing: $2" "got: ${3:-<empty>}"
	else
		ok "$1"
	fi
}

check_exists() { # label path
	if [ -e "$2" ] || [ -L "$2" ]; then
		ok "$1"
	else
		bad "$1" "expected $2 to exist"
	fi
}

check_absent() { # label path
	if [ -e "$2" ] || [ -L "$2" ]; then
		bad "$1" "expected $2 to be gone"
	else
		ok "$1"
	fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# A stand-in for fetch.sh: it serves each URL out of $STUB_SERVER by the URL's
# last path segment and records the URL. The real one is fetch.test.sh's subject.
fake_fetch() { # repo
	cat >"$1/scripts/ci/fetch.sh" <<'EOF2'
gg_fetch_dir() { echo "$STUB_DOWNLOADS"; }
gg_fetch() {
	echo "$1" >>"$STUB_LOG"
	mkdir -p "$(dirname "$2")"
	cp "$STUB_SERVER/${1##*/}" "$2"
}
EOF2
}

repo="$tmp/repo"
mkdir -p "$repo/scripts/ci" "$repo/packages/gg-sandbox-purescript" "$tmp/bin" "$tmp/server"
cp "$CI_DIR/install-purescript.sh" "$repo/scripts/ci/"
fake_fetch "$repo"
printf 'PURS_VERSION="0.15.16"\nESBUILD_VERSION="0.28.1"\n' >"$repo/packages/gg-sandbox-purescript/purescript-version.sh"
cat >"$tmp/bin/uname" <<'STUB'
#!/usr/bin/env bash
case "$1" in
	-s) echo "${STUB_UNAME_S:-Linux}" ;;
	-m) echo "${STUB_UNAME_M:-x86_64}" ;;
esac
STUB
chmod +x "$tmp/bin/uname"

# purs and esbuild release archives for every platform, each binary answering --version.
for asset in linux64 linux-arm64 macos macos-arm64; do
	mkdir -p "$tmp/build/$asset/purescript"
	printf '#!/bin/sh\necho 0.15.16\n' >"$tmp/build/$asset/purescript/purs"
	tar -C "$tmp/build/$asset" -czf "$tmp/server/$asset.tar.gz" purescript
done
for platform in linux-x64 linux-arm64 darwin-x64 darwin-arm64; do
	mkdir -p "$tmp/build/$platform/package/bin"
	printf '#!/bin/sh\necho 0.28.1\n' >"$tmp/build/$platform/package/bin/esbuild"
	tar -C "$tmp/build/$platform" -czf "$tmp/server/$platform-0.28.1.tgz" package
done

run() { # home [env...]
	local home="$1"
	shift
	: >"$tmp/fetch.log"
	mkdir -p "$home"
	(cd "$tmp" && env -u PURS_INSTALL_DIR HOME="$home" STUB_LOG="$tmp/fetch.log" STUB_SERVER="$tmp/server" \
		PATH="$tmp/bin:$PATH" "$@" "$repo/scripts/ci/install-purescript.sh" 2>&1)
}

home="$tmp/home"
out="$(run "$home")"
check_equal "a fresh Linux x86_64 install succeeds" "0" "$?"
check_equal "fetches the pinned purs release and esbuild's npm tarball" \
	"https://github.com/purescript/purescript/releases/download/v0.15.16/linux64.tar.gz
https://registry.npmjs.org/@esbuild/linux-x64/-/linux-x64-0.28.1.tgz" "$(cat "$tmp/fetch.log")"
for binary in purs esbuild; do
	if [ -x "$home/.local/bin/$binary" ]; then
		ok "$binary lands executable in ~/.local/bin"
	else
		bad "$binary lands executable in ~/.local/bin" "it is not there"
	fi
done

out="$(run "$home")"
check_equal "a second run succeeds" "0" "$?"
check_contains "leaving purs alone" "purs 0.15.16 already installed" "$out"
check_contains "and esbuild" "esbuild 0.28.1 already installed" "$out"
check_equal "without fetching" "" "$(cat "$tmp/fetch.log")"

printf '#!/bin/sh\necho 0.15.0\n' >"$home/.local/bin/purs"
out="$(run "$home")"
check_equal "another purs is replaced" "0" "$?"
check_equal "fetching purs alone" "https://github.com/purescript/purescript/releases/download/v0.15.16/linux64.tar.gz" \
	"$(cat "$tmp/fetch.log")"
check_equal "by the pinned one" "0.15.16" "$("$home/.local/bin/purs")"

for platform in Linux-aarch64:linux-arm64:linux-arm64 Linux-arm64:linux-arm64:linux-arm64 \
	Darwin-x86_64:macos:darwin-x64 Darwin-arm64:macos-arm64:darwin-arm64; do
	IFS=: read -r machine purs esbuild <<<"$platform"
	out="$(run "$tmp/home-$machine" STUB_UNAME_S="${machine%%-*}" STUB_UNAME_M="${machine#*-}")"
	check_equal "$machine installs" "0" "$?"
	check_contains "$machine fetches purs' $purs asset" "/v0.15.16/$purs.tar.gz" "$(cat "$tmp/fetch.log")"
	check_contains "$machine fetches esbuild for $esbuild" "@esbuild/$esbuild/-/$esbuild-0.28.1.tgz" "$(cat "$tmp/fetch.log")"
done

out="$(run "$tmp/dir-home" PURS_INSTALL_DIR="$tmp/opt/bin")"
check_equal "PURS_INSTALL_DIR is honoured" "0" "$?"
check_exists "for purs" "$tmp/opt/bin/purs"
check_exists "and esbuild" "$tmp/opt/bin/esbuild"

out="$(run "$tmp/odd-home" STUB_UNAME_S=Linux STUB_UNAME_M=riscv64)"
check_equal "an unknown platform fails" "1" "$?"
check_contains "naming it" "no pinned purs build for Linux-riscv64." "$out"
check_equal "without fetching" "" "$(cat "$tmp/fetch.log")"

echo
echo "install-purescript.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
