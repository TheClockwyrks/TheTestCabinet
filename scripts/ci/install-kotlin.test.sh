#!/usr/bin/env bash
# Table test for install-kotlin.sh. Run it directly:
# scripts/ci/install-kotlin.test.sh
#
# A copy of the script runs in a throwaway repository whose kotlin-version.sh
# pins two jars, beside a stub install-java.sh that records it ran and a
# stand-in fetch.sh serving jars built here, with HOME in a temporary directory.
# The subject is that the Java arm's toolchain is installed first, the jars'
# URLs and names, and that a matching install is left alone.
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
mkdir -p "$repo/scripts/ci" "$repo/packages/gg-sandbox-kotlin" "$tmp/server"
cp "$CI_DIR/install-kotlin.sh" "$repo/scripts/ci/"
fake_fetch "$repo"
cat >"$repo/packages/gg-sandbox-kotlin/kotlin-version.sh" <<'EOF2'
KOTLIN_VERSION="2.4.10"
read -r -d '' KOTLIN_JARS <<'JARS' || true
org.jetbrains.kotlin:kotlin-compiler-embeddable:2.4.10
org.jetbrains:annotations:13.0
JARS
EOF2
cat >"$repo/scripts/ci/install-java.sh" <<'STUB'
#!/usr/bin/env bash
echo "install-java JAVA_INSTALL_DIR=${JAVA_INSTALL_DIR:-}" >>"$STUB_LOG"
exit "${STUB_JAVA_EXIT:-0}"
STUB
chmod +x "$repo/scripts/ci/install-java.sh"
printf 'jar' >"$tmp/server/kotlin-compiler-embeddable-2.4.10.jar"
printf 'jar' >"$tmp/server/annotations-13.0.jar"

run() { # home [env...]
	local home="$1"
	shift
	: >"$tmp/fetch.log"
	mkdir -p "$home"
	(cd "$tmp" && env -u KOTLIN_INSTALL_DIR -u JAVA_INSTALL_DIR HOME="$home" STUB_LOG="$tmp/fetch.log" \
		STUB_SERVER="$tmp/server" "$@" "$repo/scripts/ci/install-kotlin.sh" 2>&1)
}

home="$tmp/home"
out="$(run "$home")"
check_equal "a fresh install succeeds" "0" "$?"
check_equal "installs the Java arm's toolchain, then fetches each jar from Maven Central" \
	"install-java JAVA_INSTALL_DIR=
https://repo1.maven.org/maven2/org/jetbrains/kotlin/kotlin-compiler-embeddable/2.4.10/kotlin-compiler-embeddable-2.4.10.jar
https://repo1.maven.org/maven2/org/jetbrains/annotations/13.0/annotations-13.0.jar" "$(cat "$tmp/fetch.log")"
prefix="$home/.local/share/gg-kotlin"
check_exists "the jars sit in libs/, named artifact-version" "$prefix/libs/kotlin-compiler-embeddable-2.4.10.jar"
check_exists "every one of them" "$prefix/libs/annotations-13.0.jar"
check_equal "the Kotlin version is stamped" "2.4.10" "$(cat "$prefix/libs/.kotlin-version")"
check_contains "and the jars counted" "2 jars" "$out"

out="$(run "$home")"
check_equal "a second run succeeds" "0" "$?"
check_contains "leaving Kotlin alone" "Kotlin 2.4.10 already installed" "$out"
check_equal "after still asking the Java arm (which is idempotent itself)" \
	"install-java JAVA_INSTALL_DIR=" "$(cat "$tmp/fetch.log")"

out="$(run "$tmp/dir-home" KOTLIN_INSTALL_DIR="$tmp/opt/kotlin" JAVA_INSTALL_DIR="$tmp/opt/java")"
check_equal "the install directories are honoured" "0" "$?"
check_exists "KOTLIN_INSTALL_DIR as the prefix" "$tmp/opt/kotlin/libs/annotations-13.0.jar"
check_contains "and JAVA_INSTALL_DIR handed on" "install-java JAVA_INSTALL_DIR=$tmp/opt/java" "$(cat "$tmp/fetch.log")"

out="$(run "$tmp/fail-home" STUB_JAVA_EXIT=1)"
check_equal "a failed Java install fails" "1" "$?"
check_equal "before any jar is fetched" "install-java JAVA_INSTALL_DIR=" "$(cat "$tmp/fetch.log")"

echo
echo "install-kotlin.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
