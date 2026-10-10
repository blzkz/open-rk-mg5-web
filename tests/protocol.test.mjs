// Run with: node --test tests/
// Reference values come from the desktop app's rk_mg5/protocol.py.

import assert from "node:assert/strict";
import { test } from "node:test";

import * as a from "../js/actions.js";
import * as p from "../js/protocol.js";

const hex = (bytes) => Buffer.from(bytes).toString("hex");

test("frames match the desktop implementation", () => {
  const cases = [
    [[0x47, 1, 0, []], "985000014700000000000000"],
    [[0x4f, 2, 0x83, []], "245000024f83000000000000"],
    [[0x35, 49, 1, [0x55]], "0d5001313501550000000000"],
    [[0x3a, 80, 0, [0x26, 0x0f, 0, 255, 0, 0]], "145006503a00260f00ff0000"],
    [[0x30, 32, 8, [0x05, 0x04, 0, 0]], "b55004203008050400000000"],
  ];
  for (const [args, expected] of cases) {
    const frame = p.buildFrame(...args);
    assert.equal(frame.length, p.REPORT_LEN);
    assert.equal(hex(frame.slice(0, 12)), expected);
  }
});

test("DPI encoding", () => {
  assert.deepEqual([50, 800, 26000, 30000, 30050, 42000, 10, 50000].map(p.encodeDpi), [0, 15, 519, 599, 30050, 42000, 0, 42000]);
  assert.deepEqual([0, 15, 519, 599, 30050, 42000, 50000].map(p.decodeDpi), [50, 800, 26000, 30000, 30050, 42000, 42000]);
});

test("config block parsing", () => {
  const raw = new Uint8Array(64);
  raw[p.OFF_REPORT_RATE] = 0x44; // 8000 Hz
  raw[p.OFF_DPI_LEVEL] = 0x26; // level 2 of 6
  raw[p.OFF_LOD] = 2;
  raw[p.OFF_DEBOUNCE] = 5;
  raw[p.OFF_PERFORMANCE] = 0x50 | p.PERF_GLASS_MODE;
  raw[p.OFF_SLEEP] = 4;
  raw.set([0x0b, 0x00], p.OFF_DPI_VALUES + 2); // level 2: 600 DPI
  raw.set([0xff, 0x00, 0x00], p.OFF_DPI_COLORS + 3);
  const c = new p.Config(raw);
  assert.equal(c.reportRate, 8000);
  assert.equal(c.dpiLevel, 2);
  assert.equal(c.dpiLevelCount, 6);
  assert.equal(c.dpi(2), 600);
  assert.deepEqual(c.dpiColor(2), [255, 0, 0]);
  assert.equal(c.lod, 2);
  assert.equal(c.debounce, 5);
  assert.equal(c.sensorMode, 1);
  assert.ok(c.flag(p.PERF_RIPPLE_CONTROL));
  assert.ok(c.flag(p.PERF_GLASS_MODE));
  assert.ok(!c.flag(p.PERF_MOTION_SYNC));
  assert.equal(c.sleepSeconds, 120);
});

test("input report events", () => {
  const view = (bytes) => new DataView(Uint8Array.from(bytes).buffer);
  assert.deepEqual(p.parseEvent(9, view([0xfa, 3, 4])), { kind: "dpi_level", value: 4 });
  assert.deepEqual(p.parseEvent(9, view([0xfa, 5, 0x80 | 57])), { kind: "battery", value: { percent: 57, charging: true } });
  assert.deepEqual(p.parseEvent(9, view([0xfa, 2, 1])), { kind: "connection", value: true });
  assert.equal(p.parseEvent(9, view([0x00, 3, 4])), null);
  assert.equal(p.parseEvent(1, view([0xfa, 3, 4])), null);
});

test("button actions", () => {
  assert.equal(a.describe(0x05040000), "Ciclo de DPI");
  assert.equal(a.describe(0x00010006), "Ctrl+C");
  assert.equal(a.describe(0x00060045), "Mayús+Alt+F12");
  assert.equal(a.keyFromEvent({ code: "KeyC", ctrlKey: true }), 0x00010006);
  assert.equal(a.keyFromEvent({ code: "F12", shiftKey: true, altKey: true }), 0x00060045);
  assert.equal(a.keyFromEvent({ code: "ShiftLeft", shiftKey: true }), null);
  assert.ok(a.isKeyboard(0x00010006));
  assert.ok(!a.isKeyboard(a.DISABLED));
});
