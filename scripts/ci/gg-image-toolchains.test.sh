#!/usr/bin/env bash
# Table test for gg-image-toolchains.sh. Run it directly:
# scripts/ci/gg-image-toolchains.test.sh
#
# A copy of the script runs in a throwaway repository holding this repository's own version files,
# with HOME in a temporary directory that stands in for the devcontainer's: small fake trees at
# the paths the template's language images put theirs, named by the pins those version files hold.
# `ldconfig`, `ruby`, `uvx`, `npm` and `curl` are stubbed, and so are the images' `purs`, `spago`,
# `java` and `wit-bindgen`. The subject is the tree of links and stamps it builds at each default
# home, that the installers and resolvers run after it against that tree say each arm is already
# installed and fetch nothing beyond the TeaVM jars the jvm image's cache lacks, that an image
# holding another version than the pin stops it with the pin file named, and that the image tags
# the devcontainer's compose file names are the versions this repository's pins hold.
#
# The pins are read in a subshell, so that sourcing the version files leaves this shell's own
# variables alone, and arrive through `eval`, which shellcheck cannot follow.
# shellcheck disable=SC2030,SC2031,SC2153
set -uo pipefail

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$CI_DIR/../.." && pwd)"
readonly CI_DIR REPO_DIR
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

check_link() { # label path target
	if [ -L "$2" ] && [ "$(readlink "$2")" = "$3" ]; then
		ok "$1"
	else
		bad "$1" "expected $2 to link to $3" "got: $(readlink "$2" 2>/dev/null || echo '<not a link>')"
	fi
}

check_dir() { # label path
	if [ -d "$2" ] && [ ! -L "$2" ]; then
		ok "$1"
	else
		bad "$1" "expected $2 to be a real directory"
	fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# The repository: the script and the installers it serves, with this repository's own pins.
repo="$tmp/repo"
mkdir -p "$repo/scripts/ci"
for script in gg-image-toolchains.sh tcab-lib.sh install-swift.sh install-wasi-sdk.sh install-dotnet.sh \
	install-java.sh install-kotlin.sh install-purescript.sh install-gg-build-toolchains.sh \
	install-wit-bindgen.sh; do
	cp "$CI_DIR/$script" "$repo/scripts/ci/"
done
for file in packages/gg-sandbox-swift/swift-version.sh packages/gg-sandbox-cpp/cpp-version.sh \
	packages/gg-sandbox-csharp/csharp-version.sh packages/gg-sandbox-java/java-version.sh \
	packages/gg-sandbox-kotlin/kotlin-version.sh packages/gg-sandbox-purescript/purescript-version.sh \
	packages/gg-sandbox-purescript/spago.yaml packages/gg-sandbox-ruby/yard-version.sh \
	packages/gg-sandbox-python/build.sh packages/gg-sandbox-rust/rust-version.sh \
	packages/gg-sandbox-rust/Cargo.lock rust-toolchain.toml scripts/gg-npm-tools.sh scripts/gg-downloads.sh; do
	mkdir -p "$repo/$(dirname "$file")"
	cp "$REPO_DIR/$file" "$repo/$file"
done
mkdir -p "$repo/scripts/gg-npm-locks"
cp -R "$REPO_DIR/scripts/gg-npm-locks/." "$repo/scripts/gg-npm-locks/"
# A fetch that records what it was asked for and serves only a jar from Maven Central, which is
# what install-java.sh fetches for the TeaVM dependencies the jvm image's cache lacks. Anything
# else is refused: the subject is that nothing else asks.
cat >"$repo/scripts/ci/fetch.sh" <<'EOF'
gg_fetch_dir() { echo "$HOME/downloads"; }
gg_fetch() {
	echo "$1" >>"$STUB_LOG"
	case "$1" in
	https://repo1.maven.org/maven2/*.jar)
		mkdir -p "$(dirname "$2")"
		printf 'fetched' >"$2"
		;;
	*)
		echo "stub: refusing to download $1" >&2
		return 1
		;;
	esac
}
EOF

# The pins, read the way the script reads them.
pins() { # home
	# shellcheck disable=SC1091 # the copies above
	(
		export HOME="$1"
		source "$repo/packages/gg-sandbox-swift/swift-version.sh"
		source "$repo/packages/gg-sandbox-csharp/csharp-version.sh"
		source "$repo/packages/gg-sandbox-java/java-version.sh"
		source "$repo/packages/gg-sandbox-kotlin/kotlin-version.sh"
		source "$repo/packages/gg-sandbox-purescript/purescript-version.sh"
		source "$repo/packages/gg-sandbox-ruby/yard-version.sh"
		componentize="$(sed -n 's/^COMPONENTIZE_VERSION="\(.*\)"$/\1/p' "$repo/packages/gg-sandbox-python/build.sh")"
		printf 'SWIFT=%q\nSWIFT_SDK=%q\nSWIFT_TARGET=%q\nWASI_SDK=%q\nCPP_TARGET=%q\nCSHARP_TARGET=%q\n' \
			"$GG_SWIFT_VERSION" "$GG_SWIFT_WASM_SDK_VERSION" "$GG_SWIFT_TARGET" "$GG_WASI_SDK_VERSION" \
			"$GG_CPP_TARGET" "$GG_CSHARP_TARGET"
		printf 'DOTNET=%q\nRUNTIME=%q\nTFM=%q\nMONO_PACK=%q\nBUILD=%q\n' "$GG_DOTNET_SDK_VERSION" \
			"$GG_DOTNET_RUNTIME_VERSION" "$GG_DOTNET_TFM" "$GG_DOTNET_MONO_WASI_PACK" "$GG_BUILD_PREFIX"
		printf 'JDK=%q\nTEAVM=%q\nKOTLIN=%q\nPURS=%q\nESBUILD=%q\nYARD=%q\nCOMPONENTIZE=%q\n' "$JDK_VERSION" \
			"$TEAVM_VERSION" "$KOTLIN_VERSION" "$PURS_VERSION" "$ESBUILD_VERSION" "$YARD_VERSION" "$componentize"
		printf 'KOTLIN_JARS=%q\nWIT_BINDGEN=%q\nCSHARP_WASI_SDK=%q\n' "$KOTLIN_JARS" "$GG_WIT_BINDGEN_VERSION" \
			"$GG_CSHARP_WASI_SDK_VERSION"
		printf 'TEAVM_JARS=%q\nSPAGO=%q\n' "$TEAVM_JARS" "$SPAGO_VERSION"
		# install-wit-bindgen.sh requires the Swift and Rust arms' pins to be the C++ arm's, and
		# each sets the same name, so each is read on its own.
		printf 'SWIFT_WIT_BINDGEN=%q\n' "$(source "$repo/packages/gg-sandbox-swift/swift-version.sh" &&
			echo "$GG_WIT_BINDGEN_VERSION")"
		printf 'RUST_WIT_BINDGEN=%q\n' "$(source "$repo/packages/gg-sandbox-rust/rust-version.sh" &&
			echo "$GG_WIT_BINDGEN_VERSION")"
	)
}
eval "$(pins "$tmp/home")"

# The system libraries the base image installs, which `ldconfig -p` lists.
mkdir -p "$tmp/syslib" "$tmp/bin"
for soname in libstdc++.so.6 libgcc_s.so.1 libtinfo.so.6 libicuuc.so.78 libicui18n.so.78 libicudata.so.78; do
	printf 'system %s' "$soname" >"$tmp/syslib/$soname"
done
cat >"$tmp/bin/ldconfig" <<'STUB'
#!/usr/bin/env bash
echo "6 libs found in cache \`/etc/ld.so.cache'"
for lib in "$STUB_SYSLIB"/*; do
	printf '\t%s (libc6,AArch64) => %s\n' "$(basename "$lib")" "$lib"
done
STUB
# YARD is installed when GEM_HOME holds the pinned gem, as RubyGems answers it.
cat >"$tmp/bin/ruby" <<'STUB'
#!/usr/bin/env bash
case "$*" in
*'gem "yard"'*) [ -d "$GEM_HOME/gems/yard-${!#}" ] ;;
*find_all_by_name*) for gem in "$GEM_HOME"/gems/yard-*; do printf '%s ' "${gem##*-}"; done ;;
*) exit 1 ;;
esac
STUB
# uvx --offline answers from the installed tool, which the python image puts in uv's tool directory.
cat >"$tmp/bin/uvx" <<'STUB'
#!/usr/bin/env bash
want="$(printf '%s\n' "$@" | sed -n 's/^componentize-py==//p')"
have="$(cat "$HOME/.local/share/uv/tools/componentize-py/version" 2>/dev/null)"
if [ -n "$have" ] && [ "$have" = "$want" ]; then
	echo "componentize-py $have"
else
	echo "error: componentize-py==$want is not in the offline cache" >&2
	exit 2
fi
STUB
# npm and curl record that they were asked and refuse: after the links, nothing installs spago or
# downloads wit-bindgen.
# shellcheck disable=SC2016 # the stub expands its own arguments
for tool in npm curl; do
	printf '#!/usr/bin/env bash\necho "%s $*" >>"$STUB_LOG"\nexit 1\n' "$tool" >"$tmp/bin/$tool"
done
chmod +x "$tmp/bin/ldconfig" "$tmp/bin/ruby" "$tmp/bin/uvx" "$tmp/bin/npm" "$tmp/bin/curl"

# The TeaVM jars the jvm image's Gradle cache leaves out, as the published image does: the release's
# own jars are seeded, and ASM is one of the dependencies it resolved to another version.
teavm_uncached() { # coordinate
	[[ "$1" == org.ow2.asm:* ]]
}

# The purescript image's spago, an `npm install -g` tree: the package under lib/node_modules with
# every other package of the committed lock below it, at the lock's versions. [name version] moves
# one package to another version.
spago_tree() { # home [name version]
	node -e '
const fs = require("fs"), path = require("path");
const [lockFile, root, moved, to] = process.argv.slice(1);
for (const [key, entry] of Object.entries(JSON.parse(fs.readFileSync(lockFile)).packages)) {
	if (!key.startsWith("node_modules/")) continue;
	const name = key.split("node_modules/").pop();
	const dir = key === "node_modules/spago" ? root : path.join(root, key.replace(/^node_modules\/spago\//, "").replace(/^node_modules\//, "node_modules/"));
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version: name === moved ? to : entry.version }));
}
' "$repo/scripts/gg-npm-locks/spago-$SPAGO/package-lock.json" "$1/.local/share/spago/lib/node_modules/spago" "${2:-}" "${3:-}"
	stub_bin "$1/.local/share/spago/lib/node_modules/spago/bin/bundle.js" "$SPAGO"
	mkdir -p "$1/.local/share/spago/bin"
	ln -s ../lib/node_modules/spago/bin/bundle.js "$1/.local/share/spago/bin/spago"
}

stub_bin() { # path output
	mkdir -p "$(dirname "$1")"
	printf '#!/usr/bin/env bash\necho %q\n' "$2" >"$1"
	chmod +x "$1"
}

# The trees the template's language images put under the account's home, in their layouts.
images() { # home [swift] [wasi-sdk] [dotnet] [jdk] [kotlin-version-in-cache] [wit-bindgen]
	local home="$1" swift="${2:-$SWIFT}" wasi="${3:-$WASI_SDK}" dotnet="${4:-$DOTNET}" jdk="${5:-$JDK}"
	local cache_kotlin="${6:-$KOTLIN}"
	stub_bin "$home/swift/$swift/usr/bin/swiftc" "swiftc $swift"
	local bundle="$home/.swiftpm/swift-sdks/swift-$swift-RELEASE_wasm.artifactbundle/swift-$swift-RELEASE_wasm/$SWIFT_TARGET"
	mkdir -p "$bundle/WASI.sdk" "$bundle/swift.xctoolchain/usr/lib/swift_static"

	stub_bin "$home/wasi-sdk/$wasi/bin/clang-23" "clang version 23.1.0-wasi-sdk"
	ln -s clang-23 "$home/wasi-sdk/$wasi/bin/clang"
	ln -s clang "$home/wasi-sdk/$wasi/bin/clang++"
	mkdir -p "$home/wasi-sdk/$wasi/lib/clang/23" "$home/wasi-sdk/$wasi/share/wasi-sysroot/lib/$CPP_TARGET" \
		"$home/wasi-sdk/$wasi/share/wasi-sysroot/lib/$CSHARP_TARGET/noeh"
	printf 'x' >"$home/wasi-sdk/$wasi/lib/libLLVM.so.23.1-wasi-sdk"

	local sdk="$home/dotnet/$dotnet"
	stub_bin "$sdk/dotnet" "dotnet $dotnet"
	mkdir -p "$sdk/sdk/$dotnet/Roslyn/bincore" "$sdk/shared/Microsoft.NETCore.App/$RUNTIME" \
		"$sdk/packs/Microsoft.NETCore.App.Ref/$RUNTIME/ref/$TFM"
	printf 'x' >"$sdk/sdk/$dotnet/Roslyn/bincore/csc.dll"
	printf 'x' >"$sdk/packs/Microsoft.NETCore.App.Ref/$RUNTIME/ref/$TFM/System.Runtime.dll"
	printf 'x' >"$sdk/packs/Microsoft.NETCore.App.Ref/$RUNTIME/ref/$TFM/System.Linq.dll"
	printf 'x' >"$sdk/packs/Microsoft.NETCore.App.Ref/$RUNTIME/ref/$TFM/System.Runtime.xml"
	# What the wasi-experimental workload leaves in the SDK once installed, which no image holds.
	for tasks in "Microsoft.NET.Runtime.WebAssembly.Wasi.Sdk/$RUNTIME/tasks/$TFM/WasmAppBuilder.dll" \
		"Microsoft.NET.Runtime.MonoTargets.Sdk/$RUNTIME/tasks/$TFM/MonoTargetsTasks.dll"; do
		mkdir -p "$(dirname "$sdk/packs/$tasks")"
		printf 'x' >"$sdk/packs/$tasks"
	done

	stub_bin "$home/jdk/$jdk/bin/javac" "javac"
	stub_bin "$home/jdk/$jdk/bin/java" "openjdk version \"${jdk%%+*}\" 2026-07-21 LTS"

	local coordinate group rest artifact version
	while read -r coordinate; do
		[ -n "$coordinate" ] || continue
		group="${coordinate%%:*}"
		rest="${coordinate#*:}"
		artifact="${rest%%:*}"
		version="${rest#*:}"
		[ "$version" = "$KOTLIN" ] && version="$cache_kotlin"
		mkdir -p "$home/.gradle/caches/modules-2/files-2.1/$group/$artifact/$version/0123abcd"
		printf 'jar' >"$home/.gradle/caches/modules-2/files-2.1/$group/$artifact/$version/0123abcd/$artifact-$version.jar"
	done <<<"$KOTLIN_JARS"
	while read -r coordinate; do
		[ -n "$coordinate" ] || continue
		teavm_uncached "$coordinate" && continue
		group="${coordinate%%:*}"
		rest="${coordinate#*:}"
		artifact="${rest%%:*}"
		version="${rest#*:}"
		mkdir -p "$home/.gradle/caches/modules-2/files-2.1/$group/$artifact/$version/4567cdef"
		printf 'jar' >"$home/.gradle/caches/modules-2/files-2.1/$group/$artifact/$version/4567cdef/$artifact-$version.jar"
	done <<<"$TEAVM_JARS"

	spago_tree "$home"
	stub_bin "$home/.local/bin/purs" "$PURS"
	stub_bin "$home/.local/bin/wit-bindgen" "wit-bindgen-cli ${7:-$WIT_BINDGEN} (0123abcd 2026-09-10)"
	mkdir -p "$home/ruby/gems/gems/yard-$YARD" "$home/.local/share/uv/tools/componentize-py"
	echo "$COMPONENTIZE" >"$home/.local/share/uv/tools/componentize-py/version"
}

run() { # home script [env...]
	local home="$1" script="$2"
	shift 2
	: >"$tmp/calls.log"
	(cd "$tmp" && env -u TCAB_GG_BUILD_PREFIX -u JAVA_INSTALL_DIR -u KOTLIN_INSTALL_DIR -u PURS_INSTALL_DIR \
		-u GRADLE_USER_HOME HOME="$home" GEM_HOME="$home/ruby/gems" STUB_LOG="$tmp/calls.log" \
		STUB_SYSLIB="$tmp/syslib" PATH="$tmp/bin:$PATH" "$@" "$repo/scripts/ci/$script" 2>&1)
}

home="$tmp/home"
images "$home"
out="$(run "$home" gg-image-toolchains.sh)"
check_equal "the trees for every pin link" "0" "$?"
check_contains "and it says so" "gg's toolchains are linked to the template's images" "$out"

share="$home/.local/share/tcab"
check_dir "Swift's home is a real directory" "$share/gg-swift"
check_link "its toolchain is the image's" "$share/gg-swift/toolchain" "$home/swift/$SWIFT"
check_link "its SDK is the image's $SWIFT_TARGET variant" "$share/gg-swift/sdk" \
	"$home/.swiftpm/swift-sdks/swift-$SWIFT_SDK-RELEASE_wasm.artifactbundle/swift-$SWIFT_SDK-RELEASE_wasm/$SWIFT_TARGET"
check_dir "with an empty lib/" "$share/gg-swift/lib"
check_equal "and a stamp" "$SWIFT" "$(cat "$share/gg-swift/swift-version")"

check_dir "wasi-sdk's home is a real directory" "$share/gg-wasi-sdk"
check_link "its bin/ is the image's" "$share/gg-wasi-sdk/bin" "$home/wasi-sdk/$WASI_SDK/bin"
check_link "its share/ is the image's" "$share/gg-wasi-sdk/share" "$home/wasi-sdk/$WASI_SDK/share"
check_dir "its lib/ is a real directory" "$share/gg-wasi-sdk/lib"
check_link "of the image's libraries" "$share/gg-wasi-sdk/lib/libLLVM.so.23.1-wasi-sdk" \
	"$home/wasi-sdk/$WASI_SDK/lib/libLLVM.so.23.1-wasi-sdk"
for soname in libstdc++.so.6 libgcc_s.so.1 libtinfo.so.6; do
	check_link "and the system's $soname" "$share/gg-wasi-sdk/lib/$soname" "$tmp/syslib/$soname"
done
check_equal "and a stamp" "$WASI_SDK" "$(cat "$share/gg-wasi-sdk/wasi-sdk-version")"

check_link ".NET's runtime is the image's SDK" "$share/gg-dotnet/dotnet" "$home/dotnet/$DOTNET"
check_link "Roslyn is the SDK's" "$share/gg-dotnet/roslyn" "$home/dotnet/$DOTNET/sdk/$DOTNET/Roslyn"
check_dir "the reference assemblies are a real directory" "$share/gg-dotnet/ref/$TFM"
check_link "of links to the image's" "$share/gg-dotnet/ref/$TFM/System.Linq.dll" \
	"$home/dotnet/$DOTNET/packs/Microsoft.NETCore.App.Ref/$RUNTIME/ref/$TFM/System.Linq.dll"
check_equal "which find lists without following a directory" "2" \
	"$(find "$share/gg-dotnet/ref" -name '*.dll' | wc -l | tr -d ' ')"
for soname in libicuuc.so.78 libicui18n.so.78 libicudata.so.78; do
	check_link "and the system's $soname" "$share/gg-dotnet/lib/$soname" "$tmp/syslib/$soname"
done
check_equal "and a stamp" "$DOTNET" "$(cat "$share/gg-dotnet/dotnet-version")"

check_link "the guest's build SDK is the image's" "$share/gg-build/dotnet-sdk-$DOTNET" "$home/dotnet/$DOTNET"
if [ "$CSHARP_WASI_SDK" = "$WASI_SDK" ]; then
	check_link "and its full wasi-sdk too" "$share/gg-build/wasi-sdk-$CSHARP_WASI_SDK-full" "$home/wasi-sdk/$WASI_SDK"
else
	check_contains "and leaves the guest's own wasi-sdk to the installer" \
		"the guest links with wasi-sdk $CSHARP_WASI_SDK, which no image holds" "$out"
	if [ -e "$share/gg-build/wasi-sdk-$CSHARP_WASI_SDK-full" ]; then
		bad "linking nothing in its place" "expected no $share/gg-build/wasi-sdk-$CSHARP_WASI_SDK-full"
	else
		ok "linking nothing in its place"
	fi
fi

check_link "the JDK is the image's" "$home/.local/share/gg-java/jdk" "$home/jdk/$JDK"
kotlin_jars="$(find "$home/.local/share/gg-kotlin/libs" -name '*.jar' | wc -l | tr -d ' ')"
check_equal "every Kotlin jar is linked" "$(grep -c . <<<"$KOTLIN_JARS")" "$kotlin_jars"
check_link "into the image's Gradle cache" "$home/.local/share/gg-kotlin/libs/kotlin-stdlib-$KOTLIN.jar" \
	"$home/.gradle/caches/modules-2/files-2.1/org.jetbrains.kotlin/kotlin-stdlib/$KOTLIN/0123abcd/kotlin-stdlib-$KOTLIN.jar"
check_equal "with the installer's stamp" "$KOTLIN" "$(cat "$home/.local/share/gg-kotlin/libs/.kotlin-version")"

java_libs="$home/.local/share/gg-java/libs"
teavm_cached=0
while read -r coordinate; do
	[ -n "$coordinate" ] || continue
	teavm_uncached "$coordinate" || teavm_cached=$((teavm_cached + 1))
done <<<"$TEAVM_JARS"
check_equal "every TeaVM jar the cache holds is linked" "$teavm_cached" \
	"$(find "$java_libs" -name '*.jar' -type l | wc -l | tr -d ' ')"
check_link "into the image's Gradle cache" "$java_libs/teavm-core-$TEAVM.jar" \
	"$home/.gradle/caches/modules-2/files-2.1/org.teavm/teavm-core/$TEAVM/4567cdef/teavm-core-$TEAVM.jar"
if [ -e "$java_libs/.teavm-version" ]; then
	bad "leaving the stamp to the installer" "expected no $java_libs/.teavm-version"
else
	ok "leaving the stamp to the installer"
fi

spago_home="$share/gg-npm/spago-$SPAGO-$(cd "$repo" && source scripts/gg-npm-tools.sh &&
	gg_npm_tool_digest "scripts/gg-npm-locks/spago-$SPAGO/package-lock.json")"
check_link "spago's npm prefix is the image's package" "$spago_home/node_modules/spago" \
	"$home/.local/share/spago/lib/node_modules/spago"
check_link "with the image's command" "$spago_home/node_modules/.bin/spago" "$home/.local/share/spago/bin/spago"

# The installers, run after it, find each arm installed and fetch nothing.
out="$(run "$home" install-swift.sh)"
check_equal "install-swift.sh succeeds" "0" "$?"
check_contains "finding Swift installed" "Swift $SWIFT already installed at $share/gg-swift" "$out"
check_equal "without a download" "" "$(cat "$tmp/calls.log")"

out="$(run "$home" install-wasi-sdk.sh)"
check_equal "install-wasi-sdk.sh succeeds" "0" "$?"
check_contains "finding wasi-sdk installed" "wasi-sdk $WASI_SDK already installed at $share/gg-wasi-sdk" "$out"
check_equal "without a download" "" "$(cat "$tmp/calls.log")"

out="$(run "$home" install-dotnet.sh)"
check_equal "install-dotnet.sh succeeds" "0" "$?"
check_contains "finding .NET installed" ".NET $DOTNET already installed at $share/gg-dotnet" "$out"
check_equal "without a download" "" "$(cat "$tmp/calls.log")"

# install-kotlin.sh runs install-java.sh, which fetches only the TeaVM jars the cache lacks.
out="$(run "$home" install-kotlin.sh)"
check_equal "install-kotlin.sh succeeds" "0" "$?"
check_contains "finding the JDK installed" "Temurin $JDK already installed" "$out"
check_contains "and the Kotlin compiler" "Kotlin $KOTLIN already installed" "$out"
check_contains "keeping TeaVM's linked jars" "have teavm-core-$TEAVM.jar (linked)" "$out"
uncached=""
while read -r coordinate; do
	[ -n "$coordinate" ] || continue
	teavm_uncached "$coordinate" || continue
	group="${coordinate%%:*}"
	rest="${coordinate#*:}"
	uncached="$uncached${uncached:+$'\n'}https://repo1.maven.org/maven2/${group//./\/}/${rest%%:*}/${rest#*:}/${rest%%:*}-${rest#*:}.jar"
done <<<"$TEAVM_JARS"
check_equal "and downloading only the ones it lacks" "$uncached" "$(cat "$tmp/calls.log")"
check_equal "then stamping TeaVM" "$TEAVM" "$(cat "$java_libs/.teavm-version")"
check_link "with the links as they were" "$java_libs/teavm-core-$TEAVM.jar" \
	"$home/.gradle/caches/modules-2/files-2.1/org.teavm/teavm-core/$TEAVM/4567cdef/teavm-core-$TEAVM.jar"
check_equal "and the cache untouched" "jar" "$(cat "$java_libs/teavm-core-$TEAVM.jar")"

# esbuild is the installer's own, and stands installed here so the run is about purs.
stub_bin "$home/.local/bin/esbuild" "$ESBUILD"
out="$(run "$home" install-purescript.sh)"
check_equal "install-purescript.sh succeeds" "0" "$?"
check_contains "finding purs installed" "purs $PURS already installed" "$out"
check_equal "without a download" "" "$(cat "$tmp/calls.log")"

# What install-gg-build-tools.sh and the PureScript arm's build.sh resolve spago with.
: >"$tmp/calls.log"
# shellcheck disable=SC2016 # the arguments expand in the child shell
out="$(cd "$tmp" && env -u TCAB_GG_NPM_PREFIX -u GG_NPM_INSTALL_DIR HOME="$home" STUB_LOG="$tmp/calls.log" \
	PATH="$tmp/bin:$PATH" bash -c 'source "$1/scripts/gg-npm-tools.sh" && gg_npm_tool spago "$2"' _ "$repo" "$SPAGO" 2>&1)"
check_equal "gg_npm_tool resolves spago" "0" "$?"
check_equal "to the linked prefix" "$spago_home" "$out"
check_equal "without npm" "" "$(cat "$tmp/calls.log")"
check_equal "whose command is the image's" "$SPAGO" "$("$spago_home/node_modules/.bin/spago" --version)"

out="$(run "$home" install-wit-bindgen.sh)"
check_equal "install-wit-bindgen.sh succeeds" "0" "$?"
check_contains "finding wit-bindgen at the link" \
	"wit-bindgen $WIT_BINDGEN at $share/gg-wit-bindgen-$WIT_BINDGEN/wit-bindgen" "$out"
check_equal "without a download" "" "$(cat "$tmp/calls.log")"

# The Mono runtime pack is the installer's own, and stands unpacked here, with the guest's wasi-sdk
# where no image serves it.
mkdir -p "$share/gg-build/$MONO_PACK.$RUNTIME/runtimes/wasi-wasm/native"
if [ "$CSHARP_WASI_SDK" != "$WASI_SDK" ]; then
	stub_bin "$share/gg-build/wasi-sdk-$CSHARP_WASI_SDK-full/bin/clang" "clang"
	mkdir -p "$share/gg-build/wasi-sdk-$CSHARP_WASI_SDK-full/share/wasi-sysroot/lib/$CSHARP_TARGET/noeh"
fi
out="$(run "$home" install-gg-build-toolchains.sh)"
check_equal "install-gg-build-toolchains.sh succeeds" "0" "$?"
check_contains "finding the build SDK installed" ".NET SDK $DOTNET already installed at $share/gg-build/dotnet-sdk-$DOTNET" "$out"
check_contains "and the full wasi-sdk" \
	"wasi-sdk $CSHARP_WASI_SDK already installed at $share/gg-build/wasi-sdk-$CSHARP_WASI_SDK-full" "$out"
check_equal "without a download" "" "$(cat "$tmp/calls.log")"

out="$(run "$home" gg-image-toolchains.sh)"
check_equal "a second run succeeds" "0" "$?"
check_equal "leaving the image's trees as they were" "$JDK" "$(basename "$(readlink "$home/.local/share/gg-java/jdk")")"
check_equal "and TeaVM's stamp" "$TEAVM" "$(cat "$java_libs/.teavm-version")"
check_equal "with every one of its jars" "$(grep -c . <<<"$TEAVM_JARS")" \
	"$(find "$java_libs" -name '*.jar' | wc -l | tr -d ' ')"

# A pin the image does not hold stops the build, naming what disagrees.
expect_mismatch() { # label home needle-file needle-version
	local out
	out="$(run "$2" gg-image-toolchains.sh)"
	check_equal "$1 stops it" "1" "$?"
	check_contains "naming the pin file" "error: $3 pins" "$out"
	check_contains "and what the image holds" "$4" "$out"
}
check_link "wit-bindgen's directory is a link to the image's" "$share/gg-wit-bindgen-$WIT_BINDGEN/wit-bindgen" \
	"$home/.local/bin/wit-bindgen"

images "$tmp/swift-home" 9.9.9
expect_mismatch "a Swift image of another release" "$tmp/swift-home" packages/gg-sandbox-swift/swift-version.sh \
	"but the template's image holds Swift 9.9.9."
images "$tmp/wasi-home" "$SWIFT" 99.0
expect_mismatch "a wasi-sdk image of another release" "$tmp/wasi-home" packages/gg-sandbox-cpp/cpp-version.sh \
	"but the template's image holds wasi-sdk 99.0."
images "$tmp/dotnet-home" "$SWIFT" "$WASI_SDK" 99.0.100
expect_mismatch "a .NET image of another SDK" "$tmp/dotnet-home" packages/gg-sandbox-csharp/csharp-version.sh \
	"but the template's image holds .NET SDK 99.0.100."
images "$tmp/jdk-home" "$SWIFT" "$WASI_SDK" "$DOTNET" 99.0.1+1
expect_mismatch "a jvm image of another JDK" "$tmp/jdk-home" packages/gg-sandbox-java/java-version.sh \
	"but the template's image holds the JDK 99.0.1+1."
images "$tmp/kotlin-home" "$SWIFT" "$WASI_SDK" "$DOTNET" "$JDK" 9.9.9
expect_mismatch "a Gradle cache of another Kotlin" "$tmp/kotlin-home" packages/gg-sandbox-kotlin/kotlin-version.sh \
	"9.9.9 in its Gradle cache"
images "$tmp/teavm-home"
rm -rf "$tmp/teavm-home/.gradle/caches/modules-2/files-2.1/org.teavm/teavm-core"
expect_mismatch "a Gradle cache without the pinned TeaVM" "$tmp/teavm-home" packages/gg-sandbox-java/java-version.sh \
	"org.teavm:teavm-core:$TEAVM"
images "$tmp/spago-home"
mv "$tmp/spago-home/.local/share/spago/lib/node_modules/spago/bin/bundle.js" "$tmp/spago-bundle.js"
stub_bin "$tmp/spago-home/.local/share/spago/lib/node_modules/spago/bin/bundle.js" "0.0.1"
expect_mismatch "a purescript image of another spago" "$tmp/spago-home" \
	packages/gg-sandbox-purescript/purescript-version.sh "spago 0.0.1"
images "$tmp/spago-tree-home"
rm -rf "$tmp/spago-tree-home/.local/share/spago"
spago_tree "$tmp/spago-tree-home" yaml 0.0.1
out="$(run "$tmp/spago-tree-home" gg-image-toolchains.sh)"
check_equal "a spago tree that is not the lock's stops it" "1" "$?"
check_contains "naming the lock" "scripts/gg-npm-locks/spago-$SPAGO/package-lock.json names:" "$out"
check_contains "and the package that differs" "image only: yaml@0.0.1" "$out"
images "$tmp/yard-home"
mv "$tmp/yard-home/ruby/gems/gems/yard-$YARD" "$tmp/yard-home/ruby/gems/gems/yard-0.0.1"
expect_mismatch "a ruby image of another YARD" "$tmp/yard-home" packages/gg-sandbox-ruby/yard-version.sh "0.0.1"
images "$tmp/py-home"
echo 0.0.1 >"$tmp/py-home/.local/share/uv/tools/componentize-py/version"
expect_mismatch "a python image of another componentize-py" "$tmp/py-home" packages/gg-sandbox-python/build.sh \
	"componentize-py $COMPONENTIZE"
images "$tmp/wit-home" "$SWIFT" "$WASI_SDK" "$DOTNET" "$JDK" "$KOTLIN" 0.0.1
expect_mismatch "a wasm-components image of another wit-bindgen" "$tmp/wit-home" \
	packages/gg-sandbox-cpp/cpp-version.sh "wit-bindgen-cli 0.0.1"

# The anchor's image tags name the versions this repository pins, ignoring the content digest every
# language image tag ends in, so a template update that moves an image without the pin fails here
# rather than in the image build. The tags are read from this checkout's compose file.
compose="$REPO_DIR/.devcontainer/docker-compose.yml"
tag() { # NAME_IMAGE
	sed -n "s|^  $1: [^:]*:\\(.*\\)\$|\\1|p" "$compose"
}
check_tag() { # label NAME_IMAGE prefix-or-fragment
	local tag
	tag="$(tag "$2")"
	if [[ "$tag" =~ _[0-9a-f]{8}$ ]] && [[ "_${tag%_*}_" == *"_$3_"* ]]; then
		ok "$1"
	else
		bad "$1" "expected $2's tag to name $3" "got: ${tag:-<no $2>}"
	fi
}
check_tag "the swift image is Swift $SWIFT" SWIFT_IMAGE "${SWIFT}_wasm-sdk-${SWIFT_SDK}"
check_tag "the wasi-sdk image is wasi-sdk $WASI_SDK" WASI_SDK_IMAGE "$WASI_SDK"
check_tag "the dotnet image is the SDK $DOTNET" DOTNET_IMAGE "$DOTNET"
check_tag "the jvm image is the JDK $JDK" JVM_IMAGE "jdk-${JDK//+/-}"
check_tag "and Kotlin $KOTLIN" JVM_IMAGE "kotlin-$KOTLIN"
# TeaVM's own jars are taken from the jvm image's Gradle cache, so its pin is held to the tag too.
check_tag "and TeaVM $TEAVM" JVM_IMAGE "teavm-$TEAVM"
check_tag "the ruby image is YARD $YARD" RUBY_IMAGE "yard-$YARD"
check_tag "the python image is componentize-py $COMPONENTIZE" PYTHON_IMAGE "componentize-py-$COMPONENTIZE"
check_tag "the purescript image is purs $PURS" PURESCRIPT_IMAGE "$PURS"
check_tag "and spago $SPAGO" PURESCRIPT_IMAGE "spago-$SPAGO"
check_tag "the wasm-components image is the C++ arm's wit-bindgen $WIT_BINDGEN" WASM_COMPONENTS_IMAGE \
	"wit-bindgen-$WIT_BINDGEN"
check_tag "and the Swift arm's $SWIFT_WIT_BINDGEN" WASM_COMPONENTS_IMAGE "wit-bindgen-$SWIFT_WIT_BINDGEN"
check_tag "and the Rust arm's lock's $RUST_WIT_BINDGEN" WASM_COMPONENTS_IMAGE "wit-bindgen-$RUST_WIT_BINDGEN"

echo "gg-image-toolchains.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
