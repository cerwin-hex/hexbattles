import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { Rect, Text as SvgText } from "react-native-svg";
import styles from "@/app/gameStyles";
import type { Difficulty } from "@/types";

function diffLabel(d: Difficulty): string {
  if (d === "expert") return "Expert";
  if (d === "super_hard") return "S.Hard";
  if (d === "hard") return "Hard";
  if (d === "medium") return "Med";
  return "Easy";
}

interface DevModeOverlayProps {
  isDeveloperModeActive: boolean;
  setIsDeveloperModeActive: React.Dispatch<React.SetStateAction<boolean>>;
  topInset: number;
  aiDifficulty: Difficulty;
}

export function DevModeOverlay({
  isDeveloperModeActive,
  setIsDeveloperModeActive,
  topInset,
  aiDifficulty,
}: DevModeOverlayProps) {
  return (
    <View
      style={{
        position: "absolute",
        top: topInset + 4,
        right: 4,
        zIndex: 20,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
      }}
    >
      {isDeveloperModeActive && (
        <View
          style={{
            backgroundColor: "rgba(0,0,0,0.6)",
            borderRadius: 4,
            paddingHorizontal: 5,
            paddingVertical: 2,
          }}
        >
          <Text style={{ color: "#FFD700", fontSize: 11, fontWeight: "bold" }}>
            {diffLabel(aiDifficulty)}
          </Text>
        </View>
      )}
      <TouchableOpacity
        style={[
          styles.devBtn,
          isDeveloperModeActive ? styles.devBtnActive : styles.devBtnInactive,
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
    </View>
  );
}

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
