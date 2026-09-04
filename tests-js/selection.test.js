import assert from "node:assert/strict";
import test from "node:test";

import {
  nearestCellBoundary, nearestLine, resolveSelection, resolvedText, selectionRanges,
} from "../src/reader_service/static/selection.js";

const lines = [
  {
    line_ordinal: 0,
    quad: [[0.1, 0.1], [0.7, 0.1], [0.7, 0.2], [0.1, 0.2]],
    text: "总线DMA",
    cells: [
      [0.1, 0.2, 0, 1], [0.2, 0.3, 1, 2], [0.3, 0.4, 2, 3],
      [0.4, 0.5, 3, 4], [0.5, 0.6, 4, 5],
    ],
  },
  {
    line_ordinal: 1,
    quad: [[0.12, 0.3], [0.6, 0.3], [0.6, 0.4], [0.12, 0.4]],
    text: "Cache缺失",
    cells: [
      [0.12, 0.28, 0, 5], [0.28, 0.36, 5, 6], [0.36, 0.44, 6, 7],
    ],
  },
];

test("hit testing snaps to a line and anonymous cell boundary", () => {
  assert.equal(nearestLine(lines, 0.35).line_ordinal, 1);
  assert.equal(nearestCellBoundary(lines[0], 0.49), 4);
});

test("cross-line selection is represented as per-line ranges", () => {
  const anchor = { lineOrdinal: 0, boundary: 1 };
  const focus = { lineOrdinal: 1, boundary: 2 };
  const ranges = selectionRanges(lines, anchor, focus);
  assert.deepEqual(ranges.map((range) => [range.line.line_ordinal, range.cellStart, range.cellEnd]), [
    [0, 1, 5], [1, 0, 2],
  ]);
  const resolved = resolveSelection(lines, anchor, focus);
  assert.equal(resolvedText(resolved), "线DMA\nCache缺");
  assert.deepEqual(resolved[0].quads[0], [[0.2, 0.1], [0.6, 0.1], [0.6, 0.2], [0.2, 0.2]]);
});

test("backward selection resolves identically", () => {
  assert.deepEqual(
    resolveSelection(lines, { lineOrdinal: 1, boundary: 2 }, { lineOrdinal: 0, boundary: 1 }),
    resolveSelection(lines, { lineOrdinal: 0, boundary: 1 }, { lineOrdinal: 1, boundary: 2 }),
  );
});
