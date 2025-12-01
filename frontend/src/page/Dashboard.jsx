// src/page/Dashboard.jsx
import { useState, useEffect, useCallback } from "react" // useCallback 추가
import "./Dashboard.css"
import { useElevatorController } from "../hooks/useElevatorController"
import { useElevatorNetwork } from "../hooks/useElevatorNetwork"

const FLOORS = [5, 4, 3, 2, 1]
const FLOOR_HEIGHT = 110
const FLOOR_BASE_OFFSET = 30

const MAX_LOAD_KG = 500
const MIN_WEIGHT_KG = 20
const MAX_WEIGHT_KG = 110

function Dashboard() {
  const [passengers, setPassengers] = useState([])
  const [spawnFloor, setSpawnFloor] = useState(1)
  const [targetFloor, setTargetFloor] = useState(5)
  const [nextPassengerId, setNextPassengerId] = useState(1)
  
  // [추가] 백엔드 명령 로그 표시용 상태
  const [lastCommand, setLastCommand] = useState(null)
  // 누적 로그 항목 (최신 항목이 앞에 오도록 관리)
  const [logEntries, setLogEntries] = useState([
    { timestamp: new Date().toISOString(), level: 'INFO', message: '시스템 시작' }
  ])

  const addLogEntry = useCallback((entry) => {
    setLogEntries(prev => {
      // 중복 연속 항목 처리: 최신 항목과 level+message가 같으면 카운트 증가
      const latest = prev[0]
      if (latest && latest.level === entry.level && latest.message === entry.message) {
        const updated = [{ ...latest, timestamp: entry.timestamp, count: (latest.count || 1) + 1 }, ...prev.slice(1)]
        return updated.slice(0, 200)
      }

      const next = [{ ...entry, count: 1 }, ...prev]
      // 최대 200개까지만 보관
      return next.slice(0, 200)
    })
  }, [])

  const visiblePassengers = passengers.filter((p) => p.status !== "done")
  const onboardPassengers = passengers.filter((p) => p.status === "onboard")
  
  const onboardCount = onboardPassengers.length
  const onboardWeightKg = onboardPassengers.reduce((sum, p) => sum + (p.weightKg ?? 0), 0)
  const isOverload = onboardWeightKg > MAX_LOAD_KG
  const hasJammedOnboard = onboardPassengers.some((p) => p.isJammed)

  // 1. 컨트롤러 사용
  const ctrl = useElevatorController({
    isOverload,
    hasJammedOnboard,
  })

  // ▼▼▼ [추가] 백엔드 명령 처리 핸들러 ▼▼▼
  const handleBackendCommand = useCallback((command) => {
    // 로그에 표시 (메시지 본문에 레벨 태그를 포함하지 않음)
    const msg = `${command.type}: ${command.message || ''}`;
    setLastCommand(msg);
    addLogEntry({ timestamp: new Date().toISOString(), level: 'CMD', message: msg })

    switch (command.type) {
      case "FIX_ALIGNMENT": // 백엔드에서 이 타입을 보내면 실행
        if (ctrl.isMisaligned) {
            ctrl.fixMisalign();
        } else {
            console.log("이미 정위치 상태입니다.");
        }
        break;
      
      case "EMERGENCY_STOP":
        // 추후 구현 가능 (모터 정지 등)
        alert("관제 센터로부터 비상 정지 명령 수신!");
        break;

      default:
        console.log("Unknown command:", command);
    }
  }, [ctrl, addLogEntry]); 
  // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

  // 2. 네트워크 훅 연결 (상태 전송 + 명령 수신 핸들러 전달)
  const elevatorState = {
    currentFloor: ctrl.currentFloor,
    realtimeFloor: ctrl.realtimeFloor,
    speedFloorsPerSec: ctrl.speedFloorsPerSec,
    doorState: ctrl.doorState,
    direction: ctrl.direction,
    isOverload,
    hasJammedOnboard,
  }
  
  // handleBackendCommand를 두 번째 인자로 전달!
  const { isConnected } = useElevatorNetwork(elevatorState, handleBackendCommand)

  const { 
    currentFloor, carFloor, realtimeFloor, queue, direction, doorState, 
    moveDuration, speedFloorsPerSec, isMisaligned, isMoving 
  } = ctrl

  const doorLooksOpen = doorState === "open" || doorState === "opening"

  // 헬퍼 계산
  const floorIndexFromBottom = (f) => f - 1
  const currentIndex = floorIndexFromBottom(carFloor)
  const carBottom = Math.max(0, currentIndex * FLOOR_HEIGHT + FLOOR_BASE_OFFSET + 10)
  const realtimeIndex = floorIndexFromBottom(realtimeFloor)
  const realtimePx = Math.max(0, realtimeIndex * FLOOR_HEIGHT + FLOOR_BASE_OFFSET + 10)
  const displayFloor = Math.round(realtimeFloor)

  // 이벤트 핸들러들
  const handleAddPassenger = (e) => {
    e.preventDefault()
    if (spawnFloor === targetFloor) return alert("출발/목적층이 같습니다.")

    const weightKg = Math.floor(Math.random() * (MAX_WEIGHT_KG - MIN_WEIGHT_KG + 1)) + MIN_WEIGHT_KG
    const newPassenger = {
      id: nextPassengerId, from: spawnFloor, to: targetFloor, status: "waiting", weightKg, isJammed: false,
    }

    setPassengers((prev) => [...prev, newPassenger])
    setNextPassengerId((id) => id + 1)
    
    if (spawnFloor === currentFloor && doorState === "closed" && !isMoving) {
       ctrl.openDoor() 
    } else {
       ctrl.requestFloor(spawnFloor)
    }
  }

  const handleAddJammedPassenger = () => {
    const from = currentFloor
    const to = from === 5 ? 1 : 5
    const weightKg = Math.floor(Math.random() * (MAX_WEIGHT_KG - MIN_WEIGHT_KG + 1)) + MIN_WEIGHT_KG
    const newPassenger = {
      id: nextPassengerId, from, to, status: "waiting", weightKg, isJammed: true,
    }
    setPassengers((prev) => [...prev, newPassenger])
    setNextPassengerId((id) => id + 1)

    if (from === currentFloor && doorState === "closed" && !isMoving) {
        ctrl.openDoor()
    } else {
        ctrl.requestFloor(from)
    }
  }

  const handleUnloadPassenger = (id) => {
    if (!doorLooksOpen) return alert("문이 열린 상태에서만 승객이 내릴 수 있습니다.")
    const passengerToUnload = passengers.find((p) => p.id === id)
    if (!passengerToUnload || passengerToUnload.status !== "onboard") return

    setPassengers((prev) =>
      prev.map((p) => p.id === id && p.status === "onboard" ? { ...p, status: "done", to: currentFloor } : p)
    )

    const destFloor = passengerToUnload.to
    const isStillNeeded = passengers.some(p => {
       if (p.id === id || p.status === "done") return false 
       if (p.status === "onboard" && p.to === destFloor) return true
       if (p.status === "waiting" && p.from === destFloor) return true
       return false
    })

    if (!isStillNeeded) ctrl.removeRequest(destFloor)
  }

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
      boardingTargets.forEach(floor => ctrl.requestFloor(floor))
      return updated
    })
  }, [doorState, currentFloor, ctrl])

  // 상태 변화 시 로그 추가 (중복 방지를 위해 true로 변할 때만 누적)
  useEffect(() => {
    if (isMisaligned) {
      addLogEntry({ timestamp: new Date().toISOString(), level: 'WARN', message: '정위치 정차 실패 감지' })
    }
  }, [isMisaligned])

  useEffect(() => {
    if (isOverload) {
      addLogEntry({ timestamp: new Date().toISOString(), level: 'ALERT', message: '과부하 알림 (500kg 초과)' })
    }
  }, [isOverload])

  useEffect(() => {
    if (hasJammedOnboard) {
      addLogEntry({ timestamp: new Date().toISOString(), level: 'ALERT', message: '문 끼임 승객 감지' })
    }
  }, [hasJammedOnboard])

  const statusLabel = direction === "idle" ? "대기" : direction === "up" ? "상행" : "하행"
  const statusColor = direction === "idle" ? "#6b7280" : direction === "up" ? "#2563eb" : "#dc2626"

  return (
    <div className="Dashboard">
      <header className="dash-header">
        <div className="dash-header-main">
          <div>
            <h1>CPS Elevator Simulator</h1>
            <p style={{fontSize: "0.8rem", color: isConnected ? "green" : "red", marginTop: "-8px", marginBottom: "8px"}}>
               {isConnected ? "● Online" : "○ Offline"}
            </p>
            <p>
              현재 층: <b>{displayFloor}</b> <span style={{ color: statusColor }}>({statusLabel})</span>
            </p>
            <p className="queue-info">대기 큐: {queue.length === 0 ? "없음" : queue.join(" → ")}</p>
            <p className="capacity-info">
              정격 적재 {MAX_LOAD_KG}kg · <span className={`capacity-count ${isOverload ? "full" : ""}`}>현재 {onboardCount}명 / {onboardWeightKg}kg</span>
            </p>
            <p className="speed-info">속도: {speedFloorsPerSec.toFixed(2)} 층/초</p>
          </div>
          <div className="door-controls">
            <div className="door-indicator">
              <span className={`door-indicator-dot ${doorLooksOpen ? "open" : "closed"}`} />
              <span className="door-indicator-label">
                {doorState === "opening" ? "열리는 중" : doorState === "closing" ? "닫히는 중" : doorLooksOpen ? "열림" : "닫힘"}
              </span>
            </div>
            <div className="door-buttons">
              <button className="door-btn open" onClick={ctrl.openDoor} disabled={doorState === "open" || doorState === "opening" || isMoving}>열림</button>
              <button className="door-btn close" onClick={ctrl.closeDoor} disabled={doorState === "closed" || doorState === "closing"}>닫힘</button>
            </div>
          </div>
        </div>
      </header>

      <div className="dash-layout">
        <div className="panel">
          <h2>내부 패널</h2>
          <p className="panel-subtitle">엘리베이터 안에서 층 선택</p>
          <div className="panel-buttons">
            {FLOORS.slice().reverse().map((f) => (
              <button key={f} className="floor-btn inside" onClick={() => ctrl.requestFloor(f)}>{f}</button>
            ))}
          </div>
          <div className="jam-section">
            <h3>끼임 승객 테스트</h3>
            <button className="jam-btn" onClick={handleAddJammedPassenger}>끼임 승객 생성 (현재 층)</button>
            <p className="jam-hint">빨간 승객이 탑승 중이면 문이 닫히지 않고 "닫히는 중" 상태로 유지됩니다.</p>
          </div>
          <div className="level-section">
            <h3>정위치 정차 실패 테스트</h3>
            <button className="level-error-btn" onClick={() => ctrl.setMisalignMode(true)}>다음 정차 시 정위치 실패 발생</button>
            <button className="level-fix-btn" onClick={ctrl.fixMisalign} disabled={!isMisaligned}>정위치 자동 수정</button>
            <p className="level-hint">정위치 실패 모드를 켜면 1~5층 랜덤 위치에 정차하고 문이 열리지 않습니다. "자동 수정"으로 해결하세요.</p>
          </div>
        </div>

        <div className="shaft">
           <div className="shaft-scene">
             {FLOORS.map((f) => {
               const idx = floorIndexFromBottom(f)
               const bottom = idx * FLOOR_HEIGHT + FLOOR_BASE_OFFSET
               const waitingHere = visiblePassengers.filter(p => p.status === "waiting" && p.from === f)
               return (
                 <div key={f} className="floor-layer" style={{ bottom: `${bottom}px` }}>
                   <div className="floor-line" />
                   <div className="floor-label-side">{f}F</div>
                   <div className="floor-waiting-side">
                     {waitingHere.map(p => (
                       <div key={p.id} className={"passenger-dot waiting side" + (p.isJammed ? " jammed" : "")} />
                     ))}
                   </div>
                 </div>
               )
             })}
             <div className="shaft-wall" />
             <div className={`elevator-car side ${doorLooksOpen ? "open" : "closed"}`} style={{ bottom: `${carBottom}px`, transitionDuration: `${moveDuration}ms` }}>
                <div className="car-inner">
                  <div className={`car-door side door-${doorState}`}>
                    <div className="door-panel left" /><div className="door-panel right" />
                  </div>
                  <div className="car-people-inside">
                    {onboardPassengers.map(p => (
                      <div key={p.id} className={"passenger-dot inside" + (p.isJammed ? " jammed" : "")} />
                    ))}
                  </div>
                </div>
             </div>
           </div>
        </div>

        <div className="panel">
           <h2>외부 호출 / 승객</h2>
           <p className="panel-subtitle">각 층에서 엘리베이터 호출 + 승객 추가</p>
           <div className="panel-buttons" style={{ marginBottom: 16 }}>
             {FLOORS.map(f => <button key={f} className="floor-btn" onClick={() => ctrl.requestFloor(f)}>{f}층</button>)}
           </div>
           <form className="passenger-form" onSubmit={handleAddPassenger}>
             <div className="field">
               <label>출발층</label>
               <select value={spawnFloor} onChange={e => setSpawnFloor(Number(e.target.value))}>
                 {FLOORS.slice().reverse().map(f => <option key={f} value={f}>{f}층</option>)}
               </select>
             </div>
             <div className="field">
               <label>목적층</label>
               <select value={targetFloor} onChange={e => setTargetFloor(Number(e.target.value))}>
                 {FLOORS.slice().reverse().map(f => <option key={f} value={f}>{f}층</option>)}
               </select>
             </div>
             <button type="submit" className="add-passenger-btn">승객 추가</button>
           </form>
           <div className="passenger-list">
             {visiblePassengers.length === 0 ? <p className="passenger-empty">대기 중인 승객이 없습니다.</p> : visiblePassengers.map(p => (
                <div key={p.id} className={"passenger-item" + (p.isJammed ? " jammed-item" : "")}>
                  <span className="passenger-route">{p.from}층 → {p.to}층 {p.isJammed ? "(끼임)" : ""}</span>
                  <span className="passenger-weight">{p.weightKg}kg</span>
                  <span className={`passenger-status ${p.status}`}>{p.status === "waiting" ? "대기" : p.status === "onboard" ? "탑승 중" : "완료"}</span>
                  {p.status === "onboard" && <button className="unload-btn" onClick={() => handleUnloadPassenger(p.id)} disabled={!doorLooksOpen}>내리기</button>}
                </div>
             ))}
           </div>
        </div>
      </div>
      
      <section className="backend-panel">
        <div className="backend-inner">
          <div className="backend-header">
            <h2>백엔드 연동 · 센서 데이터 모니터링</h2>
            <p className="backend-subtitle">엘리베이터 상태를 백엔드와 주고받는 영역입니다.</p>
          </div>
          <div className="backend-grid">
            <div className="backend-card">
              <h3>실시간 센서 값</h3>
              <table className="backend-table">
                <thead><tr><th>항목</th><th>값</th><th>단위</th><th>상태</th></tr></thead>
                <tbody>
                  <tr><td>현재 층</td><td>{displayFloor}</td><td>층</td><td>-</td></tr>
                  <tr><td>카 위치</td><td>{realtimePx.toFixed(1)}</td><td>px</td><td>{isMisaligned ? "정위치 실패" : "정상"}</td></tr>
                  <tr><td>속도</td><td>{speedFloorsPerSec.toFixed(2)}</td><td>층/초</td><td>{isMoving ? "이동 중" : "정지"}</td></tr>
                  <tr><td>문 상태</td><td>{doorState}</td><td>-</td><td>{hasJammedOnboard ? "끼임 감지" : "정상"}</td></tr>
                  <tr><td>적재량</td><td>{onboardWeightKg}</td><td>kg</td><td>{isOverload ? "과부하" : "정상"}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="backend-card backend-log">
              <h3>백엔드 이벤트 / 알람 로그</h3>
              <p className="backend-log-hint">로그 표시 영역</p>
              <div className="backend-log-list">
                {logEntries.length === 0 ? (
                  <div className="backend-log-item">[INFO] 로그가 없습니다</div>
                ) : (
                  logEntries.map((entry) => {
                    const color = entry.level === 'ALERT' ? '#dc2626' : entry.level === 'WARN' ? '#f59e0b' : entry.level === 'CMD' ? '#3b82f6' : undefined
                    return (
                      <div key={entry.timestamp + entry.message} className="backend-log-item" style={{ color }}>
                        [{new Date(entry.timestamp).toLocaleTimeString()}] [{entry.level}] {entry.message}
                        {entry.count && entry.count > 1 ? ` (×${entry.count})` : ''}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </div>
        {/* [오른쪽] 위험 판단 행렬 (Risk Assessment Matrix) */}
            <div className="backend-card">
              <h3>🛡️ 자율 제어 위험 판단 행렬</h3>
              
              {/* 행렬 계산 로직 */}
              {(() => {
                // 1. 위험 요소 벡터 생성 (조건이 맞으면 1, 아니면 0)
                // 개문발차(OpenMove): 문이 열려있는데(open/opening) 속도가 0.1 이상인 경우
                const isOpenMoving = (doorState.includes("open") && Math.abs(speedFloorsPerSec) > 0.1);

                const riskVector = [
                  { id: "MISALIGN", label: "정위치오차", value: isMisaligned ? 1 : 0 },
                  { id: "OVERLOAD", label: "과부하",    value: isOverload ? 1 : 0 },
                  { id: "JAMMING",  label: "문 끼임",   value: hasJammedOnboard ? 1 : 0 },
                  { id: "OPENMOVE", label: "개문발차",  value: isOpenMoving ? 1 : 0 },
                ];

                // 2. 위험 점수 합산 (Sigma)
                const totalScore = riskVector.reduce((acc, curr) => acc + curr.value, 0);

                // 3. 최종 판정 로직
                let statusLevel = "NORMAL";
                let statusText = "정상 운행 (Normal)";
                
                if (totalScore >= 2) {
                  statusLevel = "CRITICAL";
                  statusText = "🚨 비상 정지 (Emergency Stop)";
                } else if (totalScore === 1) {
                  statusLevel = "WARNING";
                  statusText = "⚠️ 주의/감속 (Warning)";
                }

                return (
                  <div className="matrix-container">
                    {/* 상단: 입력 벡터 (0 / 1 표시) */}
                    <div className="matrix-row inputs">
                      {riskVector.map((item) => (
                        <div key={item.id} className={`matrix-cell ${item.value === 1 ? "active" : ""}`}>
                          <span className="matrix-label">{item.label}</span>
                          <span className="matrix-bit">{item.value}</span>
                        </div>
                      ))}
                    </div>

                    {/* 연결 연산자 (화살표 or 수식 느낌) */}
                    <div className="matrix-operator">
                      <span>∑ (Sum) = {totalScore}</span>
                      <span className="arrow">⬇</span>
                    </div>

                    {/* 하단: 최종 판정 결과 */}
                    <div className={`matrix-result ${statusLevel}`}>
                      <div className="result-title">System Decision</div>
                      <div className="result-value">{statusText}</div>
                    </div>
                  </div>
                );
              })()}
            </div>
      </section>
      
      <footer className="dash-footer">© 2025 CPS Elevator System</footer>
    </div>
  )
}

export default Dashboard