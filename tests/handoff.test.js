// Web only: the query string one tool hands to the next (Magnetic sort → CellTrace).
const test = require("node:test");
const assert = require("node:assert/strict");
const BM = require("../assets/bench.js");
const H = BM.handoff;

test("query drops missing and non-finite values and encodes the rest", () => {
  assert.equal(H.query({ density: 4e6, volume: 2.5, from: "CD8⁺ T cells", wells: null, cpw: undefined, x: NaN }),
    "density=4000000&volume=2.5&from=CD8%E2%81%BA%20T%20cells");
});

test("parse reads numbers with '.' decimals, keeps strings, and ignores other keys", () => {
  const got = H.parse("?density=4000000&volume=2.5&from=OT-I&evil=1&perwell=1e2", ["density", "volume", "from", "perwell"]);
  assert.deepEqual(got, { density: 4000000, volume: 2.5, from: "OT-I", perwell: 100 });
});

test("parse round-trips query and survives bad escapes", () => {
  const q = H.query({ density: 1.5e6, from: "OT-II", excess: 12.5 });
  assert.deepEqual(H.parse("?" + q, ["density", "from", "excess"]), { density: 1.5e6, from: "OT-II", excess: 12.5 });
  assert.deepEqual(H.parse("?density=%E0%A4%A&volume=2", ["density", "volume"]), { volume: 2 });
  assert.deepEqual(H.parse("", ["density"]), {});
});
