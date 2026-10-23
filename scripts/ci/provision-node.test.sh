#!/usr/bin/env bash
# Table test for scripts/ci/provision-node.sh. The script runs in a fixture tree holding
# its two libraries and the compose file the Node pin is read from, with `curl` and
# `uname` stubbed on PATH, so nothing is downloaded and nothing outside the temporary
# directory is touched.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly NODE="24.16.0"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

failures=0
passes=0
fail() {
	echo "FAIL: $*" >&2
	failures=$((failures + 1))
}
pass() {
	echo "  ok   $*"
	passes=$((passes + 1))
}

# A Node tarball shaped like nodejs.org's for each architecture, whose `node` prints its
# version.
for node_arch in x64 arm64; do
	mkdir -p "$work/tarball/node-v$NODE-linux-$node_arch/bin"
	printf '#!/bin/sh\necho v%s\n' "$NODE" >"$work/tarball/node-v$NODE-linux-$node_arch/bin/node"
	chmod +x "$work/tarball/node-v$NODE-linux-$node_arch/bin/node"
	tar -C "$work/tarball" -cJf "$work/node-$node_arch.tar.xz" "node-v$NODE-linux-$node_arch"
done

# The stubs: curl logs the URL and writes the tarball it names to its -o path; uname
# answers the machine the case declares.
mkdir -p "$work/bin"
cat >"$work/bin/curl" <<STUB
#!/usr/bin/env bash
out="" url=""
while [[ \$# -gt 0 ]]; do
	case "\$1" in
		-o) out="\$2"; shift 2 ;;
		http*) url="\$1"; shift ;;
		*) shift ;;
	esac
done
echo "\$url" >>"$work/curl.log"
case "\$url" in
	*-linux-x64.tar.xz) cp "$work/node-x64.tar.xz" "\$out" ;;
	*-linux-arm64.tar.xz) cp "$work/node-arm64.tar.xz" "\$out" ;;
	*) exit 22 ;;
esac
STUB
cat >"$work/bin/uname" <<'STUB'
#!/usr/bin/env bash
echo "${STUB_UNAME_M:-x86_64}"
STUB
chmod +x "$work/bin/curl" "$work/bin/uname"

fixture() { # name [NODE_VERSION line]
	local dir="$work/$1"
	mkdir -p "$dir/scripts/ci" "$dir/.devcontainer"
	cp "$here/provision-node.sh" "$here/lib.sh" "$here/tcab-lib.sh" "$dir/scripts/ci/"
	{
		echo "x-devcontainer-build-args: &devcontainer-build-args"
		[[ $# -lt 2 ]] || echo "  $2"
		echo "  RUST_VERSION: 1.97.1"
		echo "services: {}"
	} >"$dir/.devcontainer/docker-compose.yml"
	echo "$dir"
}

run() { # dir args... ; sets out and status
	local dir="$1"
	shift
	rm -f "$work/curl.log"
	status=0
	out="$(PATH="$work/bin:$PATH" "$dir/scripts/ci/provision-node.sh" "$@" 2>&1)" || status=$?
}

dir="$(fixture pinned "NODE_VERSION: $NODE")"
run "$dir" "$work/cache"
if [[ "$status" -eq 0 ]]; then
	pass "an empty directory is provisioned"
else
	fail "exited $status: $out"
fi
if [[ -x "$work/cache/node/bin/node" ]]; then
	pass "with node"
else
	fail "no node in the directory"
fi
if grep -qx "https://nodejs.org/dist/v$NODE/node-v$NODE-linux-x64.tar.xz" "$work/curl.log"; then
	pass "from the pinned x64 tarball"
else
	fail "fetched: $(cat "$work/curl.log")"
fi
if [[ "$out" == *"##vso[task.prependpath]$work/cache/node/bin"* ]]; then
	pass "and puts it on the job's PATH"
else
	fail "no prependpath: $out"
fi

run "$dir" "$work/cache"
if [[ "$status" -eq 0 && ! -e "$work/curl.log" ]]; then
	pass "a second run downloads nothing"
else
	fail "second run: $status, $(cat "$work/curl.log" 2>/dev/null)"
fi
if [[ "$out" == *"is already there"* && "$out" == *"##vso[task.prependpath]"* ]]; then
	pass "and still sets the PATH"
else
	fail "second run output: $out"
fi

STUB_UNAME_M=aarch64 run "$dir" "$work/arm"
if [[ "$status" -eq 0 ]] && grep -q "linux-arm64.tar.xz" "$work/curl.log"; then
	pass "an aarch64 machine takes the arm64 tarball"
else
	fail "arm64: $status: $out"
fi

STUB_UNAME_M=riscv64 run "$dir" "$work/riscv"
if [[ "$status" -eq 1 && "$out" == *"no Node build is published for riscv64"* ]]; then
	pass "a machine Node publishes nothing for fails, naming it"
else
	fail "riscv64: $status: $out"
fi

dir="$(fixture unpinned)"
run "$dir" "$work/unpinned"
if [[ "$status" -ne 0 && ! -e "$work/curl.log" ]]; then
	pass "a compose file without the pin fails before any download"
else
	fail "unpinned: $status: $out"
fi

run "$dir"
if [[ "$status" -eq 2 ]]; then
	pass "no directory is a usage error"
else
	fail "usage: $status"
fi

echo
echo "provision-node.test.sh: $passes passed, $failures failed"
[[ "$failures" -eq 0 ]]
