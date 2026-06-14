// Prevent an extra console window from opening on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    test_cabinet_desktop_lib::run();
}
