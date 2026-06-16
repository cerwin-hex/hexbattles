import React from "react";
import { Text, TouchableOpacity, View, StyleProp, ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import type { EntityType } from "@/types";
import styles from "@/app/gameStyles";
import type { EconBreakdown } from "@/components/GameModals";
import { CoinValue } from "@/components/UnitIcon";

interface BottomActionMenuProps {
  botInset: number;
  isAiTurn: boolean;
  gameResult: string | null;
  moveHistory: unknown[];
  handleUndo: () => void;
  showGold: boolean;
  hasSelection: boolean;
  setShowEconModal: (v: boolean) => void;
  goldDisplayValue: number;
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
  showGold,
  hasSelection,
  setShowEconModal,
  goldDisplayValue,
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

        {showGold && (
          <TouchableOpacity
            style={styles.goldDisplay}
            onPress={() => {
              if (hasSelection) setShowEconModal(true);
            }}
            activeOpacity={hasSelection ? 0.75 : 1}
          >
            <CoinValue
              value={`${goldDisplayValue}`}
              textStyle={styles.goldAmount}
              size={16}
            />
            {hasSelection && econBreakdown !== null ? (
              <CoinValue
                value={
                  econBreakdown.net >= 0
                    ? `+${econBreakdown.net}`
                    : `${econBreakdown.net}`
                }
                suffix="/turn"
                size={12}
                textStyle={[
                  styles.goldNet,
                  econBreakdown.net >= 0
                    ? styles.goldNetPos
                    : styles.goldNetNeg,
                ]}
              />
            ) : (
              <Text style={[styles.goldNet, { color: "transparent" }]}>
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
