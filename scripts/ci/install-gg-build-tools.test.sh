#!/usr/bin/env bash
# Table test for install-gg-build-tools.sh. Run it directly:
# scripts/ci/install-gg-build-tools.test.sh
#
# A copy of the script runs in a throwaway repository whose version files pin
# every tool, beside stand-ins for scripts/gg-npm-tools.sh, scripts/gg-downloads.sh
# and fetch.sh that record what they are asked for; the stand-in npm tool
# directory for spago holds a `spago` that records where and how it ran. `npm`,
# `uv`, `uvx` and `cargo` are stubs, and PATH otherwise holds only the few
# commands the script runs, so which of them is present is the case's to say.
# The subject is every tool warmed with its pin, the opal gem unpacked once, and
# each missing prerequisite.
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
mkdir -p "$repo/scripts/ci" "$repo/packages/gg-sandbox-ruby" "$repo/packages/gg-sandbox-purescript" \
	"$repo/packages/gg-sandbox-swift" "$repo/packages/gg-sandbox-python" "$tmp/server"
cp "$CI_DIR/install-gg-build-tools.sh" "$CI_DIR/tcab-lib.sh" "$repo/scripts/ci/"
fake_fetch "$repo"
cat >"$repo/scripts/gg-npm-tools.sh" <<'EOF2'
gg_npm_tool() {
	echo "npm-tool $1 $2" >>"$STUB_LOG"
	local dir="$STUB_TOOLS/$1-$2"
	mkdir -p "$dir/node_modules/.bin"
	cat >"$dir/node_modules/.bin/spago" <<'SPAGO'
#!/usr/bin/env bash
echo "spago $* [XDG_CACHE_HOME=$XDG_CACHE_HOME files=$(echo *)]" >>"$STUB_LOG"
SPAGO
	chmod +x "$dir/node_modules/.bin/spago"
	echo "$dir"
}
EOF2
cat >"$repo/scripts/gg-downloads.sh" <<'EOF2'
gg_spago_cache() { echo "$STUB_TOOLS/spago-cache-$1"; }
gg_swift_libraries_dir() { echo "$STUB_TOOLS/swift-libraries"; }
gg_swift_library() { echo "swift-library $1 $2 $3" >>"$STUB_LOG"; }
EOF2
cat >"$repo/packages/gg-sandbox-ruby/opal-version.sh" <<'EOF2'
OPAL_COMPILER_VERSION="3.0.0"
OPAL_VERSION="1.7.3"
COMPONENTIZE_VERSION="0.21.0"
EOF2
printf 'SPAGO_VERSION="1.0.4"\nREGISTRY_VERSION="66.2.0"\n' >"$repo/packages/gg-sandbox-purescript/purescript-version.sh"
printf 'workspace: {}\n' >"$repo/packages/gg-sandbox-purescript/spago.yaml"
printf 'lock: {}\n' >"$repo/packages/gg-sandbox-purescript/spago.lock"
cat >"$repo/packages/gg-sandbox-swift/swift-version.sh" <<'EOF2'
GG_SWIFT_COLLECTIONS_VERSION="1.2.1"
GG_SWIFT_ALGORITHMS_VERSION="1.2.2"
GG_SWIFT_NUMERICS_VERSION="1.0.3"
gg_swift_collections_url() { echo "https://example.com/swift-collections/$GG_SWIFT_COLLECTIONS_VERSION.tar.gz"; }
gg_swift_algorithms_url() { echo "https://example.com/swift-algorithms/$GG_SWIFT_ALGORITHMS_VERSION.tar.gz"; }
gg_swift_numerics_url() { echo "https://example.com/swift-numerics/$GG_SWIFT_NUMERICS_VERSION.tar.gz"; }
EOF2
printf '#!/usr/bin/env bash\nCOMPONENTIZE_VERSION="0.25.0"\n' >"$repo/packages/gg-sandbox-python/build.sh"
printf 'numpy==2.3.0\n' >"$repo/packages/gg-sandbox-python/requirements.txt"

# The opal gem: a tar holding data.tar.gz, which holds the stdlib.
mkdir -p "$tmp/build/gem-data/stdlib"
printf 'x' >"$tmp/build/gem-data/stdlib/json.rb"
tar -C "$tmp/build/gem-data" -czf "$tmp/build/data.tar.gz" stdlib
printf '{}' >"$tmp/build/metadata.gz"
tar -C "$tmp/build" -cf "$tmp/server/opal-1.7.3.gem" metadata.gz data.tar.gz

# PATH: only the commands the script and the stand-ins run, and each stub the case includes.
mkdir -p "$tmp/min" "$tmp/npm" "$tmp/uv" "$tmp/cargo"
for tool in bash cat chmod cp dirname gzip mkdir mktemp rm sed tar; do
	ln -s "$(command -v "$tool")" "$tmp/min/$tool"
done
printf '#!/usr/bin/env bash\nexit 0\n' >"$tmp/npm/npm"
cat >"$tmp/uv/uv" <<'STUB'
#!/usr/bin/env bash
echo "uv $*" >>"$STUB_LOG"
STUB
cat >"$tmp/uv/uvx" <<'STUB'
#!/usr/bin/env bash
echo "uvx $*" >>"$STUB_LOG"
STUB
cat >"$tmp/cargo/cargo" <<'STUB'
#!/usr/bin/env bash
echo "cargo $*" >>"$STUB_LOG"
STUB
chmod +x "$tmp/npm/npm" "$tmp/uv/uv" "$tmp/uv/uvx" "$tmp/cargo/cargo"
readonly ALL="$tmp/npm:$tmp/uv:$tmp/cargo:$tmp/min"

run() { # path [env...]
	local path="$1"
	shift
	: >"$tmp/calls.log"
	(cd "$tmp" && /usr/bin/env -i HOME="$tmp/home" STUB_LOG="$tmp/calls.log" STUB_SERVER="$tmp/server" \
		STUB_TOOLS="$tmp/tools" PATH="$path" "$@" "$repo/scripts/ci/install-gg-build-tools.sh" 2>&1)
}

gem_dir="$tmp/home/.local/share/tcab/gg-opal-1.7.3"
out="$(run "$ALL")"
check_equal "a full run succeeds" "0" "$?"
calls="$(sed "s|$tmp|TMP|g; s|files=.*]|files=...]|" "$tmp/calls.log" | grep -v '^uv pip')"
check_equal "warms every tool at its pin, in order" \
	"npm-tool @bytecodealliance/componentize-js 0.21.0
npm-tool opal-compiler 3.0.0
https://rubygems.org/downloads/opal-1.7.3.gem
npm-tool spago 1.0.4
spago install [XDG_CACHE_HOME=TMP/tools/spago-cache-66.2.0 files=...]
swift-library swift-collections 1.2.1 https://example.com/swift-collections/1.2.1.tar.gz
swift-library swift-algorithms 1.2.2 https://example.com/swift-algorithms/1.2.2.tar.gz
swift-library swift-numerics 1.0.3 https://example.com/swift-numerics/1.0.3.tar.gz
uvx --quiet --from componentize-py==0.25.0 componentize-py --help
cargo fetch --locked --manifest-path TMP/repo/packages/gg-sandbox-rust/Cargo.toml
cargo fetch --locked --manifest-path TMP/repo/packages/gg-sandbox/guest/Cargo.toml" "$calls"
check_contains "spago installs from the arm's own manifest and lock" "files=spago.lock spago.yaml]" \
	"$(grep '^spago' "$tmp/calls.log")"
check_contains "the python arm's wheels go through uv, into uv's cache" "-r $repo/packages/gg-sandbox-python/requirements.txt" \
	"$(grep '^uv pip install --quiet --target ' "$tmp/calls.log")"
check_exists "the opal gem's stdlib is unpacked" "$gem_dir/stdlib/json.rb"
check_contains "ending on the summary" "gg's package-manager-delivered build tools are warm" "$out"

out="$(run "$ALL")"
check_equal "a second run succeeds" "0" "$?"
check_contains "leaving the opal gem alone" "opal gem 1.7.3 already unpacked at $gem_dir" "$out"
check_lacks "without fetching it" "rubygems.org" "$(cat "$tmp/calls.log")"

out="$(run "$tmp/npm:$tmp/uv:$tmp/min")"
check_equal "no cargo still succeeds" "0" "$?"
check_contains "warning that the crate sets were not fetched" "no \`cargo\` on PATH, so the rust arm's crate set" "$out"

out="$(run "$tmp/npm:$tmp/cargo:$tmp/min")"
check_equal "no uv fails" "1" "$?"
check_contains "naming the installer that provides it" "Run scripts/ci/install-uv.sh first" "$out"
check_lacks "before the python arm" "uvx" "$(cat "$tmp/calls.log")"

out="$(run "$tmp/uv:$tmp/cargo:$tmp/min")"
check_equal "no npm fails" "1" "$?"
check_contains "saying why" "no \`npm\` on PATH." "$out"
check_equal "before anything is warmed" "" "$(cat "$tmp/calls.log")"

printf '#!/usr/bin/env bash\n' >"$repo/packages/gg-sandbox-python/build.sh"
out="$(run "$ALL")"
check_equal "a python arm with no componentize-py pin fails" "1" "$?"
check_contains "naming the file" "could not read COMPONENTIZE_VERSION out of packages/gg-sandbox-python/build.sh." "$out"

echo
echo "install-gg-build-tools.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
