import React from "react";
import { Text, TouchableOpacity, View, StyleProp, ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import type { EntityType } from "@/utils/hexGrid";
import styles from "@/app/gameStyles";
import type { EconBreakdown } from "@/components/GameModals";

interface BottomActionMenuProps {
  botInset: number;
  isAiTurn: boolean;
  gameResult: string | null;
  moveHistory: unknown[];
  handleUndo: () => void;
  showCredits: boolean;
  hasSelection: boolean;
  setShowEconModal: (v: boolean) => void;
  creditsDisplayValue: number;
  selectedLakeFund: number | null;
  lakeUpkeepPerTurn: number | null;
  econBreakdown: EconBreakdown | null;
  canBuild: boolean;
  ribbonMode: "units" | "buildings" | null;
  setSelectedEntityKey: (k: string | null) => void;
  closeRibbon: () => void;
  setArmedEntityId: (id: EntityType | null) => void;
  openRibbon: (mode: "units" | "buildings") => void;
  isDeveloperModeActive: boolean;
  isAiPaused: boolean;
  isAiTurnDone: boolean;
  aiHistoryIndex: number;
  handleAiStepBack: () => void;
  aiHistoryLen: number;
  handleAiStepNext: () => void;
  handleEndAiTurn: () => void;
  handleEndTurn: () => void;
  endTurnStyle: StyleProp<ViewStyle>;
}

export default function BottomActionMenu({
  botInset,
  isAiTurn,
  gameResult,
  moveHistory,
  handleUndo,
  showCredits,
  hasSelection,
  setShowEconModal,
  creditsDisplayValue,
  selectedLakeFund,
  lakeUpkeepPerTurn,
  econBreakdown,
  canBuild,
  ribbonMode,
  setSelectedEntityKey,
  closeRibbon,
  setArmedEntityId,
  openRibbon,
  isDeveloperModeActive,
  isAiPaused,
  isAiTurnDone,
  aiHistoryIndex,
  handleAiStepBack,
  aiHistoryLen,
  handleAiStepNext,
  handleEndAiTurn,
  handleEndTurn,
  endTurnStyle,
}: BottomActionMenuProps) {
  return (
    <View style={[styles.bottomBar, { paddingBottom: botInset }]}>
      <View style={styles.bottomBarInner}>
        {(() => {
          const undoDisabled =
            isAiTurn || gameResult !== null || moveHistory.length === 0;
          return (
            <TouchableOpacity
              style={[styles.undoBtn, undoDisabled && styles.undoBtnDisabled]}
              onPress={handleUndo}
              activeOpacity={undoDisabled ? 1 : 0.75}
              disabled={undoDisabled}
            >
              <Text
                style={[
                  styles.undoBtnLabel,
                  undoDisabled && styles.undoBtnLabelDisabled,
                ]}
              >
                Undo
              </Text>
              <Text
                style={[
                  styles.undoBtnIcon,
                  undoDisabled && styles.undoBtnIconDisabled,
                ]}
              >
                ↺
              </Text>
            </TouchableOpacity>
          );
        })()}

        {showCredits && (
          <TouchableOpacity
            style={styles.creditsDisplay}
            onPress={() => {
              if (hasSelection) setShowEconModal(true);
            }}
            activeOpacity={hasSelection ? 0.75 : 1}
          >
            <View style={styles.creditsTopRow}>
              <Text style={styles.creditsIcon}>⚜️</Text>
              <Text style={styles.creditsAmount}>{creditsDisplayValue}</Text>
            </View>
            {selectedLakeFund !== null && lakeUpkeepPerTurn !== null ? (
              <Text style={[styles.creditsNet, styles.creditsNetNeg]}>
                -{lakeUpkeepPerTurn}/turn
              </Text>
            ) : hasSelection && econBreakdown !== null ? (
              <Text
                style={[
                  styles.creditsNet,
                  econBreakdown.net >= 0
                    ? styles.creditsNetPos
                    : styles.creditsNetNeg,
                ]}
              >
                {econBreakdown.net >= 0
                  ? `+${econBreakdown.net}`
                  : `${econBreakdown.net}`}
                /turn
              </Text>
            ) : (
              <Text style={[styles.creditsNet, { color: "transparent" }]}>
                +0/turn
              </Text>
            )}
          </TouchableOpacity>
        )}

        <View style={styles.spacer} />

        {canBuild &&
          (["buildings", "units"] as const).map((mode) => {
            const isActive = ribbonMode === mode;
            return (
              <TouchableOpacity
                key={mode}
                style={[
                  styles.buildBtn,
                  isActive && styles.buildBtnActive,
                  !canBuild && styles.buildBtnDisabled,
                ]}
                onPress={() => {
                  if (isAiTurn || gameResult !== null || !canBuild) return;
                  setSelectedEntityKey(null);
                  if (isActive) {
                    closeRibbon();
                    setArmedEntityId(null);
                  } else {
                    openRibbon(mode);
                    setArmedEntityId(null);
                  }
                }}
                activeOpacity={canBuild ? 0.75 : 1}
              >
                <Text
                  style={{
                    fontSize: 13,
                    color: isActive
                      ? "#0D0A06"
                      : canBuild
                        ? "#C8A24A"
                        : "#3A2E14",
                  }}
                >
                  {mode === "units" ? "⚒" : "🏛"}
                </Text>
                <Text
                  style={[
                    styles.buildBtnText,
                    isActive && styles.buildBtnTextActive,
                    !canBuild && styles.buildBtnTextDisabled,
                  ]}
                >
                  {mode === "units" ? "Train" : "Build"}
                </Text>
              </TouchableOpacity>
            );
          })}

        {isDeveloperModeActive && (isAiPaused || isAiTurnDone) && aiHistoryIndex > 0 && (
          <TouchableOpacity
            style={styles.prevActionBtn}
            onPress={handleAiStepBack}
          >
            <Text style={{ fontSize: 13, color: "#00FF88" }}>←</Text>
            <Text style={styles.nextActionBtnText}>Prev</Text>
          </TouchableOpacity>
        )}

        {isDeveloperModeActive && (isAiPaused || isAiTurnDone) && (() => {
          const atEnd = isAiTurnDone && aiHistoryIndex >= aiHistoryLen - 1;
          return (
            <TouchableOpacity
              style={[styles.nextActionBtn, atEnd && { opacity: 0.35 }]}
              onPress={atEnd ? undefined : handleAiStepNext}
              disabled={atEnd}
            >
              <Text style={styles.nextActionBtnText}>
                {aiHistoryIndex < aiHistoryLen - 1 ? "Next ▶" : "Next"}
              </Text>
              <Text style={{ fontSize: 13, color: "#00FF88" }}>→</Text>
            </TouchableOpacity>
          );
        })()}

        {isAiTurnDone ? (
          <TouchableOpacity
            style={styles.endTurnBtn}
            onPress={handleEndAiTurn}
          >
            <Text style={styles.endTurnText}>End AI Turn</Text>
            <Text style={styles.endTurnArrow}>→</Text>
          </TouchableOpacity>
        ) : isAiTurn ? (
          <View style={[styles.endTurnBtn, styles.aiTurnBtn]}>
            <Text style={styles.aiTurnText}>AI Turn...</Text>
          </View>
        ) : (
          <Animated.View style={endTurnStyle}>
            <TouchableOpacity
              style={styles.endTurnBtn}
              onPress={handleEndTurn}
              disabled={gameResult !== null}
            >
              <Text style={styles.endTurnText}>End Turn</Text>
              <Text style={styles.endTurnArrow}>→</Text>
            </TouchableOpacity>
          </Animated.View>
        )}
      </View>
    </View>
  );
}
