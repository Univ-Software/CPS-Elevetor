// src/hooks/useElevatorController.js
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { buildQueueWithLook } from "../logic/elevatorScheduler";

const TIME_PER_FLOOR = 2300; // 층당 이동 시간
const DOOR_OPEN_TIME = 1000;
const DOOR_CLOSE_TIME = 1000;
const DOOR_DWELL_TIME = 2000;

/**
 * 엘리베이터 컨트롤러 훅
 *
 * - isOverload         : 과부하 센서 (백엔드/센서 레이어에서 오염 가능)
 * - hasJammedOnboard   : 문 끼임 센서
 * - isMisalignedSensor : 정위치 센서 (백엔드/센서 판단 포함, 오염 가능)
 *
 * 내부의 isMisaligned 는 "물리적인 truth" (테스트 버튼으로 만드는 정위치 실패 상태)
 */
export function useElevatorController({
  isOverload,
  hasJammedOnboard,
  isMisalignedSensor = false,
}) {
  // 상태
  const [currentFloor, setCurrentFloor] = useState(1);
  const [carFloor, setCarFloor] = useState(1); // 목표 시각적 위치
  const [realtimeFloor, setRealtimeFloor] = useState(1); // 실시간 위치 (실수)
  const [queue, setQueue] = useState([]);
  const [direction, setDirection] = useState("idle");
  const [doorState, setDoorState] = useState("closed");

  const [moveDuration, setMoveDuration] = useState(0);

  // 정위치 테스트용 모드 + 물리 truth 상태
  const [misalignMode, setMisalignMode] = useState(false);
  const [isMisaligned, setIsMisaligned] = useState(false); // "실제 정위치 실패" truth

  const [speedFloorsPerSec, setSpeedFloorsPerSec] = useState(0);

  // 현재 이동 중인 목표 층 (스케줄러용)
  const activeTargetRef = useRef(null);

  // 이동 애니메이션/계산 타이머 Ref
  const timersRef = useRef({
    interval: null,
    timeout: null,
  });

  // 공통 타이머 정리 함수
  const clearTimers = useCallback(() => {
    if (timersRef.current.interval) {
      clearInterval(timersRef.current.interval);
      timersRef.current.interval = null;
    }
    if (timersRef.current.timeout) {
      clearTimeout(timersRef.current.timeout);
      timersRef.current.timeout = null;
    }
  }, []);

  // ----------------------------------------------------
  // 1. 층 호출 요청 (스케줄러 호출 시 realtimeFloor 사용)
  // ----------------------------------------------------
  const requestFloor = useCallback(
    (floor) => {
      // 정위치 실패 상태(물리 truth 또는 센서)가 있으면 호출 자체를 막는다.
      const lockByMisalign = isMisaligned || isMisalignedSensor;
      if (lockByMisalign) {
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
    [currentFloor, realtimeFloor, direction, doorState, isMisaligned, isMisalignedSensor]
  );

  const removeRequest = useCallback((floor) => {
    setQueue((prev) => prev.filter((f) => f !== floor));
  }, []);

  // ----------------------------------------------------
  // 2. 모터 이동 제어 (Retargeting 지원)
  // ----------------------------------------------------
  useEffect(() => {
    const lockByMisalign = isMisaligned || isMisalignedSensor;

    // 정위치 실패 상태에서는 "일반 주행" 로직만 막는다.
    // 실제 정위치 보정(fixMisalign)은 별도 타이머로 동작.
    if (lockByMisalign) {
      activeTargetRef.current = null;
      setSpeedFloorsPerSec(0);
      return;
    }

    // 1. 이동 불가 조건 (문이 열려 있으면 주행 X)
    if (doorState !== "closed") {
      if (direction !== "idle") setDirection("idle");
      setSpeedFloorsPerSec(0);
      activeTargetRef.current = null;
      clearTimers();
      return;
    }

    // 2. 대기 조건 (큐가 비었으면 정지)
    if (queue.length === 0) {
      if (direction !== "idle") setDirection("idle");
      setSpeedFloorsPerSec(0);
      activeTargetRef.current = null;
      clearTimers();
      return;
    }

    const target = queue[0];

    // 3. 이미 도착한 상태면 처리 안 함
    if (target === currentFloor) {
      setDirection("idle");
      setSpeedFloorsPerSec(0);
      activeTargetRef.current = null;
      clearTimers();
      return;
    }

    // 4. 이미 이동 중인데 목표가 그대로라면 재시작 금지
    if (activeTargetRef.current === target) {
      return;
    }

    // --- 이동 시작 (혹은 경로 수정) ---

    // 기존 타이머 정리
    clearTimers();

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
      setIsMisaligned(true); // 물리 truth로 "정위치 실패" 기록
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
  }, [
    queue,
    currentFloor,
    doorState,
    realtimeFloor,
    direction,
    misalignMode,
    isMisaligned,
    isMisalignedSensor,
    clearTimers,
  ]);

  // 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  // ----------------------------------------------------
  // 3. 자동 문 열림 & 상태 관리
  // ----------------------------------------------------
  useEffect(() => {
    const lockByMisalign = isMisaligned || isMisalignedSensor;

    if (doorState !== "closed") return;
    if (queue.length === 0) return;
    if (lockByMisalign) return; // 정위치 실패 시 자동 문열림 방지

    const target = queue[0];
    if (
      target === currentFloor &&
      activeTargetRef.current === null &&
      Math.abs(carFloor - currentFloor) < 0.1
    ) {
      setDoorState("opening");
    }
  }, [doorState, queue, currentFloor, carFloor, isMisaligned, isMisalignedSensor]);

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
    const lockByMisalign = isMisaligned || isMisalignedSensor;

    // 정위치 실패 상태에서는 문 열림 방지
    if (lockByMisalign) {
      try {
        alert("정위치 실패 상태입니다. 문이 열리지 않습니다.");
      } catch (e) {
        console.warn("Attempted to open door while misaligned");
      }
      return;
    }

    if (
      doorState === "open" ||
      doorState === "opening" ||
      activeTargetRef.current
    )
      return;
    setDoorState("opening");
  }, [doorState, isMisaligned, isMisalignedSensor]);

  const closeDoor = useCallback(() => {
    if (doorState === "closed" || doorState === "closing") return;
    if (isOverload) {
      alert("과부하로 문을 닫을 수 없습니다.");
      return;
    }
    setDoorState("closing");
  }, [doorState, isOverload]);

  /**
   * 정위치 보정:
   * - 현재 realtimeFloor 기준으로 가장 가까운 층으로 스냅
   * - 물리 truth isMisaligned 를 false 로 정리
   * - 일반 주행 타이머와는 별도로 동작
   */
  const fixMisalign = useCallback(() => {
    // 현재 위치 기준으로 가장 가까운 층
    let nearest = Math.round(realtimeFloor);
    nearest = Math.max(1, Math.min(5, nearest));

    const startPos = realtimeFloor;
    const dist = Math.abs(nearest - startPos);

    // 오차가 거의 없으면 바로 스냅
    if (dist < 0.01) {
      setCurrentFloor(nearest);
      setCarFloor(nearest);
      setRealtimeFloor(nearest);
      setIsMisaligned(false);
      setSpeedFloorsPerSec(0);
      return;
    }

    // 기존 타이머 모두 중단 (일반 주행 멈춤)
    clearTimers();
    activeTargetRef.current = null;

    const time = Math.max(TIME_PER_FLOOR * dist, 300);

    setMoveDuration(time);
    setCarFloor(nearest);
    setIsMisaligned(true); // "보정 중" 상태 플래그

    const startTime = performance.now();

    const fixInterval = setInterval(() => {
      const now = performance.now();
      const progress = Math.min((now - startTime) / time, 1);

      // Ease-in-out 위치 보정
      const ease = -(Math.cos(Math.PI * progress) - 1) / 2;
      const pos = startPos + (nearest - startPos) * ease;
      setRealtimeFloor(pos);

      // 속도 업데이트
      const avgSpeed = dist / (time / 1000);
      const currentSpeed =
        avgSpeed * (Math.PI / 2) * Math.sin(Math.PI * progress);
      setSpeedFloorsPerSec(progress < 1 ? currentSpeed : 0);

      if (progress >= 1) {
        clearInterval(fixInterval);
      }
    }, 50);

    const timeoutId = setTimeout(() => {
      setCurrentFloor(nearest);
      setRealtimeFloor(nearest);
      setCarFloor(nearest);
      setSpeedFloorsPerSec(0);
      setIsMisaligned(false); // 보정 완료
      clearInterval(fixInterval);
    }, time);

    // 타이머 ref에 저장 (언마운트/재시작 시 정리 위해)
    timersRef.current = { interval: fixInterval, timeout: timeoutId };
  }, [realtimeFloor, clearTimers]);

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
      isMisaligned, // 물리 truth (Dashboard에서 ground truth로 사용)
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
