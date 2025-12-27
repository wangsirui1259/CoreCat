const NS = "http://www.w3.org/2000/svg";

function buildMuxSvgBackground(mod) {
  const width = mod.width;
  const height = mod.height;
  const cut = getMuxCut(mod);
  const strokeColor = mod.strokeColor || 'rgba(150, 108, 203, 0.6)';
  const strokeWidth = Number.isFinite(mod.strokeWidth) ? mod.strokeWidth : 2;
  const fillColor = mod.fill || 'rgba(255, 253, 249, 0.95)';

  // 梯形路径：左上 -> 右上(下移cut) -> 右下(上移cut) -> 左下
  const path = `M ${strokeWidth / 2} ${strokeWidth / 2} 
                L ${width - strokeWidth / 2} ${cut} 
                L ${width - strokeWidth / 2} ${height - cut} 
                L ${strokeWidth / 2} ${height - strokeWidth / 2} Z`;

  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' viewBox='0 0 ${width} ${height}'>
    <path d='${path}' fill='${fillColor}' stroke='${strokeColor}' stroke-width='${strokeWidth}' stroke-linejoin='round'/>
  </svg>`;

  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const MODULE_LIBRARY = {
  alu: {
    label: "ALU",
    width: 170,
    height: 110,
    ports: [
      { name: "A", side: "left", offset: 0.25 },
      { name: "B", side: "left", offset: 0.7 },
      { name: "Op", side: "top", offset: 0.5 },
      { name: "Out", side: "right", offset: 0.5 },
    ],
  },
  reg: {
    label: "Clocked Reg",
    width: 160,
    height: 100,
    ports: [
      { name: "D", side: "left", offset: 0.5 },
      { name: "Q", side: "right", offset: 0.5 },
      { name: "CLK", side: "top", offset: 0.5, clock: true },
      // { name: "RST", side: "bottom", offset: 0.75 }
    ],
  },
  logic: {
    label: "Logic",
    width: 150,
    height: 90,
    ports: [
      { name: "In1", side: "left", offset: 0.35 },
      { name: "In2", side: "left", offset: 0.7 },
      { name: "Out", side: "right", offset: 0.5 },
    ],
  },
  combo: {
    label: "Combinational",
    width: 180,
    height: 110,
    ports: [
      { name: "InA", side: "left", offset: 0.3 },
      { name: "InB", side: "left", offset: 0.7 },
      { name: "Sel", side: "top", offset: 0.5 },
      { name: "Out", side: "right", offset: 0.5 },
    ],
  },
  mux: {
    label: "MUX",
    width: 60,
    height: 300,
    ports: [],
  },
};

const DEFAULT_MODULE = {
  nameSize: 14,
  showType: false,
  fill: "",
  strokeColor: "",
  strokeWidth: 2,
};

const MUX_DEFAULT = {
  inputs: 4,
  controlSide: "top",
  controlOffsetTop: 0.6,
  controlOffsetBottom: 0.6,
  slopeAngle: 60,
  minRight: 24,
};

const DEFAULT_WIRE = {
  color: "#263238",
  width: 2.4,
  style: "solid",
};

// Minimum distance between wires and module edges
const WIRE_MARGIN = 20;

const DEFAULT_CANVAS_BG = "#f6f1e8";

const WIRE_STYLES = {
  solid: "",
  dashed: "8 6",
  dotted: "2 6",
};

const state = {
  modules: [],
  wires: [],
  selection: null,
  connecting: null,
  drag: null,
  dragWire: null,
  pan: null,
  nextId: 1,
  typeCounts: {},
  canvasBackground: "",
  view: {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  },
  export: {
    transparent: true,
    fitToBounds: true,
  },
};

const moduleElements = new Map();

const canvas = document.getElementById("canvas");
const wireLayer = document.getElementById("wire-layer");
const moduleLayer = document.getElementById("module-layer");
const propertiesContent = document.getElementById("properties-content");
const statusEl = document.getElementById("status");

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function uid(prefix) {
  return `${prefix}-${state.nextId++}`;
}

function getCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left - state.view.offsetX) / state.view.scale,
    y: (event.clientY - rect.top - state.view.offsetY) / state.view.scale,
  };
}

function getModuleById(id) {
  return state.modules.find((mod) => mod.id === id);
}

function getPortById(mod, portId) {
  return mod.ports.find((port) => port.id === portId);
}

function getPortLocalPosition(mod, port) {
  // 获取边框宽度，默认为 1px（与 DEFAULT_MODULE. strokeWidth 保持一致）
  const borderWidth = Number.isFinite(mod.strokeWidth) ? mod.strokeWidth : 1;

  if (port.side === "slopeTop" || port.side === "slopeBottom") {
    const cut = getMuxCut(mod);
    const t = clamp(port.offset, 0, 1);
    const y = port.side === "slopeTop" ? cut * t : mod.height - cut * t;
    return { x: mod.width * t, y };
  }
  if (port.side === "left") {
    return { x: borderWidth / 2, y: mod.height * port.offset };
  }
  if (port.side === "right") {
    return { x: mod.width - borderWidth / 2, y: mod.height * port.offset };
  }
  if (port.side === "top") {
    return { x: mod.width * port.offset, y: borderWidth / 2 };
  }
  // bottom
  return { x: mod.width * port.offset, y: mod.height - borderWidth / 2 };
}

function getPortPosition(mod, port) {
  const local = getPortLocalPosition(mod, port);
  return {
    x: mod.x + local.x,
    y: mod.y + local.y,
  };
}

function getPortPositionByRef(ref) {
  const mod = getModuleById(ref.moduleId);
  if (!mod) {
    return null;
  }
  const port = getPortById(mod, ref.portId);
  if (!port) {
    return null;
  }
  return getPortPosition(mod, port);
}

function describePortRef(ref) {
  const mod = getModuleById(ref.moduleId);
  if (!mod) {
    return "Unknown";
  }
  const port = getPortById(mod, ref.portId);
  if (!port) {
    return mod.name;
  }
  return `${mod.name}:${port.name}`;
}

function isClockPort(mod, port) {
  if (!mod || !port) {
    return false;
  }
  if (mod.type !== "reg") {
    return false;
  }
  return port.clock === true || port.name === "CLK";
}

function escapeXml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;");
}

function applyModuleAppearance(el, mod) {
  if (mod.fill) {
    el.style.setProperty("--module-fill", mod.fill);
  }
  if (mod.strokeColor) {
    el.style.setProperty("--module-stroke", mod.strokeColor);
  }
  if (Number.isFinite(mod.strokeWidth)) {
    el.style.setProperty("--module-stroke-width", `${mod.strokeWidth}px`);
  }
}

function getCanvasBackgroundColor() {
  return state.canvasBackground || DEFAULT_CANVAS_BG;
}

function applyCanvasBackground() {
  if (state.canvasBackground) {
    canvas.style.background = state.canvasBackground;
  } else {
    canvas.style.background = "";
  }
}

function computeDiagramBounds() {
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
    
    // Handle multi-segment bends
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

function getMuxCut(mod) {
  const angle = ((90 - MUX_DEFAULT.slopeAngle) * Math.PI) / 180;
  const cut = mod.width * Math.tan(angle);
  return clamp(cut, 8, mod.width - 12);
}

function muxMinHeight(width) {
  const angle = ((90 - MUX_DEFAULT.slopeAngle) * Math.PI) / 180;
  return Math.max(60, 2 * width * Math.tan(angle) + MUX_DEFAULT.minRight);
}

function muxMaxWidth(height) {
  const angle = ((90 - MUX_DEFAULT.slopeAngle) * Math.PI) / 180;
  const maxCut = Math.max(0, (height - MUX_DEFAULT.minRight) / 2);
  if (maxCut <= 0) {
    return 0;
  }
  return maxCut / Math.tan(angle);
}

function ensureMuxGeometry(mod, mode) {
  mod.width = clamp(Math.round(mod.width), 60, 300);
  mod.height = clamp(Math.round(mod.height), 120, 600);

  if (mode === "keepHeight") {
    const maxWidth = muxMaxWidth(mod.height);
    if (Number.isFinite(maxWidth) && maxWidth > 0 && mod.width > maxWidth) {
      mod.width = Math.max(60, Math.round(maxWidth));
    }
  }

  const minHeight = muxMinHeight(mod.width);
  if (mod.height < minHeight) {
    mod.height = Math.round(minHeight);
  }
  return getMuxCut(mod);
}

function ensureMuxPorts(mod) {
  const inputs = clamp(Math.round(mod.muxInputs || MUX_DEFAULT.inputs), 2, 8);
  const controlSide = mod.muxControlSide === "bottom" ? "bottom" : MUX_DEFAULT.controlSide;
  mod.muxInputs = inputs;
  mod.muxControlSide = controlSide;

  const existingByName = new Map();
  mod.ports.forEach((port) => existingByName.set(port.name, port));

  const ports = [];
  for (let i = 0; i < inputs; i += 1) {
    const name = `I${i + 1}`;
    const existing = existingByName.get(name);
    ports.push({
      id: existing ? existing.id : uid("port"),
      name,
      side: "left",
      offset: (i + 1) / (inputs + 1),
    });
  }

  const selExisting = existingByName.get("Sel");
  ports.push({
    id: selExisting ? selExisting.id : uid("port"),
    name: "Sel",
    side: controlSide === "bottom" ? "slopeBottom" : "slopeTop",
    offset: controlSide === "bottom" ? MUX_DEFAULT.controlOffsetBottom : MUX_DEFAULT.controlOffsetTop,
  });

  const outExisting = existingByName.get("Out");
  ports.push({
    id: outExisting ? outExisting.id : uid("port"),
    name: "Out",
    side: "right",
    offset: 0.5,
  });

  const allowedIds = new Set(ports.map((port) => port.id));
  state.wires = state.wires.filter((wire) => {
    if (wire.from.moduleId === mod.id && !allowedIds.has(wire.from.portId)) {
      return false;
    }
    if (wire.to.moduleId === mod.id && !allowedIds.has(wire.to.portId)) {
      return false;
    }
    return true;
  });

  mod.ports = ports;
}

function createModule(type, x, y) {
  const library = MODULE_LIBRARY[type] || MODULE_LIBRARY.logic;
  const count = (state.typeCounts[type] = (state.typeCounts[type] || 0) + 1);
  const moduleItem = {
    id: uid("mod"),
    type,
    name: `${library.label} ${count}`,
    x: Math.round(x),
    y: Math.round(y),
    width: library.width,
    height: library.height,
    nameSize: DEFAULT_MODULE.nameSize,
    showType: DEFAULT_MODULE.showType,
    ports: library.ports.map((port) => ({
      id: uid("port"),
      name: port.name,
      side: port.side,
      offset: port.offset,
      clock: port.clock === true,
    })),
  };
  if (type === "mux") {
    moduleItem.muxInputs = MUX_DEFAULT.inputs;
    moduleItem.muxControlSide = MUX_DEFAULT.controlSide;
    moduleItem.ports = [];
    ensureMuxPorts(moduleItem);
  }
  state.modules.push(moduleItem);
  select({ type: "module", id: moduleItem.id });
}

function createWire(from, to) {
  const wire = {
    id: uid("wire"),
    from,
    to,
    label: "",
    route: "H",
    bend: 0,
    bends: null, // For multi-segment routing
    color: DEFAULT_WIRE.color,
    width: DEFAULT_WIRE.width,
    style: DEFAULT_WIRE.style,
  };
  setWireDefaultBend(wire);
  // Try to apply smart routing to avoid modules
  setWireSmartBends(wire);
  state.wires.push(wire);
  select({ type: "wire", id: wire.id });
}

function setWireDefaultBend(wire) {
  const start = getPortPositionByRef(wire.from);
  const end = getPortPositionByRef(wire.to);
  if (!start || !end) {
    return;
  }
  if (wire.route === "V") {
    wire.bend = Math.round((start.y + end.y) / 2);
  } else {
    wire.bend = Math.round((start.x + end.x) / 2);
  }
  // Initialize bends array for multi-segment support
  wire.bends = null;
}

// Get module bounding box with margin for wire routing
function getModuleBounds(mod, margin = WIRE_MARGIN) {
  return {
    left: mod.x - margin,
    right: mod.x + mod.width + margin,
    top: mod.y - margin,
    bottom: mod.y + mod.height + margin,
  };
}

// Check if a point is inside a rectangle
function pointInRect(x, y, rect) {
  return x > rect.left && x < rect.right && y > rect.top && y < rect.bottom;
}

// Check if a horizontal line segment intersects with a rectangle (excluding endpoints)
function hLineIntersectsRect(y, x1, x2, rect) {
  if (y <= rect.top || y >= rect.bottom) return false;
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  return maxX > rect.left && minX < rect.right;
}

// Check if a vertical line segment intersects with a rectangle (excluding endpoints)
function vLineIntersectsRect(x, y1, y2, rect) {
  if (x <= rect.left || x >= rect.right) return false;
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  return maxY > rect.top && minY < rect.bottom;
}

// Get all modules that a wire might intersect with
// includeEndpoints: if true, also include source/target modules as potential obstacles
function getObstacleModules(wire, includeEndpoints = false) {
  if (includeEndpoints) {
    return state.modules;
  }
  return state.modules.filter((mod) => mod.id !== wire.from.moduleId && mod.id !== wire.to.moduleId);
}

// Check if the simple 3-segment path intersects any module (including source/target modules)
function checkPathCollision(wire, start, end) {
  // Check all modules including source and target - the wire path may pass through them
  const allModules = getObstacleModules(wire, true);
  
  for (const mod of allModules) {
    const rect = getModuleBounds(mod);
    
    if (wire.route === "V") {
      const midY = wire.bend;
      // Segment 1: vertical from start.y to midY at start.x
      if (vLineIntersectsRect(start.x, start.y, midY, rect)) return true;
      // Segment 2: horizontal from start.x to end.x at midY
      if (hLineIntersectsRect(midY, start.x, end.x, rect)) return true;
      // Segment 3: vertical from midY to end.y at end.x
      if (vLineIntersectsRect(end.x, midY, end.y, rect)) return true;
    } else {
      const midX = wire.bend;
      // Segment 1: horizontal from start.x to midX at start.y
      if (hLineIntersectsRect(start.y, start.x, midX, rect)) return true;
      // Segment 2: vertical from start.y to end.y at midX
      if (vLineIntersectsRect(midX, start.y, end.y, rect)) return true;
      // Segment 3: horizontal from midX to end.x at end.y
      if (hLineIntersectsRect(end.y, midX, end.x, rect)) return true;
    }
  }
  
  return false;
}

// Compute a smart route that avoids ALL modules
// Uses a bounding-box approach: finds the combined bounds of all obstacles in the path and routes around them
function computeSmartRoute(wire, start, end) {
  // Include all modules including source/target as potential obstacles
  const allModules = getObstacleModules(wire, true);
  if (allModules.length === 0) return null;
  
  const margin = WIRE_MARGIN;
  
  // Find all obstacles that are in the wire's bounding box area
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  
  // Collect all modules that could interfere with the wire path
  const relevantModules = allModules.filter((mod) => {
    const rect = getModuleBounds(mod, margin);
    // Check if module's bounding box overlaps with wire's bounding box
    return !(rect.right < minX - margin || rect.left > maxX + margin ||
             rect.bottom < minY - margin || rect.top > maxY + margin);
  });
  
  if (relevantModules.length === 0) return null;
  
  // Compute combined bounding box of all relevant modules
  let combinedLeft = Infinity, combinedRight = -Infinity;
  let combinedTop = Infinity, combinedBottom = -Infinity;
  
  for (const mod of relevantModules) {
    const rect = getModuleBounds(mod, margin);
    combinedLeft = Math.min(combinedLeft, rect.left);
    combinedRight = Math.max(combinedRight, rect.right);
    combinedTop = Math.min(combinedTop, rect.top);
    combinedBottom = Math.max(combinedBottom, rect.bottom);
  }
  
  if (wire.route === "H") {
    // Horizontal-first routing
    // Determine the exit and entry X positions based on start/end positions relative to combined bounds
    let midX1, midX2;
    
    // For start position
    if (start.x >= combinedRight - margin) {
      // Start is to the right of all obstacles - go further right
      midX1 = combinedRight + margin;
    } else if (start.x <= combinedLeft + margin) {
      // Start is to the left of all obstacles - go further left
      midX1 = combinedLeft - margin;
    } else {
      // Start is within obstacles horizontally - need to exit
      // Go to the nearest edge
      const distToRight = combinedRight - start.x;
      const distToLeft = start.x - combinedLeft;
      midX1 = distToRight < distToLeft ? combinedRight + margin : combinedLeft - margin;
    }
    
    // For end position
    if (end.x >= combinedRight - margin) {
      // End is to the right of all obstacles
      midX2 = combinedRight + margin;
    } else if (end.x <= combinedLeft + margin) {
      // End is to the left of all obstacles
      midX2 = combinedLeft - margin;
    } else {
      // End is within obstacles horizontally
      const distToRight = combinedRight - end.x;
      const distToLeft = end.x - combinedLeft;
      midX2 = distToRight < distToLeft ? combinedRight + margin : combinedLeft - margin;
    }
    
    // Route above all obstacles
    const topY = combinedTop - margin;
    const routeAbove = [
      { x: midX1, y: start.y },
      { x: midX1, y: topY },
      { x: midX2, y: topY },
      { x: midX2, y: end.y },
    ];
    
    // Route below all obstacles
    const bottomY = combinedBottom + margin;
    const routeBelow = [
      { x: midX1, y: start.y },
      { x: midX1, y: bottomY },
      { x: midX2, y: bottomY },
      { x: midX2, y: end.y },
    ];
    
    // Choose the route that requires less vertical travel
    const distAbove = Math.abs(topY - start.y) + Math.abs(topY - end.y);
    const distBelow = Math.abs(bottomY - start.y) + Math.abs(bottomY - end.y);
    
    return distAbove < distBelow ? routeAbove : routeBelow;
  } else {
    // Vertical-first routing
    let midY1, midY2;
    
    // For start position
    if (start.y >= combinedBottom - margin) {
      midY1 = combinedBottom + margin;
    } else if (start.y <= combinedTop + margin) {
      midY1 = combinedTop - margin;
    } else {
      const distToBottom = combinedBottom - start.y;
      const distToTop = start.y - combinedTop;
      midY1 = distToBottom < distToTop ? combinedBottom + margin : combinedTop - margin;
    }
    
    // For end position
    if (end.y >= combinedBottom - margin) {
      midY2 = combinedBottom + margin;
    } else if (end.y <= combinedTop + margin) {
      midY2 = combinedTop - margin;
    } else {
      const distToBottom = combinedBottom - end.y;
      const distToTop = end.y - combinedTop;
      midY2 = distToBottom < distToTop ? combinedBottom + margin : combinedTop - margin;
    }
    
    // Route left of all obstacles
    const leftX = combinedLeft - margin;
    const routeLeft = [
      { x: start.x, y: midY1 },
      { x: leftX, y: midY1 },
      { x: leftX, y: midY2 },
      { x: end.x, y: midY2 },
    ];
    
    // Route right of all obstacles
    const rightX = combinedRight + margin;
    const routeRight = [
      { x: start.x, y: midY1 },
      { x: rightX, y: midY1 },
      { x: rightX, y: midY2 },
      { x: end.x, y: midY2 },
    ];
    
    // Choose the route that requires less horizontal travel
    const distLeft = Math.abs(leftX - start.x) + Math.abs(leftX - end.x);
    const distRight = Math.abs(rightX - start.x) + Math.abs(rightX - end.x);
    
    return distLeft < distRight ? routeLeft : routeRight;
  }
}

// Set smart routing for a wire, computing avoidance path if needed
function setWireSmartBends(wire) {
  const start = getPortPositionByRef(wire.from);
  const end = getPortPositionByRef(wire.to);
  if (!start || !end) return;
  
  // First check if simple path has collision
  if (!checkPathCollision(wire, start, end)) {
    wire.bends = null; // Use simple routing
    return;
  }
  
  // Compute smart route around obstacles
  const smartRoute = computeSmartRoute(wire, start, end);
  if (smartRoute) {
    wire.bends = smartRoute.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  }
}

function select(selection) {
  state.selection = selection;
  renderModules();
  updateWires();
  renderProperties();
  updateStatus();
}

function svgEl(tag, attrs) {
  const el = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([key, value]) => {
    el.setAttribute(key, value);
  });
  return el;
}

function buildWirePath(wire, start, end) {
  // If wire has custom bends array (multi-segment), use it
  if (Array.isArray(wire.bends) && wire.bends.length > 0) {
    let path = `M ${start.x} ${start.y}`;
    for (const bend of wire.bends) {
      path += ` L ${bend.x} ${bend.y}`;
    }
    path += ` L ${end.x} ${end.y}`;
    return path;
  }
  
  // Default simple 3-segment routing
  if (wire.route === "V") {
    const midY = wire.bend;
    return `M ${start.x} ${start.y} L ${start.x} ${midY} L ${end.x} ${midY} L ${end.x} ${end.y}`;
  }
  const midX = wire.bend;
  return `M ${start.x} ${start.y} L ${midX} ${start.y} L ${midX} ${end.y} L ${end.x} ${end.y}`;
}

// Get all handle positions for a wire (including multi-segment bends)
function getWireHandlePositions(wire, start, end) {
  if (Array.isArray(wire.bends) && wire.bends.length > 0) {
    return wire.bends.map((bend, index) => ({
      x: bend.x,
      y: bend.y,
      index,
    }));
  }
  
  // Single handle for simple routing
  if (wire.route === "V") {
    return [{ x: (start.x + end.x) / 2, y: wire.bend, index: -1 }];
  }
  return [{ x: wire.bend, y: (start.y + end.y) / 2, index: -1 }];
}

function wireHandlePosition(wire, start, end) {
  // For multi-segment, return the middle bend position
  if (Array.isArray(wire.bends) && wire.bends.length > 0) {
    const midIndex = Math.floor(wire.bends.length / 2);
    return { x: wire.bends[midIndex].x, y: wire.bends[midIndex].y };
  }
  
  if (wire.route === "V") {
    return { x: (start.x + end.x) / 2, y: wire.bend };
  }
  return { x: wire.bend, y: (start.y + end.y) / 2 };
}

function wireLabelPosition(wire, start, end) {
  return wireHandlePosition(wire, start, end);
}

function syncSvgSize() {
  wireLayer.setAttribute("width", canvas.clientWidth);
  wireLayer.setAttribute("height", canvas.clientHeight);
}

function updateWires() {
  syncSvgSize();
  wireLayer.innerHTML = "";

  state.wires.forEach((wire) => {
    const start = getPortPositionByRef(wire.from);
    const end = getPortPositionByRef(wire.to);
    if (!start || !end) {
      return;
    }

    const isSelected = state.selection && state.selection.type === "wire" && state.selection.id === wire.id;
    const strokeColor = typeof wire.color === "string" && wire.color ? wire.color : DEFAULT_WIRE.color;
    const baseWidth = Number.isFinite(wire.width) ? wire.width : DEFAULT_WIRE.width;
    const strokeWidth = isSelected ? baseWidth + 1 : baseWidth;
    const dash = WIRE_STYLES[wire.style] || "";
    const pathAttrs = {
      d: buildWirePath(wire, start, end),
      class: `wire wire-hit${isSelected ? " selected" : ""}`,
      stroke: strokeColor,
      "stroke-width": strokeWidth,
    };
    if (dash) {
      pathAttrs["stroke-dasharray"] = dash;
    }
    const path = svgEl("path", pathAttrs);
    path.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      select({ type: "wire", id: wire.id });
    });
    wireLayer.appendChild(path);

    if (wire.label) {
      const labelPos = wireLabelPosition(wire, start, end);
      const label = svgEl("text", {
        x: labelPos.x,
        y: labelPos.y - 10,
        class: "wire-label wire-hit",
        fill: strokeColor,
      });
      label.textContent = wire.label;
      label.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        select({ type: "wire", id: wire.id });
      });
      wireLayer.appendChild(label);
    }

    if (isSelected) {
      // Render all handle positions for multi-segment wires
      const handlePositions = getWireHandlePositions(wire, start, end);
      handlePositions.forEach((pos) => {
        const handle = svgEl("circle", {
          cx: pos.x,
          cy: pos.y,
          r: 6,
          class: "wire-handle",
        });
        handle.addEventListener("pointerdown", (event) => {
          event.stopPropagation();
          startWireDrag(event, wire, pos.index);
        });
        wireLayer.appendChild(handle);
      });
    }
  });

  if (state.connecting && state.connecting.cursor) {
    const start = getPortPositionByRef(state.connecting.from);
    if (start) {
      const end = state.connecting.cursor;
      const midX = (start.x + end.x) / 2;
      const preview = svgEl("path", {
        d: `M ${start.x} ${start.y} L ${midX} ${start.y} L ${midX} ${end.y} L ${end.x} ${end.y}`,
        class: "wire preview",
      });
      wireLayer.appendChild(preview);
    }
  }
}

function renderModules() {
  moduleLayer.innerHTML = "";
  moduleElements.clear();

  state.modules.forEach((mod) => {
    const el = document.createElement("div");
    el.className = `module ${mod.type}${state.selection && state.selection.type === "module" && state.selection.id === mod.id ? " selected" : ""}`;
    el.style.left = `${mod.x}px`;
    el.style.top = `${mod.y}px`;
    el.style.width = `${mod.width}px`;
    el.style.height = `${mod.height}px`;
    el.dataset.id = mod.id;
    let muxCut = null;

    if (!Number.isFinite(mod.nameSize)) {
      mod.nameSize = DEFAULT_MODULE.nameSize;
    }
    if (mod.showType === undefined) {
      mod.showType = DEFAULT_MODULE.showType;
    }
    if (mod.fill === undefined) {
      mod.fill = DEFAULT_MODULE.fill;
    }
    if (mod.strokeColor === undefined) {
      mod.strokeColor = DEFAULT_MODULE.strokeColor;
    }
    if (mod.strokeWidth === undefined) {
      mod.strokeWidth = DEFAULT_MODULE.strokeWidth;
    }
    if (mod.type === "mux" && !Number.isFinite(mod.muxInputs)) {
      mod.muxInputs = MUX_DEFAULT.inputs;
    }
    if (mod.type === "mux" && !mod.muxControlSide) {
      mod.muxControlSide = MUX_DEFAULT.controlSide;
    }
    // 在 renderModules 函数中，找到 if (mod.type === "mux") 的部分，修改为：
    if (mod.type === "mux") {
      muxCut = ensureMuxGeometry(mod);
      el.style.height = `${mod.height}px`;
      el.style.setProperty("--mux-cut", `${muxCut}px`);
      // 使用动态生成的 SVG 背景
      el.style.background = buildMuxSvgBackground(mod);
      el.style.backgroundSize = '100% 100%';
    }
    applyModuleAppearance(el, mod);

    const header = document.createElement("div");
    header.className = "module-header";
    const title = document.createElement("div");
    title.className = "module-title";
    title.textContent = mod.name;
    title.style.fontSize = `${mod.nameSize}px`;
    const type = document.createElement("div");
    type.className = "module-type";
    type.textContent = MODULE_LIBRARY[mod.type] ? MODULE_LIBRARY[mod.type].label : mod.type;
    header.appendChild(title);
    if (mod.showType) {
      header.appendChild(type);
    }
    el.appendChild(header);

    mod.ports.forEach((port) => {
      const clockPort = isClockPort(mod, port);
      if (clockPort && port.side !== "top" && port.side !== "bottom") {
        port.side = "bottom";
      }
      const local = getPortLocalPosition(mod, port);
      const portEl = document.createElement("div");
      portEl.className = clockPort ? "port clock-port" : "port";
      portEl.style.left = `${local.x}px`;
      portEl.style.top = `${local.y}px`;
      portEl.dataset.portId = port.id;
      portEl.dataset.moduleId = mod.id;
      portEl.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        handlePortClick(event, mod, port);
      });

      el.appendChild(portEl);

      if (clockPort) {
        const marker = document.createElement("div");
        marker.className = "clock-marker";
        marker.dataset.side = port.side;
        marker.style.left = `${local.x}px`;
        marker.style.top = `${local.y}px`;
        el.appendChild(marker);
        return;
      }

      const label = document.createElement("div");
      label.className = "port-label";
      label.dataset.side = port.side;
      label.style.left = `${local.x}px`;
      label.style.top = `${local.y}px`;
      label.textContent = port.name;

      el.appendChild(label);
    });

    el.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      if (event.target.closest(".port")) {
        return;
      }
      event.preventDefault();
      select({ type: "module", id: mod.id });
      startModuleDrag(event, mod);
    });

    moduleLayer.appendChild(el);
    moduleElements.set(mod.id, el);
  });
}

function handlePortClick(event, mod, port) {
  if (state.connecting) {
    if (state.connecting.from.moduleId === mod.id && state.connecting.from.portId === port.id) {
      state.connecting = null;
      updateWires();
      updateStatus();
      return;
    }
    createWire(state.connecting.from, { moduleId: mod.id, portId: port.id });
    state.connecting = null;
    updateWires();
    updateStatus();
    return;
  }

  state.connecting = {
    from: { moduleId: mod.id, portId: port.id },
    cursor: getCanvasPoint(event),
  };
  updateWires();
  updateStatus();
}

function startModuleDrag(event, mod) {
  state.drag = {
    id: mod.id,
    startX: event.clientX,
    startY: event.clientY,
    originX: mod.x,
    originY: mod.y,
  };
  window.addEventListener("pointermove", onModuleDrag);
  window.addEventListener("pointerup", endModuleDrag);
}

function onModuleDrag(event) {
  if (!state.drag) {
    return;
  }
  const mod = getModuleById(state.drag.id);
  if (!mod) {
    return;
  }
  const dx = (event.clientX - state.drag.startX) / state.view.scale;
  const dy = (event.clientY - state.drag.startY) / state.view.scale;
  mod.x = Math.round(state.drag.originX + dx);
  mod.y = Math.round(state.drag.originY + dy);
  const el = moduleElements.get(mod.id);
  if (el) {
    el.style.left = `${mod.x}px`;
    el.style.top = `${mod.y}px`;
  }
  updateWires();
}

function endModuleDrag() {
  state.drag = null;
  window.removeEventListener("pointermove", onModuleDrag);
  window.removeEventListener("pointerup", endModuleDrag);
}

function startPan(event) {
  state.pan = {
    startX: event.clientX,
    startY: event.clientY,
    originX: state.view.offsetX,
    originY: state.view.offsetY,
  };
  window.addEventListener("pointermove", onPan);
  window.addEventListener("pointerup", endPan);
}

function onPan(event) {
  if (!state.pan) {
    return;
  }
  state.view.offsetX = state.pan.originX + (event.clientX - state.pan.startX);
  state.view.offsetY = state.pan.originY + (event.clientY - state.pan.startY);
  applyViewTransform();
  updateWires();
}

function endPan() {
  state.pan = null;
  window.removeEventListener("pointermove", onPan);
  window.removeEventListener("pointerup", endPan);
}

function startWireDrag(event, wire, bendIndex = -1) {
  state.dragWire = {
    id: wire.id,
    route: wire.route,
    bendIndex: bendIndex, // -1 for simple routing, >= 0 for multi-segment
    origin: bendIndex >= 0 && Array.isArray(wire.bends) 
      ? { x: wire.bends[bendIndex].x, y: wire.bends[bendIndex].y }
      : wire.bend,
    startX: event.clientX,
    startY: event.clientY,
  };
  window.addEventListener("pointermove", onWireDrag);
  window.addEventListener("pointerup", endWireDrag);
}

function onWireDrag(event) {
  if (!state.dragWire) {
    return;
  }
  const wire = state.wires.find((item) => item.id === state.dragWire.id);
  if (!wire) {
    return;
  }
  
  const dx = (event.clientX - state.dragWire.startX) / state.view.scale;
  const dy = (event.clientY - state.dragWire.startY) / state.view.scale;
  
  // Handle multi-segment bend dragging
  if (state.dragWire.bendIndex >= 0 && Array.isArray(wire.bends)) {
    const origin = state.dragWire.origin;
    wire.bends[state.dragWire.bendIndex] = {
      x: Math.round(origin.x + dx),
      y: Math.round(origin.y + dy),
    };
  } else {
    // Simple routing
    if (state.dragWire.route === "V") {
      wire.bend = Math.round(state.dragWire.origin + dy);
    } else {
      wire.bend = Math.round(state.dragWire.origin + dx);
    }
  }
  updateWires();
}

function endWireDrag() {
  state.dragWire = null;
  window.removeEventListener("pointermove", onWireDrag);
  window.removeEventListener("pointerup", endWireDrag);
  renderProperties();
}

function makeField(labelText, inputEl) {
  const field = document.createElement("div");
  field.className = "field";
  const label = document.createElement("label");
  label.textContent = labelText;
  field.appendChild(label);
  field.appendChild(inputEl);
  return field;
}

function makeTextInput(value, onInput) {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value || "";
  input.addEventListener("input", () => onInput(input.value));
  return input;
}

function makeNumberInput(value, options, onInput) {
  const input = document.createElement("input");
  input.type = "number";
  input.value = Number.isFinite(value) ? value : 0;
  if (options) {
    if (options.min !== undefined) input.min = options.min;
    if (options.max !== undefined) input.max = options.max;
    if (options.step !== undefined) input.step = options.step;
  }
  input.addEventListener("input", () => {
    const parsed = Number.parseFloat(input.value);
    if (!Number.isFinite(parsed)) {
      return;
    }
    onInput(parsed);
  });
  return input;
}

function makeCheckbox(value, onChange) {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = Boolean(value);
  input.addEventListener("change", () => onChange(input.checked));
  return input;
}

function makeColorInput(value, onInput) {
  const input = document.createElement("input");
  input.type = "color";
  input.value = value || DEFAULT_WIRE.color;
  input.addEventListener("input", () => onInput(input.value));
  return input;
}

function makeSelect(options, value, onChange) {
  const select = document.createElement("select");
  options.forEach((option) => {
    const opt = document.createElement("option");
    opt.value = option.value;
    opt.textContent = option.label;
    if (option.value === value) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

function makeButton(label, className, onClick) {
  const button = document.createElement("button");
  button.textContent = label;
  if (className) {
    button.classList.add(className);
  }
  button.addEventListener("click", onClick);
  return button;
}

function renderCanvasProperties() {
  propertiesContent.appendChild(
    makeField(
      "Canvas Background",
      makeColorInput(state.canvasBackground || DEFAULT_CANVAS_BG, (value) => {
        state.canvasBackground = value;
        applyCanvasBackground();
      })
    )
  );

  const resetRow = document.createElement("div");
  resetRow.className = "action-row";
  resetRow.appendChild(
    makeButton("Reset Background", "btn-accent", () => {
      state.canvasBackground = "";
      applyCanvasBackground();
      renderProperties();
    })
  );
  propertiesContent.appendChild(resetRow);
}

function renderModuleProperties(mod) {
  propertiesContent.appendChild(
    makeField(
      "Name",
      makeTextInput(mod.name, (value) => {
        mod.name = value;
        renderModules();
      })
    )
  );

  const fillField = makeField(
    "Fill",
    makeColorInput(mod.fill || "#fffdf9", (value) => {
      mod.fill = value;
      renderModules();
    })
  );
  propertiesContent.appendChild(fillField);

  const strokeField = makeField(
    "Stroke Color",
    makeColorInput(mod.strokeColor || "#1d262b", (value) => {
      mod.strokeColor = value;
      renderModules();
    })
  );
  propertiesContent.appendChild(strokeField);

  const strokeWidthField = makeField(
    "Stroke Width",
    makeNumberInput(Number.isFinite(mod.strokeWidth) ? mod.strokeWidth : 2, { min: 0, max: 8, step: 0.2 }, (value) => {
      mod.strokeWidth = clamp(value, 0, 8);
      renderModules();
    })
  );
  propertiesContent.appendChild(strokeWidthField);

  const resetStyleRow = document.createElement("div");
  resetStyleRow.className = "action-row";
  resetStyleRow.appendChild(
    makeButton("Reset Style", "btn-accent", () => {
      mod.fill = DEFAULT_MODULE.fill;
      mod.strokeColor = DEFAULT_MODULE.strokeColor;
      mod.strokeWidth = DEFAULT_MODULE.strokeWidth;
      renderModules();
      renderProperties();
    })
  );
  propertiesContent.appendChild(resetStyleRow);

  const nameSizeField = makeField(
    "Name Size",
    makeNumberInput(Number.isFinite(mod.nameSize) ? mod.nameSize : DEFAULT_MODULE.nameSize, { min: 10, max: 28, step: 1 }, (value) => {
      mod.nameSize = clamp(Math.round(value), 10, 28);
      renderModules();
    })
  );
  propertiesContent.appendChild(nameSizeField);

  const showTypeField = document.createElement("div");
  showTypeField.className = "field field-inline";
  const showTypeLabel = document.createElement("label");
  showTypeLabel.textContent = "Show Type";
  const showTypeInput = makeCheckbox(mod.showType !== false, (value) => {
    mod.showType = value;
    renderModules();
  });
  showTypeField.appendChild(showTypeLabel);
  showTypeField.appendChild(showTypeInput);
  propertiesContent.appendChild(showTypeField);

  propertiesContent.appendChild(
    makeField(
      "Type",
      makeSelect(
        Object.keys(MODULE_LIBRARY).map((key) => ({ value: key, label: MODULE_LIBRARY[key].label })),
        mod.type,
        (value) => {
          mod.type = value;
          if (value === "mux") {
            mod.muxInputs = MUX_DEFAULT.inputs;
            mod.muxControlSide = MUX_DEFAULT.controlSide;
            mod.ports = [];
            ensureMuxPorts(mod);
          }
          renderModules();
          updateWires();
          renderProperties();
        }
      )
    )
  );

  if (mod.type === "mux") {
    const muxInputsField = makeField(
      "Mux Inputs",
      makeNumberInput(Number.isFinite(mod.muxInputs) ? mod.muxInputs : MUX_DEFAULT.inputs, { min: 2, max: 8, step: 1 }, (value) => {
        mod.muxInputs = clamp(Math.round(value), 2, 8);
        ensureMuxPorts(mod);
        renderModules();
        updateWires();
        renderProperties();
      })
    );
    propertiesContent.appendChild(muxInputsField);

    const muxControlField = makeField(
      "Control Side",
      makeSelect(
        [
          { value: "top", label: "Top" },
          { value: "bottom", label: "Bottom" },
        ],
        mod.muxControlSide || MUX_DEFAULT.controlSide,
        (value) => {
          mod.muxControlSide = value;
          ensureMuxPorts(mod);
          renderModules();
          updateWires();
        }
      )
    );
    propertiesContent.appendChild(muxControlField);
  }

  const sizeField = document.createElement("div");
  sizeField.className = "field";
  const sizeLabel = document.createElement("label");
  sizeLabel.textContent = "Size";
  const sizeRow = document.createElement("div");
  sizeRow.className = "field-row";
  let heightInput;
  const widthInput = makeNumberInput(mod.width, { min: 60, max: 300, step: 1 }, (value) => {
    mod.width = clamp(Math.round(value), 60, 300);
    if (mod.type === "mux") {
      const beforeHeight = mod.height;
      ensureMuxGeometry(mod, "keepWidth");
      if (heightInput && mod.height !== beforeHeight) {
        heightInput.value = mod.height;
      }
    }
    renderModules();
    updateWires();
  });
  heightInput = makeNumberInput(mod.height, { min: 120, max: 600, step: 1 }, (value) => {
    mod.height = clamp(Math.round(value), 120, 600);
    if (mod.type === "mux") {
      const beforeWidth = mod.width;
      const beforeHeight = mod.height;
      ensureMuxGeometry(mod, "keepHeight");
      if (mod.width !== beforeWidth) {
        widthInput.value = mod.width;
      }
      if (mod.height !== beforeHeight) {
        heightInput.value = mod.height;
      }
    }
    renderModules();
    updateWires();
  });
  sizeRow.appendChild(widthInput);
  sizeRow.appendChild(heightInput);
  sizeField.appendChild(sizeLabel);
  sizeField.appendChild(sizeRow);
  propertiesContent.appendChild(sizeField);

  const portsField = document.createElement("div");
  portsField.className = "field";
  const portsLabel = document.createElement("label");
  portsLabel.textContent = "Ports";
  portsField.appendChild(portsLabel);

  const portList = document.createElement("div");
  portList.className = "port-list";

  mod.ports.forEach((port) => {
    const row = document.createElement("div");
    row.className = "port-row";

    const nameInput = makeTextInput(port.name, (value) => {
      port.name = value;
      renderModules();
    });

    const sideOptions = isClockPort(mod, port)
      ? [
        { value: "top", label: "Top" },
        { value: "bottom", label: "Bottom" },
      ]
      : [
        { value: "left", label: "Left" },
        { value: "right", label: "Right" },
        { value: "top", label: "Top" },
        { value: "bottom", label: "Bottom" },
      ];
    const sideSelect = makeSelect(sideOptions, port.side, (value) => {
      port.side = value;
      renderModules();
      updateWires();
    });

    const offsetInput = makeNumberInput(Math.round(port.offset * 100), { min: 0, max: 100, step: 1 }, (value) => {
      port.offset = clamp(value / 100, 0, 1);
      renderModules();
      updateWires();
    });

    const removeButton = makeButton("Remove", "", () => {
      mod.ports = mod.ports.filter((item) => item.id !== port.id);
      state.wires = state.wires.filter((wire) => wire.from.portId !== port.id && wire.to.portId !== port.id);
      state.connecting = null;
      renderModules();
      updateWires();
      renderProperties();
      updateStatus();
    });

    row.appendChild(nameInput);
    row.appendChild(sideSelect);
    row.appendChild(offsetInput);
    row.appendChild(removeButton);
    portList.appendChild(row);
  });

  portsField.appendChild(portList);

  const addPort = makeButton("Add Port", "btn-accent", () => {
    mod.ports.push({
      id: uid("port"),
      name: `P${mod.ports.length + 1}`,
      side: "left",
      offset: 0.5,
    });
    renderModules();
    updateWires();
    renderProperties();
  });

  portsField.appendChild(addPort);
  propertiesContent.appendChild(portsField);

  const actionRow = document.createElement("div");
  actionRow.className = "action-row";
  actionRow.appendChild(
    makeButton("Delete Module", "danger", () => {
      state.modules = state.modules.filter((item) => item.id !== mod.id);
      state.wires = state.wires.filter((wire) => wire.from.moduleId !== mod.id && wire.to.moduleId !== mod.id);
      state.selection = null;
      state.connecting = null;
      renderModules();
      updateWires();
      renderProperties();
      updateStatus();
    })
  );
  propertiesContent.appendChild(actionRow);
}

function renderWireProperties(wire) {
  const labelField = makeField(
    "Label",
    makeTextInput(wire.label, (value) => {
      wire.label = value;
      updateWires();
    })
  );
  propertiesContent.appendChild(labelField);

  const colorField = makeField(
    "Color",
    makeColorInput(wire.color || DEFAULT_WIRE.color, (value) => {
      wire.color = value;
      updateWires();
    })
  );
  propertiesContent.appendChild(colorField);

  const widthField = makeField(
    "Width",
    makeNumberInput(Number.isFinite(wire.width) ? wire.width : DEFAULT_WIRE.width, { min: 1, max: 12, step: 0.2 }, (value) => {
      wire.width = clamp(value, 1, 12);
      updateWires();
    })
  );
  propertiesContent.appendChild(widthField);

  const styleField = makeField(
    "Line Style",
    makeSelect(
      [
        { value: "solid", label: "Solid" },
        { value: "dashed", label: "Dashed" },
        { value: "dotted", label: "Dotted" },
      ],
      wire.style || DEFAULT_WIRE.style,
      (value) => {
        wire.style = value;
        updateWires();
      }
    )
  );
  propertiesContent.appendChild(styleField);

  const routeField = makeField(
    "Route",
    makeSelect(
      [
        { value: "H", label: "Horizontal first" },
        { value: "V", label: "Vertical first" },
      ],
      wire.route,
      (value) => {
        wire.route = value;
        setWireDefaultBend(wire);
        // Clear multi-segment bends when changing route
        wire.bends = null;
        updateWires();
        renderProperties();
      }
    )
  );
  propertiesContent.appendChild(routeField);

  // Show multi-segment controls if bends exist
  if (Array.isArray(wire.bends) && wire.bends.length > 0) {
    const bendsField = document.createElement("div");
    bendsField.className = "field";
    const bendsLabel = document.createElement("label");
    bendsLabel.textContent = "Bend Points";
    bendsField.appendChild(bendsLabel);

    const bendsList = document.createElement("div");
    bendsList.className = "port-list";

    wire.bends.forEach((bend, index) => {
      const row = document.createElement("div");
      row.className = "port-row";

      const label = document.createElement("span");
      label.textContent = `Point ${index + 1}`;
      label.style.fontSize = "12px";
      label.style.color = "var(--muted)";

      const xInput = makeNumberInput(bend.x, { step: 1 }, (value) => {
        wire.bends[index].x = Math.round(value);
        updateWires();
      });
      xInput.placeholder = "X";
      xInput.title = "X position";

      const yInput = makeNumberInput(bend.y, { step: 1 }, (value) => {
        wire.bends[index].y = Math.round(value);
        updateWires();
      });
      yInput.placeholder = "Y";
      yInput.title = "Y position";

      row.appendChild(label);
      row.appendChild(xInput);
      row.appendChild(yInput);
      bendsList.appendChild(row);
    });

    bendsField.appendChild(bendsList);
    propertiesContent.appendChild(bendsField);

    // Add button to reset to simple routing
    const resetRouteRow = document.createElement("div");
    resetRouteRow.className = "action-row";
    resetRouteRow.appendChild(
      makeButton("Reset to Simple Route", "btn-accent", () => {
        wire.bends = null;
        setWireDefaultBend(wire);
        updateWires();
        renderProperties();
      })
    );
    propertiesContent.appendChild(resetRouteRow);

    // Add button to re-compute smart route
    const recomputeRow = document.createElement("div");
    recomputeRow.className = "action-row";
    recomputeRow.appendChild(
      makeButton("Recompute Smart Route", "btn-accent", () => {
        wire.bends = null;
        setWireDefaultBend(wire);
        setWireSmartBends(wire);
        updateWires();
        renderProperties();
      })
    );
    propertiesContent.appendChild(recomputeRow);
  } else {
    // Simple routing - show single bend control
    const bendField = makeField(
      "Bend (px)",
      makeNumberInput(wire.bend, { step: 1 }, (value) => {
        wire.bend = Math.round(value);
        updateWires();
      })
    );
    propertiesContent.appendChild(bendField);

    // Add button to enable smart routing
    const smartRouteRow = document.createElement("div");
    smartRouteRow.className = "action-row";
    smartRouteRow.appendChild(
      makeButton("Enable Smart Route", "btn-accent", () => {
        setWireSmartBends(wire);
        updateWires();
        renderProperties();
      })
    );
    propertiesContent.appendChild(smartRouteRow);
  }

  const meta = document.createElement("div");
  meta.className = "empty-state";
  meta.textContent = `${describePortRef(wire.from)} -> ${describePortRef(wire.to)}`;
  propertiesContent.appendChild(meta);

  const actionRow = document.createElement("div");
  actionRow.className = "action-row";
  actionRow.appendChild(
    makeButton("Delete Wire", "danger", () => {
      state.wires = state.wires.filter((item) => item.id !== wire.id);
      state.selection = null;
      renderModules();
      updateWires();
      renderProperties();
      updateStatus();
    })
  );
  propertiesContent.appendChild(actionRow);
}

function renderProperties() {
  propertiesContent.innerHTML = "";
  renderCanvasProperties();
  if (!state.selection) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Select a module or wire to edit its properties. Drag modules from the palette to start.";
    propertiesContent.appendChild(empty);
    return;
  }

  if (state.selection.type === "module") {
    const mod = getModuleById(state.selection.id);
    if (mod) {
      renderModuleProperties(mod);
    }
    return;
  }

  if (state.selection.type === "wire") {
    const wire = state.wires.find((item) => item.id === state.selection.id);
    if (wire) {
      renderWireProperties(wire);
    }
  }
}

function updateStatus() {
  const zoomText = `Zoom ${Math.round(state.view.scale * 100)}%`;
  if (state.connecting) {
    statusEl.textContent = `Connecting from ${describePortRef(state.connecting.from)} · ${zoomText}`;
    return;
  }
  if (!state.selection) {
    statusEl.textContent = `Ready · ${zoomText}`;
    return;
  }
  if (state.selection.type === "module") {
    statusEl.textContent = `Module selected · ${zoomText}`;
    return;
  }
  if (state.selection.type === "wire") {
    statusEl.textContent = `Wire selected · ${zoomText}`;
  }
}

function deleteSelected() {
  if (!state.selection) {
    return;
  }
  if (state.selection.type === "module") {
    const id = state.selection.id;
    state.modules = state.modules.filter((item) => item.id !== id);
    state.wires = state.wires.filter((wire) => wire.from.moduleId !== id && wire.to.moduleId !== id);
  }
  if (state.selection.type === "wire") {
    state.wires = state.wires.filter((wire) => wire.id !== state.selection.id);
  }
  state.selection = null;
  state.connecting = null;
  renderModules();
  updateWires();
  renderProperties();
  updateStatus();
}

function serializeState() {
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
      bends: wire.bends, // Include multi-segment bends
      color: wire.color,
      width: wire.width,
      style: wire.style,
    })),
  };
}

function refreshIdCounter() {
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

function loadState(data) {
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
    // Load multi-segment bends if present
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
      ensureMuxPorts(mod);
      ensureMuxGeometry(mod);
    }
  });
  renderModules();
  updateWires();
  renderProperties();
  updateStatus();
}

function isTypingTarget(target) {
  if (!target) {
    return false;
  }
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

function initPalette() {
  const paletteItems = document.querySelectorAll(".palette-item");
  paletteItems.forEach((item) => {
    item.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/plain", item.dataset.type);
    });
    item.addEventListener("click", () => {
      const type = item.dataset.type;
      const library = MODULE_LIBRARY[type] || MODULE_LIBRARY.logic;
      const rect = canvas.getBoundingClientRect();
      const x = rect.width / 2 - library.width / 2;
      const y = rect.height / 2 - library.height / 2;
      createModule(type, x, y);
    });
  });

  canvas.addEventListener("dragover", (event) => {
    event.preventDefault();
  });

  canvas.addEventListener("drop", (event) => {
    event.preventDefault();
    const type = event.dataTransfer.getData("text/plain");
    if (!type) {
      return;
    }
    const library = MODULE_LIBRARY[type] || MODULE_LIBRARY.logic;
    const point = getCanvasPoint(event);
    createModule(type, point.x - library.width / 2, point.y - library.height / 2);
  });
}

function initButtons() {
  const modal = document.getElementById("modal");
  const modalTitle = document.getElementById("modal-title");
  const modalText = document.getElementById("modal-text");
  const modalClose = document.getElementById("modal-close");
  const modalApply = document.getElementById("modal-apply");
  const exportPngButton = document.getElementById("btn-export-png");
  const exportSvgButton = document.getElementById("btn-export-svg");
  const bgToggleButton = document.getElementById("btn-bg-toggle");
  let modalMode = "export";

  const openModal = (mode) => {
    modalMode = mode;
    if (mode === "export") {
      modalTitle.textContent = "Export JSON";
      modalText.value = JSON.stringify(serializeState(), null, 2);
      modalText.readOnly = true;
      modalApply.style.display = "none";
    } else {
      modalTitle.textContent = "Import JSON";
      modalText.value = "";
      modalText.readOnly = false;
      modalApply.style.display = "inline-flex";
    }
    modal.classList.remove("hidden");
  };

  const closeModal = () => {
    modal.classList.add("hidden");
  };

  document.getElementById("btn-export").addEventListener("click", () => openModal("export"));
  document.getElementById("btn-import").addEventListener("click", () => openModal("import"));

  modalClose.addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });

  modalApply.addEventListener("click", () => {
    if (modalMode !== "import") {
      return;
    }
    try {
      const data = JSON.parse(modalText.value);
      loadState(data);
      closeModal();
    } catch (err) {
      alert("Failed to parse JSON.");
    }
  });

  document.getElementById("btn-save").addEventListener("click", () => {
    localStorage.setItem("corecat-diagram", JSON.stringify(serializeState()));
  });

  document.getElementById("btn-load").addEventListener("click", () => {
    const data = localStorage.getItem("corecat-diagram");
    if (!data) {
      alert("No saved diagram found.");
      return;
    }
    loadState(JSON.parse(data));
  });

  document.getElementById("btn-clear").addEventListener("click", () => {
    if (!confirm("Clear the canvas?")) {
      return;
    }
    state.modules = [];
    state.wires = [];
    state.selection = null;
    state.connecting = null;
    renderModules();
    updateWires();
    renderProperties();
    updateStatus();
  });

  const updateBgButton = () => {
    bgToggleButton.textContent = state.export.transparent ? "BG: Transparent" : "BG: Solid";
  };

  exportPngButton.addEventListener("click", exportPng);
  exportSvgButton.addEventListener("click", exportSvg);
  bgToggleButton.addEventListener("click", () => {
    state.export.transparent = !state.export.transparent;
    updateBgButton();
  });
  updateBgButton();
}

function initCanvasEvents() {
  canvas.addEventListener("pointerdown", (event) => {
    if (event.ctrlKey && event.button === 1) {
      event.preventDefault();
      startPan(event);
      return;
    }
    if (event.target.closest(".module") || event.target.closest(".wire-hit")) {
      return;
    }
    state.selection = null;
    state.connecting = null;
    renderModules();
    updateWires();
    renderProperties();
    updateStatus();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!state.connecting) {
      return;
    }
    state.connecting.cursor = getCanvasPoint(event);
    updateWires();
  });

  canvas.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey) {
        return;
      }
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      const oldScale = state.view.scale;
      const factor = event.deltaY > 0 ? 0.9 : 1.1;
      const nextScale = clamp(oldScale * factor, 0.4, 2.5);
      if (nextScale === oldScale) {
        return;
      }
      const worldX = (cursorX - state.view.offsetX) / oldScale;
      const worldY = (cursorY - state.view.offsetY) / oldScale;
      state.view.scale = nextScale;
      state.view.offsetX = cursorX - worldX * nextScale;
      state.view.offsetY = cursorY - worldY * nextScale;
      applyViewTransform();
      updateWires();
      updateStatus();
    },
    { passive: false }
  );
}

function applyViewTransform() {
  const transform = `translate(${state.view.offsetX}px, ${state.view.offsetY}px) scale(${state.view.scale})`;
  moduleLayer.style.transform = transform;
  moduleLayer.style.transformOrigin = "0 0";
  wireLayer.style.transform = transform;
  wireLayer.style.transformOrigin = "0 0";
}

function resetView() {
  state.view.scale = 1;
  state.view.offsetX = 0;
  state.view.offsetY = 0;
  applyViewTransform();
  updateWires();
  updateStatus();
}

function buildExportSvg(options) {
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
    ".module-name{font-family:MiSans VF,Trebuchet MS,Lucida Sans Unicode,Lucida Grande,sans-serif;font-size:16px;font-weight:700;fill:#1d262b;}",
    ".module-type{font-family:MiSans VF,Trebuchet MS,Lucida Sans Unicode,Lucida Grande,sans-serif;font-size:12px;letter-spacing:2px;text-transform:uppercase;fill:#6b6f6f;}",
    ".port-label{font-family:Maple Mono Normal NF CN,Consolas,Courier New,monospace;font-size:14px;fill:#1d262b;}",
    ".wire-label{font-family:Maple Mono Normal NF CN,Consolas,Courier New,monospace;font-size:12px;fill:#1d262b;}",
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
        `<text class="wire-label" x="${labelPos.x}" y="${labelPos.y - 10}" text-anchor="middle" dominant-baseline="central">${escapeXml(
          wire.label
        )}</text>`
      );
    }
  });

  state.modules.forEach((mod) => {
    const fill = mod.fill || "#fffdf9";
    const stroke = mod.strokeColor || "#1d262b";
    const strokeOpacity = mod.strokeColor ? 1 : 0.35;
    const strokeWidth = Number.isFinite(mod.strokeWidth) ? mod.strokeWidth : 1.2;
    parts.push(`<g transform="translate(${mod.x} ${mod.y})">`);
    if (mod.type === "mux") {
      const cut = getMuxCut(mod);
      const points = `0 0 ${mod.width} ${cut} ${mod.width} ${mod.height - cut} 0 ${mod.height}`;
      parts.push(
        `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-opacity="${strokeOpacity}" stroke-width="${strokeWidth}"></polygon>`
      );
    } else {
      parts.push(
        `<rect x="0" y="0" width="${mod.width}" height="${mod.height}" rx="12" ry="12" fill="${fill}" stroke="${stroke}" stroke-opacity="${strokeOpacity}" stroke-width="${strokeWidth}"></rect>`
      );
    }

    const nameSize = Number.isFinite(mod.nameSize) ? mod.nameSize : DEFAULT_MODULE.nameSize;
    const centerX = mod.width / 2;
    const centerY = mod.height / 2;
    if (mod.showType) {
      const nameY = centerY - Math.max(6, nameSize * 0.3);
      const typeY = centerY + Math.max(10, nameSize * 0.7);
      parts.push(
        `<text class="module-name" x="${centerX}" y="${nameY}" text-anchor="middle" dominant-baseline="middle" font-size="${nameSize}">${escapeXml(
          mod.name
        )}</text>`
      );
      const typeLabel = MODULE_LIBRARY[mod.type] ? MODULE_LIBRARY[mod.type].label : mod.type;
      parts.push(`<text class="module-type" x="${centerX}" y="${typeY}" text-anchor="middle" dominant-baseline="middle">${escapeXml(typeLabel)}</text>`);
    } else {
      parts.push(
        `<text class="module-name" x="${centerX}" y="${centerY}" text-anchor="middle" dominant-baseline="middle" font-size="${nameSize}">${escapeXml(
          mod.name
        )}</text>`
      );
    }

    mod.ports.forEach((port) => {
      const local = getPortLocalPosition(mod, port);
      if (isClockPort(mod, port)) {
        const size = 12;
        if (port.side === "bottom") {
          const points = `${local.x - size / 2} ${local.y} ${local.x + size / 2} ${local.y} ${local.x} ${local.y - size}`;
          parts.push(
            `<polygon points="${points}" fill="none" stroke="${stroke}" stroke-width="${Math.max(1, strokeWidth)}"></polygon>`
          );
        } else {
          const points = `${local.x - size / 2} ${local.y} ${local.x + size / 2} ${local.y} ${local.x} ${local.y + size}`;
          parts.push(
            `<polygon points="${points}" fill="none" stroke="${stroke}" stroke-width="${Math.max(1, strokeWidth)}"></polygon>`
          );
        }
        return;
      }
      parts.push(`<circle cx="${local.x}" cy="${local.y}" r="5" fill="#1d262b" stroke="#f2c14e" stroke-width="2"></circle>`);
      const offset = 8;
      let labelX = local.x;
      let labelY = local.y;
      let anchor = "middle";
      if (port.side === "left") {
        labelX = local.x + offset;
        anchor = "start";
      } else if (port.side === "right") {
        labelX = local.x - offset;
        anchor = "end";
      } else if (port.side === "top" || port.side === "slopeTop") {
        labelY = local.y + offset;
      } else if (port.side === "bottom" || port.side === "slopeBottom") {
        labelY = local.y - offset;
      }
      parts.push(
        `<text class="port-label" x="${labelX}" y="${labelY}" text-anchor="${anchor}" dominant-baseline="middle">${escapeXml(port.name)}</text>`
      );
    });

    parts.push("</g>");
  });

  parts.push("</g></svg>");
  return { svg: parts.join(""), width, height };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportSvg() {
  const result = buildExportSvg({
    transparent: state.export.transparent,
    fitToBounds: state.export.fitToBounds,
  });
  const blob = new Blob([result.svg], { type: "image/svg+xml;charset=utf-8" });
  downloadBlob(blob, "corecat-diagram.svg");
}

function exportPng() {
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

document.addEventListener("keydown", (event) => {
  if (isTypingTarget(document.activeElement)) {
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    deleteSelected();
  }
  if (event.key === "Escape") {
    state.connecting = null;
    updateWires();
    updateStatus();
  }
});

window.addEventListener("resize", () => {
  syncSvgSize();
  updateWires();
});

initPalette();
initButtons();
initCanvasEvents();
applyViewTransform();
applyCanvasBackground();
renderModules();
updateWires();
renderProperties();
updateStatus();

statusEl.addEventListener("click", () => {
  resetView();
});
