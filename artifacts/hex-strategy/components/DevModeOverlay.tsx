import React from "react";
import { Text, TouchableOpacity } from "react-native";
import { Rect, Text as SvgText } from "react-native-svg";
import styles from "@/app/gameStyles";
import type { HexTile } from "@/types";

interface DevModeOverlayProps {
  isDeveloperModeActive: boolean;
  setIsDeveloperModeActive: React.Dispatch<React.SetStateAction<boolean>>;
  topInset: number;
}

export function DevModeOverlay({
  isDeveloperModeActive,
  setIsDeveloperModeActive,
  topInset,
}: DevModeOverlayProps) {
  return (
    <TouchableOpacity
      style={[
        styles.devBtn,
        isDeveloperModeActive ? styles.devBtnActive : styles.devBtnInactive,
        { top: topInset + 4, right: 4, position: "absolute", zIndex: 20 },
      ]}
      onPress={() => setIsDeveloperModeActive((v) => !v)}
    >
      <Text
        style={[
          styles.devBtnText,
          isDeveloperModeActive
            ? styles.devBtnTextActive
            : styles.devBtnTextInactive,
        ]}
      >
        DEV
      </Text>
    </TouchableOpacity>
  );
}

const TERRAIN_ABBR: Record<string, string> = {
  grass: "Grs",
  forest: "Frs",
  desert: "Dst",
  mountain: "Mtn",
  lake: "Lke",
};

interface DevTerrainSvgLabelsProps {
  isDeveloperModeActive: boolean;
  tileDataMap: Map<string, { cx: number; cy: number }>;
  activeTileMap: Map<string, HexTile>;
  hexSize: number;
}

export const DevTerrainSvgLabels = React.memo(
  function DevTerrainSvgLabels({
    isDeveloperModeActive,
    tileDataMap,
    activeTileMap,
    hexSize,
  }: DevTerrainSvgLabelsProps) {
    if (!isDeveloperModeActive) return null;
    const fontSize = Math.max(6, Math.min(9, hexSize * 0.24));
    const items: React.ReactElement[] = [];
    tileDataMap.forEach(({ cx, cy }, key) => {
      const tile = activeTileMap.get(key);
      if (!tile) return;
      const label = TERRAIN_ABBR[tile.terrain] ?? tile.terrain;
      items.push(
        <SvgText
          key={`terrain-${key}`}
          x={cx}
          y={cy + hexSize * 0.38}
          textAnchor="middle"
          fontSize={fontSize}
          fill="rgba(255,255,255,0.75)"
          fontWeight="bold"
        >
          {label}
        </SvgText>
      );
    });
    return <>{items}</>;
  }
);

interface DevEconOverlay {
  cx: number;
  cy: number;
  label: string;
  aiLabel?: string;
}

interface DevEconomicSvgOverlaysProps {
  isDeveloperModeActive: boolean;
  devEconomicOverlays: DevEconOverlay[];
  hexSize: number;
}

export const DevEconomicSvgOverlays = React.memo(
  function DevEconomicSvgOverlays({
    isDeveloperModeActive,
    devEconomicOverlays,
    hexSize,
  }: DevEconomicSvgOverlaysProps) {
    if (!isDeveloperModeActive) return null;
    return (
      <>
        {devEconomicOverlays.map(({ cx, cy, label, aiLabel }, i) => {
          const fontSize = Math.max(7, Math.min(11, hexSize * 0.32));
          const maxLen = aiLabel
            ? Math.max(label.length, aiLabel.length)
            : label.length;
          const totalHeight = aiLabel ? fontSize * 2.8 : fontSize * 1.4;
          return (
            <React.Fragment key={`dev-econ-${i}`}>
              <Rect
                x={cx - fontSize * maxLen * 0.32}
                y={cy - fontSize * 0.85}
                width={fontSize * maxLen * 0.64}
                height={totalHeight}
                fill="rgba(0,0,0,0.65)"
                rx={2}
              />
              <SvgText
                x={cx}
                y={cy + fontSize * 0.42}
                textAnchor="middle"
                fontSize={fontSize}
                fill="#00FF88"
                fontWeight="bold"
              >
                {label}
              </SvgText>
              {aiLabel && (
                <SvgText
                  x={cx}
                  y={cy + fontSize * 0.42 + fontSize * 1.4}
                  textAnchor="middle"
                  fontSize={fontSize}
                  fill="#FFD700"
                  fontWeight="bold"
                >
                  {aiLabel}
                </SvgText>
              )}
            </React.Fragment>
          );
        })}
      </>
    );
  }
);
