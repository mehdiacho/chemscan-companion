import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import {
  availableMonitors,
  currentMonitor,
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
} from "@tauri-apps/api/window";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { NAMES } from "./names";

type SampleState = "solid" | "liquid" | "gas";
type Nature = "organic" | "inorganic";
type View = "calc" | "names" | "app";
type NameFilter = "all" | "circled";

interface Settings {
  ionSize: number;
  ionSizeIsMax: boolean;
  deltaV: number;
  threshold: number;
  matrixSize: number;
}

interface Point {
  x: number;
  y: number;
}

interface Saved {
  state: SampleState;
  nature: Nature;
  weight: string;
  version: string;
  pinned: boolean;
  view: View;
  nameFilter: NameFilter;
  autoUpdate: boolean;
  panelPos?: Point;
  bubblePos?: Point;
}

const PANEL_SIZE = new LogicalSize(300, 470);
const BUBBLE_SIZE = new LogicalSize(56, 56);
const STORAGE_KEY = "chemscan-companion";
const MARGIN = 16;
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

const win = getCurrentWindow();
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const panel = $<HTMLElement>("#panel");
const bubble = $<HTMLButtonElement>("#bubble");
const pinBtn = $<HTMLButtonElement>("#pin");
const weightInput = $<HTMLInputElement>("#weight");
const versionInput = $<HTMLInputElement>("#version");
const message = $<HTMLParagraphElement>("#message");

function load(): Saved {
  const defaults: Saved = {
    state: "solid",
    nature: "inorganic",
    weight: "",
    version: "1.04",
    pinned: true,
    view: "calc",
    nameFilter: "all",
    autoUpdate: true,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
  } catch {
    return defaults;
  }
}

const saved = load();
let mode: "panel" | "bubble" = "panel";

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Storage is a convenience; the app works without it.
  }
}

// ---------- Calculator ----------

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

function setResult(key: keyof Settings, html: string, raw: string) {
  const el = document.querySelector<HTMLElement>(`.result[data-key="${key}"]`)!;
  el.querySelector(".result-value")!.innerHTML = html;
  el.dataset.copy = raw;
}

function clearResults() {
  for (const key of ["ionSize", "deltaV", "threshold", "matrixSize"] as const) {
    setResult(key, "â€“", "");
  }
}

async function recalc() {
  weightInput.classList.remove("invalid");
  versionInput.classList.remove("invalid");
  message.classList.remove("error");
  message.textContent = "";

  const weight = Number.parseFloat(saved.weight);
  if (saved.weight.trim() === "") {
    clearResults();
    message.textContent = "Enter the sample weight to get settings.";
    return;
  }

  try {
    const s = await invoke<Settings>("calculate", {
      state: saved.state,
      nature: saved.nature,
      weightGrams: Number.isFinite(weight) ? weight : -1,
      version: saved.version,
    });
    setResult(
      "ionSize",
      s.ionSizeIsMax ? `${fmt(s.ionSize)}<small>max</small>` : fmt(s.ionSize),
      fmt(s.ionSize),
    );
    setResult("deltaV", fmt(s.deltaV), fmt(s.deltaV));
    setResult("threshold", fmt(s.threshold), fmt(s.threshold));
    setResult("matrixSize", String(s.matrixSize), String(s.matrixSize));
    if (s.ionSizeIsMax) message.textContent = "Gas: ion size must not exceed 1.3.";
  } catch (err) {
    clearResults();
    const text = String(err);
    message.textContent = text;
    message.classList.add("error");
    (text.toLowerCase().includes("version") ? versionInput : weightInput).classList.add("invalid");
  }
}

function initSegmented(name: "state" | "nature" | "nameFilter", onChange: () => void = recalc) {
  const group = document.querySelector<HTMLElement>(`.segmented[data-name="${name}"]`)!;
  const buttons = [...group.querySelectorAll<HTMLButtonElement>("button")];
  const sync = () => buttons.forEach((b) => b.classList.toggle("active", b.dataset.value === saved[name]));
  buttons.forEach((b) =>
    b.addEventListener("click", () => {
      (saved[name] as string) = b.dataset.value!;
      sync();
      persist();
      onChange();
    }),
  );
  sync();
}

function initCalculator() {
  initSegmented("state");
  initSegmented("nature");
  weightInput.value = saved.weight;
  versionInput.value = saved.version;
  weightInput.addEventListener("input", () => {
    saved.weight = weightInput.value;
    persist();
    recalc();
  });
  versionInput.addEventListener("input", () => {
    saved.version = versionInput.value;
    persist();
    recalc();
  });
  document.querySelectorAll<HTMLElement>(".result").forEach((el) =>
    el.addEventListener("click", async () => {
      if (!el.dataset.copy) return;
      try {
        await navigator.clipboard.writeText(el.dataset.copy);
        el.classList.add("copied");
        setTimeout(() => el.classList.remove("copied"), 600);
      } catch {
        // Clipboard can be unavailable; copying is optional.
      }
    }),
  );
  recalc();
}

// ---------- Sections ----------

function showView(view: View) {
  saved.view = view;
  persist();
  document.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((b) => {
    const on = b.dataset.view === view;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", String(on));
  });
  for (const v of ["calc", "names", "app"] as const) $(`#view-${v}`).hidden = v !== view;
  if (view === "names") nameSearch.focus();
}

function initTabs() {
  document
    .querySelectorAll<HTMLButtonElement>(".tabs button")
    .forEach((b) => b.addEventListener("click", () => showView(b.dataset.view as View)));
  showView(saved.view);
}

// ---------- Names ----------

const nameSearch = $<HTMLInputElement>("#name-search");
const nameList = $<HTMLDivElement>("#name-list");
const nameCount = $<HTMLParagraphElement>("#name-count");

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function highlight(name: string, query: string): string {
  const i = query ? name.toLowerCase().indexOf(query) : -1;
  if (i < 0) return escapeHtml(name);
  const end = i + query.length;
  return `${escapeHtml(name.slice(0, i))}<mark>${escapeHtml(name.slice(i, end))}</mark>${escapeHtml(name.slice(end))}`;
}

function renderNames() {
  const query = nameSearch.value.trim().toLowerCase();
  const matches = NAMES.filter(
    (n) =>
      (saved.nameFilter === "all" || n.circled) &&
      (!query || (!n.redacted && n.name.toLowerCase().includes(query))),
  );
  const circled = matches.filter((n) => n.circled).length;
  nameCount.textContent = `${matches.length} of ${NAMES.length} names, ${circled} circled`;

  if (matches.length === 0) {
    nameList.innerHTML = `<p class="empty">No names match.</p>`;
    return;
  }
  let html = "";
  let column = 0;
  for (const n of matches) {
    if (n.column !== column) {
      column = n.column;
      html += `<p class="name-col">Column ${column}</p>`;
    }
    const cls = ["name", n.circled && "circled", n.struck && "struck", n.redacted && "redacted"].filter(Boolean).join(" ");
    const label = n.redacted ? "" : highlight(n.name, query);
    html += `<div class="${cls}" title="${n.redacted ? "Blacked out on the list" : ""}"><span>${label}</span></div>`;
  }
  nameList.innerHTML = html;
}

function initNames() {
  initSegmented("nameFilter", renderNames);
  nameSearch.addEventListener("input", renderNames);
  nameSearch.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      nameSearch.value = "";
      renderNames();
    }
  });
  renderNames();
}

// ---------- Updates ----------

const autoUpdateBtn = $<HTMLButtonElement>("#auto-update");
const checkBtn = $<HTMLButtonElement>("#check-update");
const updateStatus = $<HTMLParagraphElement>("#update-status");
const updateDot = $<HTMLSpanElement>("#update-dot");
let checking = false;
let updateTimer: number | undefined;

function setUpdateStatus(text: string, error = false) {
  updateStatus.textContent = text;
  updateStatus.classList.toggle("error", error);
}

/** Checks GitHub Releases; if a newer version exists it installs it and restarts. */
async function checkForUpdates(manual: boolean) {
  if (checking) return;
  checking = true;
  checkBtn.disabled = true;
  if (manual) setUpdateStatus("Checking for updates…");
  try {
    const update = await check();
    if (!update) {
      if (manual) setUpdateStatus(`You're on the latest version (checked ${new Date().toLocaleTimeString()}).`);
      return;
    }
    updateDot.hidden = false;
    setUpdateStatus(`Downloading version ${update.version}…`);
    let total = 0;
    let done = 0;
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") total = event.data.contentLength ?? 0;
      if (event.event === "Progress") {
        done += event.data.chunkLength;
        if (total) setUpdateStatus(`Downloading version ${update.version}… ${Math.round((done / total) * 100)}%`);
      }
      if (event.event === "Finished") setUpdateStatus(`Installing version ${update.version}…`);
    });
    await relaunch();
  } catch (err) {
    if (manual) setUpdateStatus(`Couldn't check for updates: ${err}`, true);
    else console.warn("update check failed", err);
  } finally {
    checking = false;
    checkBtn.disabled = false;
  }
}

function scheduleUpdates() {
  clearInterval(updateTimer);
  updateTimer = undefined;
  if (!saved.autoUpdate) return;
  updateTimer = window.setInterval(() => checkForUpdates(false), UPDATE_INTERVAL_MS);
}

function setAutoUpdate(on: boolean) {
  saved.autoUpdate = on;
  autoUpdateBtn.setAttribute("aria-checked", String(on));
  persist();
  scheduleUpdates();
}

async function initUpdates() {
  autoUpdateBtn.addEventListener("click", () => {
    setAutoUpdate(!saved.autoUpdate);
    if (saved.autoUpdate) checkForUpdates(false);
  });
  checkBtn.addEventListener("click", () => checkForUpdates(true));
  setAutoUpdate(saved.autoUpdate);
  try {
    $("#app-version").textContent = await getVersion();
  } catch {
    // Only available inside the app.
  }
  if (saved.autoUpdate) checkForUpdates(false);
}

// ---------- Window behaviour ----------

async function onScreen(p: Point): Promise<boolean> {
  const monitors = await availableMonitors();
  return monitors.some(
    (m) =>
      p.x >= m.position.x &&
      p.y >= m.position.y &&
      p.x < m.position.x + m.size.width - 20 &&
      p.y < m.position.y + m.size.height - 20,
  );
}

/** Bottom-right corner of the current monitor's work area, for first launch. */
async function cornerFor(size: LogicalSize): Promise<Point> {
  const m = await currentMonitor();
  if (!m) return { x: 100, y: 100 };
  const scale = m.scaleFactor;
  const area = m.workArea ?? { position: m.position, size: m.size };
  return {
    x: Math.round(area.position.x + area.size.width - (size.width + MARGIN) * scale),
    y: Math.round(area.position.y + area.size.height - (size.height + MARGIN) * scale),
  };
}

async function placeAt(saved: Point | undefined, size: LogicalSize) {
  const pos = saved && (await onScreen(saved)) ? saved : await cornerFor(size);
  await win.setPosition(new PhysicalPosition(pos.x, pos.y));
}

async function rememberPosition() {
  const p = await win.outerPosition();
  const point = { x: p.x, y: p.y };
  if (mode === "bubble") saved.bubblePos = point;
  else saved.panelPos = point;
  persist();
}

async function setPinned(pinned: boolean) {
  saved.pinned = pinned;
  pinBtn.setAttribute("aria-pressed", String(pinned));
  pinBtn.title = pinned ? "Always on top: on" : "Always on top: off";
  persist();
  if (mode === "panel") await win.setAlwaysOnTop(pinned);
}

async function toBubble() {
  await rememberPosition();
  mode = "bubble";
  panel.hidden = true;
  bubble.hidden = false;
  await win.setSize(BUBBLE_SIZE);
  if (!saved.bubblePos && saved.panelPos) {
    // First time: drop the bubble at the panel's top-right corner.
    const scale = await win.scaleFactor();
    saved.bubblePos = {
      x: Math.round(saved.panelPos.x + (PANEL_SIZE.width - BUBBLE_SIZE.width) * scale),
      y: saved.panelPos.y,
    };
  }
  await placeAt(saved.bubblePos, BUBBLE_SIZE);
  await win.setAlwaysOnTop(true);
  await win.setSkipTaskbar(true);
}

async function toPanel() {
  await rememberPosition();
  mode = "panel";
  bubble.hidden = true;
  panel.hidden = false;
  await win.setSize(PANEL_SIZE);
  await placeAt(saved.panelPos, PANEL_SIZE);
  await win.setAlwaysOnTop(saved.pinned);
  await win.setSkipTaskbar(false);
  await win.setFocus();
}

function initBubbleDrag() {
  // A press that moves becomes a window drag; a press that doesn't is a click.
  let start: Point | null = null;
  bubble.addEventListener("mousedown", (e) => {
    if (e.button === 0) start = { x: e.screenX, y: e.screenY };
  });
  bubble.addEventListener("mousemove", (e) => {
    if (!start) return;
    if (Math.hypot(e.screenX - start.x, e.screenY - start.y) > 3) {
      start = null;
      win.startDragging();
    }
  });
  bubble.addEventListener("mouseup", () => {
    if (start) {
      start = null;
      toPanel();
    }
  });
  bubble.addEventListener("mouseleave", () => (start = null));
}

async function initWindow() {
  pinBtn.addEventListener("click", () => setPinned(!saved.pinned));
  $("#to-bubble").addEventListener("click", toBubble);
  $("#minimize").addEventListener("click", () => win.minimize());
  $("#close").addEventListener("click", async () => {
    await rememberPosition();
    await win.close();
  });
  initBubbleDrag();

  let moveTimer: number | undefined;
  await win.onMoved(() => {
    clearTimeout(moveTimer);
    moveTimer = window.setTimeout(rememberPosition, 250);
  });

  await win.setSize(PANEL_SIZE);
  await placeAt(saved.panelPos, PANEL_SIZE);
  await setPinned(saved.pinned);
  await win.show();
  await win.setFocus();
}

initCalculator();
initNames();
initTabs();
initWindow();
initUpdates();
