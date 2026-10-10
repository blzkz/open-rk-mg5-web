// Button assignments ("keyRaw" values) understood by the MG5 firmware.
//
// A keyRaw is a big-endian u32: [type, code, ...].
// - type 0x00 keyboard: byte 1 = modifier mask, byte 3 = HID usage (e.g. 0x00010006 = Ctrl+C)
// - type 0x01 mouse:    byte 1 = button (1 left, 2 right, 3 middle, 4 back, 5 forward, 8/9 scroll)
// - type 0x02 media:    bytes 2-3 = HID consumer usage
// - type 0x05 DPI:      byte 1 = 1 up, 2 down, 4 cycle

export const DISABLED = 0x00000000;
export const LEFT_CLICK = 0x01010100;

export const ACTIONS = [
  { raw: LEFT_CLICK, name: "Clic izquierdo", group: "Ratón" },
  { raw: 0x01020100, name: "Clic derecho", group: "Ratón" },
  { raw: 0x01030100, name: "Clic central", group: "Ratón" },
  { raw: 0x01040100, name: "Atrás", group: "Ratón" },
  { raw: 0x01050100, name: "Adelante", group: "Ratón" },
  { raw: 0x01080100, name: "Desplazar arriba", group: "Ratón" },
  { raw: 0x01090100, name: "Desplazar abajo", group: "Ratón" },
  { raw: 0x05040000, name: "Ciclo de DPI", group: "DPI" },
  { raw: 0x05010000, name: "Subir DPI", group: "DPI" },
  { raw: 0x05020000, name: "Bajar DPI", group: "DPI" },
  { raw: 0x020000e9, name: "Subir volumen", group: "Multimedia" },
  { raw: 0x020000ea, name: "Bajar volumen", group: "Multimedia" },
  { raw: 0x020000e2, name: "Silenciar", group: "Multimedia" },
  { raw: 0x020000cd, name: "Reproducir / pausa", group: "Multimedia" },
  { raw: 0x020000b5, name: "Pista siguiente", group: "Multimedia" },
  { raw: 0x020000b6, name: "Pista anterior", group: "Multimedia" },
  { raw: DISABLED, name: "Desactivado", group: "Otros" },
];
const ACTIONS_BY_RAW = new Map(ACTIONS.map((a) => [a.raw, a]));

// Factory assignment of each key index.
export const DEFAULT_KEYS = [0x01010100, 0x01020100, 0x01030100, 0x01050100, 0x01040100, 0x05040000];
export const BUTTON_NAMES = ["Botón izquierdo", "Botón derecho", "Rueda", "Lateral delantero", "Lateral trasero", "Botón DPI (inferior)"];

export const MODIFIERS = [
  [0x01, "Ctrl"],
  [0x02, "Mayús"],
  [0x04, "Alt"],
  [0x08, "Super"],
];

// KeyboardEvent.code -> [HID usage, label]. Codes are layout independent, like evdev keycodes.
const CODE_TO_HID = {
  Escape: [0x29, "Esc"], Backspace: [0x2a, "Retroceso"], Tab: [0x2b, "Tab"], Enter: [0x28, "Intro"],
  Space: [0x2c, "Espacio"], Minus: [0x2d, "-"], Equal: [0x2e, "="], BracketLeft: [0x2f, "["],
  BracketRight: [0x30, "]"], Backslash: [0x31, "\\"], Semicolon: [0x33, ";"], Quote: [0x34, "'"],
  Backquote: [0x35, "`"], Comma: [0x36, ","], Period: [0x37, "."], Slash: [0x38, "/"],
  CapsLock: [0x39, "Bloq Mayús"], PrintScreen: [0x46, "Impr Pant"], ScrollLock: [0x47, "Bloq Despl"],
  Pause: [0x48, "Pausa"], Insert: [0x49, "Insert"], Home: [0x4a, "Inicio"], PageUp: [0x4b, "Re Pág"],
  Delete: [0x4c, "Supr"], End: [0x4d, "Fin"], PageDown: [0x4e, "Av Pág"], ArrowRight: [0x4f, "→"],
  ArrowLeft: [0x50, "←"], ArrowDown: [0x51, "↓"], ArrowUp: [0x52, "↑"], IntlBackslash: [0x64, "<"],
};
for (let i = 0; i < 26; i++) {
  const letter = String.fromCharCode(65 + i);
  CODE_TO_HID[`Key${letter}`] = [0x04 + i, letter];
}
"1234567890".split("").forEach((digit, i) => {
  CODE_TO_HID[`Digit${digit}`] = [0x1e + i, digit];
});
for (let i = 0; i < 12; i++) CODE_TO_HID[`F${i + 1}`] = [0x3a + i, `F${i + 1}`];
const HID_LABELS = new Map(Object.values(CODE_TO_HID));

// Builds a keyboard keyRaw from a KeyboardEvent, or null if it can't be represented
// (a plain modifier press or an unsupported key).
export function keyFromEvent(event) {
  const entry = CODE_TO_HID[event.code];
  if (!entry) return null;
  let mods = 0;
  if (event.ctrlKey) mods |= 0x01;
  if (event.shiftKey) mods |= 0x02;
  if (event.altKey) mods |= 0x04;
  if (event.metaKey) mods |= 0x08;
  return ((mods << 16) | entry[0]) >>> 0;
}

export function isKeyboard(raw) {
  return raw >>> 24 === 0 && raw !== DISABLED;
}

export function describe(raw) {
  const action = ACTIONS_BY_RAW.get(raw);
  if (action) return action.name;
  if (raw >>> 24 === 0) {
    const mods = (raw >>> 16) & 0xff;
    const usage = raw & 0xff;
    const parts = MODIFIERS.filter(([bit]) => mods & bit).map(([, name]) => name);
    parts.push(HID_LABELS.get(usage) ?? `Tecla 0x${usage.toString(16).toUpperCase().padStart(2, "0")}`);
    return parts.join("+");
  }
  return `Personalizado (0x${raw.toString(16).toUpperCase().padStart(8, "0")})`;
}
