// src/page/Dashboard.jsx
import { useState, useEffect } from "react"
import "./Dashboard.css"
import { useElevatorController } from "../hooks/useElevatorController"

const FLOORS = [5, 4, 3, 2, 1]
const FLOOR_HEIGHT = 110
const FLOOR_BASE_OFFSET = 30

const MAX_LOAD_KG = 500
const MIN_WEIGHT_KG = 20
const MAX_WEIGHT_KG = 110

function Dashboard() {
  // --------------------------------------------------------
  // 1. 환경(승객) 시뮬레이션 상태 (Controller 외부의 영역)
  // --------------------------------------------------------
  const [passengers, setPassengers] = useState([])
  const [spawnFloor, setSpawnFloor] = useState(1)
  const [targetFloor, setTargetFloor] = useState(5)
  const [nextPassengerId, setNextPassengerId] = useState(1)

  // 승객 필터링
  const visiblePassengers = passengers.filter((p) => p.status !== "done")
  const onboardPassengers = passengers.filter((p) => p.status === "onboard")
  
  // 센서 데이터 계산 (Controller에 입력으로 전달)
  const onboardCount = onboardPassengers.length
  const onboardWeightKg = onboardPassengers.reduce((sum, p) => sum + (p.weightKg ?? 0), 0)
  const isOverload = onboardWeightKg > MAX_LOAD_KG
  const hasJammedOnboard = onboardPassengers.some((p) => p.isJammed)

  // --------------------------------------------------------
  // 2. 엘리베이터 컨트롤러 훅 사용 (핵심 로직 분리)
  // --------------------------------------------------------
  const ctrl = useElevatorController({
    isOverload,
    hasJammedOnboard,
  })

  // Controller에서 상태 값 꺼내오기
  const { 
    currentFloor, 
    carFloor, 
    realtimeFloor, // [중요] 실시간 위치 계산값 (텍스트 표시용)
    queue, 
    direction, 
    doorState, 
    moveDuration, 
    speedFloorsPerSec, 
    isMisaligned, 
    isMoving 
  } = ctrl

  const doorLooksOpen = doorState === "open" || doorState === "opening"

  // --------------------------------------------------------
  // 3. 화면 렌더링용 헬퍼 계산
  // --------------------------------------------------------
  const floorIndexFromBottom = (f) => f - 1
  
  // [A] 그래픽용 (CSS Animation): 목표치(carFloor)를 사용하여 부드럽게 이동
  const currentIndex = floorIndexFromBottom(carFloor)
  const carBottom = Math.max(0, currentIndex * FLOOR_HEIGHT + FLOOR_BASE_OFFSET + 10)

  // [B] 텍스트용 (Realtime Value): 실시간 계산값(realtimeFloor)을 사용하여 숫자 갱신
  const realtimeIndex = floorIndexFromBottom(realtimeFloor)
  const realtimePx = Math.max(0, realtimeIndex * FLOOR_HEIGHT + FLOOR_BASE_OFFSET + 10)


  // --------------------------------------------------------
  // 4. 이벤트 핸들러 (승객 추가 / 하차 / 버튼 클릭)
  // --------------------------------------------------------

  // 일반 승객 추가
  const handleAddPassenger = (e) => {
    e.preventDefault()
    if (spawnFloor === targetFloor) {
      alert("출발층과 목적층이 같습니다.")
      return
    }

    const weightKg = Math.floor(Math.random() * (MAX_WEIGHT_KG - MIN_WEIGHT_KG + 1)) + MIN_WEIGHT_KG
    
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
    
    // 승객이 버튼을 누름 -> Controller에 요청
    // 만약 이미 그 층에 있고 문이 닫혀있다면 문 열기 요청
    if (spawnFloor === currentFloor && doorState === "closed" && !isMoving) {
       ctrl.openDoor() 
    } else {
       ctrl.requestFloor(spawnFloor) // 외부 호출 (Hall Call)
    }
  }

  // 끼임 승객 추가
  const handleAddJammedPassenger = () => {
    const from = currentFloor
    const to = from === 5 ? 1 : 5
    
    const weightKg = Math.floor(Math.random() * (MAX_WEIGHT_KG - MIN_WEIGHT_KG + 1)) + MIN_WEIGHT_KG
    
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
        ctrl.openDoor()
    } else {
        ctrl.requestFloor(from)
    }
  }

  // 수동 하차 버튼 핸들러
  const handleUnloadPassenger = (id) => {
    if (!doorLooksOpen) {
      alert("문이 열린 상태에서만 승객이 내릴 수 있습니다.")
      return
    }

    const passengerToUnload = passengers.find((p) => p.id === id)
    if (!passengerToUnload || passengerToUnload.status !== "onboard") return

    // 1. 화면상 승객 하차 처리
    setPassengers((prev) =>
      prev.map((p) =>
        p.id === id && p.status === "onboard"
          ? { ...p, status: "done", to: currentFloor }
          : p
      )
    )

    // 2. 큐 정리 (해당 층에 갈 다른 승객이 없다면 큐에서 제거)
    const destFloor = passengerToUnload.to
    
    const isStillNeeded = passengers.some(p => {
       if (p.id === id) return false 
       if (p.status === "done") return false 
       if (p.status === "onboard" && p.to === destFloor) return true
       if (p.status === "waiting" && p.from === destFloor) return true
       return false
    })

    if (!isStillNeeded) {
        ctrl.removeRequest(destFloor)
    }
  }

  // --------------------------------------------------------
  // 5. 문이 열렸을 때 탑승 및 자동 하차 로직
  // --------------------------------------------------------
  useEffect(() => {
    if (doorState !== "open") return

    setPassengers((prev) => {
      const boardingTargets = []
      
      const updated = prev.map((p) => {
        // [탑승] 대기 중이고 현재 층이 출발지면 -> 탑승
        if (p.status === "waiting" && p.from === currentFloor) {
          boardingTargets.push(p.to)
          return { ...p, status: "onboard" }
        }

        // [하차] 탑승 중이고 현재 층이 목적지면 -> 하차 완료
        if (p.status === "onboard" && p.to === currentFloor) {
          return { ...p, status: "done" }
        }

        return p
      })

      // 새로 탑승한 승객들이 목적지 버튼을 누름 -> Controller에 요청
      boardingTargets.forEach(floor => ctrl.requestFloor(floor))
      
      return updated
    })
  }, [doorState, currentFloor, ctrl])

  // --------------------------------------------------------
  // 6. UI 렌더링
  // --------------------------------------------------------
  const statusLabel = direction === "idle" ? "대기" : direction === "up" ? "상행" : "하행"
  const statusColor = direction === "idle" ? "#6b7280" : direction === "up" ? "#2563eb" : "#dc2626"

  return (
    <div className="Dashboard">
      <header className="dash-header">
        <div className="dash-header-main">
          <div>
            <h1>CPS Elevator Simulator</h1>
            <p>
              현재 층: <b>{currentFloor}</b> <span style={{ color: statusColor }}>({statusLabel})</span>
            </p>
            <p className="queue-info">
              대기 큐: {queue.length === 0 ? "없음" : queue.join(" → ")}
            </p>
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
              <span className={`door-indicator-dot ${doorLooksOpen ? "open" : "closed"}`} />
              <span className="door-indicator-label">
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
                onClick={ctrl.openDoor} 
                disabled={doorState === "open" || doorState === "opening" || isMoving}
              >
                열림
              </button>
              <button 
                type="button" 
                className="door-btn close" 
                onClick={ctrl.closeDoor} 
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
                onClick={() => ctrl.requestFloor(f)}
              >
                {f}
              </button>
            ))}
          </div>

          <div className="jam-section">
            <h3>끼임 승객 테스트</h3>
            <button type="button" className="jam-btn" onClick={handleAddJammedPassenger}>
              끼임 승객 생성 (현재 층)
            </button>
            <p className="jam-hint">
              빨간 승객이 탑승 중이면 문이 닫히지 않고 "닫히는 중" 상태로 유지됩니다.
            </p>
          </div>

          <div className="level-section">
            <h3>정위치 정차 실패 테스트</h3>
            <button 
              type="button" 
              className="level-error-btn" 
              onClick={() => ctrl.setMisalignMode(true)}
            >
              다음 정차 시 정위치 실패 발생
            </button>
            <button 
              type="button" 
              className="level-fix-btn" 
              onClick={ctrl.fixMisalign} 
              disabled={!isMisaligned}
            >
              정위치 자동 수정
            </button>
            <p className="level-hint">
              정위치 실패 모드를 켜면 다음 목표 층에서 1~5층 사이 랜덤 위치에 정차하고 문이 열리지 않습니다.
              "정위치 자동 수정"을 누르면 가장 가까운 층으로 이동 후 정상 동작합니다.
            </p>
          </div>
        </div>

        {/* 가운데: 샤프트 (그래픽) */}
        <div className="shaft">
           <div className="shaft-scene">
             {FLOORS.map((f) => {
               const idx = floorIndexFromBottom(f)
               const bottom = idx * FLOOR_HEIGHT + FLOOR_BASE_OFFSET
               const waitingHere = visiblePassengers.filter(
                 (p) => p.status === "waiting" && p.from === f
               )

               return (
                 <div key={f} className="floor-layer" style={{ bottom: `${bottom}px` }}>
                   <div className="floor-line" />
                   <div className="floor-label-side">{f}F</div>
                   <div className="floor-waiting-side">
                     {waitingHere.map((p) => (
                       <div 
                         key={p.id} 
                         className={"passenger-dot waiting side" + (p.isJammed ? " jammed" : "")} 
                         title={`${p.from}층 → ${p.to}층 (${p.weightKg}kg)`}
                       />
                     ))}
                   </div>
                 </div>
               )
             })}

             <div className="shaft-wall" />

             {/* 엘리베이터 캐빈 */}
             <div 
                className={`elevator-car side ${doorLooksOpen ? "open" : "closed"}`}
                style={{ 
                  bottom: `${carBottom}px`, 
                  transitionDuration: `${moveDuration}ms` 
                }}
             >
                <div className="car-inner">
                  <div className={`car-door side door-${doorState}`}>
                    <div className="door-panel left" />
                    <div className="door-panel right" />
                  </div>

                  <div className="car-people-inside">
                    {onboardPassengers.map((p) => (
                      <div 
                        key={p.id} 
                        className={"passenger-dot inside" + (p.isJammed ? " jammed" : "")} 
                        title={`${p.from}층 → ${p.to}층 (${p.weightKg}kg)`}
                      />
                    ))}
                  </div>
                </div>
             </div>
           </div>
        </div>

        {/* 오른쪽: 외부 패널 */}
        <div className="panel">
           <h2>외부 호출 / 승객</h2>
           <p className="panel-subtitle">각 층에서 엘리베이터 호출 + 승객 추가</p>

           <div className="panel-buttons" style={{ marginBottom: 16 }}>
             {FLOORS.map((f) => (
               <button key={f} className="floor-btn" onClick={() => ctrl.requestFloor(f)}>
                 {f}층
               </button>
             ))}
           </div>

           <form className="passenger-form" onSubmit={handleAddPassenger}>
             <div className="field">
               <label>출발층</label>
               <select value={spawnFloor} onChange={(e) => setSpawnFloor(Number(e.target.value))}>
                 {FLOORS.slice().reverse().map((f) => (
                   <option key={f} value={f}>{f}층</option>
                 ))}
               </select>
             </div>
             <div className="field">
               <label>목적층</label>
               <select value={targetFloor} onChange={(e) => setTargetFloor(Number(e.target.value))}>
                 {FLOORS.slice().reverse().map((f) => (
                   <option key={f} value={f}>{f}층</option>
                 ))}
               </select>
             </div>
             <button type="submit" className="add-passenger-btn">승객 추가</button>
           </form>
           
           <div className="passenger-list">
             {visiblePassengers.length === 0 ? (
                <p className="passenger-empty">대기 중인 승객이 없습니다.</p>
             ) : (
                visiblePassengers.map((p) => (
                  <div key={p.id} className={"passenger-item" + (p.isJammed ? " jammed-item" : "")}>
                    <span className="passenger-route">
                      {p.from}층 → {p.to}층 {p.isJammed ? " (끼임)" : ""}
                    </span>
                    <span className="passenger-weight">{p.weightKg}kg</span>
                    <span className={`passenger-status ${p.status}`}>
                      {p.status === "waiting" ? "대기" : p.status === "onboard" ? "탑승 중" : "완료"}
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
      
      {/* 백엔드 패널 (하단) */}
      <section className="backend-panel">
        <div className="backend-inner">
          <div className="backend-header">
            <h2>백엔드 연동 · 센서 데이터 모니터링</h2>
            <p className="backend-subtitle">
              엘리베이터 상태를 백엔드와 주고받는 영역입니다.
            </p>
          </div>

          <div className="backend-grid">
            <div className="backend-card">
              <h3>실시간 센서 값 (예시)</h3>
              <table className="backend-table">
                <thead>
                  <tr>
                    <th>항목</th><th>값</th><th>단위</th><th>상태</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>현재 층</td><td>{currentFloor}</td><td>층</td><td>-</td>
                  </tr>
                  <tr>
                    {/* 실시간 위치 값 표시 */}
                    <td>카 위치</td><td>{realtimePx.toFixed(1)}</td><td>px</td>
                    <td>{isMisaligned ? "정위치 실패" : "정상"}</td>
                  </tr>
                  <tr>
                    <td>속도</td><td>{speedFloorsPerSec.toFixed(2)}</td><td>층/초</td>
                    <td>{isMoving ? "이동 중" : "정지"}</td>
                  </tr>
                  <tr>
                    <td>문 상태</td><td>{doorState}</td><td>-</td>
                    <td>{hasJammedOnboard ? "끼임 감지" : "정상"}</td>
                  </tr>
                  <tr>
                    <td>적재량</td><td>{onboardWeightKg}</td><td>kg</td>
                    <td>{isOverload ? "과부하" : "정상"}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="backend-card backend-log">
              <h3>백엔드 이벤트 / 알람 로그</h3>
              <p className="backend-log-hint">
                로그 표시 영역 예시입니다.
              </p>
              <div className="backend-log-list">
                <div className="backend-log-item">[INFO] 시스템 시작</div>
                {isMisaligned && <div className="backend-log-item">[WARN] 정위치 정차 실패 감지</div>}
                {isOverload && <div className="backend-log-item">[ALERT] 과부하 알림 (500kg 초과)</div>}
                {hasJammedOnboard && <div className="backend-log-item">[ALERT] 문 끼임 승객 감지</div>}
              </div>
            </div>
          </div>
        </div>
      </section>
      
      <footer className="dash-footer">© 2025 CPS Elevator System</footer>
    </div>
  )
}

export default Dashboard