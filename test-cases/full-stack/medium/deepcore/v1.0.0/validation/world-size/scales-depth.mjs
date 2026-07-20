// Automated validation for world-size.scales-depth.
//
// Quick, Standard, and Marathon scale how deep the Core is (roughly half, reference, and double
// depth). We start an expedition at each size and read the Core chamber's row through findTile.

export default async function drive(api, ttc) {
  const check = ttc.checkOne("world-size.scales-depth");

  await api.reset({ seed: 1 });
  await api.call("startExpedition", "standard", "quick");
  const quick = await api.call("findTile", "core");

  await api.reset({ seed: 1 });
  await api.call("startExpedition", "standard", "standard");
  const standard = await api.call("findTile", "core");

  await api.reset({ seed: 1 });
  await api.call("startExpedition", "standard", "marathon");
  const marathon = await api.call("findTile", "core");

  check.expectEq("Quick is a half-depth mine", quick ? quick.row : null, 250);
  check.expectEq("Standard is the reference depth", standard ? standard.row : null, 500);
  check.expectEq("Marathon is a double-depth mine", marathon ? marathon.row : null, 1000);

  await api.wait(150);
  await api.screenshot("depths");
  return check.verdict();
}
