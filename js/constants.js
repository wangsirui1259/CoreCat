/**
 * Constants - 常量定义
 * 包含模块库、默认配置、线型样式等
 */

export const NS = "http://www.w3.org/2000/svg";

export const MODULE_LIBRARY = {
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
      { name: "Out", side: "right", offset: 0.5 },
    ],
  },
  extender: {
    label: "Extender",
    width: 160,
    height: 60,
    ports: [
      { name: "In", side: "left", offset: 0.6 },
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

export const DEFAULT_MODULE = {
  nameSize: 14,
  showType: false,
  fill: "",
  strokeColor: "",
  strokeWidth: 2,
};

export const MUX_DEFAULT = {
  inputs: 4,
  controlSide: "top",
  controlOffsetTop: 0.55,
  controlOffsetBottom: 0.55,
  slopeAngle: 60,
  minRight: 24,
};

export const EXTENDER_DEFAULT = {
  slopeRatio: 0.25,
  minOffset: 10,
  edgePadding: 18,
};

export const DEFAULT_WIRE = {
  color: "#263238",
  width: 2.5,
  style: "solid",
};

// Minimum distance between wires and module edges
export const WIRE_MARGIN = 20;

export const DEFAULT_CANVAS_BG = "#f6f1e8";

export const WIRE_STYLES = {
  solid: "",
  dashed: "8 6",
  dotted: "2 6",
};
