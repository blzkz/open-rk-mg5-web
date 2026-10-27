// Web (WebHID) control panel for Royal Kludge mice (MG5, experimental M30), laid out like Synapse / G Hub.

import * as a from "./actions.js";
import * as p from "./protocol.js";
import { MouseView } from "./mouse-view.js";
import { ProfileStore, applyProfile, normalizeProfile, profileFromMouse, rgbFromHex } from "./profiles.js";

const VERSION = "0.1.0";
const UDEV_RULES = [
  'SUBSYSTEM=="hidraw", ATTRS{idVendor}=="372e", ATTRS{idProduct}=="103f|1073", TAG+="uaccess"',
  'SUBSYSTEM=="hidraw", ATTRS{idVendor}=="258a", ATTRS{idProduct}=="0136|0138", TAG+="uaccess"',
];
const UDEV_COMMAND =
  `printf '%s\\n' ${UDEV_RULES.map((rule) => `'${rule}'`).join(" ")} | sudo tee /etc/udev/rules.d/70-rk-mg5.rules\n` +
  "sudo udevadm control --reload-rules && sudo udevadm trigger";
const NOT_FOUND = "Conecta el receptor 2.4G o el cable del RK MG5 (o del RK M30, experimental).";
const IS_LINUX = /Linux/.test(navigator.userAgent) && !/Android|CrOS/.test(navigator.userAgent);
const BATTERY_POLL_MS = 60_000;
const DPI_APPLY_DELAY_MS = 500;
const OFFLINE_RETRY_MS = 3000;
const LOW_BATTERY = 20;

const $ = (id) => document.getElementById(id);
const hex = (rgb) => "#" + rgb.map((c) => c.toString(16).padStart(2, "0")).join("");
const CHECK_ICON =
  '<svg class="check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const state = {
  mouse: null,
  config: null,
  keys: [...a.DEFAULT_KEYS],
  selectedButton: 1,
  capturingKey: false,
  tab: "customize",
  autosave: true,
  retryTimer: 0,
};
const profiles = new ProfileStore();

// -- small widgets -----------------------------------------------------------

function toast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  $("toasts").append(el);
  setTimeout(() => el.remove(), 3500);
}

// Number entry with -/+ buttons. onChange fires once the user stops typing or clicking.
function spin(container, { min, max, step, delay = 300, onChange }) {
  container.innerHTML = '<input type="number" inputmode="numeric"><button type="button" aria-label="Menos">−</button><button type="button" aria-label="Más">+</button>';
  const [input, minus, plus] = container.children;
  Object.assign(input, { min, max, step });
  let timer = 0;
  const clamp = (v) => Math.max(min, Math.min(max, Math.round(v / step) * step));
  const refresh = () => {
    minus.disabled = Number(input.value) <= min;
    plus.disabled = Number(input.value) >= max;
  };
  const changed = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const value = clamp(Number(input.value) || min);
      input.value = value;
      refresh();
      onChange(value);
    }, delay);
  };
  minus.addEventListener("click", () => { input.value = clamp(Number(input.value) - step); refresh(); changed(); });
  plus.addEventListener("click", () => { input.value = clamp(Number(input.value) + step); refresh(); changed(); });
  input.addEventListener("change", changed);
  input.addEventListener("keydown", (e) => e.key === "Enter" && input.blur());
  return {
    set(value) {
      clearTimeout(timer);
      input.value = value;
      refresh();
    },
    configure(limits) {
      ({ min, max, step } = { min, max, step, ...limits });
      Object.assign(input, { min, max, step });
      refresh();
    },
  };
}

// Row of linked toggle buttons, one per option.
function segmented(container, labels, onSelect) {
  const buttons = labels.map((label, i) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      if (button.getAttribute("aria-pressed") !== "true") onSelect(i);
    });
    container.append(button);
    return button;
  });
  return {
    buttons,
    set(index) {
      buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === index)));
    },
  };
}

function askName(title, initial) {
  const dialog = $("name-dialog");
  const input = $("name-dialog-input");
  $("name-dialog-title").textContent = title;
  input.value = initial;
  dialog.returnValue = "";
  dialog.showModal();
  input.select();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok" ? input.value.trim() || null : null), { once: true });
  });
}

function confirmDialog(title, body) {
  const dialog = $("confirm-dialog");
  $("confirm-dialog-title").textContent = title;
  $("confirm-dialog-body").textContent = body;
  dialog.returnValue = "";
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
  });
}

function setupMenu(buttonId, menuId) {
  const button = $(buttonId);
  const menu = $(menuId);
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    document.querySelectorAll(".menu").forEach((m) => (m.hidden = true));
    menu.hidden = !open;
  });
  menu.addEventListener("click", (e) => {
    const item = e.target.closest("[data-action]");
    if (!item) return;
    menu.hidden = true;
    MENU_ACTIONS[item.dataset.action]?.();
  });
}

// -- UI construction -----------------------------------------------------------

const ui = {};
let mouseView;

function buildCustomize() {
  const container = $("action-groups");
  ui.actionRows = new Map();
  let list = null;
  let group = null;
  for (const action of a.ACTIONS) {
    if (action.group !== group) {
      group = action.group;
      const label = document.createElement("div");
      label.className = "section-label";
      label.textContent = group.toUpperCase();
      list = document.createElement("div");
      list.className = "boxed-list";
      container.append(label, list);
    }
    const row = document.createElement("button");
    row.type = "button";
    row.className = "row";
    row.innerHTML = `<span class="row-text"></span>${CHECK_ICON}`;
    row.firstChild.textContent = action.name;
    row.addEventListener("click", () => assign(action.raw));
    list.append(row);
    ui.actionRows.set(action.raw, row);
  }
  container.style.display = "contents";

  $("key-capture").addEventListener("click", () => (state.capturingKey ? stopKeyCapture() : startKeyCapture()));
  $("reset-button").addEventListener("click", () => assign(a.DEFAULT_KEYS[state.selectedButton]));
  $("factory-buttons").addEventListener("click", () => apply((m) => m.setKeys([...a.DEFAULT_KEYS])));
  window.addEventListener("keydown", onKeyDown, true);
}

function buildPerformance() {
  ui.levelCount = spin($("level-count"), {
    min: 1,
    max: p.DPI_LEVELS,
    step: 1,
    onChange: (count) => apply((m, c) => m.setDpiLevelCount(c, count)),
  });

  ui.levelRows = [];
  const list = $("dpi-list");
  for (let level = 1; level <= p.DPI_LEVELS; level++) {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `
      <input type="radio" class="radio" name="dpi-level" aria-label="Usar el nivel ${level}" title="Usar este nivel">
      <div class="row-text"><div class="row-title">Nivel ${level}</div></div>
      <input type="color" class="color-input" aria-label="Color del nivel ${level}">
      <div class="spin compact"></div>`;
    const [radio, , color, spinBox] = row.children;
    radio.addEventListener("change", () => radio.checked && apply((m, c) => m.activateDpiLevel(c, level)));
    color.addEventListener("change", () => apply((m) => m.setDpiColor(level, rgbFromHex(color.value))));
    const dpi = spin(spinBox, {
      min: p.DPI_MIN,
      max: p.DPI_MAX,
      step: p.DPI_STEP,
      delay: DPI_APPLY_DELAY_MS,
      onChange: (value) =>
        apply(async (m, c) => {
          await m.setDpiValue(level, value);
          // The active level only takes effect after re-selecting it.
          if (c.dpiLevel === level) await m.activateDpiLevel(await m.readConfig(), level);
        }),
    });
    list.append(row);
    ui.levelRows.push({ level, row, radio, color, dpi });
  }

  ui.rates = Object.keys(p.REPORT_RATES).map(Number).sort((x, y) => x - y);
  ui.rateSegments = segmented($("rate-segments"), ui.rates.map(String), (i) => apply((m) => m.setReportRate(ui.rates[i])));
}

function buildSensor() {
  ui.lods = Object.keys(p.LOD_HEIGHTS).map(Number);
  ui.lodSegments = segmented($("lod-segments"), Object.values(p.LOD_HEIGHTS), (i) => apply((m) => m.setLod(ui.lods[i])));

  ui.modes = Object.keys(p.SENSOR_MODES).map(Number);
  ui.modeSegments = segmented($("mode-segments"), ["Oficina", "Rendimiento", "Competitivo"], (i) =>
    apply((m, c) => m.setPerformance((c.performance & 0x3f) | (ui.modes[i] << 6))),
  );

  ui.debounce = spin($("debounce"), { min: 1, max: 20, step: 1, onChange: (ms) => apply((m) => m.setDebounce(ms)) });

  ui.flags = [];
  const list = $("sensor-options");
  for (const [mask, title, subtitle] of [
    [p.PERF_MOTION_SYNC, "Motion Sync", "Sincroniza el sensor con el sondeo"],
    [p.PERF_RIPPLE_CONTROL, "Ripple Control", "Suaviza el movimiento a DPI altos"],
    [p.PERF_ANGLE_SNAPPING, "Corrección de ángulo", "Endereza las líneas rectas"],
    [p.PERF_GLASS_MODE, "Modo cristal", "Para superficies de cristal"],
  ]) {
    const row = document.createElement("label");
    row.className = "row";
    row.innerHTML = '<div class="row-text"><div class="row-title"></div><div class="row-subtitle"></div></div><input type="checkbox" class="switch" role="switch">';
    row.querySelector(".row-title").textContent = title;
    row.querySelector(".row-subtitle").textContent = subtitle;
    const input = row.querySelector("input");
    input.addEventListener("change", () => {
      const enabled = input.checked;
      apply((m, c) => m.setPerformance(enabled ? c.performance | mask : c.performance & ~mask));
    });
    list.append(row);
    ui.flags.push({ mask, input, row });
  }
}

function fillSleepOptions(times) {
  ui.sleepTimes = times;
  $("sleep-select").replaceChildren(
    ...times.map((seconds) => new Option(seconds === 0 ? "Desactivado" : seconds < 60 ? `${seconds} s` : `${seconds / 60} min`, seconds)),
  );
}

function buildPower() {
  const select = $("sleep-select");
  fillSleepOptions(p.SLEEP_TIMES);
  select.addEventListener("change", () => {
    const seconds = Number(select.value);
    apply((m) => m.setSleep(seconds));
  });
}

function selectTab(name) {
  state.tab = name;
  for (const tab of document.querySelectorAll(".tab")) tab.setAttribute("aria-selected", String(tab.dataset.tab === name));
  for (const panel of document.querySelectorAll(".panel")) panel.hidden = panel.dataset.panel !== name;
  mouseView.setCalloutsVisible(name === "customize" && (!state.mouse || state.mouse.model.keyRemap));
  updateBadge();
}

// Shows only the options the connected model has.
function applyModel(model) {
  $("device-title").textContent = "ROYAL KLUDGE " + model.name.split(" ").pop();
  $("experimental-banner").hidden = !model.experimental;
  $("experimental-model").textContent = model.name;
  $("battery").hidden = !model.battery;
  $("battery-section").hidden = !model.battery;
  $("remap-notice").hidden = model.keyReadback;
  $("remap-controls").hidden = !model.keyRemap;
  for (const { dpi } of ui.levelRows) dpi.configure({ min: model.dpiMin, max: model.dpiMax, step: model.dpiStep });
  ui.rates.forEach((hz, i) => (ui.rateSegments.buttons[i].hidden = !model.reportRates.includes(hz)));
  $("rate-hint").hidden = Math.max(...model.reportRates) <= 1000;
  $("mode-label").hidden = !model.sensorMode;
  $("mode-segments").hidden = !model.sensorMode;
  for (const { mask, row } of ui.flags) row.hidden = mask === p.PERF_GLASS_MODE && !model.glassMode;
  ui.debounce.configure({ max: model.debounceMax });
  if (ui.sleepTimes.join() !== model.sleepTimes.join()) fillSleepOptions(model.sleepTimes);
  selectTab(state.tab);
}

// -- connection ----------------------------------------------------------------

function showStatus(title, description, { action = "Reintentar", onAction = reconnect, linuxHelp = false, deviceInfo = null } = {}) {
  clearTimeout(state.retryTimer);
  state.config = null;
  $("status-title").textContent = title;
  $("status-description").textContent = description;
  $("linux-help").hidden = !linuxHelp;
  $("device-info-box").hidden = !deviceInfo;
  $("device-info").textContent = deviceInfo ?? "";
  const button = $("status-action");
  button.hidden = !action;
  button.textContent = action || "";
  button.onclick = onAction;
  $("status-page").hidden = false;
  $("settings").hidden = true;
  document.querySelector(".tabbar").classList.add("disabled");
  $("profile-select").disabled = true;
  $("connection-label").textContent = "Sin conexión";
}

function showSettings() {
  $("status-page").hidden = true;
  $("settings").hidden = false;
  document.querySelector(".tabbar").classList.remove("disabled");
  $("profile-select").disabled = false;
  $("connection-label").textContent = state.mouse.wireless ? "Receptor 2.4G" : "Cable USB";
  applyModel(state.mouse.model);
  mouseView.layout();
}

function showNotConnected() {
  showStatus("Conecta tu ratón RK", "Pulsa el botón y elige el ratón (RK MG5 o RK M30) en la lista del navegador.", {
    action: "Conectar ratón",
    onAction: requestMouse,
  });
}

async function requestMouse() {
  let devices;
  try {
    devices = await navigator.hid.requestDevice({ filters: p.HID_FILTERS });
  } catch (e) {
    toast(`No se pudo abrir el selector: ${e.message}`);
    return;
  }
  if (!devices.length) return;
  const device = devices.find(p.isConfigInterface);
  if (device) {
    await connectDevice(device);
    return;
  }
  // The browser gave us the mouse, but none of its interfaces looks like the config channel we know.
  showStatus(
    "No reconozco la interfaz de configuración",
    "El navegador ha dado acceso al ratón, pero ninguna de sus interfaces es la que esperaba el panel, así que no le he enviado nada. Copia estos datos y mándalos en un issue para poder darle soporte:",
    { action: "Conectar ratón", onAction: requestMouse, deviceInfo: p.describeDevices(devices) },
  );
}

async function disconnectMouse() {
  clearTimeout(state.retryTimer);
  const mouse = state.mouse;
  state.mouse = null;
  state.config = null;
  if (mouse) {
    mouse.device.removeEventListener("inputreport", onInputReport);
    await mouse.close().catch(() => {});
  }
}

// `retrying` is set by the automatic retries while the permission instructions are on screen.
async function connectDevice(device, { retrying = false } = {}) {
  await disconnectMouse();
  const mouse = p.openMouse(device);
  try {
    await mouse.open();
  } catch (e) {
    if (!IS_LINUX) {
      showStatus(
        "No se puede abrir el ratón",
        `El navegador no ha podido abrirlo (${e.message}). Cierra otras apps que lo estén usando y vuelve a intentarlo.`,
        { onAction: () => connectDevice(device) },
      );
      return;
    }
    // On Linux this almost always means /dev/hidraw is root-only: explain how to allow it,
    // then keep trying so the panel connects by itself once the rule is in place.
    if (!retrying) {
      showStatus(
        "Falta darle permiso al navegador",
        "Linux no deja que las páginas web usen el ratón hasta que le das permiso a tu usuario. Sigue estos pasos:",
        { action: "Reintentar ahora", onAction: () => connectDevice(device), linuxHelp: true },
      );
    }
    state.retryTimer = setTimeout(() => connectDevice(device, { retrying: true }), OFFLINE_RETRY_MS);
    return;
  }
  state.mouse = mouse;
  if (!mouse.model.keyReadback) mouse.keys = knownKeys(mouse.model);
  device.addEventListener("inputreport", onInputReport);
  await loadFromMouse();
}

async function reconnect() {
  if (state.mouse) {
    await loadFromMouse();
    return;
  }
  const device = (await navigator.hid.getDevices()).find(p.isConfigInterface);
  if (device) await connectDevice(device);
  else showNotConnected();
}

// Reads everything from the mouse. While the settings are on screen, failures are ignored.
async function loadFromMouse({ quiet = false } = {}) {
  const mouse = state.mouse;
  if (!mouse) return;
  clearTimeout(state.retryTimer);
  let battery;
  try {
    await mouse.exclusive(async () => {
      // Cheap check so a sleeping mouse doesn't block on every retry.
      if (mouse.wireless && !(await mouse.isOnline(300))) throw new p.MouseOffline();
      state.config = await mouse.readConfig();
      state.keys = await readKeys(mouse);
      battery = mouse.model.battery ? await mouse.readBattery() : null;
    });
  } catch (e) {
    if (state.mouse !== mouse || quiet) return;
    if (e instanceof p.MouseOffline) {
      showStatus("El ratón está dormido", "Muévelo para despertarlo; el panel se conectará solo.");
      state.retryTimer = setTimeout(() => loadFromMouse(), OFFLINE_RETRY_MS);
    } else {
      showStatus("Error de comunicación", e.message);
    }
    return;
  }
  if (state.mouse !== mouse) return;
  if (battery) showBattery(battery);
  loadConfig();
  loadKeys();
  showSettings();
  ensureProfile();
}

// For mice that can't report their buttons: the layout of the active profile for this model
// (the last one set from the panel), else the factory one.
function knownKeys(model) {
  const profile = profiles.get(profiles.active);
  if (profile && profile.model === model.name && profile.buttons.length === p.KEY_COUNT) {
    return profile.buttons.map((value) => parseInt(value, 16) >>> 0);
  }
  return [...a.DEFAULT_KEYS];
}

// Without a way to read the buttons, keep the factory layout just for the labels.
async function readKeys(mouse) {
  return mouse.model.keyRemap ? await mouse.readKeys() : [...a.DEFAULT_KEYS];
}

function onInputReport(event) {
  const ev = p.parseEvent(event.reportId, event.data);
  if (!ev) return;
  if (ev.kind === "dpi_level" && state.config) {
    state.config.raw[p.OFF_DPI_LEVEL] = (ev.value << 4) | state.config.dpiLevelCount;
    loadConfig();
  } else if (ev.kind === "battery") {
    showBattery(ev.value);
  } else if (ev.kind === "connection") {
    if (ev.value) {
      // Woke up or came back in range: show what it has stored.
      setTimeout(() => loadFromMouse({ quiet: state.config !== null }), 500);
    } else {
      toast("El ratón se ha desconectado del receptor");
    }
  }
}

// -- reading -------------------------------------------------------------------

function loadConfig() {
  const c = state.config;
  if (!c) return;
  ui.levelCount.set(c.dpiLevelCount);
  for (const { level, row, radio, color, dpi } of ui.levelRows) {
    dpi.set(c.dpi(level));
    color.value = hex(c.dpiColor(level));
    radio.checked = c.dpiLevel === level;
    row.hidden = level > c.dpiLevelCount;
  }
  ui.rateSegments.set(ui.rates.indexOf(c.reportRate));
  ui.lodSegments.set(ui.lods.indexOf(c.lod));
  ui.modeSegments.set(ui.modes.indexOf(c.sensorMode));
  ui.debounce.set(c.debounce);
  for (const { mask, input } of ui.flags) input.checked = c.flag(mask);
  const nearest = ui.sleepTimes.reduce((best, s) => (Math.abs(s - c.sleepSeconds) < Math.abs(best - c.sleepSeconds) ? s : best));
  $("sleep-select").value = nearest;
  updateBadge();
}

function loadKeys() {
  mouseView.setLabels(Object.fromEntries(state.keys.map((raw, i) => [i, a.describe(raw)])));
  selectButton(state.selectedButton);
}

function updateBadge() {
  const c = state.config;
  if (!c || state.tab !== "performance") {
    mouseView.setBadge(null);
    return;
  }
  mouseView.setBadge(`${c.dpi(c.dpiLevel)} DPI`, c.dpiColor(c.dpiLevel));
}

function showBattery({ percent, charging }) {
  const low = percent <= LOW_BATTERY && !charging;
  $("battery-label").textContent = `${percent} %`;
  $("battery-fill").setAttribute("width", (15 * percent) / 100);
  $("battery-bolt").toggleAttribute("hidden", !charging);
  $("battery").classList.toggle("low", low);
  $("battery").classList.toggle("charging", charging);
  $("battery").title = charging ? `Batería: ${percent} % (cargando)` : low ? `Batería baja: ${percent} %` : `Batería: ${percent} %`;
  $("battery-big").textContent = `${percent} %`;
  $("battery-bar").style.width = `${percent}%`;
  $("battery-bar").classList.toggle("low", low);
  $("battery-state").textContent = charging ? "Cargando" : low ? "Batería baja: conecta el cable para cargarlo" : "Funcionando con batería";
}

async function pollBattery() {
  const mouse = state.mouse;
  if (!mouse || !state.config || !mouse.model.battery) return;
  try {
    showBattery(await mouse.exclusive(() => mouse.readBattery()));
  } catch {
    // Asleep or out of range; the next poll or event will catch up.
  }
}

// -- writing -------------------------------------------------------------------

// Runs write(mouse, config), then re-reads so the UI shows what the mouse stored.
async function apply(write) {
  const mouse = state.mouse;
  if (!mouse || !state.config) return false;
  let ok = false;
  try {
    await mouse.exclusive(async () => {
      await mouse.ensureAwake();
      await write(mouse, state.config);
      state.config = await mouse.readConfig();
      state.keys = await readKeys(mouse);
    });
    ok = true;
    autosaveProfile();
  } catch (e) {
    if (e instanceof p.MouseOffline) toast("El ratón está dormido: muévelo y vuelve a intentarlo");
    else toast(`Error al guardar: ${e.message}`);
  }
  loadConfig();
  loadKeys();
  return ok;
}

// -- button remapping ----------------------------------------------------------

function selectButton(index) {
  state.selectedButton = index;
  mouseView.setSelected(index);
  const current = state.keys[index];
  $("button-title").textContent = `${a.BUTTON_NAMES[index].toUpperCase()} · ${a.describe(current)}`;
  for (const [raw, row] of ui.actionRows) row.classList.toggle("current", raw === current);
  $("key-subtitle").textContent = a.isKeyboard(current) ? a.describe(current) : "Asigna una tecla, con Ctrl/Mayús/Alt si quieres";
  stopKeyCapture();
}

async function assign(raw) {
  const index = state.selectedButton;
  // Never leave the mouse without a left click.
  if (raw !== a.LEFT_CLICK && state.keys[index] === a.LEFT_CLICK && state.keys.filter((k) => k === a.LEFT_CLICK).length === 1) {
    toast("Asigna antes el clic izquierdo a otro botón");
    return;
  }
  await apply((m) => m.setKey(index, raw));
}

function startKeyCapture() {
  state.capturingKey = true;
  $("key-capture").textContent = "Pulsa una tecla…";
  $("key-capture").classList.add("suggested");
}

function stopKeyCapture() {
  state.capturingKey = false;
  $("key-capture").textContent = "Pulsa para grabar";
  $("key-capture").classList.remove("suggested");
}

function onKeyDown(event) {
  if (!state.capturingKey) return;
  event.preventDefault();
  event.stopPropagation();
  const raw = a.keyFromEvent(event);
  // Plain modifier press or unsupported key: keep waiting.
  if (raw === null) return;
  stopKeyCapture();
  assign(raw);
}

// -- profiles ------------------------------------------------------------------

function refreshProfiles() {
  const select = $("profile-select");
  select.replaceChildren();
  const names = profiles.names;
  if (!names.includes(profiles.active)) {
    select.append(new Option("Sin perfil", "", true, true));
    select.firstChild.disabled = true;
  }
  for (const name of names) select.append(new Option(name, name, false, name === profiles.active));
}

// First run: turn whatever the mouse has into the default profile.
function ensureProfile() {
  if (profiles.names.length) {
    refreshProfiles();
    return;
  }
  profiles.save(profileFromMouse("Predeterminado", state.config, state.keys, state.mouse.model.name));
  profiles.setActive("Predeterminado");
  refreshProfiles();
}

function autosaveProfile() {
  const name = profiles.active;
  const profile = name ? profiles.get(name) : null;
  // Never overwrite a profile of another model with this mouse's settings.
  if (state.autosave && profile && state.config && state.mouse && profile.model === state.mouse.model.name) {
    profiles.save(profileFromMouse(name, state.config, state.keys, profile.model));
  }
}

async function switchProfile(name) {
  const profile = profiles.get(name);
  if (!profile) return false;
  // Don't autosave into the old profile while writing the new one.
  state.autosave = false;
  const ok = await apply((m) => applyProfile(profile, m));
  state.autosave = true;
  if (ok) {
    profiles.setActive(name);
    autosaveProfile();
    toast(`Perfil «${name}» aplicado`);
  }
  refreshProfiles();
  return ok;
}

const MENU_ACTIONS = {
  async "profile-new"() {
    if (!state.config || !state.mouse) {
      toast("Conecta el ratón para crear un perfil");
      return;
    }
    const { config, keys } = state;
    const model = state.mouse.model.name;
    const name = await askName("Nuevo perfil", profiles.uniqueName("Perfil"));
    if (!name) return;
    const unique = profiles.uniqueName(name);
    profiles.save(profileFromMouse(unique, config, [...keys], model));
    profiles.setActive(unique);
    refreshProfiles();
  },

  async "profile-duplicate"() {
    const source = profiles.get(profiles.active);
    if (!source) return;
    const name = await askName("Duplicar perfil", profiles.uniqueName(source.name));
    if (!name) return;
    const unique = profiles.uniqueName(name);
    profiles.save({ ...structuredClone(source), name: unique });
    profiles.setActive(unique);
    refreshProfiles();
  },

  async "profile-rename"() {
    const old = profiles.active;
    if (!profiles.get(old)) return;
    const name = await askName("Renombrar perfil", old);
    if (name && name !== old) {
      const unique = profiles.uniqueName(name);
      profiles.rename(old, unique);
      profiles.setActive(unique);
    }
    refreshProfiles();
  },

  async "profile-delete"() {
    const name = profiles.active;
    if (!profiles.get(name)) return;
    if (profiles.names.length === 1) {
      toast("No puedes borrar el único perfil");
      return;
    }
    if (!(await confirmDialog(`¿Eliminar el perfil «${name}»?`, "El ratón se queda con su configuración actual."))) return;
    profiles.delete(name);
    profiles.setActive(profiles.names[0]);
    refreshProfiles();
  },

  "profile-import"() {
    $("import-input").click();
  },

  "profile-export"() {
    const profile = profiles.get(profiles.active);
    if (!profile) {
      toast("No hay ningún perfil activo");
      return;
    }
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${profile.name.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "perfil"}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  },

  async forget() {
    const mouse = state.mouse;
    if (!mouse) {
      toast("No hay ningún ratón conectado");
      return;
    }
    await disconnectMouse();
    await mouse.device.forget?.();
    showNotConnected();
  },

  about() {
    $("about-version").textContent = VERSION;
    $("about-dialog").showModal();
  },
};

async function importProfile(file) {
  try {
    const profile = normalizeProfile(JSON.parse(await file.text()));
    profile.name = profiles.uniqueName(profile.name);
    profiles.save(profile);
    refreshProfiles();
    toast(`Perfil «${profile.name}» importado: elígelo en la lista para aplicarlo`);
  } catch (e) {
    toast(`No se pudo importar: ${e.message}`);
  }
}

// -- start ---------------------------------------------------------------------

async function init() {
  mouseView = new MouseView($("mouse-stage"), selectButton);
  buildCustomize();
  buildPerformance();
  buildSensor();
  buildPower();
  for (const tab of document.querySelectorAll(".tab")) tab.addEventListener("click", () => selectTab(tab.dataset.tab));
  selectTab("customize");
  loadKeys();
  refreshProfiles();

  setupMenu("profile-menu-button", "profile-menu");
  setupMenu("main-menu-button", "main-menu");
  document.addEventListener("click", () => document.querySelectorAll(".menu").forEach((m) => (m.hidden = true)));
  document.addEventListener("keydown", (e) => e.key === "Escape" && document.querySelectorAll(".menu").forEach((m) => (m.hidden = true)));
  $("profile-select").addEventListener("change", (e) => switchProfile(e.target.value));
  $("import-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (file) importProfile(file);
  });
  $("refresh").addEventListener("click", reconnect);
  $("copy-device-info").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("device-info").textContent);
      toast("Datos copiados");
    } catch {
      toast("No se pudo copiar: selecciónalo y cópialo a mano");
    }
  });
  $("udev-command").textContent = UDEV_COMMAND;
  $("copy-command").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(UDEV_COMMAND);
      toast("Copiado: pégalo en una terminal");
    } catch {
      toast("No se pudo copiar: selecciónalo y cópialo a mano");
    }
  });

  if (!("hid" in navigator)) {
    const reason = window.isSecureContext
      ? "Este panel usa WebHID, que solo está en Chrome, Edge, Opera, Brave y otros navegadores basados en Chromium de escritorio. Firefox y Safari no lo soportan."
      : "WebHID solo funciona en páginas seguras: abre el panel desde https:// o desde localhost.";
    showStatus("Tu navegador no puede hablar con el ratón", reason, { action: null });
    return;
  }

  navigator.hid.addEventListener("disconnect", (e) => {
    if (state.mouse && e.device === state.mouse.device) {
      disconnectMouse();
      showStatus("No se encuentra el ratón", NOT_FOUND, {
        action: "Conectar ratón",
        onAction: requestMouse,
      });
    }
  });
  navigator.hid.addEventListener("connect", (e) => {
    if (!state.mouse && p.isConfigInterface(e.device)) connectDevice(e.device);
  });
  setInterval(pollBattery, BATTERY_POLL_MS);

  // Reuse a mouse the user already allowed on this site.
  const device = (await navigator.hid.getDevices()).find(p.isConfigInterface);
  if (device) await connectDevice(device);
  else showNotConnected();
}

init();
