import React from "react";
import { G, Line } from "react-native-svg";
import type { BorderEdge } from "@/types";

export interface BorderEdgeLayerProps {
  outerEdges: BorderEdge[];
  innerEdges: BorderEdge[];
  hasSelection: boolean;
  selectionEdges: BorderEdge[];
}

function BorderEdgeLayerInner({
  outerEdges,
  innerEdges,
  hasSelection,
  selectionEdges,
}: BorderEdgeLayerProps) {
  return (
    <G>
      {outerEdges.map((edge, i) => (
        <Line
          key={`outer-${i}`}
          x1={edge.x1}
          y1={edge.y1}
          x2={edge.x2}
          y2={edge.y2}
          stroke={edge.color}
          strokeWidth={edge.width}
          strokeLinecap="round"
        />
      ))}
      {hasSelection &&
        innerEdges.map((edge, i) => (
          <Line
            key={i}
            x1={edge.x1}
            y1={edge.y1}
            x2={edge.x2}
            y2={edge.y2}
            stroke={edge.color}
            strokeWidth={edge.width}
            strokeLinecap="round"
          />
        ))}
      {hasSelection &&
        selectionEdges.map((edge, i) => (
          <Line
            key={`sel-${i}`}
            x1={edge.x1}
            y1={edge.y1}
            x2={edge.x2}
            y2={edge.y2}
            stroke={edge.color}
            strokeWidth={edge.width}
            strokeLinecap="round"
          />
        ))}
    </G>
  );
}

function areBorderEdgeLayerEqual(
  prev: BorderEdgeLayerProps,
  next: BorderEdgeLayerProps,
): boolean {
  return (
    prev.outerEdges === next.outerEdges &&
    prev.innerEdges === next.innerEdges &&
    prev.hasSelection === next.hasSelection &&
    prev.selectionEdges === next.selectionEdges
  );
}

export const BorderEdgeLayer = React.memo(
  BorderEdgeLayerInner,
  areBorderEdgeLayerEqual,
);
