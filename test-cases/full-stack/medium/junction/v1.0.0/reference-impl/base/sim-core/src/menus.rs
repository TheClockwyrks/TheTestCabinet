// Junction — menu definitions (specs/flow.md "Required menus", DESIGN §4, §5.2), ported
// from `menus.ts`.
//
// The single source of truth for each state's menu items. Under the Rust/wasm boundary the
// simulation core OWNS the menus and the keyboard-nav index (specs/simulation.md): the front
// end reads the list to draw it, moves the highlight with the arrow keys / pointer, and
// confirms an item — all through the boundary — while the item's action is dispatched here.

use crate::mode::MODE;
use crate::types::GameState;

pub struct MenuItem {
    pub label: String,
    pub action: &'static str,
}

/// The navigable menu for a state; empty for the in-play states that have no list menu.
pub fn menu_items(state: GameState) -> Vec<MenuItem> {
    match state {
        GameState::Title => vec![
            MenuItem { label: MODE.menu_label.to_string(), action: "menu:play" },
            MenuItem { label: "HOW TO PLAY".to_string(), action: "menu:howto" },
        ],
        GameState::Howto => vec![MenuItem { label: "BACK".to_string(), action: "menu:back" }],
        GameState::Paused => vec![
            MenuItem { label: "RESUME".to_string(), action: "menu:resume" },
            MenuItem { label: "RESTART".to_string(), action: "menu:restart" },
            MenuItem { label: "QUIT TO MENU".to_string(), action: "menu:quit" },
        ],
        GameState::Bankrupt => vec![
            MenuItem { label: "TRY AGAIN".to_string(), action: "menu:again" },
            MenuItem { label: "MENU".to_string(), action: "menu:menu" },
        ],
        GameState::Playing => Vec::new(),
    }
}
