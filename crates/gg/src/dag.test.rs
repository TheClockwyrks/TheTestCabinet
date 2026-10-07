//! Tests for the shared blocked-by DAG reachability used by both tasks and the board.

use super::*;

/// A minimal [`DagNode`] for exercising the reachability search in isolation.
struct Node {
    id: String,
    blockers: Vec<String>,
}

impl Node {
    fn new(id: &str, blockers: &[&str]) -> Self {
        Self {
            id: id.to_string(),
            blockers: blockers.iter().map(|s| s.to_string()).collect(),
        }
    }
}

impl DagNode for Node {
    fn node_id(&self) -> &str {
        &self.id
    }

    fn blockers(&self) -> &[String] {
        &self.blockers
    }
}

fn nodes(defs: &[(&str, &[&str])]) -> Vec<Node> {
    defs.iter().map(|(id, b)| Node::new(id, b)).collect()
}

#[test]
fn depends_on_follows_edges_transitively() {
    // a -> b -> c (a blocked by b, b blocked by c).
    let g = nodes(&[("a", &["b"]), ("b", &["c"]), ("c", &[])]);
    assert!(depends_on(&g, "a", "b"));
    assert!(depends_on(&g, "a", "c"), "transitive reachability");
    assert!(
        depends_on(&g, "a", "a"),
        "a node depends on itself trivially"
    );
    assert!(!depends_on(&g, "c", "a"), "edges are directional");
}

#[test]
fn first_cycle_finds_the_offending_blocker_or_none() {
    // b already depends on a (b -> a). Blocking a on b would close a<->b, so `b` is the cycle.
    let g = nodes(&[("a", &[]), ("b", &["a"]), ("c", &[])]);
    assert_eq!(
        first_cycle(&g, "a", &["b".to_string()]),
        Some("b".to_string())
    );
    // Blocking a on c is acyclic (c depends on nothing).
    assert_eq!(first_cycle(&g, "a", &["c".to_string()]), None);
    // An empty proposed set can never cycle.
    assert_eq!(first_cycle(&g, "a", &[]), None);
}

#[test]
fn reachability_terminates_even_on_a_cyclic_graph() {
    // A defensively-constructed cycle (the stores never build one): a -> b -> a.
    let g = nodes(&[("a", &["b"]), ("b", &["a"])]);
    assert!(depends_on(&g, "a", "b"));
    assert!(!depends_on(&g, "a", "z"), "an absent target is unreachable");
}
