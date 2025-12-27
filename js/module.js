/**
 * Module - 模块相关功能
 * 包含模块创建、渲染、端口管理等
 */

import { state, moduleLayer, moduleElements } from './state.js';
import { MODULE_LIBRARY, DEFAULT_MODULE, MUX_DEFAULT } from './constants.js';
import { uid, isClockPort, ensureMuxGeometry, buildMuxSvgBackground, buildExtenderSvgBackground } from './utils.js';
import { getPortLocalPosition } from './port.js';

/**
 * 应用模块外观样式
 */
export function applyModuleAppearance(el, mod) {
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

/**
 * 确保MUX端口配置正确
 */
export function ensureMuxPorts(mod) {
  const inputs = Math.round(mod.muxInputs || MUX_DEFAULT.inputs);
  const clampedInputs = Math.max(2, Math.min(8, inputs));
  const controlSide = mod.muxControlSide === "bottom" ? "bottom" : MUX_DEFAULT.controlSide;
  mod.muxInputs = clampedInputs;
  mod.muxControlSide = controlSide;

  const existingByName = new Map();
  mod.ports.forEach((port) => existingByName.set(port.name, port));

  const ports = [];
  for (let i = 0; i < clampedInputs; i += 1) {
    const name = `I${i + 1}`;
    const existing = existingByName.get(name);
    ports.push({
      id: existing ? existing.id : uid("port"),
      name,
      side: "left",
      offset: (i + 1) / (clampedInputs + 1),
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

/**
 * 创建模块
 */
export function createModule(type, x, y, selectCallback) {
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
  if (selectCallback) {
    selectCallback({ type: "module", id: moduleItem.id });
  }
}

/**
 * 渲染所有模块
 */
export function renderModules(selectCallback, startModuleDragCallback, handlePortClickCallback) {
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

    if (mod.type === "mux") {
      muxCut = ensureMuxGeometry(mod);
      el.style.height = `${mod.height}px`;
      el.style.setProperty("--mux-cut", `${muxCut}px`);
      el.style.background = buildMuxSvgBackground(mod);
      el.style.backgroundSize = '100% 100%';
    }
    if (mod.type === "extender") {
      el.style.background = buildExtenderSvgBackground(mod);
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
        if (handlePortClickCallback) {
          handlePortClickCallback(event, mod, port);
        }
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
      if (selectCallback) {
        selectCallback({ type: "module", id: mod.id });
      }
      if (startModuleDragCallback) {
        startModuleDragCallback(event, mod);
      }
    });

    moduleLayer.appendChild(el);
    moduleElements.set(mod.id, el);
  });
}
