#!/usr/bin/env bash
# Table test for check-devcontainer.py. Run it directly:
# ./check-devcontainer.test.sh
#
# Each case builds a throwaway tree holding the check, the JSONC reader beside
# it and a declaration the case writes, so the subject is the verdict the check
# reaches for a pair of files: the folder one states and the mount the other
# does. The pair the template renders is checked as it stands, so a render that
# moved one half without the other fails here rather than in a container that
# comes up without its working directory. A configuration under a
# subdirectory, which lists the compose file and an override of its own, is
# read against its own directory and held to the default's declaration.
set -uo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPTS_DIR/.." && pwd)"
pass=0
fail=0

ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad() {
	fail=$((fail + 1))
	printf 'FAIL  %s\n' "$1"
	shift
	printf '        %s\n' "$@"
}

check_passed() { # label status output
	if [ "$2" -eq 0 ]; then
		ok "$1"
	else
		bad "$1" "expected exit 0" "got exit $2: ${3:-<empty>}"
	fi
}

check_failed() { # label status
	if [ "$2" -ne 0 ]; then
		ok "$1"
	else
		bad "$1" "expected a non-zero exit" "got exit 0"
	fi
}

check_contains() { # label needle haystack
	if grep -qF -- "$2" <<<"$3"; then
		ok "$1"
	else
		bad "$1" "expected output containing: $2" "got: ${3:-<empty>}"
	fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# A tree holding the check, a devcontainer.json and a compose file.
fresh_tree() { # devcontainer-json-text compose-text
	local tree
	tree="$(mktemp -d "$tmp/treeXXXXXX")"
	mkdir -p "$tree/scripts" "$tree/.devcontainer"
	cp "$SCRIPTS_DIR/check-devcontainer.py" "$SCRIPTS_DIR/jsonc.py" "$tree/scripts/"
	printf '%s\n' "$1" >"$tree/.devcontainer/devcontainer.json"
	printf '%s\n' "$2" >"$tree/.devcontainer/docker-compose.yml"
	printf '%s' "$tree"
}

# Runs the check in $1 from /, so it resolves the declaration from its own
# path rather than from the caller's working directory.
run() { # tree
	(
		cd / || exit 1
		python3 "$1/scripts/check-devcontainer.py" 2>&1
	)
}

DECLARATION='{
  // A comment, which the format allows.
  "name": "Demo",
  "dockerComposeFile": "docker-compose.yml",
  "service": "dev",
  "workspaceFolder": "/workspaces/demo",
}'

COMPOSE='services:
  dev:
    build:
      context: .
      dockerfile: ./ubuntu.dockerfile
    command: sleep infinity
    volumes:
      # The checkout.
      - ..:/workspaces/demo:rw
      - /var/run/docker.sock:/run/host/runtime.sock
  other:
    volumes:
      - ..:/elsewhere:rw'

echo "--- the declaration the template renders ---"

tree="$(fresh_tree "$DECLARATION" "$COMPOSE")"
out="$(run "$tree")"
check_passed "a folder the service mounts the checkout at passes" $? "$out"

# The rendered pair itself, read where this test sits, so the workspace this
# runs in is held to the same thing the cases below state.
out="$(cd / && python3 "$REPO_ROOT/scripts/check-devcontainer.py" 2>&1)"
check_passed "this workspace's own devcontainer.json and compose file agree" $? "$out"

echo "--- a mount and a folder that disagree ---"

tree="$(fresh_tree "$DECLARATION" 'services:
  dev:
    volumes:
      - ..:/workspaces/elsewhere:rw')"
out="$(run "$tree")"
check_failed "a service mounting the checkout at another path fails" $?
check_contains "names where it is mounted" "mounts this checkout at /workspaces/elsewhere" "$out"
check_contains "names the folder it works in" "/workspaces/demo" "$out"

tree="$(fresh_tree "$DECLARATION" 'services:
  dev:
    volumes:
      - cargo-target:/cargo-target')"
out="$(run "$tree")"
check_failed "a service mounting the checkout nowhere fails" $?
check_contains "says so" "mounts this checkout nowhere" "$out"

echo "--- a declaration that cannot be read ---"

tree="$(fresh_tree "$DECLARATION" "$COMPOSE")"
rm "$tree/.devcontainer/docker-compose.yml"
out="$(run "$tree")"
check_failed "a named compose file that is absent fails" $?
check_contains "says it is absent" "docker-compose.yml is absent" "$out"

tree="$(fresh_tree "$DECLARATION" 'services:
  app:
    volumes:
      - ..:/workspaces/demo:rw')"
out="$(run "$tree")"
check_failed "a compose file declaring no such service fails" $?
check_contains "names the service" "declares no dev service" "$out"

tree="$(fresh_tree '{"service": "dev", "workspaceFolder": "/workspaces/demo"}' "$COMPOSE")"
out="$(run "$tree")"
check_failed "a declaration naming no compose file fails" $?
check_contains "says so" "dockerComposeFile" "$out"

tree="$(fresh_tree '{"dockerComposeFile": "docker-compose.yml", "workspaceFolder": "/workspaces/demo"}' "$COMPOSE")"
out="$(run "$tree")"
check_failed "a declaration naming no service fails" $?
check_contains "says so" "service is None" "$out"

tree="$(fresh_tree '{"dockerComposeFile": "docker-compose.yml", "service": "dev"}' "$COMPOSE")"
out="$(run "$tree")"
check_failed "a declaration with no workspace folder fails" $?
check_contains "says so" "workspaceFolder is missing" "$out"

tree="$(fresh_tree '{"service": "dev",' "$COMPOSE")"
out="$(run "$tree")"
check_failed "a declaration that is not JSON fails" $?

tree="$(fresh_tree "$DECLARATION" "$COMPOSE")"
rm "$tree/.devcontainer/devcontainer.json"
out="$(run "$tree")"
check_failed "an absent declaration fails" $?
check_contains "says it is absent" "is absent" "$out"

echo "--- a configuration under a subdirectory ---"

NAMED='{
  "name": "Demo (NVIDIA GPU)",
  "dockerComposeFile": ["../docker-compose.yml", "../docker-compose.nvidia.yml"],
  "service": "dev",
  "workspaceFolder": "/workspaces/demo",
}'

OVERRIDE='services:
  dev:
    devices:
      - nvidia.com/gpu=all'

# Adds a configuration named $2 to the tree $1, listing an override written
# as $3 beside the compose file when given.
named_configuration() { # tree declaration-text [override-text]
	mkdir -p "$1/.devcontainer/nvidia"
	printf '%s\n' "$2" >"$1/.devcontainer/nvidia/devcontainer.json"
	if [ $# -gt 2 ]; then
		printf '%s\n' "$3" >"$1/.devcontainer/docker-compose.nvidia.yml"
	fi
}

tree="$(fresh_tree "$DECLARATION" "$COMPOSE")"
named_configuration "$tree" "$NAMED" "$OVERRIDE"
out="$(run "$tree")"
check_passed "a configuration listing the compose file and an override from its own directory passes" $? "$out"

tree="$(fresh_tree "$DECLARATION" "$COMPOSE")"
named_configuration "$tree" "$NAMED"
out="$(run "$tree")"
check_failed "a configuration whose override is absent fails" $?
check_contains "names the override" "docker-compose.nvidia.yml is absent" "$out"
check_contains "names the configuration" "nvidia/devcontainer.json declares the container in it" "$out"

tree="$(fresh_tree "$DECLARATION" "$COMPOSE")"
named_configuration "$tree" "$NAMED" 'services:
  app:
    devices:
      - nvidia.com/gpu=all'
out="$(run "$tree")"
check_failed "a configuration whose override declares no such service fails" $?
check_contains "names the service" "declares no dev service" "$out"

tree="$(fresh_tree "$DECLARATION" "$COMPOSE")"
named_configuration "$tree" "$NAMED" 'services:
  dev:
    volumes:
      - ..:/workspaces/elsewhere:rw'
out="$(run "$tree")"
check_failed "an override moving the checkout fails" $?
check_contains "names where it is mounted" "mounts this checkout at /workspaces/elsewhere" "$out"

tree="$(fresh_tree "$DECLARATION" "$COMPOSE")"
named_configuration "$tree" '{
  "name": "Demo (NVIDIA GPU)",
  "dockerComposeFile": ["../docker-compose.yml", "../docker-compose.nvidia.yml"],
  "service": "dev",
  "workspaceFolder": "/workspaces/demo",
  "postCreateCommand": "bash .devcontainer/post-create.sh",
}' "$OVERRIDE"
out="$(run "$tree")"
check_failed "a configuration declaring what the default does not fails" $?
check_contains "names the key" "declares postCreateCommand, which" "$out"

tree="$(fresh_tree '{
  "name": "Demo",
  "dockerComposeFile": "docker-compose.yml",
  "service": "dev",
  "workspaceFolder": "/workspaces/demo",
  "postStartCommand": "bash .devcontainer/post-start.sh",
}' "$COMPOSE")"
named_configuration "$tree" "$NAMED" "$OVERRIDE"
out="$(run "$tree")"
check_failed "a configuration lacking what the default declares fails" $?
check_contains "names the key" "declares no postStartCommand, which" "$out"

tree="$(fresh_tree '{
  "name": "Demo",
  "dockerComposeFile": "docker-compose.yml",
  "service": "dev",
  "workspaceFolder": "/workspaces/demo",
  "postStartCommand": "bash .devcontainer/post-start.sh",
}' "$COMPOSE")"
named_configuration "$tree" '{
  "name": "Demo (NVIDIA GPU)",
  "dockerComposeFile": ["../docker-compose.yml", "../docker-compose.nvidia.yml"],
  "service": "dev",
  "workspaceFolder": "/workspaces/demo",
  "postStartCommand": "bash .devcontainer/tools/host-runtime.sh",
}' "$OVERRIDE"
out="$(run "$tree")"
check_failed "a configuration declaring a key differently from the default fails" $?
check_contains "names the key" "postStartCommand is not what" "$out"

tree="$(fresh_tree "$DECLARATION" "$COMPOSE")"
named_configuration "$tree" '{
  "name": "Demo (NVIDIA GPU)",
  "dockerComposeFile": ["../docker-compose.nvidia.yml"],
  "service": "dev",
  "workspaceFolder": "/workspaces/demo",
}' 'services:
  dev:
    volumes:
      - ..:/workspaces/demo:rw
    devices:
      - nvidia.com/gpu=all'
out="$(run "$tree")"
check_failed "a configuration not merging over the default's compose file fails" $?
check_contains "says so" "its compose files start with" "$out"

tree="$(fresh_tree '{
  "name": "Demo",
  "dockerComposeFile": ["docker-compose.yml", "docker-compose.extra.yml"],
  "service": "dev",
  "workspaceFolder": "/workspaces/demo",
}' "$COMPOSE")"
printf '%s\n' 'services:
  dev:
    init: true' >"$tree/.devcontainer/docker-compose.extra.yml"
named_configuration "$tree" "$NAMED" "$OVERRIDE"
out="$(run "$tree")"
check_failed "a configuration leaving out one of the default's compose files fails" $?
check_contains "says so" "its compose files start with" "$out"

tree="$(fresh_tree '{
  "name": "Demo",
  "dockerComposeFile": ["docker-compose.yml", "docker-compose.extra.yml"],
  "service": "dev",
  "workspaceFolder": "/workspaces/demo",
}' "$COMPOSE")"
printf '%s\n' 'services:
  dev:
    init: true' >"$tree/.devcontainer/docker-compose.extra.yml"
named_configuration "$tree" '{
  "name": "Demo (NVIDIA GPU)",
  "dockerComposeFile": ["../docker-compose.yml", "../docker-compose.extra.yml", "../docker-compose.nvidia.yml"],
  "service": "dev",
  "workspaceFolder": "/workspaces/demo",
}' "$OVERRIDE"
out="$(run "$tree")"
check_passed "a configuration listing every one of the default's compose files before its own passes" $? "$out"

tree="$(fresh_tree "$DECLARATION" "$COMPOSE")"
named_configuration "$tree" '{"service": "dev",' "$OVERRIDE"
out="$(run "$tree")"
check_failed "a configuration that is not JSON fails" $?
check_contains "names it" "nvidia/devcontainer.json is not valid JSON" "$out"

echo "--- no bytecode cache is written ---"

tree="$(fresh_tree "$DECLARATION" "$COMPOSE")"
run "$tree" >/dev/null
if [ -e "$tree/scripts/__pycache__" ]; then
	bad "importing the reader leaves no __pycache__ in the tree" "found $tree/scripts/__pycache__"
else
	ok "importing the reader leaves no __pycache__ in the tree"
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
