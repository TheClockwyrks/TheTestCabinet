#!/usr/bin/env bash
# Table test for scripts/ci/gg-ci-toolchains.sh. The script runs in a fixture
# tree whose installers are stubs, with `curl` and `ruby` stubbed on PATH and a
# temporary HOME, so nothing is downloaded and nothing outside the temporary
# directory is touched.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly NODE="24.16.0"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

failures=0
fail() {
	echo "FAIL: $*" >&2
	failures=$((failures + 1))
}

case "$(uname -m)" in
	x86_64 | amd64) node_arch=x64 ;;
	*) node_arch=arm64 ;;
esac

# A Node tarball shaped like nodejs.org's, whose `node` prints its version.
mkdir -p "$work/tarball/node-v$NODE-linux-$node_arch/bin"
printf '#!/bin/sh\necho v%s\n' "$NODE" >"$work/tarball/node-v$NODE-linux-$node_arch/bin/node"
chmod +x "$work/tarball/node-v$NODE-linux-$node_arch/bin/node"
tar -C "$work/tarball" -cJf "$work/node.tar.xz" "node-v$NODE-linux-$node_arch"

# The stubs: curl writes the tarball to its -o path and logs the URL; ruby answers Gem.user_dir.
mkdir -p "$work/bin"
cat >"$work/bin/curl" <<EOF
#!/usr/bin/env bash
out=""
while [[ \$# -gt 0 ]]; do
	case "\$1" in
		-o) out="\$2"; shift 2 ;;
		http*) echo "\$1" >>"$work/curl.log"; shift ;;
		*) shift ;;
	esac
done
cp "$work/node.tar.xz" "\$out"
EOF
cat >"$work/bin/ruby" <<'EOF'
#!/usr/bin/env bash
printf '%s' "$HOME/.gem/ruby/3.3.0"
EOF
chmod +x "$work/bin/curl" "$work/bin/ruby"

# A fixture checkout: the script and its two libraries, the compose file the Node pin is read
# from, and installers that record the HOME and PATH they ran with.
fixture() { # name [NODE_VERSION line]
	local dir="$work/$1"
	mkdir -p "$dir/scripts/ci" "$dir/.devcontainer"
	cp "$here/gg-ci-toolchains.sh" "$here/lib.sh" "$here/tcab-lib.sh" "$dir/scripts/ci/"
	{
		echo "x-devcontainer-build-args: &devcontainer-build-args"
		[[ $# -lt 2 ]] || echo "  $2"
		echo "  RUST_VERSION: 1.97.1"
		echo "services: {}"
	} >"$dir/.devcontainer/docker-compose.yml"
	for installer in install-gg-toolchains install-gg-build-toolchains; do
		cat >"$dir/scripts/ci/$installer.sh" <<-EOF
			#!/usr/bin/env bash
			echo "$installer HOME=\$HOME PATH=\$PATH" >>"$dir/installers.log"
			mkdir -p "\$HOME/.local/bin"
			touch "\$HOME/.local/bin/$installer"
		EOF
		chmod +x "$dir/scripts/ci/$installer.sh"
	done
	echo "$dir"
}

run() { # dir home args... ; sets out and status
	local dir="$1" home="$2"
	shift 2
	mkdir -p "$home"
	status=0
	out="$(env -u UV_PYTHON_INSTALL_DIR HOME="$home" PATH="$work/bin:$PATH" \
		"$dir/scripts/ci/gg-ci-toolchains.sh" "$@" 2>&1)" || status=$?
}

# 1. A full run on an empty cache: Node, the links, both installers, the PATH lines.
dir="$(fixture full "NODE_VERSION: $NODE")"
home="$work/full-home"
mkdir -p "$home/.cache/uv"
echo kept >"$home/.cache/uv/from-the-image"
run "$dir" "$home" "$work/cache"
[[ "$status" -eq 0 ]] || fail "full: exited $status: $out"
[[ -x "$work/cache/node/bin/node" ]] || fail "full: no node in the cache"
grep -q "nodejs.org/dist/v$NODE/node-v$NODE-linux-$node_arch.tar.xz" "$work/curl.log" ||
	fail "full: Node was not fetched from its official tarball"
for rel in .local .cache/uv .nuget .gem; do
	[[ -L "$home/$rel" && "$(readlink "$home/$rel")" == "$work/cache/home/$rel" ]] ||
		fail "full: $home/$rel is not a link to the cache"
done
[[ "$(cat "$work/cache/home/.cache/uv/from-the-image" 2>/dev/null)" == kept ]] ||
	fail "full: what the image had in .cache/uv was not merged into the cache"
[[ -e "$work/cache/home/.local/bin/install-gg-build-toolchains" ]] ||
	fail "full: the installers did not write through the link into the cache"
[[ "$(grep -c . "$dir/installers.log")" -eq 2 ]] || fail "full: the installers did not each run once"
head -n 1 "$dir/installers.log" | grep -q '^install-gg-toolchains ' ||
	fail "full: install-gg-toolchains.sh did not run first"
grep -q "PATH=$home/.local/bin:$work/cache/node/bin:" "$dir/installers.log" ||
	fail "full: the installers ran without .local/bin, then the cached Node, first on PATH"
[[ "$out" == *"##vso[task.prependpath]$work/cache/node/bin"* ]] || fail "full: no prependpath for Node"
[[ "$out" == *"##vso[task.prependpath]$home/.local/bin"* ]] || fail "full: no prependpath for .local/bin"

# 2. A second job on the warm cache with a fresh HOME: no download, the links made again.
: >"$work/curl.log"
home="$work/warm-home"
run "$dir" "$home" "$work/cache"
[[ "$status" -eq 0 ]] || fail "warm: exited $status: $out"
[[ ! -s "$work/curl.log" ]] || fail "warm: Node was downloaded again: $(cat "$work/curl.log")"
[[ -L "$home/.local" ]] || fail "warm: .local is not linked"
[[ -e "$home/.local/bin/install-gg-toolchains" ]] || fail "warm: the cached .local is not visible through the link"

# 3. --node-only: Node and its PATH line, and no installer and no link.
dir="$(fixture nodeonly "NODE_VERSION: $NODE")"
home="$work/nodeonly-home"
run "$dir" "$home" "$work/nodeonly-cache" --node-only
[[ "$status" -eq 0 ]] || fail "node-only: exited $status: $out"
[[ -x "$work/nodeonly-cache/node/bin/node" ]] || fail "node-only: no node in the cache"
[[ ! -e "$dir/installers.log" ]] || fail "node-only: an installer ran"
[[ ! -e "$home/.local" ]] || fail "node-only: .local was linked"
[[ "$out" == *"##vso[task.prependpath]$work/nodeonly-cache/node/bin"* ]] || fail "node-only: no prependpath for Node"
[[ "$out" != *".local/bin"* ]] || fail "node-only: prepended .local/bin"

# 4. A compose file that pins no Node is refused before anything is fetched.
: >"$work/curl.log"
dir="$(fixture nopin)"
run "$dir" "$work/nopin-home" "$work/nopin-cache"
[[ "$status" -ne 0 ]] || fail "no pin: exited 0"
[[ "$out" == *"NODE_VERSION"* ]] || fail "no pin: does not name NODE_VERSION: $out"
[[ ! -s "$work/curl.log" ]] || fail "no pin: downloaded something"
[[ ! -e "$dir/installers.log" ]] || fail "no pin: an installer ran"

# 5. Usage errors.
run "$dir" "$work/usage-home"
[[ "$status" -eq 2 ]] || fail "usage: no cache dir exited $status, wanted 2"
run "$dir" "$work/usage-home" "$work/x" --everything
[[ "$status" -eq 2 ]] || fail "usage: an unknown flag exited $status, wanted 2"

if [[ "$failures" -ne 0 ]]; then
	echo "gg-ci-toolchains.test.sh: $failures failure(s)" >&2
	exit 1
fi
echo "gg-ci-toolchains.test.sh: all cases passed"
