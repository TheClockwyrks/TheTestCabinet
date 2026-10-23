#!/usr/bin/env bash
# Table test for prune-target.sh. Run it directly: ./prune-target.test.sh
#
# A stub `cargo` first on PATH answers `cargo metadata` with a workspace of
# two packages, one of them with a hyphen in its name and a binary, and stubs
# of `df` and `du` record when they ran. Each case builds a build output of
# the shape cargo leaves and prunes it. The subject is that the documentation,
# the gate artifacts, the executables, the incremental state and the
# workspace's own compiled crates go, that the compiled dependencies stay,
# among them one whose name begins with a workspace crate's, that `tmp` is
# left alone, that the disk and the directory are reported before and after,
# and that a missing directory or an unreadable workspace is handled.
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

check_gone() { # label path
	if [ -e "$2" ]; then
		bad "$1" "expected removed: $2"
	else
		ok "$1"
	fi
}

check_kept() { # label path
	if [ -e "$2" ]; then
		ok "$1"
	else
		bad "$1" "expected kept: $2"
	fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

stubs="$tmp/bin"
mkdir -p "$stubs"
cat >"$stubs/cargo" <<'STUB'
#!/usr/bin/env bash
printf 'cargo: %s\n' "$*" >>"$STUB_LOG"
[ "${METADATA_STATUS:-0}" -eq 0 ] || exit "$METADATA_STATUS"
cat <<'JSON'
{"packages": [
  {"name": "test-cabinet-demo", "targets": [{"name": "test_cabinet_demo"}, {"name": "test-cabinet-demo-cli"}]},
  {"name": "widget", "targets": [{"name": "widget"}]}
]}
JSON
STUB
cat >"$stubs/df" <<'STUB'
#!/usr/bin/env bash
printf 'df: %s\n' "$*" >>"$STUB_LOG"
echo "Filesystem Size Used Avail Use% Mounted on"
STUB
cat >"$stubs/du" <<'STUB'
#!/usr/bin/env bash
printf 'du: %s\n' "$*" >>"$STUB_LOG"
echo "1G $2"
STUB
chmod +x "$stubs/cargo" "$stubs/df" "$stubs/du"
export STUB_LOG="$tmp/stub.log"

run() { # env-assignment... -- arguments...
	local assignments=()
	while [ $# -gt 0 ] && [ "$1" != "--" ]; do
		assignments+=("$1")
		shift
	done
	[ $# -gt 0 ] && shift
	(
		cd "$tmp/work" || exit 1
		env PATH="$stubs:$PATH" "${assignments[@]}" "$CI_DIR/prune-target.sh" "$@" 2>&1
	)
}

file() { # path [mode]
	mkdir -p "$(dirname "$1")"
	: >"$1"
	[ -z "${2:-}" ] || chmod "$2" "$1"
}

# A build output of the shape cargo leaves: a debug profile and one under a
# target triple, the documentation, the gate artifacts and the suite's tmp.
build() { # target directory
	local t="$1" p
	rm -rf "$t"
	file "$t/.rustc_info.json"
	file "$t/doc/test_cabinet_demo/index.html"
	file "$t/gate-artifacts/rust-test/junit.xml"
	file "$t/tmp/ruby-build/.fingerprint/kept"
	file "$t/tmp/ruby-build/bin/ruby" 755
	file "$t/x86_64-unknown-linux-gnu/doc/widget/index.html"
	for p in "$t/debug" "$t/x86_64-unknown-linux-gnu/release"; do
		file "$p/.cargo-lock"
		file "$p/test-cabinet-demo-cli" 755
		file "$p/test-cabinet-demo-cli.d"
		file "$p/libtest_cabinet_demo.rlib"
		file "$p/examples/tour-0123456789abcdef" 755
		file "$p/incremental/test_cabinet_demo-0123456789abcdef/s-1/dep-graph.bin"
		file "$p/.fingerprint/test-cabinet-demo-0123456789abcdef/lib-test_cabinet_demo"
		file "$p/.fingerprint/widget-0123456789abcdef/lib-widget"
		file "$p/.fingerprint/widget-extra-0123456789abcdef/lib-widget_extra"
		file "$p/.fingerprint/serde-0123456789abcdef/lib-serde"
		file "$p/build/test-cabinet-demo-0123456789abcdef/build-script-build" 755
		file "$p/build/serde-0123456789abcdef/build-script-build" 755
		file "$p/build/widget-extra-0123456789abcdef/out/generated.rs"
		file "$p/deps/test_cabinet_demo-0123456789abcdef" 755
		file "$p/deps/test_cabinet_demo-0123456789abcdef.d"
		file "$p/deps/libtest_cabinet_demo-0123456789abcdef.rlib"
		file "$p/deps/libtest_cabinet_demo-0123456789abcdef.rmeta"
		file "$p/deps/test_cabinet_demo_cli-0123456789abcdef" 755
		file "$p/deps/widget-fedcba9876543210" 755
		file "$p/deps/libwidget-fedcba9876543210.rmeta"
		file "$p/deps/libwidget_extra-0123456789abcdef.rlib"
		file "$p/deps/widget_extra-0123456789abcdef.d"
		file "$p/deps/libserde-0123456789abcdef.rlib"
		file "$p/deps/libserde-0123456789abcdef.rmeta"
		file "$p/deps/serde-0123456789abcdef.d"
		file "$p/deps/libserde_derive-0123456789abcdef.so" 755
		file "$p/deps/stray_test-0123456789abcdef" 755
	done
}

mkdir -p "$tmp/work"

echo "--- the build output is pruned to the compiled dependencies ---"

build "$tmp/work/target"
: >"$STUB_LOG"
out="$(run --)"
status=$?
check_equal "exits 0" 0 "$status"
t="$tmp/work/target"
check_gone "removes the documentation" "$t/doc"
check_gone "removes the documentation beside a triple's profiles" "$t/x86_64-unknown-linux-gnu/doc"
check_gone "removes the gate artifacts" "$t/gate-artifacts"
check_kept "keeps the suite's tmp, a toolchain build's among it" "$t/tmp/ruby-build/bin/ruby"
check_kept "keeps rustc's own record" "$t/.rustc_info.json"
for p in "$t/debug" "$t/x86_64-unknown-linux-gnu/release"; do
	name="${p#"$t/"}"
	check_kept "$name: keeps cargo's lock" "$p/.cargo-lock"
	check_gone "$name: removes the binary at the profile's top" "$p/test-cabinet-demo-cli"
	check_gone "$name: removes its dependency file" "$p/test-cabinet-demo-cli.d"
	check_gone "$name: removes the library lifted to the top" "$p/libtest_cabinet_demo.rlib"
	check_gone "$name: removes the examples" "$p/examples"
	check_gone "$name: removes the incremental state" "$p/incremental"
	check_gone "$name: removes a workspace package's fingerprint" "$p/.fingerprint/test-cabinet-demo-0123456789abcdef"
	check_gone "$name: removes the other package's fingerprint" "$p/.fingerprint/widget-0123456789abcdef"
	check_kept "$name: keeps a dependency's fingerprint whose name extends a package's" "$p/.fingerprint/widget-extra-0123456789abcdef"
	check_kept "$name: keeps a dependency's fingerprint" "$p/.fingerprint/serde-0123456789abcdef"
	check_gone "$name: removes a workspace package's build script" "$p/build/test-cabinet-demo-0123456789abcdef"
	check_kept "$name: keeps a dependency's build script" "$p/build/serde-0123456789abcdef/build-script-build"
	check_kept "$name: keeps a dependency's build output whose name extends a package's" "$p/build/widget-extra-0123456789abcdef/out/generated.rs"
	check_gone "$name: removes a workspace crate's test executable" "$p/deps/test_cabinet_demo-0123456789abcdef"
	check_gone "$name: removes its dependency file" "$p/deps/test_cabinet_demo-0123456789abcdef.d"
	check_gone "$name: removes its rlib" "$p/deps/libtest_cabinet_demo-0123456789abcdef.rlib"
	check_gone "$name: removes its rmeta" "$p/deps/libtest_cabinet_demo-0123456789abcdef.rmeta"
	check_gone "$name: removes a binary target named with a hyphen" "$p/deps/test_cabinet_demo_cli-0123456789abcdef"
	check_gone "$name: removes the other crate's test executable" "$p/deps/widget-fedcba9876543210"
	check_gone "$name: removes the other crate's rmeta" "$p/deps/libwidget-fedcba9876543210.rmeta"
	check_kept "$name: keeps a dependency whose name extends a workspace crate's" "$p/deps/libwidget_extra-0123456789abcdef.rlib"
	check_kept "$name: keeps that dependency's dependency file" "$p/deps/widget_extra-0123456789abcdef.d"
	check_kept "$name: keeps a dependency's rlib" "$p/deps/libserde-0123456789abcdef.rlib"
	check_kept "$name: keeps a dependency's rmeta" "$p/deps/libserde-0123456789abcdef.rmeta"
	check_kept "$name: keeps a dependency's dependency file" "$p/deps/serde-0123456789abcdef.d"
	check_kept "$name: keeps a compiled proc macro" "$p/deps/libserde_derive-0123456789abcdef.so"
	check_gone "$name: removes any other executable under deps" "$p/deps/stray_test-0123456789abcdef"
done
log="$(cat "$STUB_LOG")"
check_contains "names the workspace's crates without reaching the network" \
	"cargo: metadata --no-deps --format-version 1 --offline" "$log"
check_equal "reports the disk and the directory before and after" \
	"df: -h /|du: -sh target|df: -h /|du: -sh target" "$(grep -v '^cargo' "$STUB_LOG" | paste -sd '|')"
check_contains "says which report comes before" "prune-target: before" "$out"
check_contains "says which report comes after" "prune-target: after" "$out"

echo "--- a directory named on the command line is the one pruned ---"

build "$tmp/work/elsewhere"
: >"$STUB_LOG"
out="$(run -- elsewhere/)"
status=$?
check_equal "exits 0" 0 "$status"
check_gone "removes its documentation" "$tmp/work/elsewhere/doc"
check_kept "keeps its compiled dependencies" "$tmp/work/elsewhere/debug/deps/libserde-0123456789abcdef.rlib"
check_contains "reports its size" "du: -sh elsewhere" "$(cat "$STUB_LOG")"

echo "--- a pruned directory prunes again to the same ---"

out="$(run -- elsewhere)"
status=$?
check_equal "exits 0 on a second run" 0 "$status"
check_kept "keeps the compiled dependencies" "$tmp/work/elsewhere/debug/deps/libserde-0123456789abcdef.rlib"

echo "--- no build output: nothing to prune ---"

rm -rf "$tmp/work/target"
: >"$STUB_LOG"
out="$(run --)"
status=$?
check_equal "exits 0" 0 "$status"
check_contains "says there is nothing to prune" "no build output at target, so nothing to prune" "$out"
check_equal "reports the disk and reads no workspace" "df: -h /" "$(cat "$STUB_LOG")"

echo "--- a workspace cargo cannot read fails the step and prunes nothing ---"

build "$tmp/work/target"
: >"$STUB_LOG"
out="$(run METADATA_STATUS=101 --)"
status=$?
check_equal "exits 1" 1 "$status"
check_contains "says why" "cargo metadata could not name the workspace's crates" "$out"
check_kept "leaves the build output as it was" "$tmp/work/target/debug/deps/test_cabinet_demo-0123456789abcdef"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
