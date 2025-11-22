// src/pages/Dashboard.jsx
import { useState, useEffect } from "react"
import "./Dashboard.css"

const FLOORS = [5, 4, 3, 2, 1]

// 문 동작 시간(ms) – 실제는 몇 초지만 데모용으로 조금 빠르게
const DOOR_OPEN_TIME = 700
const DOOR_CLOSE_TIME = 700
const DOOR_DWELL_TIME = 2000

// doorState: "closed" | "opening" | "open" | "closing"
function Dashboard() {
  const [currentFloor, setCurrentFloor] = useState(1)
  const [queue, setQueue] = useState([]) // 앞으로 들를 층들
  const [direction, setDirection] = useState("idle")

  const [doorState, setDoorState] = useState("closed")

  const [passengers, setPassengers] = useState([]) // {id, from, to, status}
  const [spawnFloor, setSpawnFloor] = useState(1)
  const [targetFloor, setTargetFloor] = useState(5)
  const [nextPassengerId, setNextPassengerId] = useState(1)

  const visiblePassengers = passengers.filter((p) => p.status !== "done")
  const doorLooksOpen = doorState === "open" || doorState === "opening"

  // -------------------------
  // 층 호출 / 승객 추가
  // -------------------------
  const requestFloor = (floor) => {
    setQueue((prev) => {
      if (prev.includes(floor) || floor === currentFloor) return prev
      return [...prev, floor]
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

    if (spawnFloor !== currentFloor) {
      // 다른 층이면 해당 층으로 이동 큐에 추가
      requestFloor(spawnFloor)
    } else {
      // 현재 층에서 사람이 생겼고 문이 닫히는 중/닫힘이면 → 다시 열기
      if (doorState === "closed" || doorState === "closing") {
        setDoorState("opening")
      }
    }
  }

  // -------------------------
  // 문 열림/닫힘 버튼
  // -------------------------
  const handleDoorOpenButton = () => {
    // 이미 열려있거나 열리는 중이면 무시
    if (doorState === "open" || doorState === "opening") return
    setDoorState("opening")
  }

  const handleDoorCloseButton = () => {
    // 이미 닫혀있거나 닫히는 중이면 무시
    if (doorState === "closed" || doorState === "closing") return
    setDoorState("closing") // 실제 엘베처럼 dwell 무시하고 바로 닫힘 시작
  }

  // -------------------------
  // 엘리베이터 이동 로직
  // -------------------------
  useEffect(() => {
    // 문이 완전히 닫혀있을 때만 이동
    if (doorState !== "closed") {
      setDirection("idle")
      return
    }

    if (queue.length === 0) {
      setDirection("idle")
      return
    }

    const target = queue[0]

    // 목표 층에 도착했으면 → 문 열기 시퀀스 자동 시작
    if (target === currentFloor) {
      setDirection("idle")
      setDoorState("opening")
      return
    }

    setDirection(target > currentFloor ? "up" : "down")

    const id = setTimeout(() => {
      setCurrentFloor((prev) => (target > prev ? prev + 1 : prev - 1))
    }, 600)

    return () => clearTimeout(id)
  }, [queue, currentFloor, doorState])

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
      // dwell 끝나면 자동으로 닫힘 시작
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
  // 문이 "완전히 열린 순간" 탑승/하차 처리
  // -------------------------
  useEffect(() => {
    if (doorState !== "open") return

    setPassengers((prev) => {
      const boardingTargets = []
      const updated = prev.map((p) => {
        // 현재 층에서 기다리던 승객 → 탑승
        if (p.status === "waiting" && p.from === currentFloor) {
          boardingTargets.push(p.to)
          return { ...p, status: "onboard" }
        }
        // 탑승 중이고 목적층에 도착 → 하차
        if (p.status === "onboard" && p.to === currentFloor) {
          return { ...p, status: "done" }
        }
        return p
      })

      if (boardingTargets.length > 0) {
        setQueue((prevQ) => {
          const q = [...prevQ]
          for (const dest of boardingTargets) {
            if (!q.includes(dest) && dest !== currentFloor) {
              q.push(dest)
            }
          }
          return q
        })
      }

      return updated
    })
  }, [doorState, currentFloor])

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
          </div>

          {/* 문 상태 표시 + 제어 */}
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
                disabled={doorState === "open" || doorState === "opening"}
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
        {/* 외부 호출 패널 */}
        <div className="panel">
          <h2>외부 호출</h2>
          <p className="panel-subtitle">각 층에서 엘리베이터 호출</p>
          <div className="panel-buttons">
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
        </div>

        {/* 샤프트 + 엘베 + 승객 네모 */}
        <div className="shaft">
          {FLOORS.map((f) => {
            const activePassengers = visiblePassengers
            const waitingHere = activePassengers.filter(
              (p) => p.status === "waiting" && p.from === f
            )
            const onboardPassengers = activePassengers.filter(
              (p) => p.status === "onboard"
            )

            return (
              <div key={f} className="floor-row">
                <span className="floor-label">{f}F</span>
                <div className="floor-content">
                  {/* 층 앞에서 기다리는 사람들 */}
                  <div className="floor-waiting">
                    {waitingHere.map((p) => (
                      <div
                        key={p.id}
                        className="passenger-dot waiting"
                        title={`${p.from}층 → ${p.to}층`}
                      />
                    ))}
                  </div>

                  {/* 현재 층의 엘리베이터 캐빈 */}
                  {currentFloor === f && (
                    <div
                      className={`elevator-car ${
                        doorLooksOpen ? "open" : "closed"
                      }`}
                    >
                      <div className="car-door" />
                      <div className="car-people">
                        {onboardPassengers.map((p) => (
                          <div
                            key={p.id}
                            className="passenger-dot inside"
                            title={`${p.from}층 → ${p.to}층`}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* 내부 패널 + 승객 생성 */}
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
