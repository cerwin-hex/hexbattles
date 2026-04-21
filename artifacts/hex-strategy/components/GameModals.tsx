import React from "react";
import {
  Modal,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { ENTITY_META, CITY_BONUS } from "@/utils/hexGrid";
import type { EntityType } from "@/types";
import styles from "@/app/gameStyles";

export interface EconBreakdown {
  grassCount: number;
  forestCount: number;
  desertCount: number;
  cityCount: number;
  grassIncome: number;
  forestIncome: number;
  desertIncome: number;
  cityIncome: number;
  upkeepGroups: {
    icon: string;
    name: string;
    count: number;
    upkeepPerUnit: number | null;
    mostExpensiveCost: number | null;
    total: number;
  }[];
  rebelCount: number;
  rebelTotalLoss: number;
  net: number;
}

interface GameModalsProps {
  confirmLeave: boolean;
  setConfirmLeave: (v: boolean) => void;
  onLeaveConfirm: () => void;

  showEconModal: boolean;
  setShowEconModal: (v: boolean) => void;
  econBreakdown: EconBreakdown | null;
  selectedTerritoryBalance: number;

  showDominancePopup: boolean;
  setShowDominancePopup: (v: boolean) => void;
  setGameResult: (v: "victory" | "defeat" | null) => void;

  gameResult: "victory" | "defeat" | null;
  onReturnToMenu: () => void;
}

export default function GameModals({
  confirmLeave,
  setConfirmLeave,
  onLeaveConfirm,
  showEconModal,
  setShowEconModal,
  econBreakdown,
  selectedTerritoryBalance,
  showDominancePopup,
  setShowDominancePopup,
  setGameResult,
  gameResult,
  onReturnToMenu,
}: GameModalsProps) {
  return (
    <>
      <Modal
        visible={confirmLeave}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmLeave(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Leave Game?</Text>
            <Text style={styles.modalBody}>
              Return to the main menu? Your progress will be lost.
            </Text>
            <View style={styles.modalRow}>
              <TouchableOpacity
                style={styles.modalStayBtn}
                onPress={() => setConfirmLeave(false)}
              >
                <Text style={styles.modalStayText}>Stay</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalLeaveBtn}
                onPress={() => {
                  setConfirmLeave(false);
                  onLeaveConfirm();
                }}
              >
                <Text style={styles.modalLeaveText}>Leave</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showEconModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowEconModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowEconModal(false)}
        >
          <View style={styles.econCard} onStartShouldSetResponder={() => true}>
            <Text style={styles.econTitle}>Economy Breakdown</Text>
            <View style={styles.econSection}>
              <Text style={styles.econSectionLabel}>INCOME / TURN</Text>
              {econBreakdown && econBreakdown.grassCount > 0 && (
                <View style={styles.econRow}>
                  <Text style={styles.econRowLabel}>
                    🌿 Grass ×{econBreakdown.grassCount}{" "}
                    <Text style={styles.econPer}>(+2 each)</Text>
                  </Text>
                  <Text style={styles.econRowValue}>
                    +{econBreakdown.grassIncome}
                  </Text>
                </View>
              )}
              {econBreakdown && econBreakdown.forestCount > 0 && (
                <View style={styles.econRow}>
                  <Text style={styles.econRowLabel}>
                    🌲 Forest ×{econBreakdown.forestCount}{" "}
                    <Text style={styles.econPer}>(+2 each)</Text>
                  </Text>
                  <Text style={styles.econRowValue}>
                    +{econBreakdown.forestIncome}
                  </Text>
                </View>
              )}
              {econBreakdown && econBreakdown.desertCount > 0 && (
                <View style={styles.econRow}>
                  <Text style={styles.econRowLabel}>
                    🏜️ Desert ×{econBreakdown.desertCount}{" "}
                    <Text style={styles.econPer}>(+1 each)</Text>
                  </Text>
                  <Text style={styles.econRowValue}>
                    +{econBreakdown.desertIncome}
                  </Text>
                </View>
              )}
              {econBreakdown && econBreakdown.cityCount > 0 && (
                <View style={styles.econRow}>
                  <Text style={styles.econRowLabel}>
                    {ENTITY_META.city.icon} Cities ×{econBreakdown.cityCount}{" "}
                    <Text style={styles.econPer}>(+{CITY_BONUS} each)</Text>
                  </Text>
                  <Text style={styles.econRowValue}>
                    +{econBreakdown.cityIncome}
                  </Text>
                </View>
              )}
            </View>
            {econBreakdown &&
              (econBreakdown.upkeepGroups.length > 0 ||
                econBreakdown.rebelTotalLoss > 0) && (
                <View style={styles.econSection}>
                  <Text style={styles.econSectionLabel}>UPKEEP / TURN</Text>
                  {econBreakdown.upkeepGroups.map((g, i) => (
                    <View key={i} style={styles.econRow}>
                      <Text style={styles.econRowLabel}>
                        {g.icon} {g.name} ×{g.count}{" "}
                        {g.upkeepPerUnit !== null && (
                          <Text style={styles.econPer}>
                            (−{g.upkeepPerUnit} each)
                          </Text>
                        )}
                      </Text>
                      <Text style={[styles.econRowValue, { color: "#E07060" }]}>
                        −{g.total}
                      </Text>
                    </View>
                  ))}
                  {econBreakdown.rebelTotalLoss > 0 && (
                    <View style={styles.econRow}>
                      <Text style={styles.econRowLabel}>
                        ✊ Rebels ×{econBreakdown.rebelCount}
                      </Text>
                      <Text style={[styles.econRowValue, { color: "#E07060" }]}>
                        −{econBreakdown.rebelTotalLoss}
                      </Text>
                    </View>
                  )}
                </View>
              )}
            <View style={styles.econDivider} />
            <View style={styles.econRow}>
              <Text style={styles.econNetLabel}>Net per turn</Text>
              <Text
                style={[
                  styles.econNetValue,
                  {
                    color:
                      econBreakdown && econBreakdown.net >= 0
                        ? "#7EC87E"
                        : "#E07060",
                  },
                ]}
              >
                {econBreakdown && econBreakdown.net >= 0 ? "+" : ""}
                {econBreakdown?.net ?? 0}
              </Text>
            </View>
            <View style={styles.econRow}>
              <Text style={styles.econNetLabel}>Current balance</Text>
              <Text style={styles.econNetValue}>
                ⚜️ {selectedTerritoryBalance}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.econCloseBtn}
              onPress={() => setShowEconModal(false)}
            >
              <Text style={styles.econCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showDominancePopup} transparent animationType="fade">
        <View style={styles.gameResultOverlay}>
          <View style={styles.gameResultCard}>
            <Text style={styles.gameResultEmoji}>⚔️</Text>
            <Text
              style={[styles.gameResultTitle, styles.gameResultVictoryTitle]}
            >
              Dominance!
            </Text>
            <Text style={styles.gameResultBody}>
              You control 70% of the realm. Claim victory now, or continue
              your conquest and take it all?
            </Text>
            <TouchableOpacity
              style={[styles.gameResultBtn, styles.dominanceContinueBtn]}
              onPress={() => setShowDominancePopup(false)}
            >
              <Text
                style={[
                  styles.gameResultBtnText,
                  styles.dominanceContinueBtnText,
                ]}
              >
                Keep Playing
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.gameResultBtn, styles.gameResultMenuBtn]}
              onPress={() => {
                setShowDominancePopup(false);
                setGameResult("victory");
              }}
            >
              <Text
                style={[
                  styles.gameResultBtnText,
                  styles.gameResultMenuBtnText,
                ]}
              >
                Claim Victory
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={gameResult !== null} transparent animationType="fade">
        <View style={styles.gameResultOverlay}>
          <View style={styles.gameResultCard}>
            <Text style={styles.gameResultEmoji}>
              {gameResult === "victory" ? "🏆" : "💀"}
            </Text>
            <Text
              style={[
                styles.gameResultTitle,
                gameResult === "victory"
                  ? styles.gameResultVictoryTitle
                  : styles.gameResultDefeatTitle,
              ]}
            >
              {gameResult === "victory" ? "Victory!" : "Game Over"}
            </Text>
            <Text style={styles.gameResultBody}>
              {gameResult === "victory"
                ? "All opponents have been eliminated. The realm is yours!"
                : "Your territory has been conquered. The campaign is lost."}
            </Text>
            <TouchableOpacity
              style={[styles.gameResultBtn, styles.gameResultMenuBtn]}
              onPress={onReturnToMenu}
            >
              <Text
                style={[styles.gameResultBtnText, styles.gameResultMenuBtnText]}
              >
                Return to Main Menu
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}
