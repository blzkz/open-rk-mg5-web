// Experimental RK M30 backend, against a simulated HIDDevice (no hardware needed).
// Run with: node --test tests/
// Reference frames come from the desktop app's rk_mg5/protocol.py.

import assert from "node:assert/strict";
import { test } from "node:test";

import * as p from "../js/protocol.js";
import { applyProfile, defaultProfile, profileFromMouse } from "../js/profiles.js";

const hex = (bytes) => Buffer.from(bytes).toString("hex");

// A plausible M30 block: level 2 of 6, 500 Hz, DPI 400..12000, debounce 3 ms.
function sampleBlock() {
  const block = new Uint8Array(p.M30_CONFIG_LEN);
  block[0] = 100;
  block[1] = 24;
  block[p.M30_OFF_REPORT_RATE] = 3;
  block[p.M30_OFF_DPI_LEVEL] = 0x26;
  block[p.M30_OFF_DEBOUNCE] = 3;
  [400, 800, 1600, 3200, 6400, 12000].forEach((dpi, i) => {
    const raw = p.encodeM30Dpi(dpi);
    for (const base of [p.M30_OFF_DPI_X, p.M30_OFF_DPI_Y]) block.set([raw & 0xff, raw >> 8], base + i * 2);
  });
  block.set([0, 255, 0, 255, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255], p.M30_OFF_DPI_COLORS);
  block.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 200); // unknown bytes that must survive every write
  return block;
}

// Answers report 9 like Chrome does (report id in byte 0). `accept` lists the cmdPara values that store a write.
class FakeDevice {
  constructor(block, { accept = [0], productId = p.M30_MODEL.donglePid } = {}) {
    this.block = Uint8Array.from(block);
    this.accept = accept;
    this.productId = productId;
    this.vendorId = p.M30_MODEL.vendorId;
    this.opened = true;
    this.pending = new Uint8Array(4);
    this.writes = [];
    this.keyWrites = [];
  }

  async sendFeatureReport(reportId, data) {
    assert.equal(reportId, p.M30_REPORT_ID);
    assert.equal(data.length, p.M30_FRAME_LEN);
    assert.equal(data[0], p.m30Checksum(data));
    const [cmd, para] = [data[1], data[2]];
    const length = data[5] | (data[6] << 8);
    const payload = data.slice(p.M30_PAYLOAD_OFFSET, p.M30_PAYLOAD_OFFSET + length);
    if (cmd === p.M30_CMD_GET_CONFIG) {
      this.pending = p.buildM30Frame(cmd, 0, this.block);
    } else if (cmd === p.M30_CMD_SET_KEYS) {
      this.keyWrites.push([para, payload]);
      this.pending = p.buildM30Frame(cmd, 0, []);
    } else if (cmd === p.M30_CMD_SET_CONFIG) {
      this.writes.push([para, payload]);
      if (this.accept.includes(para)) this.block = Uint8Array.from(payload);
      this.pending = p.buildM30Frame(cmd, 0, []);
    }
  }

  async receiveFeatureReport(reportId) {
    const bytes = new Uint8Array(this.pending.length + 1);
    bytes[0] = reportId;
    bytes.set(this.pending, 1);
    return new DataView(bytes.buffer);
  }
}

const mouseFor = (device) => {
  const mouse = p.openMouse(device);
  assert.ok(mouse instanceof p.M30);
  return mouse;
};

test("M30 frames match the desktop implementation", () => {
  const cases = [
    [[0x44, 0, new Uint8Array(400)], "d64400010090010000000000"],
    [[0x04, 1, [1, 2, 3]], "0f0401010003000102030000"],
    [[0x48, 1, [0]], "4b4801010001000000000000"],
  ];
  for (const [args, expected] of cases) {
    const frame = p.buildM30Frame(...args);
    assert.equal(frame.length, p.M30_FRAME_LEN);
    assert.equal(hex(frame.slice(0, 12)), expected);
  }
});

test("M30 DPI encoding", () => {
  assert.deepEqual([100, 24000, 50000, 1649, 10].map(p.encodeM30Dpi), [0, 239, 239, 15, 0]);
  assert.equal(p.decodeM30Dpi(15), 1600);
});

test("M30 config parsing", () => {
  const block = sampleBlock();
  block[p.M30_OFF_DEBOUNCE] |= 0x80;
  block[p.M30_OFF_FLAGS] = 0x81;
  block[p.M30_OFF_SLEEP] = 5;
  const c = new p.M30Config(p.parseM30Config(p.buildM30Frame(p.M30_CMD_GET_CONFIG, 0, block)));
  assert.deepEqual([c.dpiLevel, c.dpiLevelCount], [2, 6]);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((l) => c.dpi(l)), [400, 800, 1600, 3200, 6400, 12000]);
  assert.deepEqual(c.dpiColor(4), [255, 255, 0]);
  assert.equal(c.reportRate, 500);
  assert.equal(c.debounce, 3);
  assert.equal(c.sleepSeconds, 300);
  assert.ok(c.flag(p.PERF_MOTION_SYNC) && c.flag(p.PERF_RIPPLE_CONTROL) && c.flag(p.PERF_ANGLE_SNAPPING));
  assert.ok(!c.flag(p.PERF_GLASS_MODE));
});

test("M30 rejects bad reads", () => {
  const good = p.buildM30Frame(p.M30_CMD_GET_CONFIG, 0, sampleBlock());
  const badChecksum = Uint8Array.from(good);
  badChecksum[0] ^= 0xff;
  const badLevel = sampleBlock();
  badLevel[p.M30_OFF_DPI_LEVEL] = 0x72;
  for (const resp of [
    good.slice(0, 300),
    p.buildM30Frame(p.M30_CMD_SET_CONFIG, 0, sampleBlock()),
    badChecksum,
    p.buildM30Frame(p.M30_CMD_GET_CONFIG, 0, new Uint8Array(400)),
    p.buildM30Frame(p.M30_CMD_GET_CONFIG, 0, new Uint8Array(400).fill(0xff)),
    p.buildM30Frame(p.M30_CMD_GET_CONFIG, 0, badLevel),
  ]) {
    assert.throws(() => p.parseM30Config(resp), p.MG5Error);
  }
});

test("M30 writes only touch the setting's bytes", async () => {
  const device = new FakeDevice(sampleBlock());
  const mouse = mouseFor(device);
  const before = Uint8Array.from(device.block);
  await mouse.setReportRate(1000);
  await mouse.setDpiValue(3, 2000);
  await mouse.setDpiColor(1, [1, 2, 3]);
  await mouse.setPerformance(p.PERF_MOTION_SYNC | p.PERF_GLASS_MODE);
  await mouse.setSleep(600);
  await mouse.setDebounce(20);
  const c = await mouse.readConfig();
  assert.equal(c.reportRate, 1000);
  assert.equal(c.dpi(3), 2000);
  assert.deepEqual(Array.from(c.raw.slice(p.M30_OFF_DPI_Y + 4, p.M30_OFF_DPI_Y + 6)), [19, 0]);
  assert.deepEqual(c.dpiColor(1), [1, 2, 3]);
  assert.ok(c.flag(p.PERF_MOTION_SYNC) && !c.flag(p.PERF_RIPPLE_CONTROL));
  assert.equal(c.sleepSeconds, 600);
  assert.equal(c.debounce, 15);
  const touched = new Set([2, 5, 6, 74, 11, 12, 31, 32, 47, 48, 49]);
  for (let i = 0; i < p.M30_CONFIG_LEN; i++) {
    if (before[i] !== device.block[i]) assert.ok(touched.has(i), `byte ${i} changed`);
  }
  assert.deepEqual(Array.from(device.block.slice(200, 210)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test("M30 skips writes that change nothing", async () => {
  const device = new FakeDevice(sampleBlock());
  await mouseFor(device).setReportRate(500);
  assert.equal(device.writes.length, 0);
});

test("M30 retries with cmdPara 1, then gives up", async () => {
  const retried = new FakeDevice(sampleBlock(), { accept: [1] });
  await mouseFor(retried).setLod(2);
  assert.deepEqual(retried.writes.map(([para]) => para), [0, 1]);
  assert.equal(retried.block[p.M30_OFF_LOD], 2);

  const ignored = new FakeDevice(sampleBlock(), { accept: [] });
  await assert.rejects(mouseFor(ignored).setLod(2), p.MG5Error);
  assert.equal(ignored.writes.length, 2);
});

test("M30 never writes after a bad read", async () => {
  const device = new FakeDevice(new Uint8Array(400));
  await assert.rejects(mouseFor(device).setLod(2), p.MG5Error);
  assert.equal(device.writes.length, 0);
});

test("models, filters and config interface", () => {
  assert.ok(p.HID_FILTERS.some((f) => f.vendorId === 0x372e && f.productId === 0x103f && f.usagePage === 0xff00));
  assert.ok(p.HID_FILTERS.some((f) => f.vendorId === 0x258a && f.productId === 0x0136 && f.usagePage === undefined));
  assert.ok(p.HID_FILTERS.some((f) => f.vendorId === 0x258a && f.productId === 0x0138 && f.usagePage === undefined));
  const collection = (reportId) => ({ usagePage: 0xff00, featureReports: [{ reportId }] });
  const mg5 = { vendorId: 0x372e, productId: 0x103f, collections: [{ usagePage: 0xff00 }] };
  const m30 = { vendorId: 0x258a, productId: 0x0136, collections: [collection(9)] };
  const other = { vendorId: 0x258a, productId: 0x0136, collections: [collection(5)] };
  assert.ok(p.isConfigInterface(mg5));
  assert.ok(p.isConfigInterface(m30));
  assert.ok(!p.isConfigInterface(other));
  assert.ok(!p.isConfigInterface({ vendorId: 0x258a, productId: 0x0036, collections: [collection(9)] }));
  // Reports declared in a nested collection, or on a sibling of the vendor collection.
  const nested = { vendorId: 0x258a, productId: 0x0138, collections: [{ usagePage: 0xff00, children: [{ usagePage: 0xff00, featureReports: [{ reportId: 9 }] }] }] };
  const sibling = { vendorId: 0x258a, productId: 0x0138, collections: [{ usagePage: 0xff00 }, { usagePage: 0xff02, featureReports: [{ reportId: 9 }] }] };
  const noVendorPage = { vendorId: 0x258a, productId: 0x0138, collections: [{ usagePage: 0x000c, featureReports: [{ reportId: 9 }] }] };
  assert.ok(p.isConfigInterface(nested));
  assert.ok(p.isConfigInterface(sibling));
  assert.ok(!p.isConfigInterface(noVendorPage));
  assert.ok(p.openMouse(mg5) instanceof p.MG5);
  assert.equal(p.openMouse(m30).model, p.M30_MODEL);
  assert.ok(!p.openMouse(m30).wireless);
});

test("profiles remember their model", async () => {
  assert.equal(defaultProfile("x").model, "RK MG5");
  const c = new p.M30Config(sampleBlock());
  const profile = profileFromMouse("M30", c, [], p.M30_MODEL.name);
  assert.equal(profile.model, "RK M30");
  const device = new FakeDevice(sampleBlock());
  await assert.rejects(applyProfile(defaultProfile("MG5"), mouseFor(device)), /es de un RK MG5/);
  assert.equal(device.writes.length, 0);
});

test("the M30 picker filter doesn't hide interfaces by usage page", () => {
  const m30Filters = p.HID_FILTERS.filter((f) => f.vendorId === 0x258a);
  assert.equal(m30Filters.length, 2);
  assert.ok(m30Filters.every((f) => f.usagePage === undefined));
  assert.ok(p.HID_FILTERS.filter((f) => f.vendorId === 0x372e).every((f) => f.usagePage === 0xff00));
});

test("describeDevices summarises interfaces and report sizes", () => {
  const device = {
    productName: "2.4G Wireless Receiver",
    vendorId: 0x258a,
    productId: 0x0138,
    collections: [
      {
        usagePage: 0xff00,
        usage: 1,
        inputReports: [{ reportId: 8, items: [{ reportSize: 8, reportCount: 16 }] }],
        children: [{ usagePage: 0xff00, usage: 2, featureReports: [{ reportId: 9, items: [{ reportSize: 8, reportCount: 518 }] }] }],
      },
    ],
  };
  assert.equal(
    p.describeDevices([device]),
    [
      "2.4G Wireless Receiver 258a:0138",
      "  - página 0xff00 uso 0x0001: input 8 (16 B)",
      "    - página 0xff00 uso 0x0002: feature 9 (518 B)",
    ].join("\n"),
  );
});

test("M30 button table", () => {
  const table = p.buildM30KeyTable([0x01010100, 0x01020100, 0x01030100, 0x00010006, 0x020000e9, 0x05040000]);
  assert.equal(table.length, 80);
  assert.equal(hex(table.slice(0, 24)), "01010100010201000103010000010006020000e905040000");
  assert.ok(table.slice(24).every((b) => b === 0));
  assert.equal(hex(p.buildM30KeyTable(p.M30_DEFAULT_KEYS).slice(0, 24)), "010101000102010001030100010501000104010005040000");
  assert.throws(() => p.buildM30KeyTable([0x01020100, 0x01020100, 0x01030100, 0x01050100, 0x01040100, 0x05040000]), /clic izquierdo/);
  assert.throws(() => p.buildM30KeyTable([0x01010100]), p.MG5Error);
  // Same frame as rk_mg5/protocol.py in the desktop app.
  const frame = p.buildM30Frame(p.M30_CMD_SET_KEYS, 0, p.buildM30KeyTable(p.M30_DEFAULT_KEYS));
  assert.equal(hex(frame.slice(0, 31)), "74010001005000010101000102010001030100010501000104010005040000");
});

test("M30 setKey writes the whole table with one change", async () => {
  const device = new FakeDevice(sampleBlock());
  const mouse = mouseFor(device);
  mouse.keys = [0x01010100, 0x01020100, 0x01030100, 0x020000e9, 0x01040100, 0x05040000];
  await mouse.setKey(4, 0x020000ea);
  assert.equal(device.keyWrites.length, 1);
  const [para, payload] = device.keyWrites[0];
  assert.equal(para, 0);
  assert.equal(payload.length, 80);
  assert.equal(hex(payload.slice(0, 24)), "010101000102010001030100020000e9020000ea05040000");
  assert.deepEqual(await mouse.readKeys(), [0x01010100, 0x01020100, 0x01030100, 0x020000e9, 0x020000ea, 0x05040000]);
  assert.equal(device.writes.length, 0); // the config block is untouched
});

test("M30 button writes refuse a bad state", async () => {
  const asleep = new FakeDevice(new Uint8Array(400));
  await assert.rejects(mouseFor(asleep).setKey(3, 0x020000e9), p.MG5Error);
  assert.equal(asleep.keyWrites.length, 0);
  const device = new FakeDevice(sampleBlock());
  const mouse = mouseFor(device);
  await assert.rejects(mouse.setKey(0, 0x01020100), /clic izquierdo/);
  assert.equal(device.keyWrites.length, 0);
  assert.deepEqual(await mouse.readKeys(), p.M30_DEFAULT_KEYS);
});

test("M30 profiles always rewrite the whole button table", async () => {
  const device = new FakeDevice(sampleBlock());
  const mouse = mouseFor(device);
  const c = new p.M30Config(sampleBlock());
  const profile = profileFromMouse("M30", c, p.M30_DEFAULT_KEYS, p.M30_MODEL.name);
  await applyProfile(profile, mouse);
  assert.equal(device.keyWrites.length, 1);
  assert.equal(hex(device.keyWrites[0][1].slice(0, 24)), "010101000102010001030100010501000104010005040000");
});
