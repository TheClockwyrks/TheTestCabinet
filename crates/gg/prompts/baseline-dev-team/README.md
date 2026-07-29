# Configuration: Baseline Dev Team

The baseline dev team configuration cleanly splits responsibilities. A PM
(project manager) agent generates issues, which are then handled by a coder
agent. A reviewer agent reviews the coder agent's work and approves or rejects
the changes. The common folder's merge agent prompt is then used for handling
merge conflicts.
