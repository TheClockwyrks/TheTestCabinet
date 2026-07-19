// Automated validation for the Info sub-item `shop-hover`.
//
// Hovering a shop tower shows that type's info panel in the inspector area
// (specs/reactor.md). We set the hovered shop tower through the debug API and read
// the hovered-shop state back, capturing the panel for the reviewer to read.

import { newGame } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("info.shop-hover");

  await newGame(api, "containment", "medium", 100000);
  await api.call("hoverShop", "lance");
  const s = await api.snapshot();

  check.expectEq("hovering the Lance shows its info panel", s.hoverShop, "lance");

  await api.wait(80);
  await api.screenshot("hover");
  return check.verdict();
}
