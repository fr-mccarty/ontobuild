"use client";

import { useMemo } from "react";
import type { RevisionCommit } from "@/lib/api/revisions";
import { buildGraphLayout } from "@/lib/git-graph/graph-builder";
import {
  DEFAULT_GRAPH_CONFIG,
  type GraphConfig,
  type BranchSegment,
  type GraphVertex,
} from "@/lib/git-graph/types";

interface GitGraphProps {
  commits: RevisionCommit[];
  selectedHash?: string | null;
  onSelectCommit?: (hash: string) => void;
  config?: Partial<GraphConfig>;
  className?: string;
  refs?: Record<string, string[]>;
  defaultBranch?: string;
}

export function GitGraph({
  commits,
  selectedHash,
  onSelectCommit,
  config: configOverrides,
  className,
  refs,
  defaultBranch,
}: GitGraphProps) {
  const config = useMemo(
    () => ({ ...DEFAULT_GRAPH_CONFIG, ...configOverrides }),
    [configOverrides]
  );

  const layout = useMemo(
    () => buildGraphLayout(commits, refs, defaultBranch),
    [commits, refs, defaultBranch]
  );

  if (commits.length === 0) {
    return null;
  }

  const svgWidth = layout.width * config.cellWidth + config.cellWidth;
  const svgHeight = layout.height * config.cellHeight;

  return (
    <svg
      width={svgWidth}
      height={svgHeight}
      className={className}
      style={{ minWidth: svgWidth }}
    >
      <g className="branch-lines">
        {layout.segments.map((segment, index) => (
          <BranchLine
            key={`segment-${index}`}
            segment={segment}
            config={config}
          />
        ))}
      </g>

      <g className="commit-nodes">
        {layout.vertices.map((vertex) => (
          <CommitNode
            key={vertex.hash}
            vertex={vertex}
            config={config}
            isSelected={selectedHash === vertex.hash}
            onClick={() => onSelectCommit?.(vertex.hash)}
          />
        ))}
      </g>
    </svg>
  );
}

interface BranchLineProps {
  segment: BranchSegment;
  config: GraphConfig;
}

function BranchLine({ segment, config }: BranchLineProps) {
  const { from, to, colorIndex, isMergeLine } = segment;
  const color = config.colors[colorIndex % config.colors.length];

  const x1 = from.x * config.cellWidth + config.cellWidth / 2;
  const y1 = from.y * config.cellHeight + config.cellHeight / 2;
  const x2 = to.x * config.cellWidth + config.cellWidth / 2;
  const y2 = to.y * config.cellHeight + config.cellHeight / 2;

  let pathD: string;

  if (from.x === to.x) {
    pathD = `M ${x1} ${y1} L ${x2} ${y2}`;
  } else {
    const k = 0.5522847498;
    const dx = x2 - x1;
    const absDx = Math.abs(dx);
    const goingRight = dx > 0;

    const r = Math.min(config.cellWidth * 0.4, absDx / 2, config.cellHeight * 0.3);

    if (y2 > y1) {

      const horizontalY = y2 - r;

      if (horizontalY <= y1 + r) {
        const midY = (y1 + y2) / 2;
        pathD = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
      } else if (goingRight) {
        const arc1EndX = x1 + r;
        const arc1EndY = y1 + r;
        const arc1P1x = x1;
        const arc1P1y = y1 + r * k;
        const arc1P2x = arc1EndX - r * k;
        const arc1P2y = arc1EndY;

        const arc2StartX = x2 - r;
        const arc2StartY = y1 + r;
        const arc2EndY = y1 + 2 * r;
        const arc2P1x = arc2StartX + r * k;
        const arc2P1y = arc2StartY;
        const arc2P2x = x2;
        const arc2P2y = arc2EndY - r * k;

        pathD = [
          `M ${x1} ${y1}`,
          `C ${arc1P1x} ${arc1P1y}, ${arc1P2x} ${arc1P2y}, ${arc1EndX} ${arc1EndY}`,
          `L ${arc2StartX} ${arc2StartY}`,
          `C ${arc2P1x} ${arc2P1y}, ${arc2P2x} ${arc2P2y}, ${x2} ${arc2EndY}`,
          `L ${x2} ${y2}`,
        ].join(" ");
      } else {

        const arc1StartY = horizontalY - r;
        const arc1EndX = x1 - r;
        const arc1P1x = x1;
        const arc1P1y = arc1StartY + r * k;
        const arc1P2x = arc1EndX + r * k;
        const arc1P2y = horizontalY;

        const arc2StartX = x2 + r;
        const arc2P1x = arc2StartX - r * k;
        const arc2P1y = horizontalY;
        const arc2P2x = x2;
        const arc2P2y = y2 - r * k;

        pathD = [
          `M ${x1} ${y1}`,
          `L ${x1} ${arc1StartY}`,
          `C ${arc1P1x} ${arc1P1y}, ${arc1P2x} ${arc1P2y}, ${arc1EndX} ${horizontalY}`,
          `L ${arc2StartX} ${horizontalY}`,
          `C ${arc2P1x} ${arc2P1y}, ${arc2P2x} ${arc2P2y}, ${x2} ${y2}`,
        ].join(" ");
      }
    } else {
      const midY = (y1 + y2) / 2;
      pathD = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
    }
  }

  return (
    <path
      d={pathD}
      fill="none"
      stroke={color}
      strokeWidth={config.lineWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={isMergeLine ? 0.6 : 1}
      strokeDasharray={isMergeLine ? "4,2" : undefined}
    />
  );
}

interface CommitNodeProps {
  vertex: GraphVertex;
  config: GraphConfig;
  isSelected: boolean;
  onClick?: () => void;
}

function CommitNode({ vertex, config, isSelected, onClick }: CommitNodeProps) {
  const color = config.colors[vertex.color % config.colors.length];

  const cx = vertex.lane * config.cellWidth + config.cellWidth / 2;
  const cy = vertex.id * config.cellHeight + config.cellHeight / 2;

  const radius = isSelected ? config.selectedNodeRadius : config.nodeRadius;

  return (
    <g
      onClick={onClick}
      style={{ cursor: onClick ? "pointer" : "default" }}
      className="commit-node"
    >
      {isSelected && (
        <circle
          cx={cx}
          cy={cy}
          r={radius + 3}
          fill="none"
          stroke={color}
          strokeWidth={2}
          opacity={0.4}
        />
      )}

      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill={vertex.isMerge ? "white" : color}
        stroke={color}
        strokeWidth={vertex.isMerge ? 2 : 0}
      />

      {vertex.isMerge && (
        <circle cx={cx} cy={cy} r={radius - 2} fill={color} />
      )}
    </g>
  );
}
