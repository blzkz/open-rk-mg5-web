// Royal Kludge MG5 configuration protocol ("BeiYing" protocol, feature report 3) over WebHID.
// Port of rk_mg5/protocol.py from the desktop app; see PROTOCOL.md for the reverse-engineered details.

export const VENDOR_ID = 0x372e;
export const PRODUCT_ID_DONGLE = 0x103f;
export const PRODUCT_ID_WIRED = 0x1073;
export const PRODUCT_IDS = [PRODUCT_ID_DONGLE, PRODUCT_ID_WIRED];
// The config interface is the one with vendor usage page 0xFF00.
export const CONFIG_USAGE_PAGE = 0xff00;
export const HID_FILTERS = PRODUCT_IDS.map((productId) => ({ vendorId: VENDOR_ID, productId, usagePage: CONFIG_USAGE_PAGE }));

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

export function isConfigInterface(device) {
  return (
    device.vendorId === VENDOR_ID &&
    PRODUCT_IDS.includes(device.productId) &&
    device.collections.some((c) => c.usagePage === CONFIG_USAGE_PAGE)
  );
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

  // Switches the active DPI level the same way the official app does.
  async activateDpiLevel(config, level) {
    const payload = [(level << 4) | config.dpiLevelCount, ...u16le(encodeDpi(config.dpi(level))), ...config.dpiColor(level)];
    await this.transact(CMD_SET_DPI, 80, 0, payload);
  }
}
