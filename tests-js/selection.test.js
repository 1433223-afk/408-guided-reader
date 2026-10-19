import assert from "node:assert/strict";
import test from "node:test";

import {
  cellIndexAt, nearestCellBoundary, nearestLine, resolveSelection, resolvedText, selectionPresentationQuads,
  selectionRanges,
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
  assert.equal(nearestLine(lines, 0.3, 0.35).line_ordinal, 1);
  assert.equal(nearestCellBoundary(lines[0], 0.49), 4);
});

test('cell hit testing selects both halves of the touched cell rather than the next insertion boundary', () => {
  assert.equal(cellIndexAt(lines[0], .11, .15), 0);
  assert.equal(cellIndexAt(lines[0], .19, .15), 0);
  assert.equal(nearestCellBoundary(lines[0], .19, .15), 1);
  assert.equal(cellIndexAt(lines[0], .21, .15), 1);
  assert.equal(cellIndexAt(lines[0], .29, .15), 1);
  assert.equal(cellIndexAt(lines[0], 0, .15), 0);
  assert.equal(cellIndexAt(lines[0], 1, .15), 4);
});

test('cell hit testing uses the nearest OCR cell through gaps and keeps grouped characters intact', () => {
  const fragmented = {quad: [[.1,.1],[.5,.1],[.5,.2],[.1,.2]], text: 'CacheAB',
    cells: [[.1,.2,0,5],[.3,.4,5,6],[.42,.5,6,7]]};
  assert.equal(cellIndexAt(fragmented, .18, .15), 0);
  assert.equal(cellIndexAt(fragmented, .23, .15), 0);
  assert.equal(cellIndexAt(fragmented, .28, .15), 1);
  assert.equal(cellIndexAt(fragmented, .41, .15), 1);
  assert.equal(cellIndexAt({...fragmented,cells:[]}, .2, .15), -1);
  assert.equal(cellIndexAt(fragmented, NaN, .15), -1);
});

test("hit testing distinguishes OCR fragments on the same visual row", () => {
  const toc = [
    {
      line_ordinal: 0,
      quad: [[0.248, 0.368], [0.333, 0.368], [0.333, 0.386], [0.248, 0.386]],
      text: "存储系统",
      cells: [[0.259, 0.278, 0, 1], [0.279, 0.298, 1, 2]],
    },
    {
      line_ordinal: 1,
      quad: [[0.2, 0.369], [0.26, 0.369], [0.26, 0.386], [0.2, 0.386]],
      text: "6.2.1",
      cells: [[0.205, 0.243, 0, 5]],
    },
  ];
  const number = nearestLine(toc, 0.22, 0.378);
  assert.equal(number.text, "6.2.1");
  assert.equal(nearestCellBoundary(number, 0.205), 0);
  assert.equal(nearestCellBoundary(number, 0.243), 1);
  assert.equal(resolveSelection(toc, { lineOrdinal: 1, boundary: 0 }, { lineOrdinal: 1, boundary: 1 })[0].text, "6.2.1");
});

test("vertical OCR lines use pointer Y for precise anonymous-cell boundaries", () => {
  const vertical = {
    line_ordinal: 41,
    quad: [[0.825, 0.09], [0.933, 0.09], [0.933, 0.546], [0.825, 0.546]],
    text: "本书配套资源介绍",
    cells: Array.from({ length: 8 }, (_value, index) => [0.824, 0.932, index, index + 1]),
  };

  assert.equal(nearestCellBoundary(vertical, 0.87, 0.09), 0);
  assert.equal(nearestCellBoundary(vertical, 0.87, 0.318), 4);
  assert.equal(nearestCellBoundary(vertical, 0.87, 0.546), 8);
  assert.equal(cellIndexAt(vertical, .87, .10), 0);
  assert.equal(cellIndexAt(vertical, .87, .14), 0);
  assert.equal(cellIndexAt(vertical, .87, .17), 1);
  assert.equal(cellIndexAt(vertical, .87, .31), 3);
  assert.equal(cellIndexAt(vertical, .87, .55), 7);

  const selected = resolveSelection(
    [vertical],
    { lineOrdinal: 41, boundary: 2 },
    { lineOrdinal: 41, boundary: 5 },
  );
  assert.equal(selected[0].text, "配套资");
  assert.deepEqual(selected[0].quads[0].map(([x, y]) => [x, Number(y.toFixed(6))]), [
    [0.824, 0.204], [0.932, 0.204], [0.932, 0.375], [0.824, 0.375],
  ]);
});

test("tall horizontal fragments keep X-based hit testing", () => {
  const narrowHorizontal = {
    line_ordinal: 0,
    quad: [[0.1, 0.1], [0.2, 0.1], [0.2, 0.3], [0.1, 0.3]],
    text: "AB",
    cells: [[0.1, 0.15, 0, 1], [0.15, 0.2, 1, 2]],
  };
  assert.equal(nearestCellBoundary(narrowHorizontal, 0.2, 0.1), 2);
  assert.equal(cellIndexAt(narrowHorizontal, .19, .1), 1);
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

test("presentation merges only adjacent selected fragments on the same visual row", () => {
  const resolved = [
    { quads: [[[0.2, 0.1], [0.26, 0.1], [0.26, 0.12], [0.2, 0.12]]] },
    { quads: [[[0.255, 0.101], [0.4, 0.101], [0.4, 0.121], [0.255, 0.121]]] },
    { quads: [[[0.8, 0.1], [0.9, 0.1], [0.9, 0.12], [0.8, 0.12]]] },
    { quads: [[[0.2, 0.14], [0.5, 0.14], [0.5, 0.16], [0.2, 0.16]]] },
  ];
  assert.deepEqual(selectionPresentationQuads(resolved), [
    [[0.2, 0.1], [0.4, 0.1], [0.4, 0.121], [0.2, 0.121]],
    [[0.8, 0.1], [0.9, 0.1], [0.9, 0.12], [0.8, 0.12]],
    [[0.2, 0.14], [0.5, 0.14], [0.5, 0.16], [0.2, 0.16]],
  ]);
  assert.equal(resolved[0].quads[0][1][0], 0.26, "presentation must not mutate resolved geometry");
});
