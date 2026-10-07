#!/usr/bin/env bash
# Table test for install-gg-build-toolchains.sh. Run it directly:
# scripts/ci/install-gg-build-toolchains.test.sh
#
# A copy of the script runs in a throwaway repository whose csharp-version.sh
# pins an SDK, a wasi-sdk and a runtime pack, with a stand-in fetch.sh serving a
# stub dotnet-install.sh, a wasi-sdk tarball and a runtime-pack .nupkg built
# here, and the build prefix in a temporary directory. The stub SDK's `dotnet`
# installs the wasi-experimental workload's two build tasks when asked. The
# subject is the three trees it leaves under the prefix, and that each is left
# alone once it is there.
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
mkdir -p "$repo/scripts/ci" "$repo/packages/gg-sandbox-csharp" "$tmp/server"
cp "$CI_DIR/install-gg-build-toolchains.sh" "$CI_DIR/tcab-lib.sh" "$repo/scripts/ci/"
fake_fetch "$repo"
cat >"$repo/packages/gg-sandbox-csharp/csharp-version.sh" <<'EOF2'
GG_DOTNET_SDK_VERSION="10.0.302"
GG_DOTNET_RUNTIME_VERSION="10.0.10"
GG_DOTNET_CHANNEL="10.0"
GG_DOTNET_TFM="net10.0"
GG_DOTNET_MONO_WASI_PACK="Microsoft.NETCore.App.Runtime.Mono.wasi-wasm"
GG_WASI_SDK_VERSION="33.0"
GG_CSHARP_TARGET="wasm32-wasip2"
gg_dotnet_architecture() { echo "x64"; }
gg_wasi_sdk_platform() { echo "x86_64-linux"; }
gg_wasi_sdk_url() { echo "https://example.com/wasi-sdk-33/wasi-sdk-33.0-x86_64-linux.tar.gz"; }
GG_BUILD_PREFIX="${TCAB_GG_BUILD_PREFIX:-$HOME/.local/share/tcab/gg-build}"
EOF2

readonly PACKS="packs/Microsoft.NET.Runtime.WebAssembly.Wasi.Sdk/10.0.10/tasks/net10.0/WasmAppBuilder.dll packs/Microsoft.NET.Runtime.MonoTargets.Sdk/10.0.10/tasks/net10.0/MonoTargetsTasks.dll"
cat >"$tmp/server/dotnet-install.sh" <<STUB
#!/usr/bin/env bash
echo "dotnet-install.sh \$*" >>"\$STUB_LOG"
while [[ \$# -gt 0 ]]; do
	[[ "\$1" == --install-dir ]] && dir="\$2"
	shift
done
mkdir -p "\$dir"
cat >"\$dir/dotnet" <<'DOTNET'
#!/usr/bin/env bash
echo "dotnet \$* [DOTNET_ROOT=\$DOTNET_ROOT]" >>"\$STUB_LOG"
[[ "\$*" == "workload install wasi-experimental --skip-manifest-update" ]] || exit 1
[[ -n "\${STUB_NO_TASKS:-}" ]] && exit 0
for task in $PACKS; do
	mkdir -p "\$(dirname "\$DOTNET_ROOT/\$task")"
	printf 'dll' >"\$DOTNET_ROOT/\$task"
done
DOTNET
chmod +x "\$dir/dotnet"
STUB

sdk="$tmp/build/wasi-sdk-33.0-x86_64-linux"
mkdir -p "$sdk/bin" "$sdk/share/wasi-sysroot/lib/wasm32-wasip2/noeh" "$sdk/share/wasi-sysroot/lib/wasm32-wasip1"
printf '#!/bin/sh\n' >"$sdk/bin/clang"
chmod +x "$sdk/bin/clang"
printf 'x' >"$sdk/share/wasi-sysroot/lib/wasm32-wasip2/noeh/libc.a"
printf 'x' >"$sdk/share/wasi-sysroot/lib/wasm32-wasip1/libc.a"
tar -C "$tmp/build" -czf "$tmp/server/wasi-sdk-33.0-x86_64-linux.tar.gz" wasi-sdk-33.0-x86_64-linux

python3 - "$tmp/server/microsoft.netcore.app.runtime.mono.wasi-wasm.10.0.10.nupkg" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w") as z:
    z.writestr("runtimes/wasi-wasm/native/libmonosgen-2.0.a", "archive")
    z.writestr("Microsoft.NETCore.App.Runtime.Mono.wasi-wasm.nuspec", "<package/>")
PY

run() { # prefix [env...]
	local prefix="$1"
	shift
	: >"$tmp/calls.log"
	(cd "$tmp" && env HOME="$tmp/home" TCAB_GG_BUILD_PREFIX="$prefix" STUB_LOG="$tmp/calls.log" STUB_SERVER="$tmp/server" \
		STUB_DOWNLOADS="$tmp/downloads" "$@" "$repo/scripts/ci/install-gg-build-toolchains.sh" 2>&1)
}

prefix="$tmp/build-prefix"
out="$(run "$prefix")"
check_equal "a fresh install succeeds" "0" "$?"
sdk_dir="$prefix/dotnet-sdk-10.0.302"
check_contains "installs the whole pinned SDK into its own directory" \
	"dotnet-install.sh --channel 10.0 --version 10.0.302 --architecture x64 --install-dir $sdk_dir --no-path" \
	"$(cat "$tmp/calls.log")"
check_contains "then the workload, through that SDK" \
	"dotnet workload install wasi-experimental --skip-manifest-update [DOTNET_ROOT=$sdk_dir]" "$(cat "$tmp/calls.log")"
for task in $PACKS; do
	check_exists "leaves the workload's ${task##*/}" "$sdk_dir/$task"
done
check_exists "unpacks the whole wasi-sdk" "$prefix/wasi-sdk-33.0-full/bin/clang"
check_exists "every sysroot target of it" "$prefix/wasi-sdk-33.0-full/share/wasi-sysroot/lib/wasm32-wasip1/libc.a"
check_absent "and deletes its staged archive" "$tmp/downloads/wasi-sdk-33.0-x86_64-linux.tar.gz"
pack="$prefix/Microsoft.NETCore.App.Runtime.Mono.wasi-wasm.10.0.10"
check_contains "fetches the runtime pack from nuget by its lower-cased id" \
	"https://api.nuget.org/v3-flatcontainer/microsoft.netcore.app.runtime.mono.wasi-wasm/10.0.10/microsoft.netcore.app.runtime.mono.wasi-wasm.10.0.10.nupkg" \
	"$(cat "$tmp/calls.log")"
check_exists "unpacks it" "$pack/runtimes/wasi-wasm/native/libmonosgen-2.0.a"
check_absent "and deletes the .nupkg" "$pack/mono-wasi.nupkg"

out="$(run "$prefix")"
check_equal "a second run succeeds" "0" "$?"
check_contains "leaving the SDK alone" ".NET SDK 10.0.302 already installed at $sdk_dir" "$out"
check_contains "its workload" "the wasi-experimental workload's build tasks are already installed" "$out"
check_contains "the wasi-sdk" "wasi-sdk 33.0 already installed at $prefix/wasi-sdk-33.0-full" "$out"
check_contains "and the runtime pack" "the runtime pack is already unpacked at $pack" "$out"
check_equal "without fetching or installing anything" "" "$(cat "$tmp/calls.log")"

rm -rf "$sdk_dir/packs"
out="$(run "$prefix")"
check_equal "a missing workload is installed again" "0" "$?"
check_equal "and nothing else" \
	"dotnet workload install wasi-experimental --skip-manifest-update [DOTNET_ROOT=$sdk_dir]" "$(cat "$tmp/calls.log")"

rm -rf "$sdk_dir/packs"
out="$(run "$prefix" STUB_NO_TASKS=1)"
check_equal "a workload install that leaves no build tasks fails" "1" "$?"

out="$(run "$tmp/home-prefix" env -u TCAB_GG_BUILD_PREFIX)"
check_equal "without TCAB_GG_BUILD_PREFIX it succeeds" "0" "$?"
check_exists "under HOME" "$tmp/home/.local/share/tcab/gg-build/dotnet-sdk-10.0.302/dotnet"

echo
echo "install-gg-build-toolchains.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
