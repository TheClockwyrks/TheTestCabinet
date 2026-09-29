"""Assert the devcontainer mounts the checkout where the container works.

The declaration is two files and neither can see the other's half.
`.devcontainer/devcontainer.json` states the folder the container works in and
names the compose file and the service; `.devcontainer/docker-compose.yml`
states what the container is run with, the checkout's mount among it. Without
the two agreeing, the devcontainer CLI mounts the checkout at its own directory
name, so a checkout directory named anything but this project's slug starts a
container whose working directory does not exist.

The check itself is `scripts/check-devcontainer.py`, which stays a script of
its own for two reasons: it reads `devcontainer.json` as the JSONC it is,
through `scripts/jsonc.py` beside it, and `scripts/check-devcontainer.test.sh`
drives it the way every other script under `scripts/` is driven. This gate is
what runs it.
"""

import sys

from the_test_cabinet_ci import enter_repo_root, run

# From the workspace root, so the script finds both halves of the declaration
# regardless of the caller's working directory.
enter_repo_root()

# The interpreter this gate runs under, rather than whichever `python3` the
# machine carries: the script is written to the same floor this project is.
# It says itself what is wrong with the declaration, so its exit code is the
# whole of what this gate adds.
sys.exit(run([sys.executable, "scripts/check-devcontainer.py"]).returncode)
