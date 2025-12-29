/**
 * Export - 导出功能
 * 包含SVG和PNG导出
 */

import { state, canvas } from './state.js';
import { MODULE_LIBRARY, DEFAULT_MODULE, DEFAULT_WIRE, WIRE_STYLES, DEFAULT_CANVAS_BG, MUX_DEFAULT } from './constants.js';
import { escapeXml, getMuxCut, getExtenderOffset, getCanvasBackgroundColor, applyCanvasBackground, ensureMuxGeometry, getModuleGradientFill } from './utils.js';
import { getPortLocalPosition, getPortPositionByRef } from './port.js';
import { buildWirePath, wireLabelPosition } from './wire.js';
import { ensureMuxPorts } from './module.js';

const MODULE_STROKE_COLORS = {
  alu: "rgba(242, 193, 78, 0.8)",
  reg: "rgba(59, 125, 115, 0.8)",
  seq: "rgba(224, 122, 95, 0.8)",
  combo: "rgba(58, 114, 176, 0.8)",
  extender: "rgba(200, 110, 140, 0.8)",
  mux: "rgba(150, 108, 203, 0.6)",
};
const DEFAULT_STROKE_COLOR = "rgba(31, 38, 43, 0.18)";
const STORAGE_KEY = "corecat-diagram";
const AUTO_SAVE_DELAY = 250;
let autoSaveTimer = null;
const PORT_LABEL_FONT_SIZE = 14;
const PORT_LABEL_HALF_HEIGHT = PORT_LABEL_FONT_SIZE / 2;
const PORT_COLOR_MIX_RATIO = 0.5;

/**
 * 保存至本地存储
 */
export function saveDiagramToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState()));
  } catch (err) {
    // Ignore storage errors (e.g., private mode or quota exceeded).
  }
}

/**
 * 计划自动保存
 */
export function scheduleAutoSave(delay = AUTO_SAVE_DELAY) {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
  }
  autoSaveTimer = setTimeout(() => {
    autoSaveTimer = null;
    saveDiagramToStorage();
  }, delay);
}

/**
 * 从本地存储加载
 */
export function loadDiagramFromStorage(callbacks) {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    return false;
  }
  if (!raw) {
    return false;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return false;
  }
  if (!data || !Array.isArray(data.modules) || !Array.isArray(data.wires)) {
    return false;
  }
  loadState(data, callbacks);
  return true;
}

/**
 * 清理本地存储
 */
export function clearDiagramStorage() {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    // Ignore storage errors.
  }
}

function resolveModuleStrokeColor(mod) {
  if (typeof mod.strokeColor === "string" && mod.strokeColor.trim() !== "") {
    return mod.strokeColor;
  }
  return MODULE_STROKE_COLORS[mod.type] || DEFAULT_STROKE_COLOR;
}

function makeGradientId(mod, index) {
  const raw = typeof mod.id === "string" && mod.id ? mod.id : `module-${index}`;
  return `moduleGradient-${raw.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

function parseRgb(color) {
  if (typeof color !== "string") {
    return null;
  }
  const rgbaMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (rgbaMatch) {
    const r = Number.parseInt(rgbaMatch[1], 10);
    const g = Number.parseInt(rgbaMatch[2], 10);
    const b = Number.parseInt(rgbaMatch[3], 10);
    const a = rgbaMatch[4] !== undefined ? Number.parseFloat(rgbaMatch[4]) : 1;
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b) || Number.isNaN(a)) {
      return null;
    }
    return { r, g, b, a };
  }
  if (color.startsWith("#")) {
    let hex = color.slice(1).trim();
    if (hex.length === 3) {
      hex = hex.split("").map((ch) => ch + ch).join("");
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = Number.parseInt(hex.slice(0, 2), 16);
      const g = Number.parseInt(hex.slice(2, 4), 16);
      const b = Number.parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
      if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b) || Number.isNaN(a)) {
        return null;
      }
      return { r, g, b, a };
    }
  }
  return null;
}

function mixWithBlack(color, ratio = PORT_COLOR_MIX_RATIO) {
  const rgb = parseRgb(color);
  if (!rgb) {
    return "";
  }
  const r = Math.round(rgb.r * ratio);
  const g = Math.round(rgb.g * ratio);
  const b = Math.round(rgb.b * ratio);
  const a = rgb.a * ratio + (1 - ratio);
  if (a >= 0.999) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  const alpha = Math.round(a * 1000) / 1000;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function resolvePortFillColor(strokeColor) {
  const mixed = mixWithBlack(strokeColor);
  if (mixed) {
    return mixed;
  }
  const fallback = mixWithBlack(DEFAULT_STROKE_COLOR);
  return fallback || "#1d262b";
}

function getPortLabelPlacement(mod, portSide) {
  const isOffsetPort = mod.type === "extender" || mod.type === "mux";
  const leftOffset = isOffsetPort ? 7 : 6;
  const rightOffset = isOffsetPort ? -8 : -10;
  switch (portSide) {
    case "left":
      return { dx: leftOffset, dy: -2, anchor: "start" };
    case "right":
      return { dx: rightOffset, dy: -2, anchor: "end" };
    case "top":
      return { dx: -2, dy: 3 + PORT_LABEL_HALF_HEIGHT, anchor: "middle" };
    case "bottom":
      return { dx: -2, dy: -(10 + PORT_LABEL_HALF_HEIGHT), anchor: "middle" };
    case "slopeTop":
      return { dx: -1, dy: 6 + PORT_LABEL_HALF_HEIGHT, anchor: "middle" };
    case "slopeBottom":
      return { dx: 1, dy: -(6 + PORT_LABEL_HALF_HEIGHT), anchor: "middle" };
    default:
      return { dx: 0, dy: 0, anchor: "middle" };
  }
}

function buildClockMarkerPath(x, y, width, height, pointDown) {
  if (pointDown) {
    return `M ${x + 1} ${y + 1} L ${x + width - 1} ${y + 1} L ${x + width / 2} ${y + height - 1} Z`;
  }
  return `M ${x + width / 2} ${y + 1} L ${x + width - 1} ${y + height - 1} L ${x + 1} ${y + height - 1} Z`;
}

/**
 * 计算图表边界
 */
export function computeDiagramBounds() {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const extendPoint = (x, y) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  const extendRect = (x, y, width, height) => {
    extendPoint(x, y);
    extendPoint(x + width, y + height);
  };

  state.modules.forEach((mod) => {
    extendRect(mod.x, mod.y, mod.width, mod.height);
  });

  state.wires.forEach((wire) => {
    const start = getPortPositionByRef(wire.from);
    const end = getPortPositionByRef(wire.to);
    if (!start || !end) {
      return;
    }
    extendPoint(start.x, start.y);
    extendPoint(end.x, end.y);

    if (Array.isArray(wire.bends) && wire.bends.length > 0) {
      wire.bends.forEach((bend) => {
        extendPoint(bend.x, bend.y);
      });
    } else if (wire.route === "V") {
      extendPoint(start.x, wire.bend);
      extendPoint(end.x, wire.bend);
    } else {
      extendPoint(wire.bend, start.y);
      extendPoint(wire.bend, end.y);
    }
    if (wire.label) {
      const labelPos = wireLabelPosition(wire, start, end);
      const pad = 24;
      extendRect(labelPos.x - pad, labelPos.y - pad, pad * 2, pad * 2);
    }
  });

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

/**
 * 构建导出SVG
 */
export function buildExportSvg(options) {
  const background = options && options.transparent ? "" : getCanvasBackgroundColor();
  const useBounds = options && options.fitToBounds;
  const padding = 32;
  const bounds = useBounds ? computeDiagramBounds() : null;
  const width = bounds ? Math.ceil(bounds.maxX - bounds.minX + padding * 2) : canvas.clientWidth;
  const height = bounds ? Math.ceil(bounds.maxY - bounds.minY + padding * 2) : canvas.clientHeight;
  const offsetX = bounds ? -bounds.minX + padding : state.view.offsetX;
  const offsetY = bounds ? -bounds.minY + padding : state.view.offsetY;
  const scale = bounds ? 1 : state.view.scale;
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
  parts.push(
    "<style>",
    ".wire{fill:none;stroke-linecap:round;stroke-linejoin:round;}",
    ".module-name{font-family:MiSans VF,Noto Sans SC,Trebuchet MS,Lucida Sans Unicode,Lucida Grande,sans-serif;font-size:16px;font-weight:700;fill:#1d262b;}",
    ".module-type{font-family:MiSans VF,Noto Sans SC,Trebuchet MS,Lucida Sans Unicode,Lucida Grande,sans-serif;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;fill:#6b6f6f;}",
    ".port-label{font-family:Maple Mono Normal NF CN,Maple Mono NF CN,Consolas,Courier New,monospace;font-size:14px;fill:#1d262b;}",
    ".wire-label{font-family:Maple Mono Normal NF CN,Maple Mono NF CN,Consolas,Courier New,monospace;font-size:11px;}",
    "</style>"
  );
  if (background) {
    parts.push(`<rect width="100%" height="100%" fill="${background}"></rect>`);
  }
  parts.push(`<g transform="translate(${offsetX} ${offsetY}) scale(${scale})">`);

  state.wires.forEach((wire) => {
    const start = getPortPositionByRef(wire.from);
    const end = getPortPositionByRef(wire.to);
    if (!start || !end) {
      return;
    }
    const color = typeof wire.color === "string" && wire.color ? wire.color : DEFAULT_WIRE.color;
    const widthValue = Number.isFinite(wire.width) ? wire.width : DEFAULT_WIRE.width;
    const dash = WIRE_STYLES[wire.style] || "";
    const dashAttr = dash ? ` stroke-dasharray="${dash}"` : "";
    parts.push(`<path class="wire" d="${buildWirePath(wire, start, end)}" stroke="${color}" stroke-width="${widthValue}"${dashAttr}></path>`);
      if (wire.label) {
        const labelPos = wireLabelPosition(wire, start, end);
        parts.push(
          `<text class="wire-label" x="${labelPos.x}" y="${labelPos.y - 10}" text-anchor="middle" dominant-baseline="central" fill="${color}">${escapeXml(
          wire.label
        )}</text>`
        );
      }
  });

  state.modules.forEach((mod, index) => {
    const stroke = resolveModuleStrokeColor(mod);
    const strokeWidth = Number.isFinite(mod.strokeWidth) ? mod.strokeWidth : DEFAULT_MODULE.strokeWidth;
    const gradientId = makeGradientId(mod, index);
    const { fillAttr, gradientDef } = getModuleGradientFill(mod, stroke, gradientId);
    const sw2 = strokeWidth / 2;
    parts.push(`<g transform="translate(${mod.x} ${mod.y})">`);
    if (gradientDef) {
      parts.push(gradientDef);
    }
    if (mod.type === "mux") {
      const cut = getMuxCut(mod);
      const path = `M ${sw2} ${sw2} L ${mod.width - sw2} ${cut} L ${mod.width - sw2} ${mod.height - cut} L ${sw2} ${mod.height - sw2} Z`;
      parts.push(`<path d="${path}" fill="${fillAttr}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"></path>`);
    } else if (mod.type === "extender") {
      const offset = getExtenderOffset(mod);
      const topLeftY = Math.max(sw2, offset);
      const path = `M ${sw2} ${topLeftY} L ${mod.width - sw2} ${sw2} L ${mod.width - sw2} ${mod.height - sw2} L ${sw2} ${mod.height - sw2} Z`;
      parts.push(`<path d="${path}" fill="${fillAttr}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"></path>`);
    } else {
      const rectWidth = Math.max(0, mod.width - strokeWidth);
      const rectHeight = Math.max(0, mod.height - strokeWidth);
      const radius = Math.max(0, 14 - sw2);
      parts.push(
        `<rect x="${sw2}" y="${sw2}" width="${rectWidth}" height="${rectHeight}" rx="${radius}" ry="${radius}" fill="${fillAttr}" stroke="${stroke}" stroke-width="${strokeWidth}"></rect>`
      );
    }

    const nameSize = Number.isFinite(mod.nameSize) ? mod.nameSize : DEFAULT_MODULE.nameSize;
    const centerX = mod.width / 2;
    const centerY = mod.height / 2;
    if (mod.showType) {
      const typeSize = 11;
      const gap = 2;
      const totalHeight = nameSize + typeSize + gap;
      const top = centerY - totalHeight / 2;
      const nameY = top + nameSize / 2;
      const typeY = top + nameSize + gap + typeSize / 2;
      parts.push(
        `<text class="module-name" x="${centerX}" y="${nameY}" text-anchor="middle" dominant-baseline="middle" font-size="${nameSize}">${escapeXml(
          mod.name
        )}</text>`
      );
      const typeLabel = MODULE_LIBRARY[mod.type] ? MODULE_LIBRARY[mod.type].label : mod.type;
      parts.push(
        `<text class="module-type" x="${centerX}" y="${typeY}" text-anchor="middle" dominant-baseline="middle" font-size="${typeSize}">${escapeXml(
          typeLabel
        )}</text>`
      );
    } else {
      parts.push(
        `<text class="module-name" x="${centerX}" y="${centerY}" text-anchor="middle" dominant-baseline="middle" font-size="${nameSize}">${escapeXml(
          mod.name
        )}</text>`
      );
    }

    const CLOCKED_TYPES = new Set(["reg", "seq"]);
    const isClockPort = (port) =>
      CLOCKED_TYPES.has(mod.type) &&
      // (port.clock === true || port.name === "CLK");
      (port.clock === true || String(port.name).toUpperCase() === "CLK");

    const portFill = resolvePortFillColor(stroke);
    const portOffset = mod.type === "extender" || mod.type === "mux" ? 0 : 0;

    mod.ports.forEach((port) => {
      const local = getPortLocalPosition(mod, port);
      if (isClockPort(port)) {
        const markerWidth = 24;
        const markerHeight = 12;
        const markerX = local.x - markerWidth / 2 + 1;
        const markerY = port.side === "bottom" ? local.y - markerHeight + 1 : local.y - 1;
        const markerPath = buildClockMarkerPath(markerX, markerY, markerWidth, markerHeight, port.side !== "bottom");
        parts.push(
          `<path d="${markerPath}" fill="none" stroke="${portFill}" stroke-width="3" stroke-linejoin="round"></path>`
        );
        return;
      }
      parts.push(`<circle cx="${local.x + portOffset}" cy="${local.y + portOffset}" r="6" fill="${portFill}"></circle>`);
      const placement = getPortLabelPlacement(mod, port.side);
      const labelX = local.x + placement.dx + 2.5;
      const labelY = local.y + placement.dy + 2.5;
      const anchor = placement.anchor;
      parts.push(
        `<text class="port-label" x="${labelX}" y="${labelY}" text-anchor="${anchor}" dominant-baseline="middle">${escapeXml(port.name)}</text>`
      );
    });

    parts.push("</g>");
  });

  parts.push("</g></svg>");
  return { svg: parts.join(""), width, height };
}

/**
 * 下载Blob文件
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 导出SVG
 */
export function exportSvg() {
  const result = buildExportSvg({
    transparent: state.export.transparent,
    fitToBounds: state.export.fitToBounds,
  });
  const blob = new Blob([result.svg], { type: "image/svg+xml;charset=utf-8" });
  downloadBlob(blob, "corecat-diagram.svg");
}

/**
 * 导出PNG
 */
export function exportPng() {
  const result = buildExportSvg({
    transparent: state.export.transparent,
    fitToBounds: state.export.fitToBounds,
  });
  const svgBlob = new Blob([result.svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();
  img.onload = () => {
    const scale = Math.max(2, window.devicePixelRatio || 1);
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = Math.round(result.width * scale);
    exportCanvas.height = Math.round(result.height * scale);
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) {
      URL.revokeObjectURL(url);
      return;
    }
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, result.width, result.height);
    ctx.drawImage(img, 0, 0);
    exportCanvas.toBlob((blob) => {
      if (blob) {
        downloadBlob(blob, "corecat-diagram.png");
      }
      URL.revokeObjectURL(url);
    }, "image/png");
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    alert("Failed to export PNG.");
  };
  img.src = url;
}

/**
 * 序列化状态
 */
export function serializeState() {
  return {
    canvasBackground: state.canvasBackground,
    modules: state.modules.map((mod) => ({
      id: mod.id,
      type: mod.type,
      name: mod.name,
      x: mod.x,
      y: mod.y,
      width: mod.width,
      height: mod.height,
      nameSize: mod.nameSize,
      showType: mod.showType,
      fill: mod.fill,
      strokeColor: mod.strokeColor,
      strokeWidth: mod.strokeWidth,
      muxInputs: mod.muxInputs,
      muxControlSide: mod.muxControlSide,
      ports: mod.ports.map((port) => ({
        id: port.id,
        name: port.name,
        side: port.side,
        offset: port.offset,
      })),
    })),
    wires: state.wires.map((wire) => ({
      id: wire.id,
      from: wire.from,
      to: wire.to,
      label: wire.label,
      route: wire.route,
      bend: wire.bend,
      bends: wire.bends,
      color: wire.color,
      width: wire.width,
      style: wire.style,
    })),
  };
}

/**
 * 刷新ID计数器
 */
export function refreshIdCounter() {
  let maxId = 0;
  const track = (id) => {
    const match = /-(\d+)$/.exec(id);
    if (match) {
      maxId = Math.max(maxId, Number.parseInt(match[1], 10));
    }
  };
  state.modules.forEach((mod) => {
    track(mod.id);
    mod.ports.forEach((port) => track(port.id));
  });
  state.wires.forEach((wire) => track(wire.id));
  state.nextId = maxId + 1;
}

/**
 * 加载状态
 */
export function loadState(data, callbacks) {
  if (!data || !Array.isArray(data.modules) || !Array.isArray(data.wires)) {
    alert("Invalid diagram data.");
    return;
  }
  state.canvasBackground = typeof data.canvasBackground === "string" ? data.canvasBackground : "";
  applyCanvasBackground();
  state.modules = data.modules.map((mod) => {
    const nameSize = Number.isFinite(mod.nameSize) ? mod.nameSize : DEFAULT_MODULE.nameSize;
    const showType = mod.showType !== false;
    const muxInputs = Number.isFinite(mod.muxInputs) ? mod.muxInputs : MUX_DEFAULT.inputs;
    const muxControlSide = mod.muxControlSide === "bottom" ? "bottom" : MUX_DEFAULT.controlSide;
    const fill = typeof mod.fill === "string" ? mod.fill : DEFAULT_MODULE.fill;
    const strokeColor = typeof mod.strokeColor === "string" ? mod.strokeColor : DEFAULT_MODULE.strokeColor;
    const strokeWidth = Number.isFinite(mod.strokeWidth) ? mod.strokeWidth : DEFAULT_MODULE.strokeWidth;
    return {
      ...mod,
      nameSize,
      showType,
      fill,
      strokeColor,
      strokeWidth,
      muxInputs,
      muxControlSide,
    };
  });
  state.wires = data.wires.map((wire) => {
    const width = Number.isFinite(wire.width) ? wire.width : DEFAULT_WIRE.width;
    const color = typeof wire.color === "string" && wire.color ? wire.color : DEFAULT_WIRE.color;
    const style = WIRE_STYLES[wire.style] !== undefined ? wire.style : DEFAULT_WIRE.style;
    const bends = Array.isArray(wire.bends) ? wire.bends : null;
    return {
      ...wire,
      color,
      width,
      style,
      bends,
    };
  });
  state.selection = null;
  state.connecting = null;
  refreshIdCounter();
  state.modules.forEach((mod) => {
    if (mod.type === "mux") {
      const hasPorts = Array.isArray(mod.ports) && mod.ports.length > 0;
      if (!hasPorts) {
        ensureMuxPorts(mod);
      }
      ensureMuxGeometry(mod);
    }
  });

  if (callbacks) {
    callbacks.renderModules();
    callbacks.updateWires();
    callbacks.renderProperties();
    callbacks.updateStatus();
  }
}
