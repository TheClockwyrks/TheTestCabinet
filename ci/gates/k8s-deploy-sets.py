"""Render the staging and prod deploy sets and hold them to what may be applied.

The template's k8s-manifests gate checks what every overlay needs. This checks
what The Test Cabinet's Azure deployments add, through
`scripts/ci/k8s-deploy-sets.sh`: every overlay and every `cluster/*` bootstrap
renders; the set `scripts/ci/deploy-environment.sh --render` prints for staging
and prod, which is the overlay after `scripts/ci/pin-images.sh`, is namespaced
in `tcab-<env>` alone and names every Test Cabinet image, and the dispatcher's
run images, at the ACR and the commit (an image a repository of its own builds at
the commit its submodule pointer names), with no `REPLACE_` placeholder left; the
overlays on their own name every such image at `unpinned`; each
`cluster/azure-<env>` holds cluster-scoped objects alone; the staging set under
the template deploy.sh's own layer carries exactly the one backend image line
deploy.sh requires; and no manifest or overlay sets
`TCAB_K8S_RUN_MEMORY_LIMIT` or `TCAB_DISPATCHER_DRIVER_MEMORY_LIMIT`, since a
run pod carries a memory request and no limit.

It needs kubectl for its built-in kustomize and no cluster, and skips where
kubectl is absent, as k8s-manifests does.
"""

import shutil

from the_test_cabinet_ci import GIT_LOCATION_VARIABLES, enter_repo_root, fail, run, say, skip

enter_repo_root()

if shutil.which("kubectl") is None:
    skip("k8s-deploy-sets: skipped, kubectl is absent (the devcontainer installs it)")

if run(["scripts/ci/k8s-deploy-sets.sh"], unset=GIT_LOCATION_VARIABLES).returncode != 0:
    fail(
        "",
        "A deploy set is not what the deploy identity may apply, above. Reproduce a set with:",
        "    TCAB_PIN_GITLINKS='microservice-dispatcher=456789abcdef0123456789abcdef0123456789ab",
        "    microservice-repos=89abcdef0123456789abcdef0123456789abcdef' \\",
        "    scripts/ci/deploy-environment.sh --render staging 0123456789abcdef0123456789abcdef01234567",
    )

say("Every kustomization renders, and the staging and prod deploy sets are namespaced and pinned.")
