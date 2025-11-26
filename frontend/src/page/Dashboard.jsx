// src/pages/Dashboard.jsx
import { useState, useEffect, useRef } from "react"
import "./Dashboard.css"

const FLOORS = [5, 4, 3, 2, 1]
const MAX_CAPACITY = 5
const FLOOR_HEIGHT = 110                // 층 간 간격(px) – CSS와 맞춰 사용
const TIME_PER_FLOOR = 900              // 한 층 이동에 걸리는 시간(ms)

// 문 동작 시간(ms)
const DOOR_OPEN_TIME = 700
const DOOR_CLOSE_TIME = 700
const DOOR_DWELL_TIME = 2000

const FLOOR_BASE_OFFSET = 30     // 첫 층(1층) 바닥 위치 오프셋(px)

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
  const [carFloor, setCarFloor] = useState(1)         // 화면 캐빈 층
  const [queue, setQueue] = useState([])
  const [direction, setDirection] = useState("idle")
  const [doorState, setDoorState] = useState("closed")

  const [passengers, setPassengers] = useState([]) // {id, from, to, status}
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
  const isFull = onboardCount >= MAX_CAPACITY

  // 화면상 이동 중인지: carFloor와 currentFloor가 다르면 이동 중
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
  // 층 호출 / 승객 추가
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

    const newPassenger = {
      id: nextPassengerId,
      from: spawnFloor,
      to: targetFloor,
      status: "waiting",
    }

    setPassengers((prev) => [...prev, newPassenger])
    setNextPassengerId((id) => id + 1)

    if (
      spawnFloor === currentFloor &&
      doorState === "closed" &&
      !isMoving
    ) {
      setDoorState("opening")
    }
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
    setDoorState("closing")
  }

  // -------------------------
  // 엘리베이터 이동 로직 (연속 이동)
  // - queue[0]까지 한 번에 쭉 이동
  // - 이동 시간 = 층 수 × TIME_PER_FLOOR
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
    // 아래 "도착 후 문 열기" useEffect에서 문을 열게 둔다.
    if (target === currentFloor) {
      setDirection("idle")
      return
    }

    const distanceFloors = Math.abs(target - currentFloor)
    const travelTime = TIME_PER_FLOOR * distanceFloors // 높을수록 오래 이동

    setMoveDuration(travelTime)
    setDirection(target > currentFloor ? "up" : "down")

    // 화면용 캐빈 위치를 "바로 목적층"으로 설정
    // => CSS transition이 현재 위치 → target까지 한 번에 애니메이션
    setCarFloor(target)

    // 이 시점 기준으로 실제 속도 측정에 사용할 시간 저장
    moveRef.current = { floor: currentFloor, time: performance.now() }

    // travelTime 뒤에 논리 층을 한 번에 target으로 갱신
    const id = setTimeout(() => {
      setCurrentFloor(target)
    }, travelTime)

    // 이동 타이머는 의도적으로 clean-up 하지 않음
    // (clean-up 하면 이동 중간에 currentFloor 갱신이 취소됨)
    return () => {
      void id
    }
  }, [queue, currentFloor, doorState, isMoving])

  // -------------------------
  // 도착 후 멈춘 상태에서만 문 자동 열기
  // -------------------------
  useEffect(() => {
    if (doorState !== "closed") return
    if (queue.length === 0) return
    if (isMoving) return

    const target = queue[0]
    if (target === currentFloor && carFloor === currentFloor) {
      setDoorState("opening")
    }
  }, [doorState, queue, currentFloor, carFloor, isMoving])

  // -------------------------
  // 문 상태 타이밍 (opening → open → closing → closed)
  // -------------------------
  useEffect(() => {
    let timerId

    if (doorState === "opening") {
      timerId = setTimeout(() => {
        setDoorState("open")
      }, DOOR_OPEN_TIME)
    } else if (doorState === "open") {
      timerId = setTimeout(() => {
        setDoorState("closing")
      }, DOOR_DWELL_TIME)
    } else if (doorState === "closing") {
      timerId = setTimeout(() => {
        setDoorState("closed")
        // 한 층 서비스 완료되었으면 큐에서 제거
        setQueue((prev) =>
          prev.length > 0 && prev[0] === currentFloor ? prev.slice(1) : prev
        )
      }, DOOR_CLOSE_TIME)
    }

    return () => clearTimeout(timerId)
  }, [doorState, currentFloor])

  // -------------------------
  // 문이 "완전히 열린 순간" 탑승/하차 + 정원 체크
  // -------------------------
  useEffect(() => {
    if (doorState !== "open") return

    setPassengers((prev) => {
      let onboard = prev.filter((p) => p.status === "onboard").length
      let availableSlots = MAX_CAPACITY - onboard

      const boardingTargets = []
      const updated = prev.map((p) => {
        if (
          p.status === "waiting" &&
          p.from === currentFloor &&
          availableSlots > 0
        ) {
          boardingTargets.push(p.to)
          availableSlots -= 1
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

            <p className="capacity-info">
              정원 {MAX_CAPACITY}명 ·{" "}
              <span className={`capacity-count ${isFull ? "full" : ""}`}>
                현재 {onboardCount}명
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
                        className="passenger-dot waiting side"
                        title={`${p.from}층 → ${p.to}층`}
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
                transitionDuration: `${moveDuration}ms`, // 층 수에 따라 이동 시간 조절
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
                      className="passenger-dot inside"
                      title={`${p.from}층 → ${p.to}층`}
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
                {f}층 호출
              </button>
            ))}
          </div>

          <div className="passenger-section">
            <h3>승객 생성</h3>
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
                  <div key={p.id} className="passenger-item">
                    <span className="passenger-route">
                      {p.from}층 → {p.to}층
                    </span>
                    <span className={`passenger-status ${p.status}`}>
                      {p.status === "waiting"
                        ? "대기"
                        : p.status === "onboard"
                        ? "탑승 중"
                        : "완료"}
                    </span>
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
