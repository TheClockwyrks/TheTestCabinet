//! The shared **blocked-by DAG** machinery reused by the two tiers of gg work tracking:
//! the lightweight [task list](crate::tasks) and the heavyweight
//! [epic/issue board](crate::board).
//!
//! Both tiers model work as nodes carrying a set of *blocked-by* ids, and both must keep
//! that relation **acyclic** — gg rejects any edge that would introduce a cycle. The
//! reachability search that enforces this is identical for tasks and issues, so it lives here
//! once and each store reuses it rather than mirroring it. A store still owns its own
//! existence/self-block checks and its own error type (their messages are node-kind specific);
//! this module owns only the graph reachability that answers *would this edge close a loop?*.
//!
//! A node is anything that exposes a [`node_id`](DagNode::node_id) and its
//! [`blockers`](DagNode::blockers). [`first_cycle`] tests a proposed blocked-by set against
//! the current node slice and returns the first blocker that would close a cycle (leaving the
//! caller to refuse the mutation with its own error), or `None` when the edges are all
//! acyclic.

use std::collections::BTreeSet;

/// A node of a blocked-by DAG: it has a stable id and a set of ids it is blocked by.
///
/// Implemented by both [`Task`](crate::tasks::Task) and [`Issue`](crate::board::Issue) so the
/// [cycle check](first_cycle) is written once over `&[N]`.
pub trait DagNode {
    /// The node's stable id — the handle every blocked-by edge references.
    fn node_id(&self) -> &str;
    /// The ids of the nodes this one is blocked by.
    fn blockers(&self) -> &[String];
}

/// Whether `from` depends on `target` — i.e. `target` is reachable from `from` by following
/// blocked-by edges across `nodes`.
///
/// A depth-first search with a visited set, so it terminates even if the stored graph were
/// somehow inconsistent (a defensive guard; the stores keep it acyclic).
pub fn depends_on<N: DagNode>(nodes: &[N], from: &str, target: &str) -> bool {
    let mut stack: Vec<&str> = vec![from];
    let mut seen: BTreeSet<&str> = BTreeSet::new();
    while let Some(current) = stack.pop() {
        if current == target {
            return true;
        }
        if !seen.insert(current) {
            continue;
        }
        if let Some(node) = nodes.iter().find(|node| node.node_id() == current) {
            for blocker in node.blockers() {
                stack.push(blocker);
            }
        }
    }
    false
}

/// The first blocker in `blockers` that already depends on `subject` — meaning blocking
/// `subject` on it would close a cycle — or `None` when every proposed edge is acyclic.
///
/// Because the stored graph is always acyclic, a new blocked-by edge can only create a cycle
/// by pointing at a node that (transitively) already depends on `subject`; each candidate
/// blocker is tested with [`depends_on`]. The returned id is owned so the caller can build its
/// error without borrowing `blockers`.
pub fn first_cycle<N: DagNode>(nodes: &[N], subject: &str, blockers: &[String]) -> Option<String> {
    blockers
        .iter()
        .find(|blocker| depends_on(nodes, blocker, subject))
        .cloned()
}

#[cfg(test)]
#[path = "dag.test.rs"]
mod tests;
