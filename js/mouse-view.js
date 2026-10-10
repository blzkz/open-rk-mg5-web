// Top-down drawing of the RK MG5 with Synapse-style callouts for its buttons.
// Port of rk_mg5/mouse_view.py: the mouse is an SVG in "mouse units" (60 wide x 112 long),
// scaled to the stage, and the callout labels are HTML buttons placed around it.

const SVG_NS = "http://www.w3.org/2000/svg";
const MOUSE_W = 60;
const MOUSE_H = 112;

// Symmetric body outline: wide front, slight waist, rounded rear (right half mirrored on the left).
const OUTLINE =
  "M30,0 C46,0 57,5 57.5,24 C58,40 55.5,50 55.5,62 C55.5,80 56.5,94 51,104 C46,112 38,112 30,112 " +
  "C22,112 14,112 9,104 C3.5,94 4.5,80 4.5,62 C4.5,50 2,40 2.5,24 C3,5 14,0 30,0 Z";
const LEFT_BUTTON = "M29.4,1 L29.4,44.5 C20,44 10,41 4.2,37 C3,20 6,6 20,1.6 Z";
const SEAMS = "M30,1 L30,45 M4.2,37 C10,41 20,44.6 30,45 C40,44.6 50,41 55.8,37";

// Clickable regions, by key index.
const REGIONS = {
  0: `<path d="${LEFT_BUTTON}"/>`,
  1: `<path d="${LEFT_BUTTON}" transform="translate(60 0) scale(-1 1)"/>`,
  2: `<rect x="26.3" y="11" width="7.4" height="18" rx="3.2"/>`,
  3: `<rect x="-1.6" y="41" width="3.6" height="11" rx="1.6"/>`,
  4: `<rect x="-1.6" y="53" width="3.6" height="11" rx="1.6"/>`,
  5: `<circle cx="30" cy="92" r="4.5"/>`,
};

// index: key index; anchor: point on the mouse; side of the label; row: label height (mouse units).
const CALLOUTS = [
  { index: 0, anchor: [16, 20], side: "left", row: 8 },
  { index: 2, anchor: [30, 21], side: "left", row: 30 },
  { index: 3, anchor: [1.5, 47], side: "left", row: 52 },
  { index: 4, anchor: [1.5, 58], side: "left", row: 72 },
  { index: 1, anchor: [44, 20], side: "right", row: 8 },
  { index: 5, anchor: [30, 92], side: "right", row: 92 },
];

function speckles() {
  // Deterministic "recycled plastic" speckles (mulberry32).
  let seed = 5;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const colors = ["#8c8c87", "#ada89e", "#737880"];
  let out = "";
  for (let i = 0; i < 900; i++) {
    const x = (rand() * MOUSE_W).toFixed(2);
    const y = (rand() * MOUSE_H).toFixed(2);
    const r = (0.15 + rand() * 0.3).toFixed(2);
    out += `<circle cx="${x}" cy="${y}" r="${r}" fill="${colors[Math.floor(rand() * 3)]}"/>`;
  }
  return out;
}

function mouseMarkup() {
  let ridges = "";
  for (let y = 13; y < 28; y += 2) ridges += `M27.5,${y} L32.5,${y} `;
  const regions = Object.entries(REGIONS)
    .map(([i, shape]) => `<g class="region" data-index="${i}">${shape}</g>`)
    .join("");
  return `
    <defs>
      <radialGradient id="mg5-body" gradientUnits="userSpaceOnUse" cx="30" cy="55" r="70" fx="30" fy="45" fr="4">
        <stop offset="0" stop-color="#f2f2f0"/>
        <stop offset="1" stop-color="#c7c7c4"/>
      </radialGradient>
      <clipPath id="mg5-clip"><path d="${OUTLINE}"/></clipPath>
    </defs>
    <path d="${OUTLINE}" transform="translate(1.5 3)" fill="#000" opacity="0.45"/>
    <path d="${OUTLINE}" fill="url(#mg5-body)"/>
    <g clip-path="url(#mg5-clip)" opacity="0.7">${speckles()}</g>
    <path d="${SEAMS}" fill="none" stroke="#2e2e2e" stroke-width="0.45"/>
    <rect x="26.3" y="11" width="7.4" height="18" rx="3.2" fill="#141414" pointer-events="none"/>
    <path d="${ridges}" stroke="#fff" stroke-opacity="0.12" stroke-width="0.4" pointer-events="none"/>
    <g fill="#dbdbd9" stroke="#2e2e2e" stroke-width="0.35" pointer-events="none">
      <rect x="-1.6" y="41" width="3.6" height="11" rx="1.6"/>
      <rect x="-1.6" y="53" width="3.6" height="11" rx="1.6"/>
    </g>
    <g class="regions">${regions}</g>
    <circle class="dpi-marker" cx="30" cy="92" r="4.5" fill="none" stroke="#2e2e2e" stroke-opacity="0.6"
            stroke-width="0.4" stroke-dasharray="1.2 0.9" pointer-events="none"/>`;
}

export class MouseView {
  constructor(stage, onSelect) {
    this.stage = stage;
    this.onSelect = onSelect;
    this.selected = null;
    this.hovered = null;
    this.showCallouts = true;
    this.badge = null;

    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.classList.add("mouse-svg");
    this.lines = document.createElementNS(SVG_NS, "g");
    this.lines.classList.add("callout-lines");
    this.mouse = document.createElementNS(SVG_NS, "g");
    this.mouse.innerHTML = mouseMarkup();
    this.svg.append(this.mouse, this.lines);
    stage.append(this.svg);

    for (const region of this.mouse.querySelectorAll(".region")) {
      const index = Number(region.dataset.index);
      region.addEventListener("click", () => this.showCallouts && this._select(index));
      region.addEventListener("pointerenter", () => this._hover(index));
      region.addEventListener("pointerleave", () => this._hover(null));
    }

    this.labels = {};
    for (const callout of CALLOUTS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `callout ${callout.side}`;
      button.addEventListener("click", () => this._select(callout.index));
      button.addEventListener("pointerenter", () => this._hover(callout.index));
      button.addEventListener("pointerleave", () => this._hover(null));
      stage.append(button);
      this.labels[callout.index] = button;
    }

    this.badgeEl = document.createElement("div");
    this.badgeEl.className = "dpi-badge";
    this.badgeEl.innerHTML = '<span class="dot"></span><span class="text"></span>';
    stage.append(this.badgeEl);

    new ResizeObserver(() => this.layout()).observe(stage);
  }

  // -- public API --------------------------------------------------------------

  setLabels(names) {
    for (const [index, name] of Object.entries(names)) this.labels[index].textContent = name;
    this.layout();
  }

  setCalloutsVisible(visible) {
    this.showCallouts = visible;
    this.stage.classList.toggle("no-callouts", !visible);
    this.layout();
  }

  setSelected(index) {
    this.selected = index;
    for (const [i, button] of Object.entries(this.labels)) button.classList.toggle("selected", Number(i) === index);
    this._paintRegions();
  }

  setBadge(text, rgb = [255, 255, 255]) {
    this.badge = text ? { text, rgb } : null;
    this.badgeEl.hidden = !this.badge;
    if (this.badge) {
      this.badgeEl.querySelector(".text").textContent = text;
      this.badgeEl.querySelector(".dot").style.background = `rgb(${rgb.join(",")})`;
    }
    this.layout();
  }

  // -- geometry ----------------------------------------------------------------

  _geometry() {
    const width = this.stage.clientWidth;
    const height = this.stage.clientHeight;
    // Leave room for the labels on narrow stages.
    const share = width < 640 ? 0.26 : 0.34;
    const scale = Math.max(0.1, Math.min((height * 0.78) / MOUSE_H, (width * share) / MOUSE_W));
    const ox = (width - MOUSE_W * scale) / 2;
    const oy = (height - MOUSE_H * scale) / 2 - (this.badge ? 14 : 0);
    return { width, height, scale, ox, oy };
  }

  layout() {
    const g = this._geometry();
    const { width, height, scale, ox, oy } = g;
    if (!width || !height) return;
    this.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    this.mouse.setAttribute("transform", `translate(${ox} ${oy}) scale(${scale})`);

    const gap = width < 640 ? 30 : 56;
    const reach = gap - 6;
    let lines = "";
    for (const callout of CALLOUTS) {
      const button = this.labels[callout.index];
      button.hidden = !this.showCallouts;
      if (!this.showCallouts) continue;
      const ly = oy + callout.row * scale;
      const ax = ox + callout.anchor[0] * scale;
      const ay = oy + callout.anchor[1] * scale;
      const right = ox + MOUSE_W * scale;
      const x = callout.side === "left" ? ox - gap - button.offsetWidth : right + gap;
      button.style.left = `${Math.max(0, x)}px`;
      button.style.top = `${ly - button.offsetHeight / 2}px`;
      const start = callout.side === "left" ? ox - reach : right + reach;
      const elbow = callout.side === "left" ? ox - 14 : right + 14;
      const active = callout.index === this.selected || callout.index === this.hovered;
      lines +=
        `<g class="${active ? "active" : ""}">` +
        `<polyline points="${start},${ly} ${elbow},${ly} ${ax},${ay}"/>` +
        `<circle cx="${start}" cy="${ly}" r="2.5"/><circle cx="${ax}" cy="${ay}" r="3"/></g>`;
    }
    this.lines.innerHTML = lines;
    this.mouse.querySelector(".dpi-marker").style.display = this.showCallouts ? "" : "none";

    this.badgeEl.style.top = `${oy + MOUSE_H * scale + 24}px`;
    this._paintRegions();
  }

  _paintRegions() {
    for (const region of this.mouse.querySelectorAll(".region")) {
      const index = Number(region.dataset.index);
      region.classList.toggle("hovered", this.showCallouts && index === this.hovered);
      region.classList.toggle("selected", this.showCallouts && index === this.selected);
    }
  }

  // -- interaction -------------------------------------------------------------

  _select(index) {
    this.setSelected(index);
    this.onSelect(index);
  }

  _hover(index) {
    this.hovered = index;
    this.layout();
  }
}
