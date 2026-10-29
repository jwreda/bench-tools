// Ported from Tests/FormatTests.swift. Run all tests with: node --test web/tests
const test = require("node:test");
const assert = require("node:assert/strict");
const BM = require("../assets/bench.js");
const F = BM.format;

test("scientific shows only the digits the value carries", () => {
  assert.equal(F.scientific(2_000_000), "2.0 × 10⁶");
  assert.equal(F.scientific(2_460_000), "2.46 × 10⁶");
  assert.equal(F.scientific(1_234_000), "1.234 × 10⁶");
  assert.equal(F.scientific(100_000), "1.0 × 10⁵");
  assert.equal(F.scientific(30.1), "3.01 × 10¹");
});

test("scientific caps at four significant digits and renormalizes", () => {
  assert.equal(F.scientific(1_066_666.67), "1.067 × 10⁶");
  assert.equal(F.scientific(9_999_600), "1.0 × 10⁷");
  assert.equal(F.scientific(0), "0");
  assert.equal(F.scientific(5), "5.0");
});

test("volume and mass pick the largest readable unit", () => {
  assert.equal(F.volume(1.455e-3), "1.455 mL");
  assert.equal(F.volume(20e-6), "20.00 µL");
  assert.equal(F.volume(8.92e-3), "8.920 mL");
  assert.equal(F.volume(NaN), "— µL");
  assert.equal(F.volumeParts(720e-6).unit, "µL");
  assert.equal(F.mass(80e-6), "80.00 µg");
  assert.equal(F.mass(60.57), "60.57 g");
});

test("grouped digits", () => {
  assert.equal(F.grouped(100_000), "100,000");
  assert.equal(F.grouped(2_460_000), "2,460,000");
  assert.equal(F.grouped(1_234.5), "1,234.5");
});

test("number just under a decade", () => {
  assert.equal(F.number(9.999999999), "10.00");
  assert.equal(F.number(99.9999), "100.0");
  assert.equal(F.number(0.99999999), "1.000");
  assert.equal(F.number(9.99), "9.990");
});

test("number keeps four significant figures below one", () => {
  assert.equal(F.number(0.1234), "0.1234");
  assert.equal(F.number(0.01234), "0.01234");
  assert.equal(F.number(0.001234), "0.001234");
  assert.equal(F.number(0.005), "0.005000");
  assert.equal(F.number(0.0099996), "0.01000");
  assert.equal(F.number(-0.001234), "-0.001234");
  assert.equal(F.number(0), "0.0000");
  assert.equal(F.number(0.000999), "9.99 × 10⁻⁴");
});

test("editable is plain digits that parse back", () => {
  assert.equal(F.editable(5e-5, 6, "."), "0.00005");
  assert.equal(F.editable(10 / 3, 6, "."), "3.33333");
  assert.equal(F.editable(50, 6, "."), "50");
  assert.equal(F.editable(2_460_000, 6, "."), "2460000");
  assert.equal(F.editable(0, 6, "."), "0");
  assert.equal(F.editable(NaN, 6, "."), "");
  assert.equal(F.editable(0.25, 6, ","), "0,25");
  for (const value of [5e-5, 3.32225913621, 66_463, 0.001234]) {
    for (const sep of [".", ","]) {
      const text = F.editable(value, 6, sep);
      assert.ok(!text.includes("×"));
      const back = F.parse(text, sep);
      assert.ok(Math.abs(back - value) <= Math.abs(value) * 1e-5, `${value} via ${text}`);
    }
  }
});

test("comma region reads the comma as the decimal mark", () => {
  assert.equal(F.parse("0,5", ","), 0.5);
  assert.equal(F.parse(" 1 040 000 ", ","), 1_040_000);
  assert.equal(F.parse("1.000,5", ","), null);
});

test("point region reads grouping and refuses an ambiguous comma", () => {
  assert.equal(F.parse("0.5", "."), 0.5);
  assert.equal(F.parse("1,000,000", "."), 1_000_000);
  assert.equal(F.parse("0,5", "."), null);
  assert.equal(F.parse("", "."), null);
  assert.equal(F.parse("inf", "."), null);
  assert.equal(F.parse("2e6", "."), 2e6);
});

test("best display units", () => {
  assert.equal(BM.units.volume.best(0.00145).id, "mL");
  assert.equal(BM.units.volume.best(0).id, "uL");
  assert.equal(BM.units.molar.best(5e-5).id, "uM");
  assert.equal(BM.units.massConc.best(0.5).id, "ugPerML");
});
