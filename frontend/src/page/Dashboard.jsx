// src/pages/Dashboard.jsx
import { useState, useEffect, useRef } from "react"
import "./Dashboard.css"

const FLOORS = [5, 4, 3, 2, 1]
const FLOOR_HEIGHT = 110 // 층 간 간격(px) – CSS와 맞춰 사용
const TIME_PER_FLOOR = 2300 // 한 층 이동에 걸리는 시간(ms)
const FLOOR_BASE_OFFSET = 30 // 첫 층(1층) 바닥 위치 오프셋(px)

// 무게 관련 상수
const MAX_LOAD_KG = 500
const MIN_WEIGHT_KG = 20
const MAX_WEIGHT_KG = 110

// 문 동작 시간(ms)
const DOOR_OPEN_TIME = 700
const DOOR_CLOSE_TIME = 700
const DOOR_DWELL_TIME = 2000

// LOOK 기반 큐 재정렬 함수
function buildQueueWithLook({ prevQueue, newFloors, currentFloor, direction }) {
  const stopsSet = new Set(prevQueue)
  newFloors.forEach((f) => {
    if (f !== currentFloor) {
      stopsSet.add(f)
    }
  })

  const stops = Array.from(stopsSet)
  if (stops.length === 0) return []

  const above = stops.filter((f) => f > currentFloor).sort((a, b) => a - b)
  const below = stops.filter((f) => f < currentFloor).sort((a, b) => b - a)
  const here = stops.filter((f) => f === currentFloor)

  if (direction === "up") {
    return [...here, ...above, ...below]
  } else if (direction === "down") {
    return [...here, ...below, ...above]
  } else {
    if (above.length === 0) return [...here, ...below]
    if (below.length === 0) return [...here, ...above]

    const nearestUp = above[0] - currentFloor
    const nearestDown = currentFloor - below[0]

    if (nearestUp <= nearestDown) {
      return [...here, ...above, ...below]
    } else {
      return [...here, ...below, ...above]
    }
  }
}

// 아래쪽(1층) 기준 인덱스: 1층→0, 2층→1, ... 5층→4
function floorIndexFromBottom(floor) {
  return floor - 1
}

// doorState: "closed" | "opening" | "open" | "closing"
function Dashboard() {
  const [currentFloor, setCurrentFloor] = useState(1) // 논리 층
  const [carFloor, setCarFloor] = useState(1) // 화면 캐빈 층 (소수층 포함 가능)
  const [queue, setQueue] = useState([])
  const [direction, setDirection] = useState("idle")
  const [doorState, setDoorState] = useState("closed")

  // passengers: {id, from, to, status, weightKg, isJammed}
  const [passengers, setPassengers] = useState([])
  const [spawnFloor, setSpawnFloor] = useState(1)
  const [targetFloor, setTargetFloor] = useState(5)
  const [nextPassengerId, setNextPassengerId] = useState(1)

  // 속도 표시용 (층/초)
  const [speedFloorsPerSec, setSpeedFloorsPerSec] = useState(0)

  // 이번 이동의 애니메이션 시간(ms) – 층 수에 따라 매번 달라짐
  const [moveDuration, setMoveDuration] = useState(0)

  // 이전 층/시간 기억해서 실제 속도 측정
  const moveRef = useRef({
    floor: 1,
    time: performance.now(),
  })

  const visiblePassengers = passengers.filter((p) => p.status !== "done")
  const doorLooksOpen = doorState === "open" || doorState === "opening"

  const onboardPassengers = passengers.filter((p) => p.status === "onboard")
  const onboardCount = onboardPassengers.length
  const onboardWeightKg = onboardPassengers.reduce(
    (sum, p) => sum + (p.weightKg ?? 0),
    0
  )
  const isOverload = onboardWeightKg > MAX_LOAD_KG
  const hasJammedOnboard = onboardPassengers.some((p) => p.isJammed)

  // 정위치 정차 실패 관련 상태
  const [misalignMode, setMisalignMode] = useState(false) // "다음 정차 시 실패" 플래그
  const [isMisaligned, setIsMisaligned] = useState(false) // 현재 정위치 실패 상태 여부

  // 화면상 이동 중인지: carFloor와 currentFloor가 다르면 이동 중으로 간주
  const isMoving = carFloor !== currentFloor

  // -------------------------
  // 실제 이동 속도 계산 (currentFloor 변경 시)
  // -------------------------
  useEffect(() => {
    const now = performance.now()
    const prev = moveRef.current
    const dtSec = (now - prev.time) / 1000
    const dfloor = Math.abs(currentFloor - prev.floor)

    if (dtSec > 0 && dfloor > 0) {
      const speed = dfloor / dtSec
      setSpeedFloorsPerSec(speed)
    } else if (queue.length === 0 || doorState !== "closed") {
      setSpeedFloorsPerSec(0)
    }

    moveRef.current = { floor: currentFloor, time: now }
  }, [currentFloor, queue.length, doorState])

  // -------------------------
  // 층 호출 / 승객 추가 (일반 승객)
  // -------------------------
  const requestFloor = (floor) => {
    setQueue((prev) => {
      if (prev.includes(floor) || floor === currentFloor) return prev
      return buildQueueWithLook({
        prevQueue: prev,
        newFloors: [floor],
        currentFloor,
        direction,
      })
    })
  }

  const handleAddPassenger = (e) => {
    e.preventDefault()
    if (spawnFloor === targetFloor) {
      alert("출발층과 목적층이 같습니다.")
      return
    }

    // 20 ~ 110kg 랜덤 정수
    const weightKg =
      Math.floor(Math.random() * (MAX_WEIGHT_KG - MIN_WEIGHT_KG + 1)) +
      MIN_WEIGHT_KG

    const newPassenger = {
      id: nextPassengerId,
      from: spawnFloor,
      to: targetFloor,
      status: "waiting",
      weightKg,
      isJammed: false,
    }

    setPassengers((prev) => [...prev, newPassenger])
    setNextPassengerId((id) => id + 1)

    if (spawnFloor === currentFloor && doorState === "closed" && !isMoving) {
      setDoorState("opening")
    }
  }

  // -------------------------
  // 끼임 승객 생성 (빨간색)
  // -------------------------
  const handleAddJammedPassenger = () => {
    const from = currentFloor
    const to = from === 5 ? 1 : 5

    const weightKg =
      Math.floor(Math.random() * (MAX_WEIGHT_KG - MIN_WEIGHT_KG + 1)) +
      MIN_WEIGHT_KG

    const newPassenger = {
      id: nextPassengerId,
      from,
      to,
      status: "waiting",
      weightKg,
      isJammed: true,
    }

    setPassengers((prev) => [...prev, newPassenger])
    setNextPassengerId((id) => id + 1)

    if (from === currentFloor && doorState === "closed" && !isMoving) {
      setDoorState("opening")
    }
  }

  // -------------------------
  // 정위치 정차 실패 모드 ON (다음 정차에서 발동)
  // -------------------------
  const handleStartMisalignTest = () => {
    if (isMisaligned) {
      alert("이미 정위치 정차 실패 상태입니다. 먼저 정위치 자동 수정을 해주세요.")
      return
    }
    // 그냥 플래그만 켜두면, 다음 이동에서 한 번만 사용됨
    setMisalignMode(true)
  }

  // -------------------------
  // 승객 강제 하차 (문 열려 있을 때만)
  // -------------------------
  const handleUnloadPassenger = (id) => {
    if (!doorLooksOpen) {
      alert("문이 열린 상태에서만 승객이 내릴 수 있습니다.")
      return
    }

    const passengerToUnload = passengers.find((p) => p.id === id)
    if (!passengerToUnload || passengerToUnload.status !== "onboard") return

    const destFloor = passengerToUnload.to

    // 승객 상태: onboard → done (내린 층을 현재 층으로 기록)
    setPassengers((prev) =>
      prev.map((p) =>
        p.id === id && p.status === "onboard"
          ? { ...p, status: "done", to: currentFloor }
          : p
      )
    )

    // 이 승객이 가려던 목적층에 더 이상 아무도 안 가면 큐에서도 제거
    setQueue((prevQueue) => {
      if (!destFloor || !prevQueue.includes(destFloor)) return prevQueue

      const stillGoing = passengers.some(
        (p) =>
          p.id !== id &&
          p.status !== "done" &&
          p.to === destFloor
      )

      if (stillGoing) return prevQueue
      return prevQueue.filter((f) => f !== destFloor)
    })
  }

  // -------------------------
  // 문 열림/닫힘 버튼
  // -------------------------
  const handleDoorOpenButton = () => {
    if (doorState === "open" || doorState === "opening") return
    if (isMoving) return // 이동 중에는 열기 금지
    setDoorState("opening")
  }

  const handleDoorCloseButton = () => {
    if (doorState === "closed" || doorState === "closing") return

    // 과부하 상태에서는 문 닫기 금지
    if (isOverload) {
      alert("적재량 500kg을 초과하여 문을 닫을 수 없습니다. 승객을 내려주세요.")
      return
    }

    setDoorState("closing")
  }

  // -------------------------
  // 엘리베이터 이동 로직 (연속 이동)
  // - queue[0]까지 한 번에 쭉 이동
  // - 이동 시간 = 층 수 × TIME_PER_FLOOR
  // - misalignMode가 켜져 있으면, 목적층 근처의 랜덤 소수층으로 정차
  // -------------------------
  useEffect(() => {
    // 문이 열려 있으면 이동 금지
    if (doorState !== "closed") {
      setDirection("idle")
      return
    }

    // 처리할 큐가 없으면 정지
    if (queue.length === 0) {
      setDirection("idle")
      return
    }

    // 이미 애니메이션 이동 중이면 다음 step 기다리기
    if (isMoving) return

    const target = queue[0]

    // 이미 그 층에 논리적으로 도착해 있으면
    if (target === currentFloor) {
      setDirection("idle")
      return
    }

    const distanceFloors = Math.abs(target - currentFloor)
    const travelTime = TIME_PER_FLOOR * distanceFloors

    setMoveDuration(travelTime)
    setDirection(target > currentFloor ? "up" : "down")

    // ---- 정위치 실패 모드 적용 ----
    let visualTargetFloor = target
    if (misalignMode && !isMisaligned) {
      // target 층 근처에서 ±0.4층 정도 랜덤 오프셋
      const OFFSET_RANGE = 0.4
      const offset = (Math.random() * 2 - 1) * OFFSET_RANGE // -0.4 ~ +0.4
      let misFloor = target + offset
      // 1층 ~ 5층 범위 안으로만 클램프
      if (misFloor < 1) misFloor = 1
      if (misFloor > 5) misFloor = 5

      visualTargetFloor = misFloor
      setIsMisaligned(true)
    }

    // 화면용 캐빈 위치를 "목표(또는 오프셋된) 층"으로 설정
    setCarFloor(visualTargetFloor)

    // 이 시점 기준으로 실제 속도 측정에 사용할 시간 저장
    moveRef.current = { floor: currentFloor, time: performance.now() }

    // travelTime 뒤에 논리 층을 한 번에 target으로 갱신
    const id = setTimeout(() => {
      setCurrentFloor(target)
      // 한 번 발동 후에는 모드 해제 (다음 정차는 다시 정상)
      if (misalignMode) {
        setMisalignMode(false)
      }
    }, travelTime)

    return () => {
      void id
    }
  }, [queue, currentFloor, doorState, isMoving, misalignMode, isMisaligned])

  // -------------------------
  // 도착 후 멈춘 상태에서만 문 자동 열기
  //  - isMisaligned 상태에서는 문이 자동으로 열리지 않음
  // -------------------------
  useEffect(() => {
    if (doorState !== "closed") return
    if (queue.length === 0) return
    if (isMoving) return
    if (isMisaligned) return // 정위치 실패 상태에서는 문 자동 오픈 금지

    const target = queue[0]
    if (target === currentFloor && carFloor === currentFloor) {
      setDoorState("opening")
    }
  }, [doorState, queue, currentFloor, carFloor, isMoving, isMisaligned])

  // -------------------------
  // 문 상태 타이밍 (opening → open → closing → closed)
  //  + 끼임 승객 로직:
  //    - closing 상태에서 끼임 승객이 onboard면 "closed"로 가지 않고 계속 closing 유지
  // -------------------------
  useEffect(() => {
    let timerId

    if (doorState === "opening") {
      timerId = setTimeout(() => {
        setDoorState("open")
      }, DOOR_OPEN_TIME)
    } else if (doorState === "open") {
      // 과부하 상태에서는 자동으로 닫히지 않음
      if (!isOverload) {
        timerId = setTimeout(() => {
          setDoorState("closing")
        }, DOOR_DWELL_TIME)
      }
    } else if (doorState === "closing") {
      if (hasJammedOnboard) {
        // 끼임 승객이 탑승 중이면 문이 끝까지 닫히지 않음
        // -> "닫히는 중" 상태를 유지
      } else {
        timerId = setTimeout(() => {
          setDoorState("closed")
          // 한 층 서비스 완료되었으면 큐에서 제거
          setQueue((prev) =>
            prev.length > 0 && prev[0] === currentFloor ? prev.slice(1) : prev
          )
        }, DOOR_CLOSE_TIME)
      }
    }

    return () => clearTimeout(timerId)
  }, [doorState, currentFloor, isOverload, hasJammedOnboard])

  // -------------------------
  // 문이 "완전히 열린 순간" 탑승/하차
  // -------------------------
  useEffect(() => {
    if (doorState !== "open") return

    setPassengers((prev) => {
      const boardingTargets = []
      const updated = prev.map((p) => {
        if (p.status === "waiting" && p.from === currentFloor) {
          boardingTargets.push(p.to)
          return { ...p, status: "onboard" }
        }

        if (p.status === "onboard" && p.to === currentFloor) {
          return { ...p, status: "done" }
        }

        return p
      })

      if (boardingTargets.length > 0) {
        setQueue((prevQ) =>
          buildQueueWithLook({
            prevQueue: prevQ,
            newFloors: boardingTargets,
            currentFloor,
            direction,
          })
        )
      }

      return updated
    })
  }, [doorState, currentFloor, direction])

  // -------------------------
  // 정위치 자동 수정
  // - 현재 carFloor(소수층)를 가장 가까운 정수 층으로 이동
  // - 이동 후 currentFloor를 그 층으로 맞추고 isMisaligned 해제
  // -------------------------
  const handleFixMisalign = () => {
    if (!isMisaligned) {
      alert("현재 정위치 정차 실패 상태가 아닙니다.")
      return
    }

    // 가장 가까운 정수 층 (1~5 사이로 클램프)
    let nearestFloor = Math.round(carFloor)
    if (nearestFloor < 1) nearestFloor = 1
    if (nearestFloor > 5) nearestFloor = 5

    const distanceFloors = Math.abs(nearestFloor - carFloor)
    // 정위치 오차는 작다고 가정하므로 distanceFloors는 보통 0.x
    const travelTime = TIME_PER_FLOOR * distanceFloors

    // 0인 경우(이미 딱 층에 맞아 있는 경우) 바로 해제
    if (travelTime === 0) {
      setCarFloor(nearestFloor)
      setCurrentFloor(nearestFloor)
      setIsMisaligned(false)
      return
    }

    setMoveDuration(travelTime)
    setDirection(nearestFloor > carFloor ? "up" : "down")
    setCarFloor(nearestFloor)

    moveRef.current = { floor: currentFloor, time: performance.now() }

    setTimeout(() => {
      setCurrentFloor(nearestFloor)
      setIsMisaligned(false)
      // 이후 자동 문 열림 useEffect가 조건을 만족하면 문을 열어 줌
    }, travelTime)
  }

  // -------------------------
  // 엘리베이터 위치 계산 (시각용은 carFloor 사용)
  // -------------------------
  const currentIndex = floorIndexFromBottom(carFloor)
  const rawBottom = currentIndex * FLOOR_HEIGHT + FLOOR_BASE_OFFSET + 10
  const carBottom = rawBottom < 0 ? 0 : rawBottom

  // -------------------------
  // 표시용 텍스트/색
  // -------------------------
  const statusLabel =
    direction === "idle" ? "대기" : direction === "up" ? "상행" : "하행"

  const statusColor =
    direction === "idle"
      ? "#6b7280"
      : direction === "up"
      ? "#2563eb"
      : "#dc2626"

  return (
    <div className="Dashboard">
      <header className="dash-header">
        <div className="dash-header-main">
          <div>
            <h1>CPS Elevator Simulator</h1>
            <p>
              현재 층: <b>{currentFloor}</b>{" "}
              <span style={{ color: statusColor }}>({statusLabel})</span>
            </p>
            <p className="queue-info">
              대기 큐: {queue.length === 0 ? "없음" : queue.join(" → ")}
            </p>

            {/* 무게 기반 적재 표시 */}
            <p className="capacity-info">
              정격 적재 {MAX_LOAD_KG}kg ·{" "}
              <span className={`capacity-count ${isOverload ? "full" : ""}`}>
                현재 {onboardCount}명 / {onboardWeightKg}kg
              </span>
            </p>

            <p className="speed-info">
              속도: {speedFloorsPerSec.toFixed(2)} 층/초
            </p>
          </div>

          <div className="door-controls">
            <div className="door-indicator">
              <span
                className={`door-indicator-dot ${
                  doorLooksOpen ? "open" : "closed"
                }`}
              />
              <span className="door-indicator-label">
                문{" "}
                {doorState === "opening"
                  ? "열리는 중"
                  : doorState === "closing"
                  ? "닫히는 중"
                  : doorLooksOpen
                  ? "열림"
                  : "닫힘"}
              </span>
            </div>
            <div className="door-buttons">
              <button
                type="button"
                className="door-btn open"
                onClick={handleDoorOpenButton}
                disabled={
                  doorState === "open" ||
                  doorState === "opening" ||
                  isMoving
                }
              >
                열림
              </button>
              <button
                type="button"
                className="door-btn close"
                onClick={handleDoorCloseButton}
                disabled={doorState === "closed" || doorState === "closing"}
              >
                닫힘
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="dash-layout">
        {/* 왼쪽: 내부 패널 */}
        <div className="panel">
          <h2>내부 패널</h2>
          <p className="panel-subtitle">엘리베이터 안에서 층 선택</p>

          <div className="panel-buttons">
            {FLOORS.slice().reverse().map((f) => (
              <button
                key={f}
                className="floor-btn inside"
                onClick={() => requestFloor(f)}
              >
                {f}
              </button>
            ))}
          </div>

          {/* 끼임 승객 생성 버튼 */}
          <div className="jam-section">
            <h3>끼임 승객 테스트</h3>
            <button
              type="button"
              className="jam-btn"
              onClick={handleAddJammedPassenger}
            >
              끼임 승객 생성 (현재 층)
            </button>
            <p className="jam-hint">
              빨간 승객이 탑승 중이면 문이 닫히지 않고 "닫히는 중" 상태로 유지됩니다.
            </p>
          </div>

          {/* 정위치 정차 실패 테스트 */}
          <div className="level-section">
            <h3>정위치 정차 실패 테스트</h3>
            <button
              type="button"
              className="level-error-btn"
              onClick={handleStartMisalignTest}
            >
              다음 정차 시 정위치 실패 발생
            </button>
            <button
              type="button"
              className="level-fix-btn"
              onClick={handleFixMisalign}
              disabled={!isMisaligned}
            >
              정위치 자동 수정
            </button>
            <p className="level-hint">
              정위치 실패 모드를 켜면 다음 목표 층에서 1~5층 사이 랜덤 위치에
              정차하고, 문이 열리지 않습니다.{" "}
              &quot;정위치 자동 수정&quot;을 누르면 가장 가까운 층으로 이동한 뒤
              정상 동작합니다.
            </p>
          </div>
        </div>

        {/* 가운데: 측면 엘리베이터 장면 */}
        <div className="shaft">
          <div className="shaft-scene">
            {/* 층 라인 + 대기 승객 */}
            {FLOORS.map((f) => {
              const idx = floorIndexFromBottom(f)
              const bottom = idx * FLOOR_HEIGHT + FLOOR_BASE_OFFSET
              const waitingHere = visiblePassengers.filter(
                (p) => p.status === "waiting" && p.from === f
              )

              return (
                <div
                  key={f}
                  className="floor-layer"
                  style={{ bottom: `${bottom}px` }}
                >
                  <div className="floor-line" />
                  <div className="floor-label-side">{f}F</div>
                  <div className="floor-waiting-side">
                    {waitingHere.map((p) => (
                      <div
                        key={p.id}
                        className={
                          "passenger-dot waiting side" +
                          (p.isJammed ? " jammed" : "")
                        }
                        title={`${p.from}층 → ${p.to}층 (${p.weightKg}kg)${
                          p.isJammed ? " / 끼임 승객" : ""
                        }`}
                      />
                    ))}
                  </div>
                </div>
              )
            })}

            {/* 중앙 세로 샤프트 라인 */}
            <div className="shaft-wall" />

            {/* 엘리베이터 캐빈 */}
            <div
              className={`elevator-car side ${
                doorLooksOpen ? "open" : "closed"
              }`}
              style={{
                bottom: `${carBottom}px`,
                transitionDuration: `${moveDuration}ms`,
              }}
            >
              <div className="car-inner">
                {/* 문 – 직각 슬라이딩 */}
                <div className={`car-door side door-${doorState}`}>
                  <div className="door-panel left" />
                  <div className="door-panel right" />
                </div>

                {/* 캐빈 안 승객 (네모) */}
                <div className="car-people-inside">
                  {onboardPassengers.map((p) => (
                    <div
                      key={p.id}
                      className={
                        "passenger-dot inside" +
                        (p.isJammed ? " jammed" : "")
                      }
                      title={`${p.from}층 → ${p.to}층 (${p.weightKg}kg)${
                        p.isJammed ? " / 끼임 승객" : ""
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 오른쪽: 외부 호출 + 승객 생성 */}
        <div className="panel">
          <h2>외부 호출 / 승객</h2>
          <p className="panel-subtitle">각 층에서 엘리베이터 호출 + 승객 추가</p>

          <div className="panel-buttons" style={{ marginBottom: 16 }}>
            {FLOORS.map((f) => (
              <button
                key={f}
                className="floor-btn"
                onClick={() => requestFloor(f)}
              >
                {f}층
              </button>
            ))}
          </div>

          <div className="passenger-section">
            <h3>승객 목록</h3>
            <form className="passenger-form" onSubmit={handleAddPassenger}>
              <div className="field">
                <label>출발층</label>
                <select
                  value={spawnFloor}
                  onChange={(e) => setSpawnFloor(Number(e.target.value))}
                >
                  {FLOORS.slice().reverse().map((f) => (
                    <option key={f} value={f}>
                      {f}층
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>목적층</label>
                <select
                  value={targetFloor}
                  onChange={(e) => setTargetFloor(Number(e.target.value))}
                >
                  {FLOORS.slice().reverse().map((f) => (
                    <option key={f} value={f}>
                      {f}층
                    </option>
                  ))}
                </select>
              </div>

              <button type="submit" className="add-passenger-btn">
                승객 추가
              </button>
            </form>

            <div className="passenger-list">
              {visiblePassengers.length === 0 ? (
                <p className="passenger-empty">대기 중인 승객이 없습니다.</p>
              ) : (
                visiblePassengers.map((p) => (
                  <div
                    key={p.id}
                    className={
                      "passenger-item" + (p.isJammed ? " jammed-item" : "")
                    }
                  >
                    <span className="passenger-route">
                      {p.from}층 → {p.to}층
                      {p.isJammed ? " (끼임)" : ""}
                    </span>
                    <span className="passenger-weight">{p.weightKg}kg</span>
                    <span className={`passenger-status ${p.status}`}>
                      {p.status === "waiting"
                        ? "대기"
                        : p.status === "onboard"
                        ? "탑승 중"
                        : "완료"}
                    </span>

                    {p.status === "onboard" && (
                      <button
                        type="button"
                        className="unload-btn"
                        onClick={() => handleUnloadPassenger(p.id)}
                        disabled={!doorLooksOpen}
                      >
                        내리기
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <footer className="dash-footer">© 2025 CPS Elevator System</footer>
    </div>
  )
}

export default Dashboard
