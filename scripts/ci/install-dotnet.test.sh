#!/usr/bin/env bash
# Table test for install-dotnet.sh. Run it directly:
# scripts/ci/install-dotnet.test.sh
#
# A copy of the script runs in a throwaway repository whose csharp-version.sh
# pins an SDK and runtime, with a stand-in fetch.sh serving a stub
# dotnet-install.sh, a Debian package index and an ICU package built here, `ar`
# stubbed to unpack that package, and HOME in a temporary directory. The stub
# installer lays out a small SDK whose `dotnet` records the compile it is asked
# for and writes its -out file. The subject is the pruned layout, the vendored
# ICU, the smoke compile, and each way an SDK or package can fall short.
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
# A .deb here is a file naming the data tarball it carries, and `ar` is a stub
# whose `x` puts that tarball in the working directory as data.tar.gz.
stub_ar() { # bin-dir
	cat >"$1/ar" <<'STUB'
#!/usr/bin/env bash
[[ "$1" == x ]] || exit 1
cp "$(cat "$2")" data.tar.gz
STUB
	chmod +x "$1/ar"
}

repo="$tmp/repo"
mkdir -p "$repo/scripts/ci" "$repo/packages/gg-sandbox-csharp" "$tmp/bin" "$tmp/server"
cp "$CI_DIR/install-dotnet.sh" "$repo/scripts/ci/"
fake_fetch "$repo"
stub_ar "$tmp/bin"
cat >"$repo/packages/gg-sandbox-csharp/csharp-version.sh" <<'EOF2'
GG_DOTNET_SDK_VERSION="10.0.302"
GG_DOTNET_RUNTIME_VERSION="10.0.10"
GG_DOTNET_CHANNEL="10.0"
GG_DOTNET_TFM="net10.0"
GG_DOTNET_LANG_VERSION="14.0"
gg_dotnet_architecture() { echo "x64"; }
GG_DOTNET_DEFAULT_HOME="$HOME/.local/share/tcab/gg-dotnet"
EOF2
cat >"$tmp/bin/uname" <<'STUB'
#!/usr/bin/env bash
echo "${STUB_UNAME_M:-x86_64}"
STUB
chmod +x "$tmp/bin/uname"

# dotnet-install.sh: an SDK carrying the runtime and reference pack STUB_RUNTIME and STUB_REF name.
cat >"$tmp/server/dotnet-install.sh" <<'STUB'
#!/usr/bin/env bash
echo "dotnet-install.sh $*" >>"$STUB_LOG"
while [[ $# -gt 0 ]]; do
	[[ "$1" == --install-dir ]] && dir="$2"
	shift
done
mkdir -p "$dir/host/fxr/10.0.10" "$dir/shared/Microsoft.NETCore.App/${STUB_RUNTIME:-10.0.10}" \
	"$dir/sdk/10.0.302/Roslyn/bincore/de" "$dir/sdk/10.0.302/Roslyn/bincore/Microsoft.CodeAnalysis.resources" \
	"$dir/sdk/10.0.302/Roslyn/de" "$dir/packs/Microsoft.NETCore.App.Ref/${STUB_REF:-10.0.10}/ref/net10.0"
cat >"$dir/dotnet" <<'DOTNET'
#!/usr/bin/env bash
echo "dotnet $* [LD_LIBRARY_PATH=$LD_LIBRARY_PATH]" >>"$STUB_LOG"
for arg in "$@"; do
	[[ "$arg" == -out:* ]] && printf 'dll' >"${arg#-out:}"
done
exit 0
DOTNET
chmod +x "$dir/dotnet"
for file in host/fxr/10.0.10/libhostfxr.so shared/Microsoft.NETCore.App/${STUB_RUNTIME:-10.0.10}/libcoreclr.so \
	sdk/10.0.302/Roslyn/bincore/csc.dll sdk/10.0.302/Roslyn/bincore/Microsoft.CodeAnalysis.CSharp.dll \
	sdk/10.0.302/Roslyn/bincore/vbc.dll sdk/10.0.302/Roslyn/bincore/vbc.deps.json \
	sdk/10.0.302/Roslyn/bincore/vbc.runtimeconfig.json sdk/10.0.302/Roslyn/bincore/Microsoft.CodeAnalysis.VisualBasic.dll \
	sdk/10.0.302/Roslyn/bincore/VBCSCompiler.dll sdk/10.0.302/Roslyn/bincore/VBCSCompiler \
	sdk/10.0.302/Roslyn/bincore/de/Microsoft.CodeAnalysis.resources.dll \
	sdk/10.0.302/Roslyn/bincore/Microsoft.CodeAnalysis.resources/x.dll sdk/10.0.302/Roslyn/de/x.dll \
	packs/Microsoft.NETCore.App.Ref/${STUB_REF:-10.0.10}/ref/net10.0/System.Runtime.dll \
	packs/Microsoft.NETCore.App.Ref/${STUB_REF:-10.0.10}/ref/net10.0/System.Linq.dll \
	packs/Microsoft.NETCore.App.Ref/${STUB_REF:-10.0.10}/ref/net10.0/System.Runtime.xml; do
	[[ -e "$dir/$file" ]] || printf 'x' >"$dir/$file"
done
STUB

# The ICU package: all three libraries, or (for one case) two of them.
icu_tar() { # name libraries...
	local name="$1" lib
	shift
	mkdir -p "$tmp/build/$name/usr/lib/x86_64-linux-gnu"
	for lib in "$@"; do
		printf 'icu' >"$tmp/build/$name/usr/lib/x86_64-linux-gnu/$lib"
	done
	tar -C "$tmp/build/$name" -czf "$tmp/build/$name.tar.gz" usr
	printf '%s' "$tmp/build/$name.tar.gz"
}
icu_tar full libicuuc.so.72.1 libicui18n.so.72.1 libicudata.so.72.1 >"$tmp/server/libicu72_72.1-3_amd64.deb"
icu_tar arm libicuuc.so.72.1 libicui18n.so.72.1 libicudata.so.72.1 >"$tmp/server/libicu72_72.1-3_arm64.deb"
icu_tar partial libicuuc.so.72.1 libicudata.so.72.1 >"$tmp/partial.deb"
packages() { # arch
	printf 'Package: libicu-dev\nFilename: pool/main/i/icu/libicu-dev_72.1-3_%s.deb\n\n' "$1"
	printf 'Package: libicu72\nVersion: 72.1-3\nFilename: pool/main/i/icu/libicu72_72.1-3_%s.deb\n\n' "$1"
}
packages amd64 | gzip >"$tmp/server/Packages.gz"

run() { # home [env...]
	local home="$1"
	shift
	: >"$tmp/calls.log"
	mkdir -p "$home"
	(cd "$tmp" && env -u DOTNET_INSTALL_DIR HOME="$home" STUB_LOG="$tmp/calls.log" STUB_SERVER="$tmp/server" \
		PATH="$tmp/bin:$PATH" "$@" "$repo/scripts/ci/install-dotnet.sh" 2>&1)
}

home="$tmp/home"
prefix="$home/.local/share/tcab/gg-dotnet"
out="$(run "$home")"
check_equal "a fresh install succeeds" "0" "$?"
check_contains "installs the pinned SDK for the architecture" \
	"--channel 10.0 --version 10.0.302 --architecture x64 --install-dir" "$(cat "$tmp/calls.log")"
check_contains "and reads the ICU package out of bookworm's index" \
	"https://deb.debian.org/debian/pool/main/i/icu/libicu72_72.1-3_amd64.deb" "$(cat "$tmp/calls.log")"
for path in dotnet/dotnet dotnet/host/fxr/10.0.10/libhostfxr.so dotnet/shared/Microsoft.NETCore.App/10.0.10/libcoreclr.so \
	roslyn/bincore/csc.dll roslyn/bincore/Microsoft.CodeAnalysis.CSharp.dll ref/net10.0/System.Runtime.dll \
	lib/libicuuc.so.72.1 lib/libicui18n.so.72.1 lib/libicudata.so.72.1; do
	check_exists "keeps $path" "$prefix/$path"
done
for path in roslyn/bincore/vbc.dll roslyn/bincore/vbc.deps.json roslyn/bincore/vbc.runtimeconfig.json \
	roslyn/bincore/Microsoft.CodeAnalysis.VisualBasic.dll roslyn/bincore/VBCSCompiler.dll roslyn/bincore/VBCSCompiler \
	roslyn/bincore/de roslyn/de roslyn/bincore/Microsoft.CodeAnalysis.resources ref/net10.0/System.Runtime.xml sdk packs; do
	check_absent "prunes $path" "$prefix/$path"
done
compile="$(grep '^dotnet exec' "$tmp/calls.log")"
check_contains "smoke-compiles with the pruned csc" "exec $prefix/roslyn/bincore/csc.dll" "$compile"
check_contains "at the pinned language version" "-langversion:14.0" "$compile"
check_contains "against every reference assembly" "-r:$prefix/ref/net10.0/System.Linq.dll" "$compile"
check_contains "with the vendored ICU on the library path" "[LD_LIBRARY_PATH=$prefix/lib]" "$compile"
check_equal "stamps the version" "10.0.302" "$(cat "$prefix/dotnet-version")"

out="$(run "$home")"
check_equal "a second run succeeds" "0" "$?"
check_contains "and leaves the install alone" ".NET 10.0.302 already installed at $prefix" "$out"
check_equal "without fetching" "" "$(cat "$tmp/calls.log")"

rm "$prefix/lib/libicudata.so.72.1"
out="$(run "$home")"
check_equal "an install missing its ICU is redone" "0" "$?"
check_exists "and the ICU is back" "$prefix/lib/libicudata.so.72.1"

packages arm64 | gzip >"$tmp/server/Packages.gz"
out="$(run "$tmp/arm-home" STUB_UNAME_M=aarch64)"
check_equal "an arm64 install succeeds" "0" "$?"
check_contains "with arm64's index" "binary-arm64/Packages.gz" "$(cat "$tmp/calls.log")"
check_contains "and arm64's ICU" "libicu72_72.1-3_arm64.deb" "$(cat "$tmp/calls.log")"
packages amd64 | gzip >"$tmp/server/Packages.gz"

out="$(run "$tmp/dir-home" DOTNET_INSTALL_DIR="$tmp/opt/dotnet")"
check_equal "DOTNET_INSTALL_DIR is honoured" "0" "$?"
check_exists "as the prefix" "$tmp/opt/dotnet/roslyn/bincore/csc.dll"

out="$(run "$tmp/runtime-home" STUB_RUNTIME=10.0.9)"
check_equal "an SDK carrying another runtime fails" "1" "$?"
check_contains "naming both" "carries 10.0.9, not the pinned runtime 10.0.10." "$out"
check_absent "and installs nothing" "$tmp/runtime-home/.local/share/tcab/gg-dotnet"

out="$(run "$tmp/ref-home" STUB_REF=10.0.9)"
check_equal "an SDK without the reference pack fails" "1" "$?"
check_contains "naming it" "carries no net10.0 reference pack at 10.0.10." "$out"

cp "$tmp/partial.deb" "$tmp/server/libicu72_72.1-3_amd64.deb"
out="$(run "$tmp/icu-home")"
check_equal "an ICU package short of a library fails" "1" "$?"
check_contains "saying so" "did not carry all three of libicuuc, libicui18n and libicudata." "$out"
check_absent "and stamps nothing" "$tmp/icu-home/.local/share/tcab/gg-dotnet/dotnet-version"

printf 'Package: libicu-dev\nFilename: pool/x.deb\n' | gzip >"$tmp/server/Packages.gz"
out="$(run "$tmp/noicu-home")"
check_equal "an index without libicu72 fails" "1" "$?"
check_contains "naming it" "Debian bookworm has no libicu72 for amd64." "$out"

out="$(run "$tmp/odd-home" STUB_UNAME_M=riscv64)"
check_equal "a machine Debian has no packages for fails" "1" "$?"
check_contains "naming it" "no Debian bookworm architecture for riscv64." "$out"

echo
echo "install-dotnet.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
