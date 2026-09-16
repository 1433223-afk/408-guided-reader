import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizedPointToPdf,
  normalizedRectToPdf,
  pdfPointToNormalized,
  pdfRectToNormalized,
} from "../src/reader_service/static/geometry.js";

const boxes = [
  [0, 0, 612, 792],
  [25, -40, 525, 660],
  [-200, 100, 800, 500],
];

for (const mediaBox of boxes) {
  for (const rotation of [0, 90, 180, 270]) {
    test(`point round-trip: box=${mediaBox.join(",")} rotation=${rotation}`, () => {
      const [x0, y0, x1, y1] = mediaBox;
      const points = [
        { x: x0, y: y0 },
        { x: x1, y: y1 },
        { x: x0 + (x1 - x0) * 0.317, y: y0 + (y1 - y0) * 0.823 },
      ];
      for (const point of points) {
        const normalized = pdfPointToNormalized(point, mediaBox, rotation);
        assert.ok(normalized.x >= 0 && normalized.x <= 1);
        assert.ok(normalized.y >= 0 && normalized.y <= 1);
        const restored = normalizedPointToPdf(normalized, mediaBox, rotation);
        assert.ok(Math.abs(restored.x - point.x) < 1e-10);
        assert.ok(Math.abs(restored.y - point.y) < 1e-10);
      }
    });

    test(`rect round-trip: box=${mediaBox.join(",")} rotation=${rotation}`, () => {
      const [x0, y0, x1, y1] = mediaBox;
      const rect = {
        x0: x0 + (x1 - x0) * 0.12,
        y0: y0 + (y1 - y0) * 0.23,
        x1: x0 + (x1 - x0) * 0.78,
        y1: y0 + (y1 - y0) * 0.91,
      };
      const normalized = pdfRectToNormalized(rect, mediaBox, rotation);
      const restored = normalizedRectToPdf(normalized, mediaBox, rotation);
      for (const key of ["x0", "y0", "x1", "y1"]) {
        assert.ok(Math.abs(restored[key] - rect[key]) < 1e-10, `${key} did not round-trip`);
      }
    });
  }
}

test("rotation changes normalized top-left orientation", () => {
  const box = [10, 20, 110, 220];
  assert.deepEqual(pdfPointToNormalized({ x: 10, y: 220 }, box, 0), { x: 0, y: 0 });
  assert.deepEqual(pdfPointToNormalized({ x: 10, y: 20 }, box, 90), { x: 0, y: 0 });
  assert.deepEqual(pdfPointToNormalized({ x: 110, y: 20 }, box, 180), { x: 0, y: 0 });
  assert.deepEqual(pdfPointToNormalized({ x: 110, y: 220 }, box, 270), { x: 0, y: 0 });
});
