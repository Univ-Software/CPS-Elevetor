import { useState, useEffect, useCallback, useMemo } from "react"; // useRef 제거
import { buildQueueWithLook } from "../logic/elevatorScheduler";

// 상수 정의
const TIME_PER_FLOOR = 2300;
const DOOR_OPEN_TIME = 700;
const DOOR_CLOSE_TIME = 700;
const DOOR_DWELL_TIME = 2000;

export function useElevatorController({ isOverload, hasJammedOnboard }) {
  // --- 상태 관리 ---
  const [currentFloor, setCurrentFloor] = useState(1);
  const [carFloor, setCarFloor] = useState(1);
  const [queue, setQueue] = useState([]);
  const [direction, setDirection] = useState("idle");
  const [doorState, setDoorState] = useState("closed");
  
  // 모터/이동 관련
  const [moveDuration, setMoveDuration] = useState(0);
  const [misalignMode, setMisalignMode] = useState(false);
  const [isMisaligned, setIsMisaligned] = useState(false);
  const [speedFloorsPerSec, setSpeedFloorsPerSec] = useState(0);
  
  // 화면상 이동 중인지 판별 (소수점 오차 고려)
  const isMoving = Math.abs(carFloor - currentFloor) > 0.01;



  // --- 2. 층 호출 요청 (스케줄러 호출) ---
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

  const removeRequest = useCallback((floor) =>{
    setQueue((prev)=> prev.filter((f) => f !== floor));
  }, []);

  // --- 3. 모터 이동 제어 로직 (속도 처리 추가) ---
  useEffect(() => {
    // 문이 닫혀있지 않으면 이동 불가
    if (doorState !== "closed") {
      if (direction !== "idle") setDirection("idle");
      setSpeedFloorsPerSec(0); // 정지 시 속도 0
      return;
    }
    // 갈 곳이 없으면 대기
    if (queue.length === 0) {
      if (direction !== "idle") setDirection("idle");
      setSpeedFloorsPerSec(0); // 정지 시 속도 0
      return;
    }
    
    // 이미 이동 중이라면 재실행 방지
    if (isMoving) return;

    const target = queue[0];

    // 이미 목표 층에 있다면
    if (target === currentFloor) {
      setDirection("idle");
      setSpeedFloorsPerSec(0);
      return;
    }

    // --- 이동 시작 ---
    const distanceFloors = Math.abs(target - currentFloor);
    const travelTime = TIME_PER_FLOOR * distanceFloors; // ms 단위

    setMoveDuration(travelTime);
    setDirection(target > currentFloor ? "up" : "down");

    // [추가] 이동 시작 시 속도 계산 및 설정 (층/초)
    // 거리(층) / 시간(초)
    if (travelTime > 0) {
      const speed = distanceFloors / (travelTime / 1000);
      setSpeedFloorsPerSec(speed);
    }

    // 정위치 실패 모드 시뮬레이션 계산
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

    setCarFloor(visualTargetFloor);

    // 도착 타이머 설정
    const id = setTimeout(() => {
      setCurrentFloor(target);
      setSpeedFloorsPerSec(0); // [추가] 도착하면 속도 0으로 초기화
      if (misalignMode) setMisalignMode(false);
    }, travelTime);

    return () => clearTimeout(id);
    
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, currentFloor, doorState]); 

  // --- 4. 도착 후 자동 문 열림 ---
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

  // --- 5. 문 상태 타이머 & 안전 장치 ---
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
        // 끼임 발생 시 닫히지 않음
      } else {
        timerId = setTimeout(() => {
          setDoorState("closed");
          setQueue((prev) => (prev.length > 0 && prev[0] === currentFloor ? prev.slice(1) : prev));
        }, DOOR_CLOSE_TIME);
      }
    }
    return () => clearTimeout(timerId);
  }, [doorState, currentFloor, isOverload, hasJammedOnboard]);

  // --- Action Handlers ---
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
    
    // 수정 이동 시작 시 속도 표시
    if (time > 0) {
        const dist = Math.abs(nearest - carFloor);
        setSpeedFloorsPerSec(dist / (time/1000));
    }

    const finishFix = () => {
        setCurrentFloor(nearest);
        setIsMisaligned(false);
        setSpeedFloorsPerSec(0); // 완료 시 속도 0
    };

    if(time > 0) {
      setTimeout(finishFix, time);
    } else {
      finishFix();
    }
  }, [isMisaligned, carFloor]);

  return useMemo(() => ({
    currentFloor,
    carFloor,
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
    currentFloor, carFloor, queue, direction, doorState, isMoving, 
    moveDuration, speedFloorsPerSec, isMisaligned, 
    requestFloor, openDoor, closeDoor, fixMisalign
  ]);
}