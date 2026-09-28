#!/usr/bin/env bash
# Table test for install-java.sh. Run it directly: scripts/ci/install-java.test.sh
#
# A copy of the script runs in a throwaway repository whose java-version.sh pins
# a JDK and two jars, with a stand-in fetch.sh serving tarballs and jars built
# here, `uname` stubbed to the machine the case declares, and HOME in a
# temporary directory. The subject is the URLs it fetches, the layout it
# installs, and that a matching install is left alone.
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
mkdir -p "$repo/scripts/ci" "$repo/packages/gg-sandbox-java" "$tmp/bin" "$tmp/server"
cp "$CI_DIR/install-java.sh" "$repo/scripts/ci/"
fake_fetch "$repo"
cat >"$repo/packages/gg-sandbox-java/java-version.sh" <<'EOF2'
JDK_VERSION="21.0.12+8"
TEAVM_VERSION="0.13.1"
read -r -d '' TEAVM_JARS <<'JARS' || true
org.teavm:teavm-core:0.13.1
org.ow2.asm:asm-tree:9.8
JARS
EOF2
cat >"$tmp/bin/uname" <<'STUB'
#!/usr/bin/env bash
echo "${STUB_UNAME_M:-x86_64}"
STUB
chmod +x "$tmp/bin/uname"

# A JDK tarball shaped like Temurin's, one per architecture, whose java reports the pin.
for arch in x64 aarch64; do
	jdk="$tmp/build/$arch/jdk-21.0.12+8"
	mkdir -p "$jdk/bin"
	printf '#!/bin/sh\necho "openjdk version \\"21.0.12\\" 2025-07-15" >&2\n' >"$jdk/bin/java"
	printf '#!/bin/sh\n' >"$jdk/bin/javac"
	chmod +x "$jdk/bin/java" "$jdk/bin/javac"
	tar -C "$tmp/build/$arch" -czf "$tmp/server/OpenJDK21U-jdk_${arch}_linux_hotspot_21.0.12_8.tar.gz" jdk-21.0.12+8
done
printf 'jar' >"$tmp/server/teavm-core-0.13.1.jar"
printf 'jar' >"$tmp/server/asm-tree-9.8.jar"

run() { # home [env...]
	local home="$1"
	shift
	: >"$tmp/fetch.log"
	mkdir -p "$home"
	(cd "$tmp" && env -u JAVA_INSTALL_DIR HOME="$home" STUB_LOG="$tmp/fetch.log" STUB_SERVER="$tmp/server" \
		PATH="$tmp/bin:$PATH" "$@" "$repo/scripts/ci/install-java.sh" 2>&1)
}

home="$tmp/home"
out="$(run "$home")"
check_equal "a fresh install succeeds" "0" "$?"
check_equal "fetches the pinned Temurin, then each jar from Maven Central" \
	"https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12%2B8/OpenJDK21U-jdk_x64_linux_hotspot_21.0.12_8.tar.gz
https://repo1.maven.org/maven2/org/teavm/teavm-core/0.13.1/teavm-core-0.13.1.jar
https://repo1.maven.org/maven2/org/ow2/asm/asm-tree/9.8/asm-tree-9.8.jar" "$(cat "$tmp/fetch.log")"
prefix="$home/.local/share/gg-java"
check_exists "the JDK is unpacked one level down" "$prefix/jdk/bin/javac"
check_exists "the jars sit in libs/" "$prefix/libs/teavm-core-0.13.1.jar"
check_exists "every one of them" "$prefix/libs/asm-tree-9.8.jar"
check_equal "the TeaVM version is stamped" "0.13.1" "$(cat "$prefix/libs/.teavm-version")"
check_contains "and the jars counted" "2 jars" "$out"

out="$(run "$home")"
check_equal "a second run succeeds" "0" "$?"
check_contains "leaving the JDK alone" "Temurin 21.0.12+8 already installed" "$out"
check_contains "and TeaVM" "TeaVM 0.13.1 already installed" "$out"
check_equal "without fetching" "" "$(cat "$tmp/fetch.log")"

echo "0.12.0" >"$prefix/libs/.teavm-version"
printf 'stale' >"$prefix/libs/teavm-core-0.12.0.jar"
out="$(run "$home")"
check_equal "another TeaVM stamp is reinstalled" "0" "$?"
check_equal "fetching the jars alone" "2" "$(grep -c 'repo1.maven.org' "$tmp/fetch.log")"
check_lacks "and not the JDK" "temurin" "$(cat "$tmp/fetch.log")"
check_absent "the old jars go" "$prefix/libs/teavm-core-0.12.0.jar"

out="$(run "$tmp/arm-home" STUB_UNAME_M=aarch64)"
check_equal "an aarch64 install succeeds" "0" "$?"
check_contains "with the aarch64 build" "OpenJDK21U-jdk_aarch64_linux_hotspot_21.0.12_8.tar.gz" "$(cat "$tmp/fetch.log")"

out="$(run "$tmp/dir-home" JAVA_INSTALL_DIR="$tmp/opt/java")"
check_equal "JAVA_INSTALL_DIR is honoured" "0" "$?"
check_exists "as the prefix" "$tmp/opt/java/jdk/bin/javac"
check_absent "and nothing lands under HOME" "$tmp/dir-home/.local"

out="$(run "$tmp/odd-home" STUB_UNAME_M=riscv64)"
check_equal "an unknown machine fails" "1" "$?"
check_contains "naming it" "no pinned Temurin build for riscv64." "$out"
check_equal "without fetching" "" "$(cat "$tmp/fetch.log")"

echo
echo "install-java.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
