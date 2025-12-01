import { useState, useEffect, useCallback, useMemo } from "react";
import { buildQueueWithLook } from "../logic/elevatorScheduler";

const TIME_PER_FLOOR = 2300;
const DOOR_OPEN_TIME = 700;
const DOOR_CLOSE_TIME = 700;
const DOOR_DWELL_TIME = 2000;

export function useElevatorController({ isOverload, hasJammedOnboard }) {
  const [currentFloor, setCurrentFloor] = useState(1);
  const [carFloor, setCarFloor] = useState(1); // CSS 이동용 (목표값)
  const [realtimeFloor, setRealtimeFloor] = useState(1); // [추가] 실시간 위치 표시용
  const [queue, setQueue] = useState([]);
  const [direction, setDirection] = useState("idle");
  const [doorState, setDoorState] = useState("closed");
  
  const [moveDuration, setMoveDuration] = useState(0);
  const [misalignMode, setMisalignMode] = useState(false);
  const [isMisaligned, setIsMisaligned] = useState(false);
  const [speedFloorsPerSec, setSpeedFloorsPerSec] = useState(0);
  
  const isMoving = Math.abs(carFloor - currentFloor) > 0.01;

  const requestFloor = useCallback((floor) => {
    setQueue((prev) => {
      if (prev.includes(floor) || floor === currentFloor) return prev;
      return buildQueueWithLook({
        prevQueue: prev,
        newFloors: [floor],
        currentFloor,
        direction,
      });
    });
  }, [currentFloor, direction]);

  const removeRequest = useCallback((floor) => {
    setQueue((prev) => prev.filter((f) => f !== floor));
  }, []);

  // --- 모터 이동 제어 ---
  useEffect(() => {
    if (doorState !== "closed" || queue.length === 0) {
      if (direction !== "idle") setDirection("idle");
      setSpeedFloorsPerSec(0);
      return;
    }
    if (isMoving) return;

    const target = queue[0];
    if (target === currentFloor) {
      setDirection("idle");
      setSpeedFloorsPerSec(0);
      return;
    }

    // 이동 설정
    const distanceFloors = Math.abs(target - currentFloor);
    const travelTime = TIME_PER_FLOOR * distanceFloors;

    setMoveDuration(travelTime);
    setDirection(target > currentFloor ? "up" : "down");

    // 정위치 실패 계산
    let visualTargetFloor = target;
    if (misalignMode && !isMisaligned) {
      const OFFSET_RANGE = 0.4;
      const offset = (Math.random() * 2 - 1) * OFFSET_RANGE;
      let misFloor = target + offset;
      if (misFloor < 1) misFloor = 1;
      if (misFloor > 5) misFloor = 5;
      visualTargetFloor = misFloor;
      setIsMisaligned(true);
    }

    setCarFloor(visualTargetFloor); // CSS 애니메이션 시작

    // ▼▼▼ 실시간 위치 & 속도 계산 루프 ▼▼▼
    const startTime = performance.now();
    const startPos = realtimeFloor; // 현재 실시간 위치에서 시작
    const endPos = visualTargetFloor; // 목표 위치 (오차 포함)

    const intervalId = setInterval(() => {
      const now = performance.now();
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / travelTime, 1);

      if (progress >= 1) {
        setSpeedFloorsPerSec(0);
        setRealtimeFloor(endPos); // 끝 위치로 정확히 맞춤
        clearInterval(intervalId);
        return;
      }

      // 1. 속도 계산 (Sin 파형)
      const avgSpeed = distanceFloors / (travelTime / 1000);
      const currentSpeed = avgSpeed * (Math.PI / 2) * Math.sin(Math.PI * progress);
      setSpeedFloorsPerSec(currentSpeed);

      // 2. [추가] 위치 계산 (Ease-in-out 공식 적용)
      // CSS animation-timing-function: ease-in-out 과 유사한 수식
      // 수식: -0.5 * (cos(PI * t) - 1)
      const ease = -(Math.cos(Math.PI * progress) - 1) / 2;
      const currentPos = startPos + (endPos - startPos) * ease;
      setRealtimeFloor(currentPos);

    }, 50);
    // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

    const finishTimer = setTimeout(() => {
      setCurrentFloor(target);
      setSpeedFloorsPerSec(0);
      setRealtimeFloor(visualTargetFloor); // 확실하게 최종 위치로
      if (misalignMode) setMisalignMode(false);
      clearInterval(intervalId);
    }, travelTime);

    return () => {
      clearTimeout(finishTimer);
      clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, currentFloor, doorState]); 

  // --- 자동 문 열림 ---
  useEffect(() => {
    if (doorState !== "closed") return;
    if (queue.length === 0) return;
    if (isMoving) return;
    if (isMisaligned) return;

    const target = queue[0];
    if (target === currentFloor && Math.abs(carFloor - currentFloor) < 0.1) {
      setDoorState("opening");
    }
  }, [doorState, queue, currentFloor, carFloor, isMoving, isMisaligned]);

  // --- 문 상태 타이머 ---
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
      } else {
        timerId = setTimeout(() => {
          setDoorState("closed");
          setQueue((prev) => (prev.length > 0 && prev[0] === currentFloor ? prev.slice(1) : prev));
        }, DOOR_CLOSE_TIME);
      }
    }
    return () => clearTimeout(timerId);
  }, [doorState, currentFloor, isOverload, hasJammedOnboard]);

  const openDoor = useCallback(() => {
    if (doorState === "open" || doorState === "opening" || isMoving) return;
    setDoorState("opening");
  }, [doorState, isMoving]);

  const closeDoor = useCallback(() => {
    if (doorState === "closed" || doorState === "closing") return;
    if (isOverload) {
      alert("과부하로 문을 닫을 수 없습니다.");
      return;
    }
    setDoorState("closing");
  }, [doorState, isOverload]);

  const fixMisalign = useCallback(() => {
    if (!isMisaligned) return;
    const nearest = Math.round(carFloor);
    const time = TIME_PER_FLOOR * Math.abs(nearest - carFloor);
    
    setMoveDuration(time);
    setCarFloor(nearest);

    if (time > 0) {
        const startTime = performance.now();
        const startPos = realtimeFloor;
        const dist = Math.abs(nearest - carFloor);
        
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

            // 속도
            const avgSpeed = dist / (time / 1000);
            const currentSpeed = avgSpeed * (Math.PI / 2) * Math.sin(Math.PI * progress);
            setSpeedFloorsPerSec(currentSpeed);
            
            // 위치
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
  }, [isMisaligned, carFloor, realtimeFloor]);

  return useMemo(() => ({
    currentFloor,
    carFloor,
    realtimeFloor, // [추가] 외부로 내보냄
    queue,
    direction,
    doorState,
    isMoving,
    moveDuration,
    speedFloorsPerSec,
    isMisaligned,
    
    requestFloor,
    removeRequest,
    openDoor,
    closeDoor,
    setMisalignMode,
    fixMisalign,
  }), [
    currentFloor, carFloor, realtimeFloor, queue, direction, doorState, isMoving, 
    moveDuration, speedFloorsPerSec, isMisaligned, 
    requestFloor, removeRequest, openDoor, closeDoor, fixMisalign
  ]);
}