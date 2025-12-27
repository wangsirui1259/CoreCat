/**
 * Events - 事件处理
 * 包含拖拽、平移、缩放等事件处理
 */

import { state, canvas, moduleLayer, wireLayer, moduleElements, statusEl } from './state.js';
import { MODULE_LIBRARY } from './constants.js';
import { getCanvasPoint, getModuleById, applyCanvasBackground, clamp, isTypingTarget } from './utils.js';
import { createModule, renderModules } from './module.js';
import { createWire, updateWires, syncSvgSize } from './wire.js';
import { renderProperties } from './properties.js';
import { describePortRef } from './port.js';
import { serializeState, loadState, exportPng, exportSvg } from './export.js';

// 事件处理器引用
let onModuleDragHandler = null;
let endModuleDragHandler = null;
let onPanHandler = null;
let endPanHandler = null;
let onWireDragHandler = null;
let endWireDragHandler = null;

/**
 * 应用视图变换
 */
export function applyViewTransform() {
  const transform = `translate(${state.view.offsetX}px, ${state.view.offsetY}px) scale(${state.view.scale})`;
  moduleLayer.style.transform = transform;
  moduleLayer.style.transformOrigin = "0 0";
  wireLayer.style.transform = transform;
  wireLayer.style.transformOrigin = "0 0";
}

/**
 * 更新状态栏
 */
export function updateStatus() {
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

/**
 * 选择对象
 */
export function select(selection) {
  state.selection = selection;
  doRenderModules();
  doUpdateWires();
  doRenderProperties();
  updateStatus();
}

/**
 * 删除选中对象
 */
export function deleteSelected() {
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
  doRenderModules();
  doUpdateWires();
  doRenderProperties();
  updateStatus();
}

/**
 * 重置视图
 */
export function resetView() {
  state.view.scale = 1;
  state.view.offsetX = 0;
  state.view.offsetY = 0;
  applyViewTransform();
  doUpdateWires();
  updateStatus();
}

// 内部渲染函数
function doRenderModules() {
  renderModules(select, startModuleDrag, handlePortClick);
}

function doUpdateWires() {
  updateWires(select, startWireDrag);
}

function doRenderProperties() {
  renderProperties(doRenderModules, doUpdateWires, updateStatus);
}

/**
 * 处理端口点击
 */
function handlePortClick(event, mod, port) {
  if (state.connecting) {
    if (state.connecting.from.moduleId === mod.id && state.connecting.from.portId === port.id) {
      state.connecting = null;
      doUpdateWires();
      updateStatus();
      return;
    }
    createWire(state.connecting.from, { moduleId: mod.id, portId: port.id }, select);
    state.connecting = null;
    doUpdateWires();
    updateStatus();
    return;
  }

  state.connecting = {
    from: { moduleId: mod.id, portId: port.id },
    cursor: getCanvasPoint(event),
  };
  doUpdateWires();
  updateStatus();
}

/**
 * 开始模块拖拽
 */
function startModuleDrag(event, mod) {
  state.drag = {
    id: mod.id,
    startX: event.clientX,
    startY: event.clientY,
    originX: mod.x,
    originY: mod.y,
  };
  
  onModuleDragHandler = onModuleDrag;
  endModuleDragHandler = endModuleDrag;
  
  window.addEventListener("pointermove", onModuleDragHandler);
  window.addEventListener("pointerup", endModuleDragHandler);
}

/**
 * 模块拖拽中
 */
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
  doUpdateWires();
}

/**
 * 结束模块拖拽
 */
function endModuleDrag() {
  state.drag = null;
  window.removeEventListener("pointermove", onModuleDragHandler);
  window.removeEventListener("pointerup", endModuleDragHandler);
}

/**
 * 开始平移
 */
function startPan(event) {
  state.pan = {
    startX: event.clientX,
    startY: event.clientY,
    originX: state.view.offsetX,
    originY: state.view.offsetY,
  };
  
  onPanHandler = onPan;
  endPanHandler = endPan;
  
  window.addEventListener("pointermove", onPanHandler);
  window.addEventListener("pointerup", endPanHandler);
}

/**
 * 平移中
 */
function onPan(event) {
  if (!state.pan) {
    return;
  }
  state.view.offsetX = state.pan.originX + (event.clientX - state.pan.startX);
  state.view.offsetY = state.pan.originY + (event.clientY - state.pan.startY);
  applyViewTransform();
  doUpdateWires();
}

/**
 * 结束平移
 */
function endPan() {
  state.pan = null;
  window.removeEventListener("pointermove", onPanHandler);
  window.removeEventListener("pointerup", endPanHandler);
}

/**
 * 开始连线拖拽
 */
function startWireDrag(event, wire, bendIndex = -1) {
  state.dragWire = {
    id: wire.id,
    route: wire.route,
    bendIndex: bendIndex,
    origin: bendIndex >= 0 && Array.isArray(wire.bends) 
      ? { x: wire.bends[bendIndex].x, y: wire.bends[bendIndex].y }
      : wire.bend,
    startX: event.clientX,
    startY: event.clientY,
  };
  
  onWireDragHandler = onWireDrag;
  endWireDragHandler = endWireDrag;
  
  window.addEventListener("pointermove", onWireDragHandler);
  window.addEventListener("pointerup", endWireDragHandler);
}

/**
 * 连线拖拽中
 */
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
  
  if (state.dragWire.bendIndex >= 0 && Array.isArray(wire.bends)) {
    const origin = state.dragWire.origin;
    wire.bends[state.dragWire.bendIndex] = {
      x: Math.round(origin.x + dx),
      y: Math.round(origin.y + dy),
    };
  } else {
    if (state.dragWire.route === "V") {
      wire.bend = Math.round(state.dragWire.origin + dy);
    } else {
      wire.bend = Math.round(state.dragWire.origin + dx);
    }
  }
  doUpdateWires();
}

/**
 * 结束连线拖拽
 */
function endWireDrag() {
  state.dragWire = null;
  window.removeEventListener("pointermove", onWireDragHandler);
  window.removeEventListener("pointerup", endWireDragHandler);
  doRenderProperties();
}

/**
 * 初始化调色板
 */
export function initPalette() {
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
      createModule(type, x, y, select);
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
    createModule(type, point.x - library.width / 2, point.y - library.height / 2, select);
  });
}

/**
 * 初始化按钮
 */
export function initButtons() {
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
      loadState(data, {
        renderModules: doRenderModules,
        updateWires: doUpdateWires,
        renderProperties: doRenderProperties,
        updateStatus: updateStatus,
      });
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
    loadState(JSON.parse(data), {
      renderModules: doRenderModules,
      updateWires: doUpdateWires,
      renderProperties: doRenderProperties,
      updateStatus: updateStatus,
    });
  });

  document.getElementById("btn-clear").addEventListener("click", () => {
    if (!confirm("Clear the canvas?")) {
      return;
    }
    state.modules = [];
    state.wires = [];
    state.selection = null;
    state.connecting = null;
    doRenderModules();
    doUpdateWires();
    doRenderProperties();
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

/**
 * 初始化画布事件
 */
export function initCanvasEvents() {
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
    doRenderModules();
    doUpdateWires();
    doRenderProperties();
    updateStatus();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!state.connecting) {
      return;
    }
    state.connecting.cursor = getCanvasPoint(event);
    doUpdateWires();
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
      doUpdateWires();
      updateStatus();
    },
    { passive: false }
  );
}

/**
 * 初始化键盘事件
 */
export function initKeyboardEvents() {
  document.addEventListener("keydown", (event) => {
    if (isTypingTarget(document.activeElement)) {
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      deleteSelected();
    }
    if (event.key === "Escape") {
      state.connecting = null;
      doUpdateWires();
      updateStatus();
    }
  });
}

/**
 * 初始化窗口事件
 */
export function initWindowEvents() {
  window.addEventListener("resize", () => {
    syncSvgSize();
    doUpdateWires();
  });
}

/**
 * 初始化状态栏点击
 */
export function initStatusClick() {
  statusEl.addEventListener("click", () => {
    resetView();
  });
}

/**
 * 初始化应用
 */
export function initApp() {
  initPalette();
  initButtons();
  initCanvasEvents();
  initKeyboardEvents();
  initWindowEvents();
  initStatusClick();
  applyViewTransform();
  applyCanvasBackground();
  doRenderModules();
  doUpdateWires();
  doRenderProperties();
  updateStatus();
}
