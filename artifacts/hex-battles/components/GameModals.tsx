import React from "react";
import {
  Modal,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { CITY_BONUS } from "@/utils/hexGrid";
import type { EntityType } from "@/types";
import styles from "@/app/gameStyles";
import { CoinIcon, SkullIcon, UnitIcon } from "@/components/UnitIcon";

export interface EconBreakdown {
  grassCount: number;
  fieldCount: number;
  forestCount: number;
  sawmillCount: number;
  desertCount: number;
  cityCount: number;
  grassIncome: number;
  fieldBonus: number;
  forestIncome: number;
  sawmillBonus: number;
  desertIncome: number;
  cityIncome: number;
  cityDevBonus: number;
  upkeepGroups: {
    id: EntityType;
    name: string;
    count: number;
    category: "infantry" | "cavalry" | "buildings";
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
              Return to the main menu? You can resume from this point later,
              unless you start a new game.
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
                    Grass ×{econBreakdown.grassCount}{" "}
                    <Text style={styles.econPer}>(+2 each)</Text>
                  </Text>
                  <Text style={styles.econRowValue}>
                    +{econBreakdown.grassIncome}
                  </Text>
                </View>
              )}
              {econBreakdown && econBreakdown.fieldCount > 0 && (
                <View style={styles.econRow}>
                  <Text style={[styles.econRowLabel, styles.econIndentLabel]}>
                    ↳ Field ×{econBreakdown.fieldCount}{" "}
                    <Text style={styles.econPer}>(+1 each)</Text>
                  </Text>
                  <Text style={styles.econRowValue}>
                    +{econBreakdown.fieldBonus}
                  </Text>
                </View>
              )}
              {econBreakdown && econBreakdown.fieldCount > 0 && (
                <View style={[styles.econRow, styles.econSubtotalRow]}>
                  <Text style={styles.econSubtotalLabel}>Subtotal</Text>
                  <Text style={styles.econRowValue}>
                    +{econBreakdown.grassIncome + econBreakdown.fieldBonus}
                  </Text>
                </View>
              )}
              {econBreakdown && econBreakdown.forestCount > 0 && (
                <View style={[styles.econRow, styles.econGroupGap]}>
                  <Text style={styles.econRowLabel}>
                    Forest ×{econBreakdown.forestCount}{" "}
                    <Text style={styles.econPer}>(+2 each)</Text>
                  </Text>
                  <Text style={styles.econRowValue}>
                    +{econBreakdown.forestIncome}
                  </Text>
                </View>
              )}
              {econBreakdown && econBreakdown.sawmillCount > 0 && (
                <View style={styles.econRow}>
                  <Text style={[styles.econRowLabel, styles.econIndentLabel]}>
                    ↳ Sawmill ×{econBreakdown.sawmillCount}{" "}
                    <Text style={styles.econPer}>(+1 each)</Text>
                  </Text>
                  <Text style={styles.econRowValue}>
                    +{econBreakdown.sawmillBonus}
                  </Text>
                </View>
              )}
              {econBreakdown && econBreakdown.sawmillCount > 0 && (
                <View style={[styles.econRow, styles.econSubtotalRow]}>
                  <Text style={styles.econSubtotalLabel}>Subtotal</Text>
                  <Text style={styles.econRowValue}>
                    +{econBreakdown.forestIncome + econBreakdown.sawmillBonus}
                  </Text>
                </View>
              )}
              {econBreakdown && econBreakdown.desertCount > 0 && (
                <View style={[styles.econRow, styles.econGroupGap]}>
                  <Text style={styles.econRowLabel}>
                    Desert ×{econBreakdown.desertCount}{" "}
                    <Text style={styles.econPer}>(+1 each)</Text>
                  </Text>
                  <Text style={styles.econRowValue}>
                    +{econBreakdown.desertIncome}
                  </Text>
                </View>
              )}
              {econBreakdown && econBreakdown.cityCount > 0 && (
                <View style={[styles.econRow, styles.econGroupGap]}>
                  <View style={styles.econLabelRow}>
                    <UnitIcon entityId="city" size={16} />
                    <Text style={styles.econRowLabel}>
                      City ×{econBreakdown.cityCount}{" "}
                      <Text style={styles.econPer}>(+{CITY_BONUS} each)</Text>
                    </Text>
                  </View>
                  <Text style={styles.econRowValue}>
                    +{econBreakdown.cityIncome}
                  </Text>
                </View>
              )}
              {econBreakdown && econBreakdown.cityDevBonus > 0 && (
                <View style={styles.econRow}>
                  <Text style={[styles.econRowLabel, styles.econIndentLabel]}>
                    ↳ Improvements{" "}
                    <Text style={styles.econPer}>(+1 per adj. dev.)</Text>
                  </Text>
                  <Text style={styles.econRowValue}>
                    +{econBreakdown.cityDevBonus}
                  </Text>
                </View>
              )}
              {econBreakdown &&
                econBreakdown.cityCount > 0 &&
                econBreakdown.cityDevBonus > 0 && (
                  <View style={[styles.econRow, styles.econSubtotalRow]}>
                    <Text style={styles.econSubtotalLabel}>Subtotal</Text>
                    <Text style={styles.econRowValue}>
                      +{econBreakdown.cityIncome + econBreakdown.cityDevBonus}
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
                    <View
                      key={i}
                      style={[
                        styles.econRow,
                        i > 0 &&
                          g.category !==
                            econBreakdown.upkeepGroups[i - 1].category &&
                          styles.econUpkeepCategoryGap,
                      ]}
                    >
                      <View style={styles.econLabelRow}>
                        <UnitIcon entityId={g.id} size={16} />
                        <Text style={styles.econRowLabel}>
                          {g.name} ×{g.count}{" "}
                          {g.upkeepPerUnit !== null && (
                            <Text style={styles.econPer}>
                              (−{g.upkeepPerUnit} each)
                            </Text>
                          )}
                        </Text>
                      </View>
                      <Text style={[styles.econRowValue, { color: "#E07060" }]}>
                        −{g.total}
                      </Text>
                    </View>
                  ))}
                  {econBreakdown.rebelTotalLoss > 0 && (
                    <View
                      style={[
                        styles.econRow,
                        econBreakdown.upkeepGroups.length > 0 &&
                          styles.econUpkeepCategoryGap,
                      ]}
                    >
                      <View style={styles.econLabelRow}>
                        <UnitIcon entityId="rebel" size={16} />
                        <Text style={styles.econRowLabel}>
                          Rebels ×{econBreakdown.rebelCount}
                        </Text>
                      </View>
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
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <CoinIcon size={16} />
                <Text style={styles.econNetValue}>{selectedTerritoryBalance}</Text>
              </View>
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
              style={[styles.gameResultBtn, styles.gameResultMenuBtn]}
              onPress={() => setShowDominancePopup(false)}
            >
              <Text
                style={[
                  styles.gameResultBtnText,
                  styles.gameResultMenuBtnText,
                ]}
              >
                Keep Playing
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.gameResultBtn, styles.dominanceContinueBtn]}
              onPress={() => {
                setShowDominancePopup(false);
                setGameResult("victory");
              }}
            >
              <Text
                style={[
                  styles.gameResultBtnText,
                  styles.dominanceContinueBtnText,
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
            {gameResult === "defeat" && <SkullIcon size={56} />}
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
