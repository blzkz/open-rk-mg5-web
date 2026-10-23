// Royal Kludge mouse configuration protocols over WebHID:
// - MG5: "BeiYing" protocol, feature report 3 with 63-byte 0x50 frames.
// - M30 (experimental, untested on hardware): feature report 9 with 519-byte frames that read and
//   write the whole 400-byte config block.
// Port of rk_mg5/protocol.py from the desktop app; see PROTOCOL.md for the reverse-engineered details.

export const VENDOR_ID = 0x372e;
export const PRODUCT_ID_DONGLE = 0x103f;
export const PRODUCT_ID_WIRED = 0x1073;
export const PRODUCT_IDS = [PRODUCT_ID_DONGLE, PRODUCT_ID_WIRED];
// The config interface is the one with vendor usage page 0xFF00.
export const CONFIG_USAGE_PAGE = 0xff00;

export const REPORT_ID = 3;
export const REPORT_LEN = 63;
export const EVENT_REPORT_ID = 9;
export const EVENT_MAGIC = 0xfa;

const HEADER = 0x50;

const CMD_GET_ONLINE = 0x47;
const CMD_READ = 0x4f;
const CMD_SET_DPI = 0x3a;
const CMD_WRITE_CONFIG = 0x35;
const CMD_SET_KEY = 0x30;

// CMD_READ addresses data in pages of 10 bytes. Bit 7 of the offset selects the region.
const PAGE_SIZE = 10;
const REGION_KEYS = 0x00;
const REGION_DEVICE = 0x80;
// Inside REGION_DEVICE: bytes 0..29 hold live status, the 64-byte config block follows.
const CONFIG_START = 30;
const CONFIG_LEN = 64;
export const KEY_COUNT = 6;

// Config block offsets.
export const OFF_REPORT_RATE = 1;
export const OFF_DPI_LEVEL = 2;
export const OFF_LOD = 3;
export const OFF_DEBOUNCE = 4;
export const OFF_PERFORMANCE = 5;
export const OFF_SLEEP = 8;
export const OFF_DPI_VALUES = 11;
export const OFF_DPI_COLORS = 27;
export const DPI_LEVELS = 6;

export const REPORT_RATES = { 125: 3, 250: 2, 500: 1, 1000: 0, 2000: 6, 4000: 5, 8000: 4 };
const REPORT_RATE_BY_ID = Object.fromEntries(Object.entries(REPORT_RATES).map(([hz, id]) => [id, Number(hz)]));

export const LOD_HEIGHTS = { 1: "0,7 mm", 2: "1,0 mm", 3: "2,0 mm" };
export const SENSOR_MODES = { 0: "Oficina (ahorro)", 1: "Alto rendimiento", 2: "Competitivo" };
export const SLEEP_TIMES = [0, 30, 60, 120, 180, 300, 600, 900, 1800, 3600];

export const DPI_MIN = 50;
export const DPI_MAX = 42000;
export const DPI_STEP = 50;

export const PERF_ANGLE_SNAPPING = 0x01;
export const PERF_GLASS_MODE = 0x02;
export const PERF_RIPPLE_CONTROL = 0x10;
export const PERF_MOTION_SYNC = 0x20;

// What each supported mouse offers. The panel adapts its options to this.
export const MG5_MODEL = {
  name: "RK MG5",
  protocol: "mg5",
  vendorId: VENDOR_ID,
  donglePid: PRODUCT_ID_DONGLE,
  wiredPid: PRODUCT_ID_WIRED,
  dpiMin: DPI_MIN,
  dpiMax: DPI_MAX,
  dpiStep: DPI_STEP,
  reportRates: Object.keys(REPORT_RATES).map(Number).sort((x, y) => x - y),
  sleepTimes: SLEEP_TIMES,
  debounceMax: 20,
  battery: true,
  sensorMode: true,
  glassMode: true,
  keyRemap: true,
  experimental: false,
};
// From the official web configurator (assets/index-BSYKKems.js). Nobody has tested it on a real M30 yet.
export const M30_MODEL = {
  name: "RK M30",
  protocol: "m30",
  vendorId: 0x258a,
  donglePid: 0x0138,
  wiredPid: 0x0136,
  dpiMin: 100,
  dpiMax: 24000,
  dpiStep: 100,
  reportRates: [125, 250, 500, 1000],
  sleepTimes: [0, 60, 120, 180, 300, 600, 900, 1800, 3600],
  debounceMax: 15,
  battery: false,
  sensorMode: false,
  glassMode: false,
  keyRemap: false,
  experimental: true,
};
export const MODELS = [MG5_MODEL, M30_MODEL];

// The M30 is matched by VID/PID only: its feature report 9 may live on a different interface than the
// 0xFF00 collection, and a usagePage filter would hide that interface from the picker.
export const HID_FILTERS = MODELS.flatMap((m) =>
  [m.donglePid, m.wiredPid].map((productId) =>
    m.protocol === "m30" ? { vendorId: m.vendorId, productId } : { vendorId: m.vendorId, productId, usagePage: CONFIG_USAGE_PAGE },
  ),
);

export class MG5Error extends Error {}
export class MouseOffline extends MG5Error {
  constructor(message = "El ratón no responde (¿dormido o fuera de alcance?)") {
    super(message);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function encodeDpi(dpi) {
  dpi = Math.max(DPI_MIN, Math.min(DPI_MAX, dpi));
  return dpi <= 30000 ? Math.floor(dpi / 50) - 1 : dpi;
}

export function decodeDpi(raw) {
  raw = Math.min(raw, 42000);
  return raw < 600 ? (raw + 1) * 50 : raw;
}

const u16le = (value) => [value & 0xff, (value >> 8) & 0xff];
const u32be = (value) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];

export class Config {
  constructor(raw) {
    this.raw = Uint8Array.from(raw);
  }

  get reportRate() {
    return REPORT_RATE_BY_ID[this.raw[OFF_REPORT_RATE] & 0x07] ?? 1000;
  }

  get dpiLevel() {
    return this.raw[OFF_DPI_LEVEL] >> 4;
  }

  get dpiLevelCount() {
    return this.raw[OFF_DPI_LEVEL] & 0x0f;
  }

  dpi(level) {
    const i = OFF_DPI_VALUES + (level - 1) * 2;
    return decodeDpi(this.raw[i] | (this.raw[i + 1] << 8));
  }

  dpiColor(level) {
    const i = OFF_DPI_COLORS + (level - 1) * 3;
    return [this.raw[i], this.raw[i + 1], this.raw[i + 2]];
  }

  get lod() {
    return this.raw[OFF_LOD] & 0x0f;
  }

  get debounce() {
    return this.raw[OFF_DEBOUNCE];
  }

  get performance() {
    return this.raw[OFF_PERFORMANCE];
  }

  get sensorMode() {
    return this.performance >> 6;
  }

  flag(mask) {
    return Boolean(this.performance & mask);
  }

  get sleepSeconds() {
    return this.raw[OFF_SLEEP] * 30;
  }
}

export function buildFrame(cmd, sn, offset, payload = []) {
  const report = new Uint8Array(REPORT_LEN);
  report[1] = HEADER;
  report[2] = payload.length;
  report[3] = sn;
  report[4] = cmd;
  report[5] = offset;
  report.set(payload, 6);
  let sum = 0;
  for (let i = 1; i < REPORT_LEN - 1; i++) sum += report[i];
  report[0] = sum & 0xff;
  return report;
}

export function modelFor(device) {
  return MODELS.find((m) => device.vendorId === m.vendorId && [m.donglePid, m.wiredPid].includes(device.productId)) ?? null;
}

// Every collection of the device, nested ones included (WebHID lists reports declared inside a child
// collection only on that child).
export function allCollections(device) {
  const out = [];
  const walk = (list) => {
    for (const c of list ?? []) {
      out.push(c);
      walk(c.children);
    }
  };
  walk(device.collections);
  return out;
}

export function isConfigInterface(device) {
  const model = modelFor(device);
  if (!model) return false;
  const collections = allCollections(device);
  if (model.protocol === "m30") {
    // 0x258A is a generic SinoWealth vendor id: also require a vendor page and feature report 9.
    return (
      collections.some((c) => c.usagePage >= 0xff00) &&
      collections.some((c) => (c.featureReports ?? []).some((r) => r.reportId === M30_REPORT_ID))
    );
  }
  return collections.some((c) => c.usagePage === CONFIG_USAGE_PAGE);
}

// Length in bytes of a WebHID report, from its items.
function reportBytes(report) {
  const bits = (report.items ?? []).reduce((sum, item) => sum + (item.reportSize ?? 0) * (item.reportCount ?? 0), 0);
  return Math.ceil(bits / 8);
}

const hex4 = (n) => (n ?? 0).toString(16).padStart(4, "0");

// Plain-text summary of the HID interfaces the browser gave us, for bug reports about unknown mice.
export function describeDevices(devices) {
  const lines = [];
  for (const device of devices) {
    lines.push(`${device.productName || "?"} ${hex4(device.vendorId)}:${hex4(device.productId)}`);
    const walk = (list, depth) => {
      for (const c of list ?? []) {
        const reports = ["input", "output", "feature"].flatMap((kind) =>
          (c[`${kind}Reports`] ?? []).map((r) => `${kind} ${r.reportId} (${reportBytes(r)} B)`),
        );
        lines.push(`${"  ".repeat(depth)}- página 0x${hex4(c.usagePage)} uso 0x${hex4(c.usage)}${reports.length ? ": " + reports.join(", ") : ""}`);
        walk(c.children, depth + 1);
      }
    };
    walk(device.collections, 1);
  }
  return lines.join("\n");
}

// Wraps an HIDDevice with the backend for its model's protocol.
export function openMouse(device) {
  return modelFor(device)?.protocol === "m30" ? new M30(device) : new MG5(device);
}

// Parses an input report 9 (WebHID strips the report id) into {kind, value}, or null.
export function parseEvent(reportId, data) {
  if (reportId !== EVENT_REPORT_ID || data.byteLength < 3 || data.getUint8(0) !== EVENT_MAGIC) return null;
  const kind = data.getUint8(1);
  const value = data.getUint8(2);
  if (kind === 2) return { kind: "connection", value: value === 1 };
  if (kind === 3) return { kind: "dpi_level", value };
  if (kind === 5) return { kind: "battery", value: { percent: value & 0x7f, charging: Boolean(value >> 7) } };
  return null;
}

// Wraps an opened HIDDevice. Every request/response pair must not interleave with another one,
// so callers group their work with exclusive().
export class MG5 {
  constructor(device) {
    this.device = device;
    this._lock = Promise.resolve();
  }

  get model() {
    return MG5_MODEL;
  }

  get wireless() {
    return this.device.productId === PRODUCT_ID_DONGLE;
  }

  async open() {
    if (!this.device.opened) await this.device.open();
  }

  async close() {
    if (this.device.opened) await this.device.close();
  }

  // Runs fn() once every previously queued device job has finished.
  exclusive(fn) {
    const run = this._lock.then(fn, fn);
    this._lock = run.catch(() => {});
    return run;
  }

  // -- transport -------------------------------------------------------------

  async _receive() {
    const view = await this.device.receiveFeatureReport(REPORT_ID);
    let bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    // Chrome includes the report id in byte 0; responses themselves start with 0x50 or 0x00.
    if (bytes[0] === REPORT_ID) bytes = bytes.subarray(1);
    return bytes;
  }

  // Sends a command and waits for its response: [0x50, status, len, sn, page/offset, data...].
  // While idle the device answers with a short 4-byte report instead.
  async transact(cmd, sn, offset, payload = [], timeout = 1000) {
    await this.device.sendFeatureReport(REPORT_ID, buildFrame(cmd, sn, offset, payload));
    const deadline = performance.now() + timeout;
    while (performance.now() < deadline) {
      await sleep(20);
      const resp = await this._receive();
      if (resp.length >= 8 && resp[0] === HEADER && resp[3] === sn) {
        if (resp[1] !== 0) {
          throw new MG5Error(`El ratón rechazó el comando 0x${cmd.toString(16)} (estado ${resp[1]})`);
        }
        return resp;
      }
    }
    throw new MouseOffline();
  }

  async readPage(region, page) {
    const resp = await this.transact(CMD_READ, 2, region | page);
    if (resp[4] !== page) throw new MG5Error(`Respuesta inesperada al leer la página ${page}`);
    return resp.slice(5, 5 + PAGE_SIZE);
  }

  async readBytes(region, start, length) {
    const first = Math.floor(start / PAGE_SIZE);
    const last = Math.floor((start + length - 1) / PAGE_SIZE);
    const data = new Uint8Array((last - first + 1) * PAGE_SIZE);
    for (let page = first; page <= last; page++) {
      data.set(await this.readPage(region, page), (page - first) * PAGE_SIZE);
    }
    const skip = start - first * PAGE_SIZE;
    return data.slice(skip, skip + length);
  }

  // -- reads -----------------------------------------------------------------

  // Asks the 2.4G receiver whether the mouse is awake and paired.
  async isOnline(timeout = 1000) {
    const resp = await this.transact(CMD_GET_ONLINE, 1, 0, [], timeout);
    return resp[5] === 1;
  }

  // Writes sent while the mouse sleeps reach the receiver but not the mouse, and get lost.
  async ensureAwake() {
    if (!this.wireless) return;
    let online = false;
    try {
      online = await this.isOnline(300);
    } catch (e) {
      if (!(e instanceof MouseOffline)) throw e;
    }
    if (!online) throw new MouseOffline("El ratón está dormido");
  }

  async readBattery() {
    const value = (await this.readPage(REGION_DEVICE, 1))[0];
    return { percent: value & 0x7f, charging: Boolean(value >> 7) };
  }

  async readConfig() {
    return new Config(await this.readBytes(REGION_DEVICE, CONFIG_START, CONFIG_LEN));
  }

  async readKeys() {
    const data = await this.readBytes(REGION_KEYS, 0, KEY_COUNT * 4);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return Array.from({ length: KEY_COUNT }, (_, i) => view.getUint32(i * 4, false));
  }

  // -- writes ----------------------------------------------------------------

  async writeConfig(offset, data) {
    await this.transact(CMD_WRITE_CONFIG, 49, offset, data);
  }

  async setReportRate(hz) {
    const id = REPORT_RATES[hz];
    await this.writeConfig(OFF_REPORT_RATE, [id | (id << 4)]);
  }

  async setLod(lod) {
    await this.writeConfig(OFF_LOD, [lod & 0x0f]);
  }

  async setDebounce(ms) {
    await this.writeConfig(OFF_DEBOUNCE, [Math.max(1, Math.min(20, ms))]);
  }

  async setPerformance(value) {
    await this.writeConfig(OFF_PERFORMANCE, [value & 0xff]);
  }

  async setSleep(seconds) {
    await this.writeConfig(OFF_SLEEP, [Math.floor(seconds / 30)]);
  }

  // Assigns an action (see actions.js) to button `index` (0..5).
  async setKey(index, raw) {
    await this.transact(CMD_SET_KEY, 32, index * 4, u32be(raw));
  }

  async setDpiValue(level, dpi) {
    await this.writeConfig(OFF_DPI_VALUES + (level - 1) * 2, u16le(encodeDpi(dpi)));
  }

  async setDpiColor(level, rgb) {
    await this.writeConfig(OFF_DPI_COLORS + (level - 1) * 3, rgb);
  }

  async setDpiLevelCount(config, count) {
    const active = Math.min(config.dpiLevel, count);
    await this.writeConfig(OFF_DPI_LEVEL, [(active << 4) | count]);
  }

  // Writes the DPI level byte as is: active level in bits 7-4, level count in bits 3-0.
  async setDpiLevelRaw(value) {
    await this.writeConfig(OFF_DPI_LEVEL, [value]);
  }

  // Switches the active DPI level the same way the official app does.
  async activateDpiLevel(config, level) {
    const payload = [(level << 4) | config.dpiLevelCount, ...u16le(encodeDpi(config.dpi(level))), ...config.dpiColor(level)];
    await this.transact(CMD_SET_DPI, 80, 0, payload);
  }
}

// -- RK M30 (experimental) -------------------------------------------------------
//
// Taken from the official web configurator (assets/index-BSYKKems.js, class "_ye"); never tested
// on a real M30. Every write reads the device's current 400-byte block, changes only the bytes of
// the setting, writes the block back and reads it again to check that the mouse stored it.

export const M30_REPORT_ID = 9;
export const M30_FRAME_LEN = 519;
export const M30_PAYLOAD_OFFSET = 7;
export const M30_CONFIG_LEN = 400;

export const M30_CMD_SET_CONFIG = 0x04;
export const M30_CMD_GET_CONFIG = 0x44;
export const M30_CMD_FW_VERSION = 0x48;

// Config block offsets.
export const M30_OFF_REPORT_RATE = 2;
export const M30_OFF_DPI_LEVEL = 3;
export const M30_OFF_LOD = 4;
export const M30_OFF_DEBOUNCE = 5; // bits 3-0; bit 7 = motion sync
export const M30_OFF_FLAGS = 6; // bit 0 = angle snapping, bit 7 = ripple control
export const M30_OFF_DPI_X = 7;
export const M30_OFF_DPI_Y = 27;
export const M30_OFF_DPI_COLORS = 47;
export const M30_OFF_SLEEP = 74; // minutes

export const M30_REPORT_RATES = { 125: 1, 250: 2, 500: 3, 1000: 4 };
const M30_REPORT_RATE_BY_ID = Object.fromEntries(Object.entries(M30_REPORT_RATES).map(([hz, id]) => [id, Number(hz)]));

export function encodeM30Dpi(dpi) {
  dpi = Math.max(M30_MODEL.dpiMin, Math.min(M30_MODEL.dpiMax, Math.round(dpi / 100) * 100));
  return dpi / 100 - 1;
}

export function decodeM30Dpi(raw) {
  return (raw + 1) * 100;
}

// Sum of every byte after the checksum except the last one of a full frame, as the official app does.
export function m30Checksum(frame) {
  let sum = 0;
  for (let i = 1; i < Math.min(frame.length, M30_FRAME_LEN - 1); i++) sum += frame[i];
  return sum & 0xff;
}

export function buildM30Frame(cmd, para, payload = []) {
  const frame = new Uint8Array(M30_FRAME_LEN);
  frame[1] = cmd;
  frame[2] = para;
  frame[3] = 1; // number of packages
  frame[4] = 0; // package index
  frame.set(u16le(payload.length), 5);
  frame.set(payload, M30_PAYLOAD_OFFSET);
  frame[0] = m30Checksum(frame);
  return frame;
}

// Extracts the config block from a 0x44 response, refusing anything that doesn't look right.
// The block read here is the base of every write, so a bad read must never reach the mouse.
export function parseM30Config(resp) {
  const end = M30_PAYLOAD_OFFSET + M30_CONFIG_LEN;
  if (resp.length < end || resp[1] !== M30_CMD_GET_CONFIG) {
    throw new MG5Error(`Respuesta de configuración del M30 demasiado corta (${resp.length} bytes)`);
  }
  if (resp[0] !== m30Checksum(resp)) throw new MG5Error("Respuesta de configuración del M30 con checksum incorrecto");
  const block = Uint8Array.from(resp.slice(M30_PAYLOAD_OFFSET, end));
  if (block.every((b) => b === 0) || block.every((b) => b === 0xff)) {
    throw new MG5Error("El M30 ha devuelto un bloque de configuración vacío");
  }
  const level = block[M30_OFF_DPI_LEVEL] >> 4;
  const count = block[M30_OFF_DPI_LEVEL] & 0x0f;
  if (!(count >= 1 && count <= DPI_LEVELS && level >= 1 && level <= count)) {
    throw new MG5Error(`Bloque de configuración del M30 no válido (nivel DPI 0x${block[M30_OFF_DPI_LEVEL].toString(16)})`);
  }
  return block;
}

// Same interface as Config, over the M30's 400-byte block.
export class M30Config {
  constructor(raw) {
    this.raw = Uint8Array.from(raw);
  }

  get reportRate() {
    return M30_REPORT_RATE_BY_ID[this.raw[M30_OFF_REPORT_RATE] & 0x0f] ?? 1000;
  }

  get dpiLevel() {
    return this.raw[M30_OFF_DPI_LEVEL] >> 4;
  }

  get dpiLevelCount() {
    return this.raw[M30_OFF_DPI_LEVEL] & 0x0f;
  }

  dpi(level) {
    const i = M30_OFF_DPI_X + (level - 1) * 2;
    return decodeM30Dpi(this.raw[i] | (this.raw[i + 1] << 8));
  }

  dpiColor(level) {
    const i = M30_OFF_DPI_COLORS + (level - 1) * 3;
    return [this.raw[i], this.raw[i + 1], this.raw[i + 2]];
  }

  get lod() {
    return this.raw[M30_OFF_LOD] & 0x0f;
  }

  get debounce() {
    return this.raw[M30_OFF_DEBOUNCE] & 0x0f;
  }

  // The M30 flags mapped onto the MG5's performance byte (PERF_* masks); no sensor mode or glass mode.
  get performance() {
    let value = 0;
    if (this.raw[M30_OFF_DEBOUNCE] & 0x80) value |= PERF_MOTION_SYNC;
    if (this.raw[M30_OFF_FLAGS] & 0x01) value |= PERF_ANGLE_SNAPPING;
    if (this.raw[M30_OFF_FLAGS] & 0x80) value |= PERF_RIPPLE_CONTROL;
    return value;
  }

  get sensorMode() {
    return 0;
  }

  flag(mask) {
    return Boolean(this.performance & mask);
  }

  get sleepSeconds() {
    return this.raw[M30_OFF_SLEEP] * 60;
  }
}

// Translates a PERF_* byte into M30 config bytes: [[offset, value, mask], ...].
export function m30ChangesForPerformance(value) {
  const motion = value & PERF_MOTION_SYNC ? 0x80 : 0;
  const flags = (value & PERF_ANGLE_SNAPPING ? 0x01 : 0) | (value & PERF_RIPPLE_CONTROL ? 0x80 : 0);
  return [
    [M30_OFF_DEBOUNCE, motion, 0x80],
    [M30_OFF_FLAGS, flags, 0x81],
  ];
}

// Returns a copy of `block` with only the masked bits of each changed byte replaced.
export function applyM30Changes(block, changes) {
  const out = Uint8Array.from(block);
  for (const [offset, value, mask] of changes) out[offset] = (out[offset] & ~mask & 0xff) | (value & mask);
  return out;
}

// Experimental backend for the RK M30. Same interface as MG5.
export class M30 {
  constructor(device) {
    this.device = device;
    this._lock = Promise.resolve();
  }

  get model() {
    return M30_MODEL;
  }

  get wireless() {
    return this.device.productId === M30_MODEL.donglePid;
  }

  async open() {
    if (!this.device.opened) await this.device.open();
  }

  async close() {
    if (this.device.opened) await this.device.close();
  }

  exclusive(fn) {
    const run = this._lock.then(fn, fn);
    this._lock = run.catch(() => {});
    return run;
  }

  // -- transport -------------------------------------------------------------

  async _receive() {
    const view = await this.device.receiveFeatureReport(M30_REPORT_ID);
    let bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    // Chrome includes the report id in byte 0 (the official app counts on it).
    if (bytes[0] === M30_REPORT_ID) bytes = bytes.subarray(1);
    return bytes;
  }

  // Sends a frame and polls report 9 until a response for the same command shows up.
  async _request(cmd, para, payload, tries, interval) {
    await this.device.sendFeatureReport(M30_REPORT_ID, buildM30Frame(cmd, para, payload));
    for (let i = 0; i < tries; i++) {
      await sleep(interval);
      const resp = await this._receive();
      if (resp.length >= 2 && resp[1] === cmd) return resp;
    }
    return null;
  }

  // -- reads -----------------------------------------------------------------

  // The M30 has no online query; a config read that times out raises MouseOffline instead.
  async isOnline() {
    return true;
  }

  async ensureAwake() {}

  async readBattery() {
    return null;
  }

  async readConfig() {
    const resp = await this._request(M30_CMD_GET_CONFIG, 0, new Uint8Array(M30_CONFIG_LEN), 8, 50);
    if (!resp) throw new MouseOffline();
    return new M30Config(parseM30Config(resp));
  }

  async readKeys() {
    throw new MG5Error("El RK M30 no permite leer la asignación de botones");
  }

  // {mouse, receiver} firmware versions; the receiver one is only meaningful over 2.4G.
  async readFirmware() {
    const resp = await this._request(M30_CMD_FW_VERSION, 1, [0], 30, 20);
    if (!resp || resp.length < M30_PAYLOAD_OFFSET + 4) return null;
    const v = Array.from(resp.slice(M30_PAYLOAD_OFFSET, M30_PAYLOAD_OFFSET + 4), (b) => b.toString(16).padStart(2, "0"));
    return { mouse: v[0] + v[1], receiver: v[2] + v[3] };
  }

  // -- writes ----------------------------------------------------------------

  // Read-modify-write of the config block, verified by reading it back.
  async _modify(changes) {
    const current = (await this.readConfig()).raw;
    const block = applyM30Changes(current, changes);
    if (block.every((b, i) => b === current[i])) return;
    // Same order as the official app: cmdPara 0, then 1 if the mouse didn't keep the change.
    for (const para of [0, 1]) {
      await this._request(M30_CMD_SET_CONFIG, para, block, 4, 40);
      await sleep(100);
      const stored = (await this.readConfig()).raw;
      if (changes.every(([offset, , mask]) => (stored[offset] & mask) === (block[offset] & mask))) return;
    }
    throw new MG5Error("El RK M30 no ha guardado el cambio (la relectura no coincide)");
  }

  async setReportRate(hz) {
    await this._modify([[M30_OFF_REPORT_RATE, M30_REPORT_RATES[hz], 0x0f]]);
  }

  async setLod(lod) {
    await this._modify([[M30_OFF_LOD, lod, 0x0f]]);
  }

  async setDebounce(ms) {
    // Only 4 bits: the official app offers up to 20 ms, which wraps around to 0..4.
    await this._modify([[M30_OFF_DEBOUNCE, Math.max(1, Math.min(M30_MODEL.debounceMax, ms)), 0x0f]]);
  }

  async setPerformance(value) {
    await this._modify(m30ChangesForPerformance(value));
  }

  async setSleep(seconds) {
    await this._modify([[M30_OFF_SLEEP, Math.floor(seconds / 60), 0xff]]);
  }

  async setKey() {
    throw new MG5Error("La reasignación de botones no está disponible para el RK M30");
  }

  async setDpiValue(level, dpi) {
    const [lo, hi] = u16le(encodeM30Dpi(dpi));
    const changes = [];
    for (const base of [M30_OFF_DPI_X, M30_OFF_DPI_Y]) {
      const offset = base + (level - 1) * 2;
      changes.push([offset, lo, 0xff], [offset + 1, hi, 0xff]);
    }
    await this._modify(changes);
  }

  async setDpiColor(level, rgb) {
    const offset = M30_OFF_DPI_COLORS + (level - 1) * 3;
    await this._modify(rgb.map((value, i) => [offset + i, value, 0xff]));
  }

  async setDpiLevelCount(config, count) {
    const active = Math.min(config.dpiLevel, count);
    await this.setDpiLevelRaw((active << 4) | count);
  }

  async setDpiLevelRaw(value) {
    await this._modify([[M30_OFF_DPI_LEVEL, value, 0xff]]);
  }

  async activateDpiLevel(config, level) {
    await this.setDpiLevelRaw((level << 4) | config.dpiLevelCount);
  }
}
