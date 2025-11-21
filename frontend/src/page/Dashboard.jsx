// src/pages/Dashboard.jsx
import { useState, useEffect } from "react"
import "./Dashboard.css"

const FLOORS = [5, 4, 3, 2, 1] // 위에서 아래로 표시용

function Dashboard() {
  const [currentFloor, setCurrentFloor] = useState(1)
  const [queue, setQueue] = useState([]) // 가야 할 층들
  const [direction, setDirection] = useState("idle") // "up" | "down" | "idle"

  // 문 상태
  const [doorOpen, setDoorOpen] = useState(false)

  // 승객 상태
  const [passengers, setPassengers] = useState([]) // {id, from, to, status}
  const [spawnFloor, setSpawnFloor] = useState(1)
  const [targetFloor, setTargetFloor] = useState(5)
  const [nextPassengerId, setNextPassengerId] = useState(1)

  // 층 호출 함수 (외부/내부/승객 공용)
  const requestFloor = (floor) => {
    setQueue((prev) => {
      if (prev.includes(floor) || floor === currentFloor) return prev
      return [...prev, floor]
    })
  }

  // 승객 생성: 출발층(from) + 목적층(to)
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
      status: "waiting", // 항상 대기부터 시작
    }

    setPassengers((prev) => [...prev, newPassenger])
    setNextPassengerId((id) => id + 1)

    // 엘리베이터가 다른 층에 있으면 출발층으로 먼저 호출
    if (spawnFloor !== currentFloor) {
      requestFloor(spawnFloor)
    }
    // 같은 층이면: 일단 그 층에서 기다리게 두고, 사용자가 문 열면 탑승
  }

  // 문 열기: 현재 층 기준으로 탑승/하차 처리
  const handleOpenDoor = () => {
    if (doorOpen) return
    setDoorOpen(true)

    setPassengers((prev) => {
      const boardingTargets = []
      const updated = prev.map((p) => {
        // 대기 승객 + 현재 층 = 탑승
        if (p.status === "waiting" && p.from === currentFloor) {
          boardingTargets.push(p.to)
          return { ...p, status: "onboard" }
        }
        // 탑승 중 승객 + 목적층 도착 = 하차
        if (p.status === "onboard" && p.to === currentFloor) {
          return { ...p, status: "done" }
        }
        return p
      })

      if (boardingTargets.length > 0) {
        setQueue((prevQ) => {
          let q = [...prevQ]
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
  }

  // 문 닫기: 현재 층이 queue[0]이면 그 층 방문 완료 → queue에서 제거
  const handleCloseDoor = () => {
    if (!doorOpen) return
    setDoorOpen(false)

    setQueue((prev) => {
      if (prev.length > 0 && prev[0] === currentFloor) {
        return prev.slice(1)
      }
      return prev
    })
  }

  // 엘리베이터 이동 로직
  useEffect(() => {
    // 문 열려 있으면 이동하지 않음
    if (doorOpen) {
      setDirection("idle")
      return
    }

    if (queue.length === 0) {
      setDirection("idle")
      return
    }

    const target = queue[0]

    // 목표층에 이미 도착했는데 문이 닫혀 있음 → 사용자가 열고/닫을 때까지 대기
    if (target === currentFloor) {
      setDirection("idle")
      return
    }

    setDirection(target > currentFloor ? "up" : "down")

    const id = setTimeout(() => {
      setCurrentFloor((prev) => (target > prev ? prev + 1 : prev - 1))
    }, 600)

    return () => clearTimeout(id)
  }, [queue, currentFloor, doorOpen])

  const visiblePassengers = passengers.filter((p) => p.status !== "done")

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
                  doorOpen ? "open" : "closed"
                }`}
              />
              <span className="door-indicator-label">
                문 {doorOpen ? "열림" : "닫힘"}
              </span>
            </div>
            <div className="door-buttons">
              <button
                type="button"
                className="door-btn open"
                onClick={handleOpenDoor}
                disabled={doorOpen}
              >
                열림
              </button>
              <button
                type="button"
                className="door-btn close"
                onClick={handleCloseDoor}
                disabled={!doorOpen}
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

        {/* 엘리베이터 샤프트 + 캐빈 + 사람 네모 */}
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
                  {/* 층에서 기다리는 사람들 */}
                  <div className="floor-waiting">
                    {waitingHere.map((p) => (
                      <div
                        key={p.id}
                        className="passenger-dot waiting"
                        title={`${p.from}층 → ${p.to}층`}
                      />
                    ))}
                  </div>

                  {/* 엘리베이터 캐빈 + 탑승 승객들 */}
                  {currentFloor === f && (
                    <div
                      className={`elevator-car ${
                        doorOpen ? "open" : "closed"
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

        {/* 내부 패널 + 승객 생성/목록 */}
        <div className="panel">
          <h2>내부 패널</h2>
          <p className="panel-subtitle">엘리베이터 안에서 층 선택</p>

          {/* 내부 층 버튼 */}
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

          {/* 승객 생성 섹션 */}
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

            {/* 승객 목록 */}
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
