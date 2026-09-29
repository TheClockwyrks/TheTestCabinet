#!/usr/bin/env bash
# Hermetic test for devcontainer-setup.sh. Run it directly:
# ./scripts/devcontainer-setup.test.sh
#
# Each case builds a throwaway workspace holding a copy of the script, a
# devcontainer.json and stub installers, and a throwaway HOME, and puts stubs of
# sudo, apt-get, dpkg-query, npm and findmnt first on PATH. Nothing reaches the
# network, apt or the real /cargo-target. The script skips itself in CI, so every
# run that must not skip is made with the CI variables removed. A provisioner a
# case spawns is killed by the PID file it writes, with its process group.
set -uo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBJECT="$SCRIPTS_DIR/devcontainer-setup.sh"
REAL_NPM="$(command -v npm || true)"
pass=0
fail=0

ok() {
	pass=$((pass + 1))
	printf '  ok   %s\n' "$1"
}
bad() {
	fail=$((fail + 1))
	printf 'FAIL  %s\n' "$1"
	shift
	printf '        %s\n' "$@"
}
check() { # label condition-status detail
	if [ "$2" -eq 0 ]; then ok "$1"; else bad "$1" "${3:-}"; fi
}
check_contains() { # label needle haystack
	if grep -qF -- "$2" <<<"$3"; then
		ok "$1"
	else
		bad "$1" "expected output containing: $2" "got: ${3:-<empty>}"
	fi
}

tmp="$(mktemp -d)"
stubs="$tmp/stubs"
mkdir -p "$stubs"

kill_provisioners() {
	local pidfile pid
	for pidfile in "$tmp"/*/home/.cache/tcab-devcontainer-setup.pid; do
		[ -f "$pidfile" ] || continue
		pid="$(cat "$pidfile")"
		[ -n "$pid" ] || continue
		kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
	done
}
cleanup() {
	kill_provisioners
	rm -rf "$tmp"
}
trap cleanup EXIT

# ── stubs ───────────────────────────────────────────────────────────────────
# Every stub appends a line to $STUB_LOG, so a case reads what ran and in what
# order.

cat >"$stubs/sudo" <<'EOF'
#!/usr/bin/env bash
printf 'sudo %s\n' "$*" >>"$STUB_LOG"
[ "${STUB_SUDO_FAIL:-0}" = 1 ] && exit 1
[ "${1:-}" = -n ] && shift
exec "$@"
EOF
cat >"$stubs/apt-get" <<'EOF'
#!/usr/bin/env bash
printf 'apt-get %s\n' "$*" >>"$STUB_LOG"
EOF
cat >"$stubs/dpkg-query" <<'EOF'
#!/usr/bin/env bash
# Every package is missing unless STUB_PACKAGES_INSTALLED=1.
if [ "${STUB_PACKAGES_INSTALLED:-0}" = 1 ]; then printf 'install ok installed'; fi
EOF
cat >"$stubs/npm" <<'EOF'
#!/usr/bin/env bash
printf 'npm %s\n' "$*" >>"$STUB_LOG"
EOF
cat >"$stubs/findmnt" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "${STUB_FSTYPE:-xfs}"
EOF
chmod +x "$stubs"/*

# A workspace and a HOME of their own, with stub installers that log their
# call and then do what STUB_INSTALL says: `ok`, `fail` or `sleep`.
fresh() { # name
	local case_dir="$tmp/$1"
	mkdir -p "$case_dir/ws/scripts/ci" "$case_dir/ws/.devcontainer" "$case_dir/home" "$case_dir/links"
	cp "$SUBJECT" "$case_dir/ws/scripts/devcontainer-setup.sh"
	printf '{}\n' >"$case_dir/ws/.devcontainer/devcontainer.json"
	printf '[toolchain]\nchannel = "1.0.0"\n' >"$case_dir/ws/rust-toolchain.toml"
	local installer
	for installer in install-gg-toolchains install-gg-build-toolchains; do
		cat >"$case_dir/ws/scripts/ci/$installer.sh" <<EOF
#!/usr/bin/env bash
printf '%s\n' "$installer" >>"\$STUB_LOG"
case "\${STUB_INSTALL:-ok}" in
fail) exit 1 ;;
sleep) sleep 30 ;;
esac
EOF
	done
	: >"$case_dir/stub.log"
	CASE="$case_dir"
}

# Run the subject in the current case's workspace, as the dev container would,
# with the CI variables removed. Extra `VAR=value` arguments come first.
run_setup() { # [VAR=value...] [--] [args...]
	local assigns=()
	while [ $# -gt 0 ] && [[ "$1" == *=* ]]; do
		assigns+=("$1")
		shift
	done
	[ "${1:-}" = -- ] && shift
	(cd "$CASE/ws" && env -u TF_BUILD -u BUILD_BUILDID -u CI -u TCAB_SKIP_DEVCONTAINER_SETUP \
		-u CARGO_TARGET_DIR -u CARGO_HOME -u TCAB_CARGO_TARGET_RELOCATE \
		HOME="$CASE/home" PATH="$stubs:/usr/bin:/bin" STUB_LOG="$CASE/stub.log" \
		TCAB_DEVCONTAINER_WORKSPACE="$CASE/ws" TCAB_DEVCONTAINER_TEST_IN_CONTAINER=1 \
		TCAB_DEVCONTAINER_TEST_FSTYPE=xfs TCAB_CARGO_TARGET_LINK_ROOT="$CASE/links" \
		"${assigns[@]}" bash scripts/devcontainer-setup.sh "$@" >"$CASE/run.out" 2>&1)
	# Through a file rather than the substitution's pipe, so a provisioner that
	# kept the pipe open fails the pipe case below instead of hanging every case.
	cat "$CASE/run.out"
}

provisioner_starts() { grep -c 'provisioning started' "$CASE/home/.cache/tcab-devcontainer-setup.log" 2>/dev/null || true; }

# Wait up to five seconds for the case's provisioner to reach an installer.
wait_for_installer() {
	for _ in $(seq 50); do
		grep -q install-gg-toolchains "$CASE/stub.log" && return 0
		sleep 0.1
	done
	return 1
}

echo "=== skips ==="
fresh skip
out="$(run_setup TF_BUILD=True)"
check_contains "skips under TF_BUILD" "skipped: TF_BUILD is set" "$out"
out="$(run_setup CI=1)"
check_contains "skips under CI" "skipped: CI is set" "$out"
out="$(run_setup TCAB_SKIP_DEVCONTAINER_SETUP=1)"
check_contains "skips under TCAB_SKIP_DEVCONTAINER_SETUP" "skipped: TCAB_SKIP_DEVCONTAINER_SETUP is set" "$out"
out="$(run_setup TCAB_DEVCONTAINER_TEST_IN_CONTAINER=0)"
check_contains "skips outside a container" "skipped: not inside a container" "$out"
mkdir -p "$tmp/elsewhere"
out="$(run_setup TCAB_DEVCONTAINER_WORKSPACE="$tmp/elsewhere")"
check_contains "skips outside the workspace" "is not the dev container's workspace" "$out"
rm "$CASE/ws/.devcontainer/devcontainer.json"
out="$(run_setup)"
check_contains "skips a workspace without devcontainer.json" "is not the dev container's workspace" "$out"
if [ ! -e "$CASE/home/.cache" ] && [ ! -s "$CASE/stub.log" ]; then
	ok "a skip writes nothing"
else
	bad "a skip writes nothing" "$(ls -A "$CASE/home") / $(cat "$CASE/stub.log")"
fi

echo "=== the foreground returns at once, on a pipe ==="
fresh spawn
start=$SECONDS
(cd "$CASE/ws" && env -u TF_BUILD -u BUILD_BUILDID -u CI -u CARGO_TARGET_DIR \
	HOME="$CASE/home" PATH="$stubs:/usr/bin:/bin" STUB_LOG="$CASE/stub.log" STUB_INSTALL=sleep \
	STUB_PACKAGES_INSTALLED=1 TCAB_DEVCONTAINER_WORKSPACE="$CASE/ws" \
	TCAB_DEVCONTAINER_TEST_IN_CONTAINER=1 TCAB_DEVCONTAINER_TEST_FSTYPE=xfs \
	TCAB_CARGO_TARGET_LINK_ROOT="$CASE/links" \
	timeout 5 bash -c 'bash scripts/devcontainer-setup.sh 2>&1 | cat' >"$CASE/out")
status=$?
if [ "$status" -eq 0 ] && [ $((SECONDS - start)) -lt 5 ]; then
	ok "the foreground exits 0 within 5 s with its output on a pipe"
else
	bad "the foreground exits 0 within 5 s with its output on a pipe" "status $status after $((SECONDS - start)) s"
fi
check_contains "it names the recovery command" "run \`bash scripts/devcontainer-setup.sh\` again" "$(cat "$CASE/out")"
if wait_for_installer; then
	ok "the provisioner reaches the installer"
else
	bad "the provisioner reaches the installer" "$(cat "$CASE/stub.log")"
fi
out="$(run_setup STUB_INSTALL=sleep STUB_PACKAGES_INSTALLED=1)"
check_contains "a second call sees the running provisioner" "a provisioner is already running" "$out"
sleep 0.5
if [ "$(provisioner_starts)" = 1 ] && [ "$(grep -c install-gg-toolchains "$CASE/stub.log")" = 1 ]; then
	ok "exactly one provisioner runs"
else
	bad "exactly one provisioner runs" "starts: $(provisioner_starts)"
fi
if [ -f "$CASE/home/.cache/tcab-devcontainer-setup.pid" ]; then
	ok "the provisioner writes its PID file"
else
	bad "the provisioner writes its PID file"
fi
kill_provisioners

if [ -n "$REAL_NPM" ]; then
	fresh npm
	cat >"$CASE/ws/package.json" <<'EOF'
{
  "name": "devcontainer-setup-test",
  "private": true,
  "scripts": {
    "postinstall": "test ! -f scripts/devcontainer-setup.sh || bash scripts/devcontainer-setup.sh"
  }
}
EOF
	start=$SECONDS
	(cd "$CASE/ws" && env -u TF_BUILD -u BUILD_BUILDID -u CI -u CARGO_TARGET_DIR \
		HOME="$CASE/home" PATH="$stubs:$PATH" STUB_LOG="$CASE/stub.log" STUB_INSTALL=sleep \
		STUB_PACKAGES_INSTALLED=1 TCAB_DEVCONTAINER_WORKSPACE="$CASE/ws" \
		TCAB_DEVCONTAINER_TEST_IN_CONTAINER=1 TCAB_DEVCONTAINER_TEST_FSTYPE=xfs \
		TCAB_CARGO_TARGET_LINK_ROOT="$CASE/links" npm_config_cache="$CASE/npm-cache" \
		timeout 15 "$REAL_NPM" install --offline --no-audit --no-fund >"$CASE/out" 2>&1)
	status=$?
	check "npm install with the guarded postinstall returns within 15 s" "$status" \
		"status $status after $((SECONDS - start)) s: $(tail -n 5 "$CASE/out")"
	kill_provisioners
else
	echo "  --   npm is not on PATH; the npm install case is not run"
fi

echo "=== a current marker ==="
fresh marker
run_setup STUB_PACKAGES_INSTALLED=1 -- --provision >/dev/null
: >"$CASE/stub.log"
out="$(run_setup STUB_INSTALL=sleep)"
check_contains "a current marker reports provisioned" "provisioned (" "$out"
sleep 0.3
if ! grep -q install-gg "$CASE/stub.log" && [ ! -f "$CASE/home/.cache/tcab-devcontainer-setup.log" ]; then
	ok "a current marker spawns nothing"
else
	bad "a current marker spawns nothing" "$(cat "$CASE/stub.log")"
fi
printf '# a moved pin\n' >>"$CASE/ws/scripts/ci/install-gg-toolchains.sh"
out="$(run_setup STUB_INSTALL=sleep STUB_PACKAGES_INSTALLED=1)"
check_contains "a moved pin makes the marker stale" "provisioning in the background" "$out"
kill_provisioners

echo "=== --provision ==="
fresh provision
out="$(run_setup -- --provision)"
steps="$(grep -E '^(sudo -n env|install-gg|npm)' "$CASE/stub.log" | cut -d ' ' -f 1-4)"
expected="sudo -n env DEBIAN_FRONTEND=noninteractive
install-gg-toolchains
install-gg-build-toolchains
npm install -g --prefix"
if [ "$steps" = "$expected" ]; then
	ok "apt, both installers and wrangler run in order"
else
	bad "apt, both installers and wrangler run in order" "got: $steps"
fi
check_contains "apt runs under sudo -n" "sudo -n apt-get update -y" "$(cat "$CASE/stub.log")"
check_contains "apt installs ruby first" "apt-get install -y ruby libicu-dev ffmpeg cmake iproute2 lsof procps" "$(cat "$CASE/stub.log")"
check_contains "wrangler goes into ~/.local" "npm install -g --prefix $CASE/home/.local wrangler" "$(cat "$CASE/stub.log")"
if [ -s "$CASE/home/.cache/tcab-devcontainer-setup.done" ]; then
	ok "full success writes the marker"
else
	bad "full success writes the marker"
fi

fresh provision-fails
out="$(run_setup STUB_INSTALL=fail -- --provision)"
status=$?
check "a failing installer exits 0" "$status"
if [ ! -e "$CASE/home/.cache/tcab-devcontainer-setup.done" ]; then
	ok "a failing installer leaves no marker"
else
	bad "a failing installer leaves no marker"
fi
check_contains "a failing installer logs the command" "FAILED: bash scripts/ci/install-gg-toolchains.sh" "$out"
check_contains "a failing installer logs the rerun line" "run: bash scripts/devcontainer-setup.sh" "$out"
if grep -q install-gg-build-toolchains "$CASE/stub.log"; then
	bad "nothing runs after a failure" "$(cat "$CASE/stub.log")"
else
	ok "nothing runs after a failure"
fi

echo "=== the /cargo-target link ==="
fresh link
out="$(run_setup STUB_INSTALL=sleep STUB_PACKAGES_INSTALLED=1)"
check_contains "the link step uses sudo -n" "sudo -n ln -sfn $CASE/ws/target $CASE/links/the-test-cabinet" "$(cat "$CASE/stub.log")"
if [ "$(readlink "$CASE/links/the-test-cabinet")" = "$CASE/ws/target" ]; then
	ok "on xfs the link points at the checkout's target/"
else
	bad "on xfs the link points at the checkout's target/" "$(readlink "$CASE/links/the-test-cabinet")"
fi
if [ ! -e "$CASE/home/.cargo/config.toml" ] && [ ! -e "$CASE/home/.bashrc" ]; then
	ok "on xfs nothing is written"
else
	bad "on xfs nothing is written"
fi
kill_provisioners

fresh link-dir
mkdir -p "$CASE/links/the-test-cabinet"
out="$(run_setup STUB_INSTALL=sleep STUB_PACKAGES_INSTALLED=1)"
if [ -d "$CASE/links/the-test-cabinet" ] && [ ! -L "$CASE/links/the-test-cabinet" ]; then
	ok "a real directory is left alone"
else
	bad "a real directory is left alone"
fi
check_contains "a real directory is reported" "is a real directory, not a link; left untouched" "$out"
kill_provisioners

fresh link-sudo-fails
out="$(run_setup STUB_SUDO_FAIL=1 STUB_INSTALL=sleep STUB_PACKAGES_INSTALLED=1)"
check_contains "a failing sudo prints the manual command" \
	"sudo mkdir -p $CASE/links && sudo ln -sfn \"$CASE/ws/target\" $CASE/links/the-test-cabinet" "$out"
kill_provisioners

echo "=== relocating cargo's target on virtiofs ==="
fresh virtiofs
relocated="$CASE/home/.cache/cargo-target/the-test-cabinet"
run_setup TCAB_DEVCONTAINER_TEST_FSTYPE=virtiofs STUB_INSTALL=sleep STUB_PACKAGES_INSTALLED=1 >/dev/null
kill_provisioners
out="$(run_setup TCAB_DEVCONTAINER_TEST_FSTYPE=virtiofs STUB_INSTALL=sleep STUB_PACKAGES_INSTALLED=1)"
check_contains "it says why it relocates" "E0463" "$out"
config="$CASE/home/.cargo/config.toml"
if [ "$(grep -c '^target-dir = ' "$config")" = 1 ] && grep -qxF "target-dir = \"$relocated\"" "$config"; then
	ok "the cargo config block is written once over two runs"
else
	bad "the cargo config block is written once over two runs" "$(cat "$config" 2>/dev/null)"
fi
if [ "$(grep -c '^export CARGO_TARGET_DIR=' "$CASE/home/.bashrc")" = 1 ] &&
	grep -qxF "export CARGO_TARGET_DIR=\"$relocated\"" "$CASE/home/.bashrc"; then
	ok "the bashrc block is written once over two runs"
else
	bad "the bashrc block is written once over two runs" "$(cat "$CASE/home/.bashrc" 2>/dev/null)"
fi
if [ -d "$relocated" ] && [ "$(readlink "$CASE/links/the-test-cabinet")" = "$relocated" ]; then
	ok "the link points at the relocated target"
else
	bad "the link points at the relocated target" "$(readlink "$CASE/links/the-test-cabinet")"
fi
kill_provisioners

fresh virtiofs-foreign-build
mkdir -p "$CASE/home/.cargo"
printf '[build]\njobs = 4\n' >"$CASE/home/.cargo/config.toml"
out="$(run_setup TCAB_DEVCONTAINER_TEST_FSTYPE=virtiofs STUB_INSTALL=sleep STUB_PACKAGES_INSTALLED=1)"
if [ "$(cat "$CASE/home/.cargo/config.toml")" = "$(printf '[build]\njobs = 4')" ]; then
	ok "an existing [build] table is left alone"
else
	bad "an existing [build] table is left alone" "$(cat "$CASE/home/.cargo/config.toml")"
fi
check_contains "the line to add is printed" "target-dir = \"$CASE/home/.cache/cargo-target/the-test-cabinet\"" "$out"
kill_provisioners

fresh relocate-forbidden
out="$(run_setup TCAB_DEVCONTAINER_TEST_FSTYPE=virtiofs TCAB_CARGO_TARGET_RELOCATE=0 STUB_INSTALL=sleep STUB_PACKAGES_INSTALLED=1)"
if [ ! -e "$CASE/home/.cargo/config.toml" ] && [ "$(readlink "$CASE/links/the-test-cabinet")" = "$CASE/ws/target" ]; then
	ok "TCAB_CARGO_TARGET_RELOCATE=0 keeps target/ on virtiofs"
else
	bad "TCAB_CARGO_TARGET_RELOCATE=0 keeps target/ on virtiofs"
fi
kill_provisioners

fresh preset
out="$(run_setup TCAB_DEVCONTAINER_TEST_FSTYPE=virtiofs CARGO_TARGET_DIR=/somewhere STUB_INSTALL=sleep STUB_PACKAGES_INSTALLED=1)"
if [ ! -e "$CASE/home/.cargo/config.toml" ] && [ ! -e "$CASE/home/.bashrc" ] &&
	[ ! -e "$CASE/links/the-test-cabinet" ] && ! grep -q '^sudo' "$CASE/stub.log"; then
	ok "a preset CARGO_TARGET_DIR writes nothing and leaves the link alone"
else
	bad "a preset CARGO_TARGET_DIR writes nothing and leaves the link alone" "$(cat "$CASE/stub.log")"
fi
check_contains "a preset CARGO_TARGET_DIR is reported" "CARGO_TARGET_DIR is already /somewhere" "$out"
kill_provisioners

echo "=== a leftover lock ==="
fresh leftover-lock
mkdir -p "$CASE/home/.cache"
: >"$CASE/home/.cache/tcab-devcontainer-setup.lock"
out="$(run_setup STUB_INSTALL=sleep STUB_PACKAGES_INSTALLED=1)"
check_contains "a leftover lock with no holder spawns a provisioner" "provisioning in the background" "$out"
wait_for_installer
sleep 0.3
if [ "$(provisioner_starts)" = 1 ]; then
	ok "exactly one provisioner runs"
else
	bad "exactly one provisioner runs" "starts: $(provisioner_starts)"
fi
kill_provisioners

echo "=== devcontainer-setup: $pass passed, $fail failed ==="
[ "$fail" -eq 0 ]
