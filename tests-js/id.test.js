import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createId } from "../src/reader_service/static/id.js";

test("uses native UUID generation when available", () => {
  const expected = "b7876a9d-35bd-41df-a728-abd1d19186b7";
  assert.equal(createId({ randomUUID: () => expected }), expected);
});

test("LAN HTTP crypto without randomUUID generates independent UUID v4 IDs", () => {
  const insecureCrypto = { getRandomValues: bytes => webcrypto.getRandomValues(bytes) };
  const ids = Array.from({ length: 128 }, () => createId(insecureCrypto));
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(new Set(ids).size, ids.length);
});
