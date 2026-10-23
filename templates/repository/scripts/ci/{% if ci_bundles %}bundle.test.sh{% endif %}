#!/usr/bin/env bash
# Table test for bundle.sh. Run it directly: ./bundle.test.sh
#
# Each case copies the script into a scratch workspace holding the crate the
# script names, its tauri.conf.json and two flavors, with a stub Tauri CLI
# that writes, for the command it is given, the files a real build leaves, and
# a stub rustup that records its calls. The subject is that every flavor of
# every target is built with its overlay and lands under a directory of its
# own, that a directory bundle is archived, that the pinned toolchain is
# installed first, and that a missing argument, CLI, flavor or output fails.
set -uo pipefail

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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

check_file() { # label path
	if [ -f "$2" ]; then
		ok "$1"
	else
		bad "$1" "expected a file: $2"
	fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

crate="$(sed -n 's/^readonly CRATE="\(.*\)"$/\1/p' "$CI_DIR/bundle.sh")"
[ -n "$crate" ] || {
	echo "bundle.sh names no crate" >&2
	exit 1
}

# A workspace holding the script, the toolchain pin, the crate's
# configuration and two flavors, and the stubs.
workspace() {
	rm -rf "$tmp/ws" "$tmp/out" "$tmp/log"
	mkdir -p "$tmp/ws/scripts/ci" "$tmp/ws/$crate"
	cp "$CI_DIR/bundle.sh" "$tmp/ws/scripts/ci/bundle.sh"
	printf '[toolchain]\nchannel = "1.97.1"\n' >"$tmp/ws/rust-toolchain.toml"
	echo '{}' >"$tmp/ws/$crate/tauri.conf.json"
	echo '{}' >"$tmp/ws/$crate/tauri.prod.conf.json"
	echo '{}' >"$tmp/ws/$crate/tauri.staging.conf.json"
	: >"$tmp/log"
}

# The stub CLI runs in the crate, as the real one does, and writes what the
# build for its arguments leaves, named for the overlay it was handed so a
# flavor's bundle is told from another's.
mkdir -p "$tmp/bin"
cat >"$tmp/bin/tauri" <<'STUB'
#!/usr/bin/env bash
set -eu
echo "tauri $* (in ${PWD##*/})" >>"$LOG"
root="$(cd ../.. && pwd)"
config=""
prev=""
for arg in "$@"; do
	[ "$prev" = --config ] && config="$arg"
	prev="$arg"
done
flavor="${config#tauri.}"
flavor="${flavor%.conf.json}"
[ -z "${STUB_EMPTY:-}" ] || exit 0
case "$*" in
android*)
	mkdir -p gen/android/app/build/outputs/apk/universal/release
	echo "$flavor" >"gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk"
	;;
*universal-apple-darwin*)
	mkdir -p "$root/target/universal-apple-darwin/release/bundle/macos/Shell.app/Contents"
	echo "$flavor" >"$root/target/universal-apple-darwin/release/bundle/macos/Shell.app/Contents/flavor"
	;;
*nsis*)
	mkdir -p "$root/target/release/bundle/nsis"
	echo "$flavor" >"$root/target/release/bundle/nsis/Shell_0.1.0_x64-setup.exe"
	;;
*appimage*)
	mkdir -p "$root/target/release/bundle/appimage" "$root/target/release/bundle/deb"
	echo "$flavor" >"$root/target/release/bundle/appimage/Shell_0.1.0_amd64.AppImage"
	echo "$flavor" >"$root/target/release/bundle/deb/Shell_0.1.0_amd64.deb"
	echo "APPIMAGE_EXTRACT_AND_RUN=${APPIMAGE_EXTRACT_AND_RUN:-} NO_STRIP=${NO_STRIP:-}" >>"$LOG"
	;;
esac
STUB
cat >"$tmp/bin/rustup" <<'STUB'
#!/usr/bin/env bash
echo "rustup $*" >>"$LOG"
STUB
chmod +x "$tmp/bin/tauri" "$tmp/bin/rustup"

run() {
	out="$(cd "$tmp/ws" && LOG="$tmp/log" TAURI_CLI="$tmp/bin/tauri" RUSTUP="$tmp/bin/rustup" \
		bash scripts/ci/bundle.sh "$@" 2>"$tmp/err")"
	status=$?
	err="$(cat "$tmp/err")"
	log="$(cat "$tmp/log")"
}

echo "--- every target builds every flavor ---"

workspace
run linux "$tmp/out"
check_equal "a linux build exits 0" 0 "$status"
check_contains "it installs the pinned toolchain first" "rustup toolchain install 1.97.1 --profile minimal" "$(head -1 <<<"$log")"
check_contains "it builds the prod flavor with its overlay, in the crate" \
	"tauri build --bundles appimage,deb --config tauri.prod.conf.json (in ${crate##*/})" "$log"
check_contains "and the staging one with its own" "--config tauri.staging.conf.json" "$log"
check_contains "it runs the AppImage tools without FUSE and without their strip" \
	"APPIMAGE_EXTRACT_AND_RUN=1 NO_STRIP=true" "$log"
for flavor in prod staging; do
	check_file "the $flavor AppImage is collected" "$tmp/out/$flavor/Shell_0.1.0_amd64.AppImage"
	check_file "the $flavor .deb is collected" "$tmp/out/$flavor/Shell_0.1.0_amd64.deb"
	check_equal "the $flavor AppImage is the $flavor build's" "$flavor" "$(cat "$tmp/out/$flavor/Shell_0.1.0_amd64.AppImage")"
done

workspace
run windows "$tmp/out"
check_equal "a windows build exits 0" 0 "$status"
check_contains "it builds the NSIS installer" "tauri build --bundles nsis --config tauri.prod.conf.json" "$log"
check_equal "each flavor's installer is its own" "staging" "$(cat "$tmp/out/staging/Shell_0.1.0_x64-setup.exe")"

workspace
run macos "$tmp/out"
check_equal "a macos build exits 0" 0 "$status"
check_contains "it adds both Apple targets" \
	"rustup target add --toolchain 1.97.1 aarch64-apple-darwin x86_64-apple-darwin" "$log"
check_contains "it builds the universal app" \
	"tauri build --target universal-apple-darwin --bundles app --config tauri.staging.conf.json" "$log"
check_file "the app bundle is archived" "$tmp/out/prod/Shell.app.tar.gz"
check_equal "the archive holds the app" "prod" "$(tar -xzOf "$tmp/out/prod/Shell.app.tar.gz" Shell.app/Contents/flavor)"

workspace
run android "$tmp/out"
check_equal "an android build exits 0" 0 "$status"
check_contains "it builds the APK" "tauri android build --apk --config tauri.prod.conf.json" "$log"
check_equal "each flavor's APK is its own" "staging" "$(cat "$tmp/out/staging/app-universal-release.apk")"
check_contains "it lists what it built" "$tmp/out/prod/app-universal-release.apk" "$out"

echo "--- what it refuses ---"

workspace
run linux
check_equal "no directory is a usage error" 1 "$status"
check_contains "which says how to call it" "usage: scripts/ci/bundle.sh" "$err"

workspace
run ios "$tmp/out"
check_equal "an unknown target fails" 1 "$status"
check_contains "naming it" "unknown target 'ios'" "$err"

workspace
rm "$tmp/ws/$crate/tauri.prod.conf.json" "$tmp/ws/$crate/tauri.staging.conf.json"
run linux "$tmp/out"
check_equal "a crate with no flavor fails" 1 "$status"
check_contains "saying what a flavor is" "tauri.<flavor>.conf.json" "$err"
check_equal "before building anything" "" "$log"

workspace
out="$(cd "$tmp/ws" && LOG="$tmp/log" TAURI_CLI="$tmp/ws/missing" RUSTUP="$tmp/bin/rustup" \
	bash scripts/ci/bundle.sh linux "$tmp/out" 2>&1)"
check_contains "a missing CLI fails, asking for the install" "run npm ci first" "$out"

workspace
STUB_EMPTY=1 run windows "$tmp/out"
check_equal "a build that leaves nothing fails" 1 "$status"
check_contains "naming where it looked" "left nothing under target/release/bundle" "$err"

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
