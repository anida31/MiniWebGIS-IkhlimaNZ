"use strict";

// ═══════════════════════════════════════════════════════
//  CLASS: Marker
//  Represents a single map marker element + its popup.
// ═══════════════════════════════════════════════════════
class Marker {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    this.color = color;

    // marker dot
    this.element = document.createElement("div");
    this.element.className = "marker " + color;
    this.element.style.left = x - 8 + "px";
    this.element.style.top = y - 8 + "px";

    // popup label
    this.popup = document.createElement("div");
    this.popup.className = "popup";
    this.popup.innerHTML = `<strong>${color}</strong>&nbsp; x:${Math.round(x)} y:${Math.round(y)}`;
    this.popup.style.display = "none";

    this.element.appendChild(this.popup);

    // click toggles popup; stop propagation so map click doesn't fire
    this.element.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = this.popup.style.display !== "none";
      document.dispatchEvent(new CustomEvent("marker:closeAll"));
      this.popup.style.display = isOpen ? "none" : "block";
    });
  }

  addTo(mapEl) {
    mapEl.appendChild(this.element);
  }
  remove() {
    this.element.remove();
  }

  /** Global toggle — hide/show everything */
  setGlobalVisible(show) {
    this._globalVisible = show;
    this._updateDisplay();
  }

  /** Per-layer toggle */
  setLayerVisible(show) {
    this._layerVisible = show;
    this._updateDisplay();
  }

  _updateDisplay() {
    const show = this._globalVisible !== false && this._layerVisible !== false;
    this.element.style.display = show ? "block" : "none";
  }
}

// ═══════════════════════════════════════════════════════
//  CLASS: MarkerManager
//  Owns all markers; handles add / remove / toggle /
//  layer visibility / stats updates.
// ═══════════════════════════════════════════════════════
class MarkerManager {
  constructor(mapEl, statsEl) {
    this._mapEl = mapEl;
    this._stats = statsEl; // object with DOM refs for counts
    this._markers = []; // all Marker instances
    this._globalVisible = true;
    this._layerVisible = { red: true, blue: true, green: true, yellow: true };

    // listen for "close all popups" events dispatched by individual markers
    document.addEventListener("marker:closeAll", () => this._closeAllPopups());
  }

  // ── Public API ──────────────────────────────────────

  /** Add a marker at (x, y) with given color. */
  add(color, x, y) {
    const mapRect = this._mapEl.getBoundingClientRect();
    const posX = x != null ? x : Math.random() * (mapRect.width - 20) + 10;
    const posY = y != null ? y : Math.random() * (mapRect.height - 20) + 10;

    const marker = new Marker(posX, posY, color);

    // apply current visibility state to new marker
    if (!this._globalVisible) marker.setGlobalVisible(false);
    if (!this._layerVisible[color]) marker.setLayerVisible(false);

    marker.addTo(this._mapEl);
    this._markers.push(marker);
    this._updateStats();
  }

  /** Remove all markers. */
  clearAll() {
    this._markers.forEach((m) => m.remove());
    this._markers = [];
    this._updateStats();
  }

  /** Toggle global visibility of all markers. Returns new state. */
  toggleGlobal() {
    this._globalVisible = !this._globalVisible;
    this._markers.forEach((m) => m.setGlobalVisible(this._globalVisible));
    return this._globalVisible;
  }

  /** Toggle visibility of one color layer. Returns new state. */
  toggleLayer(color) {
    this._layerVisible[color] = !this._layerVisible[color];
    this._markers.filter((m) => m.color === color).forEach((m) => m.setLayerVisible(this._layerVisible[color]));
    return this._layerVisible[color];
  }

  get count() {
    return this._markers.length;
  }

  countByColor(color) {
    return this._markers.filter((m) => m.color === color).length;
  }

  // ── Private ─────────────────────────────────────────

  _closeAllPopups() {
    document.querySelectorAll(".popup").forEach((p) => (p.style.display = "none"));
  }

  _updateStats() {
    const colors = ["red", "blue", "green", "yellow"];
    this._stats.total.textContent = this._markers.length;
    colors.forEach((c) => {
      const n = this.countByColor(c);
      this._stats[c].textContent = n;
      this._stats["layer_" + c].textContent = n;
    });

    // hide/show the click hint
    const hint = document.getElementById("clickHint");
    if (hint) hint.style.opacity = this._markers.length > 0 ? "0" : "1";
  }
}

// ═══════════════════════════════════════════════════════
//  CLASS: CompassController
//  Handles auto-rotate of the SVG needle via the
//  DeviceOrientation API (works on mobile / some laptops).
//  On devices without orientation support the needle
//  simply stays pointing North (default position).
// ═══════════════════════════════════════════════════════
class CompassController {
  constructor(needleEl) {
    this._needle = needleEl;
    this._heading = 0;
    this._init();
  }

  _init() {
    if (!window.DeviceOrientationEvent) return;

    // iOS 13+ requires permission
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      // We trigger this lazily on first user interaction (see boot code).
      this._needsPermission = true;
      return;
    }

    this._listen();
  }

  requestPermission() {
    if (!this._needsPermission) return;
    DeviceOrientationEvent.requestPermission()
      .then((state) => {
        if (state === "granted") this._listen();
      })
      .catch(() => {});
  }

  _listen() {
    window.addEventListener("deviceorientationabsolute", (e) => this._onOrientation(e), true);
    window.addEventListener("deviceorientation", (e) => this._onOrientation(e), true);
  }

  _onOrientation(e) {
    // `alpha` = compass heading in degrees (0 = North, clockwise positive)
    // We rotate the needle in the opposite direction so it always points North.
    let heading = e.alpha;
    if (heading == null) return;

    // webkitCompassHeading is more accurate on iOS (already corrected for true North)
    if (e.webkitCompassHeading != null) {
      heading = e.webkitCompassHeading;
    }

    this._heading = heading;
    // Rotate needle counter to the device heading so the N tip stays toward true North
    this._needle.style.transform = `rotate(${-heading}deg)`;
  }
}

// ═══════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════
(function boot() {
  const mapEl = document.getElementById("map");

  // Gather stat DOM refs
  const statsEl = {
    total: document.getElementById("totalCount"),
    red: document.getElementById("countRed"),
    blue: document.getElementById("countBlue"),
    green: document.getElementById("countGreen"),
    yellow: document.getElementById("countYellow"),
    layer_red: document.getElementById("layerCountRed"),
    layer_blue: document.getElementById("layerCountBlue"),
    layer_green: document.getElementById("layerCountGreen"),
    layer_yellow: document.getElementById("layerCountYellow"),
  };

  const manager = new MarkerManager(mapEl, statsEl);
  const needle = document.getElementById("compassNeedle");
  const compass = new CompassController(needle);

  // iOS permission on first tap
  document.addEventListener("click", () => compass.requestPermission(), { once: true });

  // ── Active color ──────────────────────────────────────
  let activeColor = "red";

  function setActiveColor(color) {
    activeColor = color;
    ["btnAddRed", "btnAddBlue", "btnAddGreen", "btnAddYellow"].forEach((id) => {
      document.getElementById(id).style.outline = "none";
    });
    const idMap = {
      red: "btnAddRed",
      blue: "btnAddBlue",
      green: "btnAddGreen",
      yellow: "btnAddYellow",
    };
    document.getElementById(idMap[color]).style.outline = "2px solid currentColor";
  }

  // ── Map click → place marker ───────────────────────────
  mapEl.addEventListener("click", (e) => {
    // ignore clicks that land on child elements other than the map itself
    if (e.target !== mapEl) return;
    const rect = mapEl.getBoundingClientRect();
    manager.add(activeColor, e.clientX - rect.left, e.clientY - rect.top);
  });

  // ── Mouse coord display ───────────────────────────────
  const coordEl = document.getElementById("coordDisplay");
  mapEl.addEventListener("mousemove", (e) => {
    const rect = mapEl.getBoundingClientRect();
    coordEl.textContent = `x: ${Math.round(e.clientX - rect.left)}\u00a0\u00a0 y: ${Math.round(e.clientY - rect.top)}`;
  });
  mapEl.addEventListener("mouseleave", () => {
    coordEl.textContent = "x: \u2014 \u00a0 y: \u2014";
  });

  // ── Toolbar buttons ───────────────────────────────────
  function wireAddBtn(id, color) {
    document.getElementById(id).addEventListener("click", (e) => {
      e.stopPropagation();
      setActiveColor(color);
      manager.add(color);
    });
  }

  wireAddBtn("btnAddRed", "red");
  wireAddBtn("btnAddBlue", "blue");
  wireAddBtn("btnAddGreen", "green");
  wireAddBtn("btnAddYellow", "yellow");

  document.getElementById("btnClear").addEventListener("click", (e) => {
    e.stopPropagation();
    manager.clearAll();
  });

  document.getElementById("btnToggle").addEventListener("click", (e) => {
    e.stopPropagation();
    const nowVisible = manager.toggleGlobal();
    const btn = document.getElementById("btnToggle");
    btn.textContent = nowVisible ? "👁 Hide" : "👁 Show";
    btn.classList.toggle("is-hidden", !nowVisible);
  });

  // ── Layer panel ───────────────────────────────────────
  document.querySelectorAll(".layer-item").forEach((item) => {
    item.addEventListener("click", () => {
      const color = item.dataset.color;
      const nowOn = manager.toggleLayer(color);
      item.classList.toggle("off", !nowOn);
    });
  });

  // ── Init active color ─────────────────────────────────
  setActiveColor("red");
})();
