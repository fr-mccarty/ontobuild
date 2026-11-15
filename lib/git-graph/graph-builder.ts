import type { RevisionCommit } from "@/lib/api/revisions";
import type {
  GraphVertex,
  GraphLayout,
  BranchSegment,
  GridPoint,
} from "./types";

export function buildGraphLayout(
  commits: RevisionCommit[],
  refs?: Record<string, string[]>,
  defaultBranch?: string
): GraphLayout {
  if (commits.length === 0) {
    return { vertices: [], segments: [], width: 0, height: 0 };
  }

  const hashToIndex = new Map<string, number>();
  commits.forEach((commit, index) => {
    hashToIndex.set(commit.hash, index);
  });

  const vertices: GraphVertex[] = commits.map((commit, index) => {
    const parentHashes = commit.parent_hashes ?? [];
    return {
      id: index,
      hash: commit.hash,
      parentIndices: parentHashes
        .map((h) => hashToIndex.get(h))
        .filter((i): i is number => i !== undefined),
      childIndices: [],
      lane: 0,
      color: 0,
      isMerge: parentHashes.length > 1,
      refs: refs?.[commit.hash] ?? [],
    };
  });

  vertices.forEach((vertex) => {
    vertex.parentIndices.forEach((parentIdx) => {
      if (vertices[parentIdx]) {
        vertices[parentIdx].childIndices.push(vertex.id);
      }
    });
  });

  const hints = computeBranchHints(vertices, defaultBranch);

  assignLanesAndColors(vertices, hints);

  const segments = generateSegments(vertices);

  const width = Math.max(...vertices.map((v) => v.lane)) + 1;

  return {
    vertices,
    segments,
    width,
    height: commits.length,
  };
}

function computeBranchHints(
  vertices: GraphVertex[],
  defaultBranch?: string
): Map<number, number> {
  const hints = new Map<number, number>();
  if (!defaultBranch || vertices.length === 0) return hints;

  let mainTipIdx: number | null = null;
  for (const v of vertices) {
    if (v.refs.includes(defaultBranch)) {
      mainTipIdx = v.id;
      break;
    }
  }

  if (mainTipIdx === null) return hints;

  const mainLine = new Set<number>();
  let current: number | null = mainTipIdx;
  while (current !== null) {
    mainLine.add(current);
    hints.set(current, 0);
    const v: GraphVertex = vertices[current];
    current =
      v.parentIndices.length > 0 ? v.parentIndices[0] : null;
  }

  let nextLane = 1;
  for (const v of vertices) {
    if (v.refs.length === 0 || v.id === mainTipIdx) continue;
    if (v.refs.every((r) => r === defaultBranch)) continue;

    const lane = nextLane++;
    let walk: number | null = v.id;
    while (walk !== null && !mainLine.has(walk)) {
      if (hints.has(walk)) break;
      hints.set(walk, lane);
      const wv: GraphVertex = vertices[walk];
      walk =
        wv.parentIndices.length > 0 ? wv.parentIndices[0] : null;
    }
  }

  return hints;
}

function assignLanesAndColors(
  vertices: GraphVertex[],
  hints: Map<number, number>
): void {
  const activeLanes = new Map<number, { lane: number; color: number }>();
  let nextColor = 1;

  for (let i = 0; i < vertices.length; i++) {
    const vertex = vertices[i];

    const hintedLane = hints.get(i);

    let assignedLane: number | null = null;
    let assignedColor: number | null = null;

    if (hintedLane !== undefined) {
      const usedLanes = new Set<number>();
      activeLanes.forEach(({ lane }) => {
        usedLanes.add(lane);
      });

      if (!usedLanes.has(hintedLane)) {
        assignedLane = hintedLane;
        for (const childIdx of vertex.childIndices) {
          const child = vertices[childIdx];
          if (child.lane === hintedLane && child.parentIndices[0] === i) {
            assignedColor = child.color;
            break;
          }
        }
        if (assignedColor === null) {
          assignedColor = hintedLane === 0 ? 0 : nextColor++;
        }
      }
    }

    if (assignedLane === null) {
      const continuingChildren: GraphVertex[] = [];
      for (const childIdx of vertex.childIndices) {
        const child = vertices[childIdx];
        if (child.parentIndices[0] === i) {
          continuingChildren.push(child);
        }
      }

      if (continuingChildren.length > 0) {
        continuingChildren.sort((a, b) => a.lane - b.lane);
        assignedLane = continuingChildren[0].lane;
        assignedColor = continuingChildren[0].color;
      }
    }

    if (assignedLane === null) {
      const usedLanes = new Set<number>();
      activeLanes.forEach(({ lane }) => {
        usedLanes.add(lane);
      });

      assignedLane = 0;
      while (usedLanes.has(assignedLane)) {
        assignedLane++;
      }
      assignedColor = assignedLane === 0 ? 0 : nextColor++;
    }

    vertex.lane = assignedLane;
    vertex.color = assignedColor!;

    activeLanes.set(i, { lane: vertex.lane, color: vertex.color });

    for (const [idx] of activeLanes.entries()) {
      if (idx !== i) {
        const existingVertex = vertices[idx];
        const hasConnectionBelow = existingVertex.parentIndices.some(
          (pIdx) => pIdx > i
        );
        if (!hasConnectionBelow) {
          activeLanes.delete(idx);
        }
      }
    }
  }
}

function generateSegments(vertices: GraphVertex[]): BranchSegment[] {
  const segments: BranchSegment[] = [];

  for (const vertex of vertices) {
    const from: GridPoint = { x: vertex.lane, y: vertex.id };

    vertex.parentIndices.forEach((parentIdx, connectionIndex) => {
      const parent = vertices[parentIdx];
      if (!parent) return;

      const to: GridPoint = { x: parent.lane, y: parentIdx };

      const isMergeLine = connectionIndex > 0;
      const colorIndex = isMergeLine ? parent.color : vertex.color;

      segments.push({
        from,
        to,
        isMergeLine,
        colorIndex,
      });
    });
  }

  return segments;
}
