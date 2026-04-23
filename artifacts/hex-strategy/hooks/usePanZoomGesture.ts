import { useCallback, useEffect } from "react";
import { Gesture } from "react-native-gesture-handler";
import {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { EXTRA_PAN } from "@/constants/gameConstants";
import { tileKey } from "@/utils/hexMath";
import type { HexTile } from "@/types";

interface UsePanZoomGestureParams {
  boardW: number;
  boardH: number;
  bounds: { minX: number; minY: number };
  HEX_SIZE: number;
  SW: number;
  availH: number;
  topInset: number;
  initX: number;
  initY: number;
  fitScale: number;
  activeTileMap: Map<string, HexTile>;
  handleTileTap: (key: string) => void;
  handleDeselect: () => void;
}

export function usePanZoomGesture({
  boardW,
  boardH,
  bounds,
  HEX_SIZE,
  SW,
  availH,
  topInset,
  initX,
  initY,
  fitScale,
  activeTileMap,
  handleTileTap,
  handleDeselect,
}: UsePanZoomGestureParams) {
  const scale = useSharedValue(fitScale);
  const savedScale = useSharedValue(fitScale);
  const translateX = useSharedValue(initX);
  const translateY = useSharedValue(initY);
  const lastFocalX = useSharedValue(0);
  const lastFocalY = useSharedValue(0);

  // Per-frame delta tracking for the pan gesture. Using absolute
  // translationX/Y + a saved base is fragile when the pinch gesture moves
  // translateX/Y underneath the pan, causing double-counting on native.
  // Tracking only the incremental delta each frame avoids the issue entirely.
  const panLastTX = useSharedValue(0);
  const panLastTY = useSharedValue(0);
  const panLastPointerCount = useSharedValue(0);

  useEffect(() => {
    translateX.value = initX;
    translateY.value = initY;
    scale.value = fitScale;
    savedScale.value = fitScale;
  }, [initX, initY, fitScale]);

  const clampXY = (x: number, y: number, s: number) => {
    "worklet";
    const scaledW = boardW * s;
    const scaledH = boardH * s;
    const centeredX = (SW - boardW) / 2;
    const centeredY = topInset + (availH - boardH) / 2;
    let clampedX: number;
    let clampedY: number;
    if (scaledW <= SW) {
      clampedX = Math.max(
        centeredX - EXTRA_PAN,
        Math.min(centeredX + EXTRA_PAN, x),
      );
    } else {
      clampedX = Math.max(
        SW - (boardW + scaledW) / 2 - EXTRA_PAN,
        Math.min((scaledW - boardW) / 2 + EXTRA_PAN, x),
      );
    }
    if (scaledH <= availH) {
      clampedY = Math.max(
        centeredY - EXTRA_PAN,
        Math.min(centeredY + EXTRA_PAN, y),
      );
    } else {
      clampedY = Math.max(
        topInset + availH - (boardH + scaledH) / 2 - EXTRA_PAN,
        Math.min(topInset + (scaledH - boardH) / 2 + EXTRA_PAN, y),
      );
    }
    return { x: clampedX, y: clampedY };
  };

  // Pan gesture — works with 1 or 2 fingers active.
  // No maxPointers restriction so the gesture stays alive during pinch and can
  // seamlessly take over when one finger is lifted without a new gesture cycle.
  // Per-frame delta tracking avoids jumps when the pinch moves the board while
  // the pan's translationX is also accumulating. A pointer-count guard skips
  // movement while 2 fingers are down (pinch handles it), and a 2→1 transition
  // frame resets the reference position to prevent a large jump on finger lift.
  const panGesture = Gesture.Pan()
    .minDistance(8)
    .onStart((e) => {
      panLastTX.value = e.translationX;
      panLastTY.value = e.translationY;
      panLastPointerCount.value = e.numberOfPointers;
    })
    .onUpdate((e) => {
      // When more than one pointer is active, keep tracking position so we
      // don't accumulate a jump, but don't move the board (the pinch handles it).
      if (e.numberOfPointers > 1) {
        panLastTX.value = e.translationX;
        panLastTY.value = e.translationY;
        panLastPointerCount.value = e.numberOfPointers;
        return;
      }
      // Transition from 2 → 1 finger: reset tracking to current position so
      // the first delta after the lift is 0 instead of a large jump.
      if (panLastPointerCount.value > 1) {
        panLastTX.value = e.translationX;
        panLastTY.value = e.translationY;
        panLastPointerCount.value = 1;
        return;
      }
      const dx = e.translationX - panLastTX.value;
      const dy = e.translationY - panLastTY.value;
      panLastTX.value = e.translationX;
      panLastTY.value = e.translationY;
      panLastPointerCount.value = 1;
      const raw = { x: translateX.value + dx, y: translateY.value + dy };
      const clamped = clampXY(raw.x, raw.y, scale.value);
      translateX.value = clamped.x;
      translateY.value = clamped.y;
    })
    .onEnd(() => {
      panLastPointerCount.value = 0;
      const clamped = clampXY(translateX.value, translateY.value, scale.value);
      translateX.value = clamped.x;
      translateY.value = clamped.y;
    });

  // Two-finger gesture: handles both zoom-toward-focal-point and two-finger pan.
  // We track the focal point delta each frame separately from the scale
  // compensation so that moving the two fingers without changing distance still
  // pans the board.
  const pinchGesture = Gesture.Pinch()
    .onStart((e) => {
      lastFocalX.value = e.focalX;
      lastFocalY.value = e.focalY;
      savedScale.value = scale.value;
    })
    .onUpdate((e) => {
      // Guard 1: numberOfPointers — on web and some native builds, the update
      // fires with 1 pointer when the second finger releases, causing the focal
      // point to jump to the remaining finger.
      if (e.numberOfPointers < 2) {
        lastFocalX.value = e.focalX;
        lastFocalY.value = e.focalY;
        savedScale.value = scale.value;
        return;
      }

      // Guard 2: focal jump threshold — on native Expo Go, numberOfPointers may
      // not drop below 2 before onEnd fires. Instead, detect an implausibly
      // large focal movement in a single frame (finger-lift artifact) and
      // suppress it. A natural focal movement at 60 fps is well under 40 px.
      const focalDeltaX = e.focalX - lastFocalX.value;
      const focalDeltaY = e.focalY - lastFocalY.value;
      const focalJump =
        focalDeltaX * focalDeltaX + focalDeltaY * focalDeltaY;
      if (focalJump > 40 * 40) {
        lastFocalX.value = e.focalX;
        lastFocalY.value = e.focalY;
        savedScale.value = scale.value;
        return;
      }

      const prevScale = scale.value;
      const newScale = Math.max(0.3, Math.min(3, savedScale.value * e.scale));
      const ratio = newScale / prevScale;

      // Compensation to keep the focal point stationary while scaling
      const scaleCompX = (e.focalX - translateX.value - boardW / 2) * (1 - ratio);
      const scaleCompY = (e.focalY - translateY.value - boardH / 2) * (1 - ratio);

      lastFocalX.value = e.focalX;
      lastFocalY.value = e.focalY;

      const newX = translateX.value + scaleCompX + focalDeltaX;
      const newY = translateY.value + scaleCompY + focalDeltaY;

      scale.value = newScale;
      const clamped = clampXY(newX, newY, newScale);
      translateX.value = clamped.x;
      translateY.value = clamped.y;
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      const clamped = clampXY(translateX.value, translateY.value, scale.value);
      translateX.value = clamped.x;
      translateY.value = clamped.y;
    });

  const handleBoardTap = useCallback(
    (touchX: number, touchY: number, tx: number, ty: number, s: number) => {
      const boardX = boardW / 2 + (touchX - tx - boardW / 2) / s;
      const boardY = boardH / 2 + (touchY - ty - boardH / 2) / s;
      const hx = boardX + bounds.minX;
      const hy = boardY + bounds.minY;
      const fq = ((2 / 3) * hx) / HEX_SIZE;
      const fr = hy / (HEX_SIZE * Math.sqrt(3)) - fq / 2;
      const fs = -fq - fr;
      let rq = Math.round(fq);
      let rr = Math.round(fr);
      let rs = Math.round(fs);
      const qd = Math.abs(rq - fq),
        rd = Math.abs(rr - fr),
        sd = Math.abs(rs - fs);
      if (qd > rd && qd > sd) rq = -rr - rs;
      else if (rd > sd) rr = -rq - rs;
      const key = tileKey(rq, rr);
      if (activeTileMap.has(key)) handleTileTap(key);
      else handleDeselect();
    },
    [boardW, boardH, bounds, HEX_SIZE, activeTileMap, handleTileTap, handleDeselect],
  );

  const tapGesture = Gesture.Tap()
    .maxDistance(5)
    .maxDuration(150)
    .onEnd((e) => {
      runOnJS(handleBoardTap)(
        e.x,
        e.y,
        translateX.value,
        translateY.value,
        scale.value,
      );
    });

  const gesture = Gesture.Race(
    tapGesture,
    Gesture.Simultaneous(panGesture, pinchGesture),
  );

  const boardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return { gesture, boardStyle };
}
