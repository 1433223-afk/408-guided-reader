import test from 'node:test';
import assert from 'node:assert/strict';
import {contentHorizontalBounds, rasterInkBounds, parseZoomPercent} from '../src/reader_service/static/reading-display.js';

function image(points = []) {
  const width = 100, height = 100;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const [x,y,r=0,g=0,b=0] of points) data.set([r,g,b,255],(y*width+x)*4);
  return {width,height,data};
}
const line = (left,right) => ({quad:[[left,.2],[right,.2],[right,.8],[left,.8]]});
const boundsEqual = (actual,expected) => expected.forEach((value,index) => assert.ok(Math.abs(actual[index]-value)<1e-9));

test('zoom accepts a positive percentage with an optional percent sign', () => {
  for (const [text,value] of [['125',1.25],['175%',1.75],[' 150 % ',1.5],['125.5%',1.255],['25',.25],['500%',5]]) {
    assert.equal(parseZoomPercent(text),value);
  }
});
test('invalid zoom text is not partially parsed', () => {
  for (const text of ['', '0', '-100', 'abc', '125oops', '150%%', '1e2', 'Infinity']) {
    assert.equal(parseZoomPercent(text),null);
  }
});

test('blank page stays unchanged rather than inventing a body region', () => {
  assert.equal(rasterInkBounds(image()),null);
  assert.equal(contentHorizontalBounds(image()),null);
});
test('body fitting includes a diagram outside the OCR text', () => {
  boundsEqual(contentHorizontalBounds(image([[12,75],[82,75]]),[line(.2,.7)]),[.1,.85]);
});
test('sparse colored marginal ink is retained even without OCR', () => {
  boundsEqual(contentHorizontalBounds(image([[2,50,230,240,250],[80,50]]),[line(.2,.7)]),[0,.83]);
});
test('OCR margin note survives when downsampled pixels miss its fine strokes', () => {
  assert.deepEqual(contentHorizontalBounds(image([[20,50],[80,50]]),[line(.04,.91)]),[.02,.93]);
});
test('a dark scan or full-width table stays full width', () => {
  assert.deepEqual(contentHorizontalBounds(image([[0,50],[99,50]]),[line(.2,.8)]),[0,1]);
});
