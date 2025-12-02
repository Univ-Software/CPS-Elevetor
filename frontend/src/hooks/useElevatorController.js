// src/hooks/useElevatorController.js
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { buildQueueWithLook } from "../logic/elevatorScheduler";

const TIME_PER_FLOOR = 2300; // 층당 이동 시간
const DOOR_OPEN_TIME = 1000;
const DOOR_CLOSE_TIME = 1000;
const DOOR_DWELL_TIME = 2000;

export function useElevatorController({ isOverload, hasJammedOnboard }) {
  // 상태
  const [currentFloor, setCurrentFloor] = useState(1);
  const [carFloor, setCarFloor] = useState(1);          // 목표 시각적 위치
  const [realtimeFloor, setRealtimeFloor] = useState(1); // 실시간 위치 (실수)
  const [queue, setQueue] = useState([]);
  const [direction, setDirection] = useState("idle");
  const [doorState, setDoorState] = useState("closed");

  const [moveDuration, setMoveDuration] = useState(0);
  const [misalignMode, setMisalignMode] = useState(false);
  const [isMisaligned, setIsMisaligned] = useState(false);
  const [speedFloorsPerSec, setSpeedFloorsPerSec] = useState(0);

  // 현재 이동 중인 목표 층 (스케줄러용)
  const activeTargetRef = useRef(null);

  // 이동 애니메이션/계산 타이머 Ref
  const timersRef = useRef({
    interval: null,
    timeout: null,
  });

  // ----------------------------------------------------
  // 1. 층 호출 요청 (스케줄러 호출 시 realtimeFloor 사용)
  // ----------------------------------------------------
  const requestFloor = useCallback(
    (floor) => {
      // 정위치 실패 상태면 호출 자체를 무시 (안전장치)
      if (isMisaligned) {
        console.warn("🚨 Misaligned! Cannot accept new requests.");
        return;
      }

      setQueue((prev) => {
        // 이미 큐에 있거나, 정차 중인 층이면 무시
        if (prev.includes(floor)) return prev;
        if (floor === currentFloor && doorState !== "closed") return prev;

        return buildQueueWithLook({
          prevQueue: prev,
          newFloors: [floor],
          currentPos: realtimeFloor, // 실수 위치 전달
          direction,
        });
      });
    },
    [currentFloor, realtimeFloor, direction, doorState, isMisaligned]
  );

  const removeRequest = useCallback((floor) => {
    setQueue((prev) => prev.filter((f) => f !== floor));
  }, []);

  // ----------------------------------------------------
  // 2. 모터 이동 제어 (Retargeting 지원)
  // ----------------------------------------------------
  useEffect(() => {
    // 정위치 실패 상태면 "일반 주행" 로직만 막고, 속도는 건드리지 않음
    // (정위치 수정(fixMisalign)에서 속도/위치를 직접 제어하기 때문)
    if (isMisaligned) {
      activeTargetRef.current = null;
      return;
    }

    // 1. 이동 불가 조건
    if (doorState !== "closed") {
      if (direction !== "idle") setDirection("idle");
      setSpeedFloorsPerSec(0);
      activeTargetRef.current = null;
      return;
    }

    // 2. 대기 조건
    if (queue.length === 0) {
      if (direction !== "idle") setDirection("idle");
      setSpeedFloorsPerSec(0);
      activeTargetRef.current = null;
      return;
    }

    const target = queue[0];

    // 3. 이미 도착한 상태면 처리 안 함
    if (target === currentFloor) {
      setDirection("idle");
      setSpeedFloorsPerSec(0);
      activeTargetRef.current = null;
      return;
    }

    // 4. 이미 이동 중인데 목표가 그대로라면 재시작 금지
    if (activeTargetRef.current === target) {
      return;
    }

    // --- 이동 시작 (혹은 경로 수정) ---

    // 기존 타이머 정리
    if (timersRef.current.interval) clearInterval(timersRef.current.interval);
    if (timersRef.current.timeout) clearTimeout(timersRef.current.timeout);

    activeTargetRef.current = target; // 목표 갱신

    // 거리 및 시간 계산
    const distanceFloors = Math.abs(target - realtimeFloor);
    const travelTime = Math.max(TIME_PER_FLOOR * distanceFloors, 500);

    setMoveDuration(travelTime);
    setDirection(target > realtimeFloor ? "up" : "down");

    // 정위치 실패 계산 (misalignMode가 켜져있을 때만)
    let visualTargetFloor = target;
    if (misalignMode && !isMisaligned) {
      const OFFSET_RANGE = 0.4;
      const offset = (Math.random() * 2 - 1) * OFFSET_RANGE;
      let misFloor = target + offset;
      visualTargetFloor = Math.max(1, Math.min(5, misFloor)); // 1~5 제한
      setIsMisaligned(true);
    }

    setCarFloor(visualTargetFloor);

    // --- 실시간 위치 계산 루프 ---
    const startTime = performance.now();
    const startPos = realtimeFloor;
    const endPos = visualTargetFloor;

    const intervalId = setInterval(() => {
      const now = performance.now();
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / travelTime, 1);

      if (progress >= 1) {
        setSpeedFloorsPerSec(0);
        setRealtimeFloor(endPos);
        clearInterval(intervalId);
        return;
      }

      // 속도 (Sin 파형)
      const avgSpeed = distanceFloors / (travelTime / 1000);
      const currentSpeed =
        avgSpeed * (Math.PI / 2) * Math.sin(Math.PI * progress);
      setSpeedFloorsPerSec(currentSpeed);

      // 위치 (Ease-in-out)
      const ease = -(Math.cos(Math.PI * progress) - 1) / 2;
      const currentPos = startPos + (endPos - startPos) * ease;
      setRealtimeFloor(currentPos);
    }, 50);

    // 도착 처리 타이머
    const timeoutId = setTimeout(() => {
      setCurrentFloor(target);
      setSpeedFloorsPerSec(0);
      setRealtimeFloor(visualTargetFloor);
      if (misalignMode) setMisalignMode(false);
      activeTargetRef.current = null;
    }, travelTime);

    // Ref에 저장
    timersRef.current = { interval: intervalId, timeout: timeoutId };
  }, [queue, currentFloor, doorState, realtimeFloor, isMisaligned, misalignMode, direction]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (timersRef.current.interval) clearInterval(timersRef.current.interval);
      if (timersRef.current.timeout) clearTimeout(timersRef.current.timeout);
    };
  }, []);

  // ----------------------------------------------------
  // 3. 자동 문 열림 & 상태 관리
  // ----------------------------------------------------
  useEffect(() => {
    if (doorState !== "closed") return;
    if (queue.length === 0) return;
    if (isMisaligned) return;

    const target = queue[0];
    if (
      target === currentFloor &&
      activeTargetRef.current === null &&
      Math.abs(carFloor - currentFloor) < 0.1
    ) {
      setDoorState("opening");
    }
  }, [doorState, queue, currentFloor, carFloor, isMisaligned]);

  useEffect(() => {
    let timerId;
    if (doorState === "opening") {
      timerId = setTimeout(() => setDoorState("open"), DOOR_OPEN_TIME);
    } else if (doorState === "open") {
      if (!isOverload) {
        timerId = setTimeout(() => setDoorState("closing"), DOOR_DWELL_TIME);
      }
    } else if (doorState === "closing") {
      if (hasJammedOnboard) {
        // 끼임이면 닫힘 유지 (센서 쪽에서 처리)
      } else {
        timerId = setTimeout(() => {
          setDoorState("closed");
          setQueue((prev) =>
            prev.length > 0 && prev[0] === currentFloor ? prev.slice(1) : prev
          );
        }, DOOR_CLOSE_TIME);
      }
    }
    return () => clearTimeout(timerId);
  }, [doorState, currentFloor, isOverload, hasJammedOnboard]);

  // ----------------------------------------------------
  // 4. 액션 핸들러
  // ----------------------------------------------------
  const openDoor = useCallback(() => {
    // 정위치 실패 상태에서는 문 열림 방지
    if (isMisaligned) {
      try {
        alert("정위치 실패 상태입니다. 문이 열리지 않습니다.");
      } catch (e) {
        console.warn("Attempted to open door while misaligned");
      }
      return;
    }

    if (doorState === "open" || doorState === "opening" || activeTargetRef.current)
      return;
    setDoorState("opening");
  }, [doorState, isMisaligned]);

  const closeDoor = useCallback(() => {
    if (doorState === "closed" || doorState === "closing") return;
    if (isOverload) {
      alert("과부하로 문을 닫을 수 없습니다.");
      return;
    }
    setDoorState("closing");
  }, [doorState, isOverload]);

  const fixMisalign = useCallback(
    () => {
      if (!isMisaligned) return;

      const nearest = Math.round(carFloor);
      const time = TIME_PER_FLOOR * Math.abs(nearest - carFloor);

      setMoveDuration(time);
      setCarFloor(nearest);

      if (time > 0) {
        const startTime = performance.now();
        const startPos = realtimeFloor;
        const dist = Math.abs(nearest - startPos);

        const fixInterval = setInterval(() => {
          const now = performance.now();
          const elapsed = now - startTime;
          const progress = Math.min(elapsed / time, 1);

          if (progress >= 1) {
            setSpeedFloorsPerSec(0);
            setRealtimeFloor(nearest);
            clearInterval(fixInterval);
            return;
          }

          const avgSpeed = dist / (time / 1000);
          const currentSpeed =
            avgSpeed * (Math.PI / 2) * Math.sin(Math.PI * progress);
          setSpeedFloorsPerSec(currentSpeed);

          const ease = -(Math.cos(Math.PI * progress) - 1) / 2;
          const currentPos = startPos + (nearest - startPos) * ease;
          setRealtimeFloor(currentPos);
        }, 50);

        setTimeout(() => {
          setCurrentFloor(nearest);
          setIsMisaligned(false);
          setSpeedFloorsPerSec(0);
          setRealtimeFloor(nearest);
          clearInterval(fixInterval);
        }, time);
      } else {
        setCurrentFloor(nearest);
        setRealtimeFloor(nearest);
        setIsMisaligned(false);
        setSpeedFloorsPerSec(0);
      }
    },
    [isMisaligned, carFloor, realtimeFloor]
  );

  // ----------------------------------------------------
  // 5. 외부로 노출할 컨트롤러 객체
  // ----------------------------------------------------
  const isMoving = Math.abs(speedFloorsPerSec) > 0.01; // UI용 이동 여부

  return useMemo(
    () => ({
      currentFloor,
      carFloor,
      realtimeFloor,
      queue,
      direction,
      doorState,
      moveDuration,
      speedFloorsPerSec,
      isMisaligned,
      isMoving, // UI용

      requestFloor,
      removeRequest,
      openDoor,
      closeDoor,
      setMisalignMode,
      fixMisalign,
    }),
    [
      currentFloor,
      carFloor,
      realtimeFloor,
      queue,
      direction,
      doorState,
      moveDuration,
      speedFloorsPerSec,
      isMisaligned,
      isMoving,
      requestFloor,
      removeRequest,
      openDoor,
      closeDoor,
      fixMisalign,
    ]
  );
}
