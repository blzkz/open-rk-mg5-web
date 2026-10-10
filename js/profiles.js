// Mouse profiles, stored in the browser's localStorage.
// The JSON shape matches the desktop app's ~/.config/open-rk-mg5/profiles/*.json, so files can be
// exported from one and imported into the other.

import * as p from "./protocol.js";

const STORAGE_KEY = "open-rk-mg5.profiles";
const ACTIVE_KEY = "open-rk-mg5.active-profile";

const hex = (rgb) => "#" + rgb.map((c) => c.toString(16).padStart(2, "0")).join("");
export const rgbFromHex = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));

// Everything the mouse stores: buttons, DPI, polling, sensor and power settings.
export function defaultProfile(name) {
  return {
    name,
    report_rate: 1000,
    dpi_level_count: 6,
    active_dpi_level: 1,
    dpi_levels: [800, 1600, 3200, 6400, 12800, 26000],
    dpi_colors: ["#00ff00", "#ff0000", "#00ffff", "#ff00ff", "#0000ff", "#ffffff"],
    lod: 2,
    debounce: 5,
    sensor_mode: 1,
    motion_sync: true,
    ripple_control: true,
    angle_snapping: false,
    glass_mode: false,
    sleep_seconds: 300,
    buttons: ["0x01010100", "0x01020100", "0x01030100", "0x01050100", "0x01040100", "0x05040000"],
  };
}

export function profileFromMouse(name, config, keys) {
  const levels = Array.from({ length: p.DPI_LEVELS }, (_, i) => i + 1);
  return {
    name,
    report_rate: config.reportRate,
    dpi_level_count: config.dpiLevelCount,
    active_dpi_level: config.dpiLevel,
    dpi_levels: levels.map((l) => config.dpi(l)),
    dpi_colors: levels.map((l) => hex(config.dpiColor(l))),
    lod: config.lod,
    debounce: config.debounce,
    sensor_mode: config.sensorMode,
    motion_sync: config.flag(p.PERF_MOTION_SYNC),
    ripple_control: config.flag(p.PERF_RIPPLE_CONTROL),
    angle_snapping: config.flag(p.PERF_ANGLE_SNAPPING),
    glass_mode: config.flag(p.PERF_GLASS_MODE),
    sleep_seconds: config.sleepSeconds,
    buttons: keys.map((k) => "0x" + k.toString(16).padStart(8, "0")),
  };
}

// Fills in missing fields and drops unknown ones, so imported files can't break the app.
export function normalizeProfile(data) {
  if (typeof data !== "object" || data === null || typeof data.name !== "string" || !data.name.trim()) {
    throw new Error("El archivo no es un perfil válido");
  }
  const base = defaultProfile(data.name.trim());
  for (const key of Object.keys(base)) {
    if (key in data && typeof data[key] === typeof base[key]) base[key] = data[key];
  }
  return base;
}

function performanceByte(profile) {
  let value = profile.sensor_mode << 6;
  if (profile.motion_sync) value |= p.PERF_MOTION_SYNC;
  if (profile.ripple_control) value |= p.PERF_RIPPLE_CONTROL;
  if (profile.angle_snapping) value |= p.PERF_ANGLE_SNAPPING;
  if (profile.glass_mode) value |= p.PERF_GLASS_MODE;
  return value;
}

// Writes only the settings that differ from what the mouse currently has.
export async function applyProfile(profile, mouse) {
  const config = await mouse.readConfig();
  const keys = await mouse.readKeys();
  for (const [index, value] of profile.buttons.entries()) {
    const raw = parseInt(value, 16) >>> 0;
    if (keys[index] !== raw) await mouse.setKey(index, raw);
  }
  for (let level = 1; level <= p.DPI_LEVELS; level++) {
    const dpi = profile.dpi_levels[level - 1];
    if (config.dpi(level) !== dpi) await mouse.setDpiValue(level, dpi);
    const rgb = rgbFromHex(profile.dpi_colors[level - 1]);
    if (config.dpiColor(level).join() !== rgb.join()) await mouse.setDpiColor(level, rgb);
  }
  if (config.reportRate !== profile.report_rate) await mouse.setReportRate(profile.report_rate);
  if (config.lod !== profile.lod) await mouse.setLod(profile.lod);
  if (config.debounce !== profile.debounce) await mouse.setDebounce(profile.debounce);
  const perf = performanceByte(profile);
  if (config.performance !== perf) await mouse.setPerformance(perf);
  if (config.sleepSeconds !== profile.sleep_seconds) await mouse.setSleep(profile.sleep_seconds);
  const count = Math.max(1, Math.min(p.DPI_LEVELS, profile.dpi_level_count));
  const active = Math.max(1, Math.min(count, profile.active_dpi_level));
  if (config.dpiLevelCount !== count) await mouse.writeConfig(p.OFF_DPI_LEVEL, [(config.dpiLevel << 4) | count]);
  // Selecting the level makes the new DPI value take effect.
  await mouse.activateDpiLevel(await mouse.readConfig(), active);
}

function readStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows or blocked storage: profiles just won't survive a reload.
  }
}

export class ProfileStore {
  constructor() {
    this.profiles = {};
    for (const data of Object.values(readStorage(STORAGE_KEY, {}))) {
      try {
        const profile = normalizeProfile(data);
        this.profiles[profile.name] = profile;
      } catch {
        // Skip corrupt entries.
      }
    }
    this.active = readStorage(ACTIVE_KEY, "");
  }

  get names() {
    return Object.keys(this.profiles).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }

  get(name) {
    return this.profiles[name];
  }

  save(profile) {
    this.profiles[profile.name] = profile;
    writeStorage(STORAGE_KEY, this.profiles);
  }

  delete(name) {
    delete this.profiles[name];
    writeStorage(STORAGE_KEY, this.profiles);
  }

  rename(oldName, newName) {
    const profile = this.profiles[oldName];
    this.delete(oldName);
    profile.name = newName;
    this.save(profile);
    return profile;
  }

  setActive(name) {
    this.active = name;
    writeStorage(ACTIVE_KEY, name);
  }

  uniqueName(base) {
    let name = base;
    for (let n = 2; name in this.profiles; n++) name = `${base} ${n}`;
    return name;
  }
}
