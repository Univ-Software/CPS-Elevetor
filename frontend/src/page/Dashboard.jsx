// src/pages/Dashboard.jsx
import { useState, useEffect } from "react"
import "./Dashboard.css"

const FLOORS = [5, 4, 3, 2, 1] // 위에서 아래로 표시용

function Dashboard() {
  const [currentFloor, setCurrentFloor] = useState(1)
  const [queue, setQueue] = useState([])         // 가야 할 층들: [5, 3] 이런 식
  const [direction, setDirection] = useState("idle") // "up" | "down" | "idle"

  // 층 호출 (외부/내부 공용)
  const requestFloor = (floor) => {
    setQueue((prev) => {
      // 이미 큐에 있거나 현재층이면 추가 안 함
      if (prev.includes(floor) || floor === currentFloor) return prev
      return [...prev, floor]
    })
  }

  // 이동 로직: queue 또는 currentFloor가 바뀔 때마다 한 칸씩 움직이기
  useEffect(() => {
    if (queue.length === 0) {
      setDirection("idle")
      return
    }

    const target = queue[0]

    // 이미 목표 층과 같으면 큐에서 제거하고 끝
    if (target === currentFloor) {
      setQueue((prev) => prev.slice(1)) // 맨 앞층 제거
      setDirection("idle")
      return
    }

    // 아직 도착 전이면 방향 설정
    setDirection(target > currentFloor ? "up" : "down")

    // 0.6초 후에 한 층 이동
    const id = setTimeout(() => {
      setCurrentFloor((prev) => (target > prev ? prev + 1 : prev - 1))
    }, 600)

    // cleanup: currentFloor/queue 바뀔 때 이전 타이머 정리
    return () => clearTimeout(id)
  }, [queue, currentFloor])

  return (
    <div className="Dashboard">
      <header className="dash-header">
        <h1>CPS Elevator Simulator</h1>
        <p>
          현재 층: {currentFloor} / 상태:{" "}
          {direction === "idle" ? "대기" : direction === "up" ? "상행" : "하행"}
        </p>
        <p className="queue-info">
          대기 큐: {queue.length === 0 ? "없음" : queue.join(" → ")}
        </p>
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

        {/* 엘리베이터 샤프트 + 캐빈 */}
        <div className="shaft">
          {FLOORS.map((f) => (
            <div key={f} className="floor-row">
              <span className="floor-label">{f}F</span>
              {currentFloor === f && (
                <div className="elevator-car">
                  <div className="car-door" />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* 내부(캐빈) 패널 */}
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
      </div>

      <footer className="dash-footer">© 2025 CPS Elevator System</footer>
    </div>
  )
}

export default Dashboard
