export interface GridPoint {
  x: number;
  y: number;
}

export interface GraphVertex {
  id: number;
  hash: string;
  parentIndices: number[];
  childIndices: number[];
  lane: number;
  color: number;
  isMerge: boolean;
  refs: string[];
}

export interface BranchSegment {
  from: GridPoint;
  to: GridPoint;
  isMergeLine: boolean;
  colorIndex: number;
}

export interface GraphLayout {
  vertices: GraphVertex[];
  segments: BranchSegment[];
  width: number;
  height: number;
}

export interface GraphConfig {
  cellHeight: number;
  cellWidth: number;
  nodeRadius: number;
  lineWidth: number;
  selectedNodeRadius: number;
  colors: string[];
}

export const DEFAULT_GRAPH_CONFIG: GraphConfig = {
  cellHeight: 50,
  cellWidth: 20,
  nodeRadius: 4,
  lineWidth: 2,
  selectedNodeRadius: 5,
  colors: [
    "#4a9eff",
    "#ff6b6b",
    "#4ecdc4",
    "#ffe66d",
    "#95e1a3",
    "#c9b1ff",
    "#ff9f43",
    "#a8e6cf",
  ],
};
