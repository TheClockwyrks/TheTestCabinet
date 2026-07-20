// Automated validation for the States sub-item `mapselect`: the map-select screen is
// reachable (via the campaign start), and the debug API captures it.

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.mapselect");

  await api.reset();
  await api.call("goToMapSelect");
  await api.wait(150);
  check.expectEq("map select is reachable", (await api.snapshot()).screen, "mapselect");
  await api.screenshot("mapselect");

  return check.verdict();
}
