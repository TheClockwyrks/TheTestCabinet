#!/usr/bin/env bash
# Install the Kotlin program language's toolchain — the embeddable Kotlin compiler and the
# jars it runs with — so a machine running gg's test suite has the same compiler a gg run
# container does (containers/gg-toolchains/Dockerfile). Pinned to the versions in
# packages/gg-sandbox-kotlin/kotlin-version.sh, so every machine agrees.
#
# THIS ARM RIDES THE JAVA ARM'S TOOLCHAIN. A Kotlin program is compiled to JVM bytecode and
# then translated to JavaScript by TeaVM, so it needs the JDK and the TeaVM jars
# scripts/ci/install-java.sh installs — and it needs the SAME ones, because the bytecode the
# Kotlin compiler writes and the bytecode TeaVM reads are one artifact. So this script runs
# that one first rather than installing a second JDK beside it. Both are idempotent.
#
# WHY A DIRECTORY OF ITS OWN. What is added here is ~67 MB of jars named on a classpath,
# and `crates/gg` looks for them under one prefix by name (see `find_toolchain` in
# crates/gg/src/sandbox/language/kotlin.compile.rs). They are NOT put in the Java arm's
# `libs` directory, and that is the whole reason the two are separate: everything in that
# directory goes on the classpath a Java program is compiled against, and a Java arm that
# silently gained Kotlin's compiler on its classpath would be an arm whose surface changed
# because a sibling language was installed.
#
# The jars are fetched straight from Maven Central rather than resolved by Maven. An
# install step that runs a dependency resolver is an install step whose result depends on
# the day it ran, and this arm's whole point is that two runs differ in the language and in
# nothing else.
#
# Idempotent: a matching version already installed (a developer's machine, a cache restore)
# is left alone.
#
# Usage:
#   scripts/ci/install-kotlin.sh                              # -> $HOME/.local/share/gg-kotlin
#   KOTLIN_INSTALL_DIR=/opt/gg/toolchains/kotlin scripts/ci/install-kotlin.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=packages/gg-sandbox-kotlin/kotlin-version.sh
source "$ROOT/packages/gg-sandbox-kotlin/kotlin-version.sh"

# The JDK and TeaVM, which this arm compiles through. JAVA_INSTALL_DIR is honoured by that
# script, so an image installing both under /opt/gg/toolchains gets one JDK there too.
"$ROOT/scripts/ci/install-java.sh"

INSTALL_DIR="${KOTLIN_INSTALL_DIR:-$HOME/.local/share/gg-kotlin}"
LIB_DIR="$INSTALL_DIR/libs"
STAMP="$LIB_DIR/.kotlin-version"
if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$KOTLIN_VERSION" ]; then
	echo "Kotlin $KOTLIN_VERSION already installed"
	exit 0
fi

fetch() {
	COORDINATE="$1"
	INTO="$2"
	GROUP="${COORDINATE%%:*}"
	REST="${COORDINATE#*:}"
	ARTIFACT="${REST%%:*}"
	VERSION="${REST#*:}"
	curl -sSfL \
		"https://repo1.maven.org/maven2/${GROUP//./\/}/${ARTIFACT}/${VERSION}/${ARTIFACT}-${VERSION}.jar" \
		-o "$INTO"
}

echo "Installing the Kotlin compiler $KOTLIN_VERSION -> $LIB_DIR"
rm -rf "$LIB_DIR"
mkdir -p "$LIB_DIR"
while read -r COORDINATE; do
	[ -n "$COORDINATE" ] || continue
	ARTIFACT="${COORDINATE#*:}"
	fetch "$COORDINATE" "$LIB_DIR/${ARTIFACT%%:*}-${COORDINATE##*:}.jar"
done <<<"$KOTLIN_JARS"

# The scripting plugin, under the file names the compiler looks for. NOT in `libs`: that
# directory is the driver's classpath, and these four are loaded by the compiler itself out
# of a "Kotlin home" whose layout is a distribution's rather than a repository's.
HOME_DIR="$INSTALL_DIR/kotlin-home/lib"
rm -rf "$INSTALL_DIR/kotlin-home"
mkdir -p "$HOME_DIR"
while read -r COORDINATE FILE; do
	[ -n "$COORDINATE" ] || continue
	fetch "$COORDINATE" "$HOME_DIR/$FILE"
done <<<"$KOTLIN_SCRIPTING_JARS"

echo "$KOTLIN_VERSION" >"$STAMP"
echo "$(find "$INSTALL_DIR" -name '*.jar' | wc -l) jars"
