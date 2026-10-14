#!/usr/bin/env bash
# Link gg's program-language toolchains to the trees the template's language images put in the
# devcontainer, so the installers that run after it find every arm the images can serve already
# installed and download only what no image holds.
#
# The devcontainer copies the template's swift, wasi-sdk, dotnet, jvm, ruby, python and purescript
# images under the account's home (see "The language toolchains" in .devcontainer/README.md). Each
# holds a toolchain at a version the template pins, in the template's layout, while gg's readers and
# installers look for each arm at a default home of their own (`GG_*_DEFAULT_HOME` in each arm's
# version file) in the layout scripts/ci/install-*.sh writes. So this builds, at each default home,
# a small tree of links into the image with the installer's version stamp beside it, and the
# installer's own check then says the arm is already installed:
#
#   ~/.local/share/tcab/gg-swift      toolchain/ and sdk/ linked to the Swift image, an empty lib/
#   ~/.local/share/tcab/gg-wasi-sdk   bin/ and share/ linked to the wasi-sdk image, lib/ a directory
#                                     of links to its libraries and the system's libstdc++,
#                                     libgcc_s and libtinfo the installer's check asks for
#   ~/.local/share/tcab/gg-dotnet     dotnet/ and roslyn/ linked to the dotnet image's SDK, ref/
#                                     a directory of links to its reference assemblies, lib/ links
#                                     to the system's ICU
#   ~/.local/share/tcab/gg-build      the C# guest's unpruned .NET SDK linked whole, and its
#                                     wasi-sdk too where its pin is the C++ arm's
#   ~/.local/share/gg-java/jdk        linked to the jvm image's JDK (TeaVM's libs/ stays the
#                                     installer's)
#   ~/.local/share/gg-kotlin/libs     a link per pinned compiler jar into the jvm image's Gradle cache
#
# Nothing is written into an image's own tree. `purs`, YARD and componentize-py need no link, since
# the images put them where the installers and gg already look, so they are only checked.
#
# A PIN AND AN IMAGE THAT DISAGREE FAIL HERE. Each arm's pin lives in its version file under
# packages/, and the image's version in its tag in .devcontainer/docker-compose.yml. Were this to
# skip an arm whose pin the image does not hold, the installer after it would download that arm
# into its default home, which is the per-workspace download the images exist to remove, and it
# would do so silently. So a missing tree is an error naming the pin file, the pinned version and
# what the image holds, and the fix is to move the pin or the template so the two agree.
# scripts/ci/gg-image-toolchains.test.sh holds the anchor's tags to the pins, so the same
# disagreement fails the shell-tests gate before anyone builds an image.
#
# This is the devcontainer's alone: .devcontainer/languages/gg/install.sh runs it before the
# installers. The pipeline, the run images and the services image run the installers without it,
# because no image of theirs copies the template's language images.
#
# Usage:
#   scripts/ci/gg-image-toolchains.sh
set -euo pipefail

# shellcheck source=scripts/ci/tcab-lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tcab-lib.sh"
# shellcheck source=packages/gg-sandbox-swift/swift-version.sh
source "$REPO_ROOT/packages/gg-sandbox-swift/swift-version.sh"
# csharp-version.sh sources cpp-version.sh, which is the wasi-sdk pin both arms build with.
# shellcheck source=packages/gg-sandbox-csharp/csharp-version.sh
source "$REPO_ROOT/packages/gg-sandbox-csharp/csharp-version.sh"
# shellcheck source=packages/gg-sandbox-kotlin/kotlin-version.sh
source "$REPO_ROOT/packages/gg-sandbox-kotlin/kotlin-version.sh"
# shellcheck source=packages/gg-sandbox-java/java-version.sh
source "$REPO_ROOT/packages/gg-sandbox-java/java-version.sh"
# shellcheck source=packages/gg-sandbox-purescript/purescript-version.sh
source "$REPO_ROOT/packages/gg-sandbox-purescript/purescript-version.sh"
# shellcheck source=packages/gg-sandbox-ruby/yard-version.sh
source "$REPO_ROOT/packages/gg-sandbox-ruby/yard-version.sh"

# The Python arm's pin is a line of its build script rather than a version file.
COMPONENTIZE_VERSION="$(sed -n 's/^COMPONENTIZE_VERSION="\(.*\)"$/\1/p' "$REPO_ROOT/packages/gg-sandbox-python/build.sh")"

# Where the images put their trees: the account's home, which is the image build's HOME.
readonly IMAGES="$HOME"
# Where `ldconfig` lives on Ubuntu, after anything already on the PATH.
export PATH="$PATH:/usr/sbin:/sbin"

# Stop the build over a pin the image does not hold.
mismatch() { # pin-file pin what-the-image-holds
	echo "error: $1 pins $2, but the template's image holds $3." >&2
	echo "       Move the pin or the template so the two agree; see \"gg's toolchains\" in" >&2
	echo "       .devcontainer/README.md." >&2
	exit 1
}

# What a directory of versions holds, for the message above.
holding() { # dir
	if [ -d "$1" ]; then
		find "$1" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort | paste -sd ' ' -
	else
		echo "nothing at $1"
	fi
}

# The system's copy of a shared object, by its soname.
system_library() { # soname
	local path
	path="$(ldconfig -p | sed -n "s|^[[:space:]]*$1 (.*) => \\(.*\\)\$|\\1|p" | head -1)"
	if [ -z "$path" ] || [ ! -e "$path" ]; then
		echo "error: the image has no $1 for gg's toolchain links to name." >&2
		exit 1
	fi
	echo "$path"
}

# A fresh default home. Only these fixed paths are removed, and `rm` removes a link rather than
# what it names, so an image's tree is never touched.
fresh() { # dir
	rm -rf "$1"
	mkdir -p "$1"
}

log "Swift $GG_SWIFT_VERSION from the swift image"
swift_tree="$IMAGES/swift/$GG_SWIFT_VERSION"
swift_bundle="$IMAGES/.swiftpm/swift-sdks/swift-$GG_SWIFT_WASM_SDK_VERSION-RELEASE_wasm.artifactbundle"
swift_sdk="$swift_bundle/swift-$GG_SWIFT_WASM_SDK_VERSION-RELEASE_wasm/$GG_SWIFT_TARGET"
[ -x "$swift_tree/usr/bin/swiftc" ] ||
	mismatch packages/gg-sandbox-swift/swift-version.sh "Swift $GG_SWIFT_VERSION" \
		"Swift $(holding "$IMAGES/swift")"
[ -d "$swift_sdk/WASI.sdk" ] && [ -d "$swift_sdk/swift.xctoolchain/usr/lib/swift_static" ] ||
	mismatch packages/gg-sandbox-swift/swift-version.sh \
		"the Swift SDK for WebAssembly $GG_SWIFT_WASM_SDK_VERSION ($GG_SWIFT_TARGET)" \
		"$(holding "$IMAGES/.swiftpm/swift-sdks")"
fresh "$GG_SWIFT_DEFAULT_HOME"
ln -s "$swift_tree" "$GG_SWIFT_DEFAULT_HOME/toolchain"
ln -s "$swift_sdk" "$GG_SWIFT_DEFAULT_HOME/sdk"
# The installer vendors Debian's libraries here for the debian12 build it installs. The image's is
# the Ubuntu build, whose libraries the base image installs, so the directory is empty.
mkdir -p "$GG_SWIFT_DEFAULT_HOME/lib"
echo "$GG_SWIFT_VERSION" >"$GG_SWIFT_DEFAULT_HOME/swift-version"
echo "linked $GG_SWIFT_DEFAULT_HOME -> $swift_tree"

log "wasi-sdk $GG_WASI_SDK_VERSION from the wasi-sdk image"
wasi_sdk_tree="$IMAGES/wasi-sdk/$GG_WASI_SDK_VERSION"
[ -x "$wasi_sdk_tree/bin/clang++" ] && [ -d "$wasi_sdk_tree/share/wasi-sysroot/lib/$GG_CPP_TARGET" ] ||
	mismatch packages/gg-sandbox-cpp/cpp-version.sh "wasi-sdk $GG_WASI_SDK_VERSION" \
		"wasi-sdk $(holding "$IMAGES/wasi-sdk")"
fresh "$GG_WASI_SDK_DEFAULT_HOME"
ln -s "$wasi_sdk_tree/bin" "$GG_WASI_SDK_DEFAULT_HOME/bin"
ln -s "$wasi_sdk_tree/share" "$GG_WASI_SDK_DEFAULT_HOME/share"
# The compiler loads its libraries through the RPATH of its real path, so these links serve the
# installer's check, which asks for the three system sonames it would have vendored here.
mkdir -p "$GG_WASI_SDK_DEFAULT_HOME/lib"
for entry in "$wasi_sdk_tree"/lib/*; do
	ln -s "$entry" "$GG_WASI_SDK_DEFAULT_HOME/lib/"
done
for soname in libstdc++.so.6 libgcc_s.so.1 libtinfo.so.6; do
	ln -sfn "$(system_library "$soname")" "$GG_WASI_SDK_DEFAULT_HOME/lib/$soname"
done
echo "$GG_WASI_SDK_VERSION" >"$GG_WASI_SDK_DEFAULT_HOME/wasi-sdk-version"
echo "linked $GG_WASI_SDK_DEFAULT_HOME -> $wasi_sdk_tree"

log ".NET SDK $GG_DOTNET_SDK_VERSION (runtime $GG_DOTNET_RUNTIME_VERSION) from the dotnet image"
dotnet_tree="$IMAGES/dotnet/$GG_DOTNET_SDK_VERSION"
reference="$dotnet_tree/packs/Microsoft.NETCore.App.Ref/$GG_DOTNET_RUNTIME_VERSION/ref/$GG_DOTNET_TFM"
[ -x "$dotnet_tree/dotnet" ] && [ -f "$dotnet_tree/sdk/$GG_DOTNET_SDK_VERSION/Roslyn/bincore/csc.dll" ] ||
	mismatch packages/gg-sandbox-csharp/csharp-version.sh ".NET SDK $GG_DOTNET_SDK_VERSION" \
		".NET SDK $(holding "$IMAGES/dotnet")"
# The runtime pin is held to the SDK here the way install-dotnet.sh holds it to a download.
[ -d "$dotnet_tree/shared/Microsoft.NETCore.App/$GG_DOTNET_RUNTIME_VERSION" ] && [ -d "$reference" ] ||
	mismatch packages/gg-sandbox-csharp/csharp-version.sh \
		"the runtime $GG_DOTNET_RUNTIME_VERSION with its $GG_DOTNET_TFM reference pack" \
		"the runtime $(holding "$dotnet_tree/shared/Microsoft.NETCore.App")"
fresh "$GG_DOTNET_DEFAULT_HOME"
ln -s "$dotnet_tree" "$GG_DOTNET_DEFAULT_HOME/dotnet"
ln -s "$dotnet_tree/sdk/$GG_DOTNET_SDK_VERSION/Roslyn" "$GG_DOTNET_DEFAULT_HOME/roslyn"
# A real directory of links rather than one link, because packages/gg-sandbox-csharp/signatures.sh
# lists the assemblies with a `find` that follows no linked directory.
mkdir -p "$GG_DOTNET_DEFAULT_HOME/ref/$GG_DOTNET_TFM"
for assembly in "$reference"/*.dll; do
	ln -s "$assembly" "$GG_DOTNET_DEFAULT_HOME/ref/$GG_DOTNET_TFM/"
done
# The ICU the runtime loads, which the installer vendors from Debian and the base image installs.
mkdir -p "$GG_DOTNET_DEFAULT_HOME/lib"
for name in libicuuc libicui18n libicudata; do
	soname="$(ldconfig -p | sed -n "s|^[[:space:]]*\\($name\\.so\\.[0-9][0-9]*\\) (.*|\\1|p" | head -1)"
	if [ -z "$soname" ]; then
		echo "error: the image has no $name.so.<major> for gg's toolchain links to name." >&2
		exit 1
	fi
	ln -s "$(system_library "$soname")" "$GG_DOTNET_DEFAULT_HOME/lib/$soname"
done
echo "$GG_DOTNET_SDK_VERSION" >"$GG_DOTNET_DEFAULT_HOME/dotnet-version"
echo "linked $GG_DOTNET_DEFAULT_HOME -> $dotnet_tree"

log "the C# guest's build toolchains from the dotnet and wasi-sdk images"
# Unpruned, as the guest's relink needs them. The wasi-experimental workload and the Mono runtime
# pack are not in any image, so install-gg-build-toolchains.sh still installs them, the workload
# into the SDK tree this links to.
mkdir -p "$GG_BUILD_PREFIX"
rm -rf "$GG_BUILD_PREFIX/dotnet-sdk-$GG_DOTNET_SDK_VERSION"
ln -s "$dotnet_tree" "$GG_BUILD_PREFIX/dotnet-sdk-$GG_DOTNET_SDK_VERSION"
echo "linked $GG_BUILD_PREFIX/dotnet-sdk-$GG_DOTNET_SDK_VERSION -> $dotnet_tree"
# The guest's wasi-sdk is pinned apart from the C++ arm's, to the release the Mono runtime pack
# links against (see csharp-version.sh). Where the two agree the image's tree serves both; where
# they do not, install-gg-build-toolchains.sh downloads the guest's into the build prefix.
if [ "$GG_CSHARP_WASI_SDK_VERSION" = "$GG_WASI_SDK_VERSION" ]; then
	[ -d "$wasi_sdk_tree/share/wasi-sysroot/lib/$GG_CSHARP_TARGET/noeh" ] ||
		mismatch packages/gg-sandbox-csharp/csharp-version.sh \
			"wasi-sdk $GG_CSHARP_WASI_SDK_VERSION with a $GG_CSHARP_TARGET sysroot" \
			"$(holding "$wasi_sdk_tree/share/wasi-sysroot/lib")"
	rm -rf "$GG_BUILD_PREFIX/wasi-sdk-$GG_CSHARP_WASI_SDK_VERSION-full"
	ln -s "$wasi_sdk_tree" "$GG_BUILD_PREFIX/wasi-sdk-$GG_CSHARP_WASI_SDK_VERSION-full"
	echo "linked $GG_BUILD_PREFIX/wasi-sdk-$GG_CSHARP_WASI_SDK_VERSION-full -> $wasi_sdk_tree"
else
	echo "the guest links with wasi-sdk $GG_CSHARP_WASI_SDK_VERSION, which no image holds;" \
		"install-gg-build-toolchains.sh installs it"
fi

log "the JDK $JDK_VERSION from the jvm image"
jdk_tree="$IMAGES/jdk/$JDK_VERSION"
[ -x "$jdk_tree/bin/javac" ] ||
	mismatch packages/gg-sandbox-java/java-version.sh "the JDK $JDK_VERSION" "the JDK $(holding "$IMAGES/jdk")"
# What install-java.sh asks of a JDK before it leaves one alone.
"$jdk_tree/bin/java" -version 2>&1 | grep -qF "${JDK_VERSION%%+*}" ||
	mismatch packages/gg-sandbox-java/java-version.sh "the JDK $JDK_VERSION" \
		"a JDK reporting $("$jdk_tree/bin/java" -version 2>&1 | head -1)"
java_home="${JAVA_INSTALL_DIR:-$HOME/.local/share/gg-java}"
mkdir -p "$java_home"
rm -rf "$java_home/jdk"
ln -s "$jdk_tree" "$java_home/jdk"
echo "linked $java_home/jdk -> $jdk_tree"

log "the Kotlin compiler $KOTLIN_VERSION from the jvm image's Gradle cache"
# Gradle's cache keeps each jar under its coordinate and the jar's SHA-1, so each pinned coordinate
# has to match exactly one file. That layout is Gradle's own rather than a published contract, so a
# template version that reseeds or prunes the cache fails here, naming the jar.
gradle_cache="${GRADLE_USER_HOME:-$HOME/.gradle}/caches/modules-2/files-2.1"
kotlin_home="${KOTLIN_INSTALL_DIR:-$HOME/.local/share/gg-kotlin}"
fresh "$kotlin_home/libs"
while read -r coordinate; do
	[ -n "$coordinate" ] || continue
	group="${coordinate%%:*}"
	rest="${coordinate#*:}"
	artifact="${rest%%:*}"
	version="${rest#*:}"
	jars=("$gradle_cache/$group/$artifact/$version"/*/"$artifact-$version.jar")
	if [ "${#jars[@]}" -ne 1 ] || [ ! -f "${jars[0]}" ]; then
		mismatch packages/gg-sandbox-kotlin/kotlin-version.sh "$coordinate" \
			"$artifact $(holding "$gradle_cache/$group/$artifact") in its Gradle cache"
	fi
	ln -s "${jars[0]}" "$kotlin_home/libs/$artifact-$version.jar"
done <<<"$KOTLIN_JARS"
echo "$KOTLIN_VERSION" >"$kotlin_home/libs/.kotlin-version"
echo "linked $(find "$kotlin_home/libs" -name '*.jar' | wc -l) jars into $kotlin_home/libs"

log "purs, YARD and componentize-py, which the images put where gg looks"
purs="${PURS_INSTALL_DIR:-$HOME/.local/bin}/purs"
held="$("$purs" --version 2>/dev/null || echo "no purs")"
[ "$held" = "$PURS_VERSION" ] ||
	mismatch packages/gg-sandbox-purescript/purescript-version.sh "purs $PURS_VERSION" "$held"
echo "purs $PURS_VERSION at $purs"
ruby -e 'gem "yard", ARGV[0]' "$YARD_VERSION" >/dev/null 2>&1 ||
	mismatch packages/gg-sandbox-ruby/yard-version.sh "yard $YARD_VERSION" \
		"$(ruby -e 'print Gem::Specification.find_all_by_name("yard").map(&:version).join(" ")' 2>/dev/null || true) in ${GEM_HOME:-no GEM_HOME}"
echo "yard $YARD_VERSION in ${GEM_HOME:-the default gem path}"
# What packages/gg-sandbox-python/build.sh runs, offline, which resolves to the installed tool.
held="$(uvx --offline --from "componentize-py==$COMPONENTIZE_VERSION" componentize-py --version 2>/dev/null || echo "no componentize-py")"
case "$held" in
*"$COMPONENTIZE_VERSION"*) ;;
*) mismatch packages/gg-sandbox-python/build.sh "componentize-py $COMPONENTIZE_VERSION" "$held" ;;
esac
echo "componentize-py $COMPONENTIZE_VERSION through uvx --offline"

log "gg's toolchains are linked to the template's images"
