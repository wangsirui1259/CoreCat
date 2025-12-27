/**
 * Utils - 工具函数
 * 包含通用工具函数和辅助方法
 */

import { state, canvas } from './state.js';
import { NS, MUX_DEFAULT, DEFAULT_CANVAS_BG } from './constants.js';

/**
 * 将值限制在指定范围内
 */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * 生成唯一ID
 */
export function uid(prefix) {
  return `${prefix}-${state.nextId++}`;
}

/**
 * 获取画布上的点坐标（考虑缩放和偏移）
 */
export function getCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left - state.view.offsetX) / state.view.scale,
    y: (event.clientY - rect.top - state.view.offsetY) / state.view.scale,
  };
}

/**
 * 通过ID获取模块
 */
export function getModuleById(id) {
  return state.modules.find((mod) => mod.id === id);
}

/**
 * 通过ID获取端口
 */
export function getPortById(mod, portId) {
  return mod.ports.find((port) => port.id === portId);
}

/**
 * 检查是否为时钟端口
 */
export function isClockPort(mod, port) {
  if (!mod || !port) {
    return false;
  }
  if (mod.type !== "reg") {
    return false;
  }
  return port.clock === true || port.name === "CLK";
}

/**
 * XML转义
 */
export function escapeXml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;");
}

/**
 * 创建SVG元素
 */
export function svgEl(tag, attrs) {
  const el = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([key, value]) => {
    el.setAttribute(key, value);
  });
  return el;
}

/**
 * 检查目标是否为输入元素
 */
export function isTypingTarget(target) {
  if (!target) {
    return false;
  }
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

/**
 * 获取画布背景颜色
 */
export function getCanvasBackgroundColor() {
  return state.canvasBackground || DEFAULT_CANVAS_BG;
}

/**
 * 应用画布背景
 */
export function applyCanvasBackground() {
  if (state.canvasBackground) {
    canvas.style.background = state.canvasBackground;
  } else {
    canvas.style.background = "";
  }
}

/**
 * 获取MUX的切角值
 */
export function getMuxCut(mod) {
  const angle = ((90 - MUX_DEFAULT.slopeAngle) * Math.PI) / 180;
  const cut = mod.width * Math.tan(angle);
  return clamp(cut, 8, mod.width - 12);
}

/**
 * 计算MUX最小高度
 */
export function muxMinHeight(width) {
  const angle = ((90 - MUX_DEFAULT.slopeAngle) * Math.PI) / 180;
  return Math.max(60, 2 * width * Math.tan(angle) + MUX_DEFAULT.minRight);
}

/**
 * 计算MUX最大宽度
 */
export function muxMaxWidth(height) {
  const angle = ((90 - MUX_DEFAULT.slopeAngle) * Math.PI) / 180;
  const maxCut = Math.max(0, (height - MUX_DEFAULT.minRight) / 2);
  if (maxCut <= 0) {
    return 0;
  }
  return maxCut / Math.tan(angle);
}

/**
 * 确保MUX几何形状正确
 */
export function ensureMuxGeometry(mod, mode) {
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

/**
 * 构建MUX SVG背景
 */
export function buildMuxSvgBackground(mod) {
  const width = mod.width;
  const height = mod.height;
  const cut = getMuxCut(mod);
  const strokeColor = mod.strokeColor || 'rgba(150, 108, 203, 0.6)';
  const strokeWidth = Number.isFinite(mod.strokeWidth) ? mod.strokeWidth : 2;
  const fillColor = mod.fill || 'rgba(255, 253, 249, 0.95)';

  // 梯形路径：左上 -> 右上(下移cut) -> 右下(上移cut) -> 左下
  const sw2 = strokeWidth / 2;
  const path = `M ${sw2} ${sw2} L ${width - sw2} ${cut} L ${width - sw2} ${height - cut} L ${sw2} ${height - sw2} Z`;

  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' viewBox='0 0 ${width} ${height}'><path d='${path}' fill='${fillColor}' stroke='${strokeColor}' stroke-width='${strokeWidth}' stroke-linejoin='round'/></svg>`;

  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
