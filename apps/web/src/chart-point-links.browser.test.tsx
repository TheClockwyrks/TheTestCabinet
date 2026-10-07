import {
  Chart,
  distributionChart,
  type DistributionGroup,
} from "@clockwyrks/ui";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

/*
 * The figure is an image to assistive technology, so its marks have no roles to
 * query by, and an SVG link names its address in `xlink:href`, which no Testing
 * Library query reads. The points are therefore found in the figure's own nodes.
 */
/* eslint-disable testing-library/no-node-access */

/**
 * What a click on a distribution chart's run point reaches in a real browser.
 *
 * Each raw point of a comparison's Cost, Tokens and Session duration charts is
 * drawn inside a link to its run. The chart also raises a tooltip for the point
 * under the pointer, and when the tooltip has no room on the far side of the
 * point it opens over the point itself, which is what happens to the leftmost
 * arm. Whether the click then reaches the link or the tooltip is the browser's
 * hit-testing to decide, on a laid-out figure, so jsdom cannot state it.
 */

/** Run ids of the length the cabinet mints, which is what sizes the tooltip. */
type ArmRuns = readonly [string, string, string];
const LEFT_RUNS: ArmRuns = [
  "mtme95gpr0uijdl5l93ewrlr",
  "vgg7vuq111e1wr738d93inhw",
  "xji5c6sp9d98yst2p9iar394",
];
const RIGHT_RUNS: ArmRuns = [
  "z11uc7zj3wvbi81b02s8ih1q",
  "ntsij333yhjjxywiz0igci97",
  "z11utathp70urus4no0500xp",
];

/**
 * One arm's distribution over its three runs' values, given lowest first, each
 * point linked to its run.
 */
function group(
  label: string,
  [first, second, third]: ArmRuns,
  [low, middle, high]: readonly [number, number, number],
): DistributionGroup {
  return {
    label,
    n: 3,
    points: [
      { runId: first, value: low, href: `/runs/${first}` },
      { runId: second, value: middle, href: `/runs/${second}` },
      { runId: third, value: high, href: `/runs/${third}` },
    ],
    median: middle,
    mean: (low + middle + high) / 3,
    min: low,
    max: high,
    q1: low,
    q3: high,
    ciLow: low,
    ciHigh: high,
  };
}

const GROUPS = [
  group("OpenAI Codex · gpt-5.5", LEFT_RUNS, [0.42, 0.61, 0.88]),
  group("Pi · anthropic/claude-haiku-4.5", RIGHT_RUNS, [0.18, 0.2, 0.31]),
];

const CHART_TITLE = "Cost per run";

/** The address a point's link names, whichever attribute the engine reads. */
function linkTarget(link: Element): string | null {
  return (
    link.getAttribute("href") ??
    link.getAttributeNS("http://www.w3.org/1999/xlink", "href")
  );
}

/**
 * Draws the chart and answers the point linked to `href`, with the links the
 * page's clicks reach collected into `reached`. A reached link is not followed:
 * following it would load a document over the test's own.
 */
async function drawChart(href: string, reached: string[]): Promise<Element> {
  render(
    <Chart
      title={CHART_TITLE}
      spec={(palette) => distributionChart(GROUPS, palette, { y: "USD" })}
    />,
  );
  const figure = screen.getByRole("img", { name: CHART_TITLE });
  figure.addEventListener("click", (event) => {
    event.preventDefault();
    const link = (event.target as Element).closest("a");
    const target = link ? linkTarget(link) : null;
    if (target != null) reached.push(target);
  });
  const link = await waitFor(() => {
    const found = [...figure.querySelectorAll("a")].find(
      (a) => linkTarget(a) === href,
    );
    expect(found).toBeDefined();
    return found as Element;
  });
  const point = link.querySelector("circle");
  expect(point).not.toBeNull();
  return point as Element;
}

describe("a distribution chart's run points", () => {
  it.each([...LEFT_RUNS, ...RIGHT_RUNS])(
    "opens run %s when its point is clicked",
    async (runId) => {
      const href = `/runs/${runId}`;
      const reached: string[] = [];
      const point = await drawChart(href, reached);

      await userEvent.click(point);

      expect(reached).toEqual([href]);
    },
  );
});
