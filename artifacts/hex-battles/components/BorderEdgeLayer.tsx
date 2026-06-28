import React from "react";
import { G, Line } from "react-native-svg";
import type { BorderEdge } from "@/types";
import { areBorderEdgeLayerEqual } from "@/components/layerEquality";

export interface BorderEdgeLayerProps {
  outerEdges: BorderEdge[];
  innerEdges: BorderEdge[];
  /**
   * Whether to draw the owner-coloured inner boundary lines. Now permanently
   * true: every territory's outer boundary reads in its owner colour in all
   * views — the default player-colour view (where it integrates owned/bridged
   * lakes into the territory outline), a tile selection, and the dev-mode
   * AI-turn terrain view. Kept as a prop so the layer stays presentational.
   */
  showInnerEdges: boolean;
  hasSelection: boolean;
  selectionEdges: BorderEdge[];
  /**
   * Light-green outline around the single tile of a selected building (tower,
   * castle, bridge). Rendered independently of `hasSelection` — a selected
   * bridge on a lake tile may yield no contiguous territory selection.
   */
  buildingSelectionEdges: BorderEdge[];
}

// Outer and inner territory border lines never change on a selection tap (they
// only update when mutableTileMap changes — i.e. on actual moves). Isolating
// them in their own memoized component means a selection tap reconciles ~60
// selection-edge Lines instead of the full ~400 outer+inner Lines.
const StaticBorderEdges = React.memo(
  function StaticBorderEdges({
    outerEdges,
    innerEdges,
    showInnerEdges,
  }: {
    outerEdges: BorderEdge[];
    innerEdges: BorderEdge[];
    showInnerEdges: boolean;
  }) {
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
        {showInnerEdges &&
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
      </G>
    );
  },
  (prev, next) =>
    prev.outerEdges === next.outerEdges &&
    prev.innerEdges === next.innerEdges &&
    prev.showInnerEdges === next.showInnerEdges,
);

function BorderEdgeLayerInner({
  outerEdges,
  innerEdges,
  showInnerEdges,
  hasSelection,
  selectionEdges,
  buildingSelectionEdges,
}: BorderEdgeLayerProps) {
  return (
    <G>
      <StaticBorderEdges
        outerEdges={outerEdges}
        innerEdges={innerEdges}
        showInnerEdges={showInnerEdges}
      />
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
      {buildingSelectionEdges.map((edge, i) => (
        <Line
          key={`bld-${i}`}
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

export { areBorderEdgeLayerEqual };
export const BorderEdgeLayer = React.memo(
  BorderEdgeLayerInner,
  areBorderEdgeLayerEqual,
);
