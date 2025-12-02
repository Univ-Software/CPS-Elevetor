// src/page/Dashboard.jsx
import { useState, useEffect, useCallback, useRef } from "react" 
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
  
  // 백엔드 로그
  const [lastCommand, setLastCommand] = useState(null)
  const [logEntries, setLogEntries] = useState([
    { timestamp: new Date().toISOString(), level: 'INFO', message: '시스템 시작' }
  ])

  // [추가] 정위치 오차 지속 시간 (ms)
  const [misalignWaitTime, setMisalignWaitTime] = useState(0);
  const misalignStartRef = useRef(null);

  const addLogEntry = useCallback((entry) => {
    setLogEntries(prev => {
      const next = [entry, ...prev]
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

  // 백엔드 명령 처리
  const handleBackendCommand = useCallback((command) => {
    const msg = `[CMD] ${command.type}: ${command.message || ''}`;
    setLastCommand(msg);
    addLogEntry({ timestamp: new Date().toISOString(), level: 'CMD', message: msg })

    switch (command.type) {
      case "FIX_ALIGNMENT":
        if (ctrl.isMisaligned) {
            ctrl.fixMisalign();
        } else {
            console.log("이미 정위치 상태입니다.");
        }
        break;
      
      case "EMERGENCY_STOP":
        alert("관제 센터로부터 비상 정지 명령 수신!");
        break;

      default:
        console.log("Unknown command:", command);
    }
  }, [ctrl, addLogEntry]); 

  // 2. 네트워크 연결
  const elevatorState = {
    currentFloor: ctrl.currentFloor,
    realtimeFloor: ctrl.realtimeFloor,
    speedFloorsPerSec: ctrl.speedFloorsPerSec,
    doorState: ctrl.doorState,
    direction: ctrl.direction,
    isOverload,
    hasJammedOnboard,
  }
  
  const { isConnected } = useElevatorNetwork(elevatorState, handleBackendCommand)

  const { 
    currentFloor, carFloor, realtimeFloor, queue, direction, doorState, 
    moveDuration, speedFloorsPerSec, isMisaligned, isMoving 
  } = ctrl

  const doorLooksOpen = doorState === "open" || doorState === "opening"

  // 3. 화면 계산
  const floorIndexFromBottom = (f) => f - 1
  const currentIndex = floorIndexFromBottom(carFloor)
  const carBottom = Math.max(0, currentIndex * FLOOR_HEIGHT + FLOOR_BASE_OFFSET + 10)
  
  const realtimeIndex = floorIndexFromBottom(realtimeFloor)
  const realtimePx = Math.max(0, realtimeIndex * FLOOR_HEIGHT + FLOOR_BASE_OFFSET + 10)
  const displayFloor = Math.round(realtimeFloor)

  // ----------------------------------------------------------------
  // [NEW] 정위치 오차 시간 측정 로직 (2초 딜레이용)
  // ----------------------------------------------------------------
  useEffect(() => {
    // 1. 차량이 멈췄는가? (속도 0)
    const isStopped = Math.abs(speedFloorsPerSec) <= 0.01;
    // 2. 위치가 틀렸는가? (소수점 오차 0.1 이상)
    const dist = Math.abs(realtimeFloor - Math.round(realtimeFloor));
    const isPosError = dist > 0.1;

    if (isStopped && isPosError) {
        if (misalignStartRef.current === null) {
            misalignStartRef.current = Date.now(); // 타이머 시작
        } else {
            // 경과 시간 업데이트
            setMisalignWaitTime(Date.now() - misalignStartRef.current);
        }
    } else {
        // 정상이거나 이동 중이면 타이머 리셋
        misalignStartRef.current = null;
        setMisalignWaitTime(0);
    }
  }, [speedFloorsPerSec, realtimeFloor]);


  // 4. 이벤트 핸들러
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

  // 문 열림 시 탑승/하차
  useEffect(() => {
    if (doorState !== "open" || isMisaligned) return // 정위치 실패 시 탑승 차단

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
  }, [doorState, currentFloor, ctrl, isMisaligned])

  // 로그 자동 추가
  // 정위치 실패는 2초 지난 뒤에 로그 찍히게 수정 (불필요한 로그 방지)
  useEffect(() => {
    if (isMisaligned && misalignWaitTime > 2000) {
      addLogEntry({ timestamp: new Date().toISOString(), level: 'WARN', message: '[WARN] 정위치 정차 실패 (2초 경과)' })
    }
  }, [isMisaligned, misalignWaitTime, addLogEntry])

  useEffect(() => {
    if (isOverload) {
      addLogEntry({ timestamp: new Date().toISOString(), level: 'ALERT', message: '[ALERT] 과부하 알림 (500kg 초과)' })
    }
  }, [isOverload, addLogEntry])

  useEffect(() => {
    if (hasJammedOnboard) {
      addLogEntry({ timestamp: new Date().toISOString(), level: 'ALERT', message: '[ALERT] 문 끼임 승객 감지' })
    }
  }, [hasJammedOnboard, addLogEntry])

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
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="backend-card" style={{marginTop: "24px"}}>
              <h3>🛡️ 자율 제어 센서 분석 행렬</h3>
              
              {(() => {
                // --- [1] 센서 데이터 (Input) ---
                const s_DoorObj   = hasJammedOnboard ? 1 : 0; 
                const s_Overload  = isOverload ? 1 : 0;       
                // 위치 오차: 정수 층에서 0.1 이상 벗어남 (실시간)
                const isPosError  = Math.abs(realtimeFloor - Math.round(realtimeFloor)) > 0.1 ? 1 : 0;
                
                // 모터 구동 여부 (속도가 0.01 이상이면 1)
                const isMotorRun  = (Math.abs(speedFloorsPerSec) > 0.01 || direction !== "idle") ? 1 : 0;
                
                // 문 닫힘 시도 (문이 닫혀있거나 닫는 중)
                const s_DoorClose = (doorState === "closing" || doorState === "closed") ? 1 : 0;

                // ★핵심 변경★ 2초 대기 후 여부 (2000ms 넘으면 1)
                const isWaitOver = misalignWaitTime > 2000 ? 1 : 0;

                // --- [2] 안전 로직 (Logic) ---
                const matrixRows = [
                  { 
                    id: "JAM", 
                    name: "1. 승객 끼임 사고", 
                    desc: "물체 감지 + 문 닫힘 시도",
                    bits: [s_DoorObj, 0, 0, 0, s_DoorClose], 
                    fault: s_DoorObj && s_DoorClose 
                  },
                  { 
                    id: "OVL", 
                    name: "2. 과부하 운행", 
                    desc: "과부하 + 모터 구동",
                    bits: [0, s_Overload, 0, isMotorRun, 0], 
                    fault: s_Overload 
                  },
                  { 
                    id: "LVL", 
                    name: "3. 정위치 이탈", 
                    desc: "위치오차 + 정지(2초 경과)", // 설명 업데이트
                    // [ 물체감지, 과부하, 위치오차, 정지(2s), 닫힘시도 ]
                    // 위치오차(1) AND 정지후2초(1) 이면 위험!
                    bits: [0, 0, isPosError, isWaitOver, 0], 
                    fault: isPosError && isWaitOver
                  },
                ];

                // 컬럼 헤더 수정: 4번째를 '구동/정지' -> '구동/대기' 등으로 의미 확장
                const sensors = ["물체감지", "과부하", "위치오차", "구동/대기", "닫힘시도"];

                const isSystemFault = matrixRows.some(r => r.fault);

                return (
                  <div className="matrix-wrapper">
                    <table className="sensor-matrix">
                      <thead>
                        <tr>
                          <th className="matrix-corner">SCENARIO</th>
                          {sensors.map((s, i) => <th key={i}>{s}</th>)}
                          <th className="matrix-result-header">STATUS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {matrixRows.map((row) => (
                          <tr key={row.id} className={row.fault ? "row-alert" : ""}>
                            <td className="scenario-name" title={row.desc}>
                              {row.name}
                              <div style={{fontSize:'0.65rem', fontWeight:'normal', opacity:0.7}}>
                                {row.desc}
                              </div>
                            </td>
                            {row.bits.map((bit, i) => {
                              const isRelevant = 
                                (row.id === "JAM" && (i===0 || i===4)) ||
                                (row.id === "OVL" && (i===1 || i===3)) ||
                                (row.id === "LVL" && (i===2 || i===3));
                              
                              return (
                                <td key={i} className={`bit-cell ${bit === 1 ? "on" : "off"} ${!isRelevant && bit===0 ? "dim" : ""}`}>
                                  {isRelevant || bit === 1 ? bit : <span style={{opacity:0.1}}>0</span>}
                                </td>
                              )
                            })}
                            <td className="scenario-result">
                              {row.fault ? "🚨 DANGER" : "✅ SAFE"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div className="system-summary">
                      System Diagnosis: 
                      {isSystemFault 
                        ? <span className="crit"> 🛑 OPERATION HALTED</span> 
                        : <span className="norm"> 🟢 SYSTEM NORMAL</span>
                      }
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