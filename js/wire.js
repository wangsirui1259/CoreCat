/**
 * Wire - 连线相关功能
 * 包含连线创建、路由、渲染等
 */

import { state, wireLayer, canvas } from './state.js';
import { DEFAULT_WIRE, WIRE_STYLES, WIRE_MARGIN } from './constants.js';
import { uid, svgEl, getModuleById } from './utils.js';
import { getPortPositionByRef, describePortRef } from './port.js';

/**
 * 设置连线默认弯折点
 */
export function setWireDefaultBend(wire) {
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
  // Reset bends to null for simple routing (can be set later for multi-segment routes)
  wire.bends = null;
}

/**
 * 获取模块边界框（含边距）
 */
function getModuleBounds(mod, margin = WIRE_MARGIN) {
  return {
    left: mod.x - margin,
    right: mod.x + mod.width + margin,
    top: mod.y - margin,
    bottom: mod.y + mod.height + margin,
  };
}

/**
 * 检查水平线段是否与矩形相交
 */
function hLineIntersectsRect(y, x1, x2, rect) {
  if (y <= rect.top || y >= rect.bottom) return false;
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  return maxX > rect.left && minX < rect.right;
}

/**
 * 检查垂直线段是否与矩形相交
 */
function vLineIntersectsRect(x, y1, y2, rect) {
  if (x <= rect.left || x >= rect.right) return false;
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  return maxY > rect.top && minY < rect.bottom;
}

/**
 * 获取障碍物模块
 */
function getObstacleModules(wire, includeEndpoints = false) {
  if (includeEndpoints) {
    return state.modules;
  }
  return state.modules.filter((mod) => mod.id !== wire.from.moduleId && mod.id !== wire.to.moduleId);
}

/**
 * 检查路径碰撞
 */
function checkPathCollision(wire, start, end) {
  const allModules = getObstacleModules(wire, true);
  
  for (const mod of allModules) {
    const rect = getModuleBounds(mod);
    
    if (wire.route === "V") {
      const midY = wire.bend;
      if (vLineIntersectsRect(start.x, start.y, midY, rect)) return true;
      if (hLineIntersectsRect(midY, start.x, end.x, rect)) return true;
      if (vLineIntersectsRect(end.x, midY, end.y, rect)) return true;
    } else {
      const midX = wire.bend;
      if (hLineIntersectsRect(start.y, start.x, midX, rect)) return true;
      if (vLineIntersectsRect(midX, start.y, end.y, rect)) return true;
      if (hLineIntersectsRect(end.y, midX, end.x, rect)) return true;
    }
  }
  
  return false;
}

/**
 * 计算智能路由
 */
function computeSmartRoute(wire, start, end) {
  const allModules = getObstacleModules(wire, true);
  if (allModules.length === 0) return null;
  
  const margin = WIRE_MARGIN;
  
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  
  const relevantModules = allModules.filter((mod) => {
    const rect = getModuleBounds(mod, margin);
    return !(rect.right < minX - margin || rect.left > maxX + margin ||
             rect.bottom < minY - margin || rect.top > maxY + margin);
  });
  
  if (relevantModules.length === 0) return null;
  
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
    let midX1, midX2;
    
    if (start.x >= combinedRight - margin) {
      midX1 = combinedRight + margin;
    } else if (start.x <= combinedLeft + margin) {
      midX1 = combinedLeft - margin;
    } else {
      const distToRight = combinedRight - start.x;
      const distToLeft = start.x - combinedLeft;
      midX1 = distToRight < distToLeft ? combinedRight + margin : combinedLeft - margin;
    }
    
    if (end.x >= combinedRight - margin) {
      midX2 = combinedRight + margin;
    } else if (end.x <= combinedLeft + margin) {
      midX2 = combinedLeft - margin;
    } else {
      const distToRight = combinedRight - end.x;
      const distToLeft = end.x - combinedLeft;
      midX2 = distToRight < distToLeft ? combinedRight + margin : combinedLeft - margin;
    }
    
    const topY = combinedTop - margin;
    const routeAbove = [
      { x: midX1, y: start.y },
      { x: midX1, y: topY },
      { x: midX2, y: topY },
      { x: midX2, y: end.y },
    ];
    
    const bottomY = combinedBottom + margin;
    const routeBelow = [
      { x: midX1, y: start.y },
      { x: midX1, y: bottomY },
      { x: midX2, y: bottomY },
      { x: midX2, y: end.y },
    ];
    
    const distAbove = Math.abs(topY - start.y) + Math.abs(topY - end.y);
    const distBelow = Math.abs(bottomY - start.y) + Math.abs(bottomY - end.y);
    
    return distAbove < distBelow ? routeAbove : routeBelow;
  } else {
    let midY1, midY2;
    
    if (start.y >= combinedBottom - margin) {
      midY1 = combinedBottom + margin;
    } else if (start.y <= combinedTop + margin) {
      midY1 = combinedTop - margin;
    } else {
      const distToBottom = combinedBottom - start.y;
      const distToTop = start.y - combinedTop;
      midY1 = distToBottom < distToTop ? combinedBottom + margin : combinedTop - margin;
    }
    
    if (end.y >= combinedBottom - margin) {
      midY2 = combinedBottom + margin;
    } else if (end.y <= combinedTop + margin) {
      midY2 = combinedTop - margin;
    } else {
      const distToBottom = combinedBottom - end.y;
      const distToTop = end.y - combinedTop;
      midY2 = distToBottom < distToTop ? combinedBottom + margin : combinedTop - margin;
    }
    
    const leftX = combinedLeft - margin;
    const routeLeft = [
      { x: start.x, y: midY1 },
      { x: leftX, y: midY1 },
      { x: leftX, y: midY2 },
      { x: end.x, y: midY2 },
    ];
    
    const rightX = combinedRight + margin;
    const routeRight = [
      { x: start.x, y: midY1 },
      { x: rightX, y: midY1 },
      { x: rightX, y: midY2 },
      { x: end.x, y: midY2 },
    ];
    
    const distLeft = Math.abs(leftX - start.x) + Math.abs(leftX - end.x);
    const distRight = Math.abs(rightX - start.x) + Math.abs(rightX - end.x);
    
    return distLeft < distRight ? routeLeft : routeRight;
  }
}

/**
 * 设置智能路由弯折点
 */
export function setWireSmartBends(wire) {
  const start = getPortPositionByRef(wire.from);
  const end = getPortPositionByRef(wire.to);
  if (!start || !end) return;
  
  if (!checkPathCollision(wire, start, end)) {
    wire.bends = null;
    return;
  }
  
  const smartRoute = computeSmartRoute(wire, start, end);
  if (smartRoute) {
    wire.bends = smartRoute.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  }
}

export function createWire(from, to, selectCallback) {
  const wire = {
    id: uid("wire"),
    from,
    to,
    label: "",
    route: "H",
    bend: 0,
    bends: null,
    color: DEFAULT_WIRE.color,
    width: DEFAULT_WIRE.width,
    style: DEFAULT_WIRE.style,
  };
  setWireDefaultBend(wire);
  // 默认不开启智能连线
  // setWireSmartBends(wire);
  state.wires.push(wire);
  if (selectCallback) {
    selectCallback({ type: "wire", id: wire.id });
  }
}

/**
 * 构建连线路径
 */
export function buildWirePath(wire, start, end) {
  if (Array.isArray(wire.bends) && wire.bends.length > 0) {
    let path = `M ${start.x} ${start.y}`;
    for (const bend of wire.bends) {
      path += ` L ${bend.x} ${bend.y}`;
    }
    path += ` L ${end.x} ${end.y}`;
    return path;
  }
  
  if (wire.route === "V") {
    const midY = wire.bend;
    return `M ${start.x} ${start.y} L ${start.x} ${midY} L ${end.x} ${midY} L ${end.x} ${end.y}`;
  }
  const midX = wire.bend;
  return `M ${start.x} ${start.y} L ${midX} ${start.y} L ${midX} ${end.y} L ${end.x} ${end.y}`;
}

/**
 * 获取连线手柄位置数组
 * 对于智能路由（SmartRoute，wire.bends 数组存在时），返回单个中心手柄，可以拖动整条线段
 * 对于简单路由（wire.bend 单值），返回中间位置的手柄
 * 注意：wire.bends 仅由 setWireSmartBends() 设置，普通连线不会有此属性
 */
export function getWireHandlePositions(wire, start, end) {
  if (Array.isArray(wire.bends) && wire.bends.length > 0) {
    // 智能路由：计算所有弯折点的中心位置，返回单个手柄用于整体移动
    const centerX = wire.bends.reduce((sum, b) => sum + b.x, 0) / wire.bends.length;
    const centerY = wire.bends.reduce((sum, b) => sum + b.y, 0) / wire.bends.length;
    return [{ x: centerX, y: centerY, index: -2 }]; // index -2 表示智能路由整体移动
  }
  
  if (wire.route === "V") {
    return [{ x: (start.x + end.x) / 2, y: wire.bend, index: -1 }];
  }
  return [{ x: wire.bend, y: (start.y + end.y) / 2, index: -1 }];
}

/**
 * 获取连线手柄位置
 */
export function wireHandlePosition(wire, start, end) {
  if (Array.isArray(wire.bends) && wire.bends.length > 0) {
    const midIndex = Math.floor(wire.bends.length / 2);
    return { x: wire.bends[midIndex].x, y: wire.bends[midIndex].y };
  }
  
  if (wire.route === "V") {
    return { x: (start.x + end.x) / 2, y: wire.bend };
  }
  return { x: wire.bend, y: (start.y + end.y) / 2 };
}

/**
 * 获取连线标签位置
 */
export function wireLabelPosition(wire, start, end) {
  return wireHandlePosition(wire, start, end);
}

/**
 * 同步SVG尺寸
 */
export function syncSvgSize() {
  wireLayer.setAttribute("width", canvas.clientWidth);
  wireLayer.setAttribute("height", canvas.clientHeight);
}

/**
 * 更新连线渲染
 */
export function updateWires(selectCallback, startWireDragCallback) {
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
      if (selectCallback) {
        selectCallback({ type: "wire", id: wire.id });
      }
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
        if (selectCallback) {
          selectCallback({ type: "wire", id: wire.id });
        }
      });
      wireLayer.appendChild(label);
    }

    if (isSelected) {
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
          if (startWireDragCallback) {
            startWireDragCallback(event, wire, pos.index);
          }
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
