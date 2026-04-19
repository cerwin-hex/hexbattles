import React from "react";
import { Text, TouchableOpacity } from "react-native";
import { Rect, Text as SvgText } from "react-native-svg";
import styles from "@/app/gameStyles";

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

export function DevEconomicSvgOverlays({
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
