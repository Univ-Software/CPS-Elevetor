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

// -------------------- 헬퍼: 혼동행렬 업데이트 --------------------
function updateConfusion(conf, real, sensor) {
  const next = { ...conf }
  if (real && sensor) next.TP += 1
  else if (!real && sensor) next.FP += 1
  else if (real && !sensor) next.FN += 1
  else next.TN += 1
  return next
}

function computeMetrics(conf) {
  const { TP, FP, FN, TN } = conf
  const prec = TP + FP > 0 ? TP / (TP + FP) : null
  const rec  = TP + FN > 0 ? TP / (TP + FN) : null
  return { precision: prec, recall: rec, TP, FP, FN, TN }
}

function formatPct(v) {
  if (v === null) return "-"
  return (v * 100).toFixed(1) + "%"
}

function Dashboard() {
  const [passengers, setPassengers] = useState([])
  const [spawnFloor, setSpawnFloor] = useState(1)
  const [targetFloor, setTargetFloor] = useState(5)
  const [nextPassengerId, setNextPassengerId] = useState(1)
  
  // 에러 주입 모드: NONE | FP1~3 | FN1~3
  const [errorInjectionMode, setErrorInjectionMode] = useState("NONE")

  // 🔸 자율제어 모드 (ON/OFF)
  const [autoMode, setAutoMode] = useState(true)

  // 로그 상태
  const [lastCommand, setLastCommand] = useState(null)
  const [logEntries, setLogEntries] = useState([
    { timestamp: new Date().toISOString(), level: 'INFO', message: '시스템 시작 - 모니터링 대기 중' }
  ])

  // 정위치 오차 시간 측정
  const [misalignWaitTime, setMisalignWaitTime] = useState(0)
  const misalignStartRef = useRef(null)
  const misalignLoggedRef = useRef(false)

  const addLogEntry = useCallback((entry) => {
    setLogEntries(prev => [entry, ...prev].slice(0, 200))
  }, [])

  // 물리적 상태 계산
  const visiblePassengers = passengers.filter((p) => p.status !== "done")
  const onboardPassengers = passengers.filter((p) => p.status === "onboard")
  const onboardCount = onboardPassengers.length
  const onboardWeightKg = onboardPassengers.reduce((sum, p) => sum + (p.weightKg ?? 0), 0)
  
  const real_Overload = onboardWeightKg > MAX_LOAD_KG
  const real_Jammed = onboardPassengers.some((p) => p.isJammed)
  
  // 내부 동기화용 state
  const [lastIsMisaligned, setLastIsMisaligned] = useState(false)

  // --- 센서 레이어 (오염 로직) ---
  let sensor_Overload = real_Overload
  let sensor_Jammed = real_Jammed
  let sensor_Misaligned = lastIsMisaligned

  // FP/FN 1,2,3 시나리오 매핑 (사용자에게는 어떤 센서인지 숨김)
  if (errorInjectionMode.startsWith("FP")) {
    if (errorInjectionMode === "FP1") {
      // 예: JAM 센서만 오탐
      if (!real_Jammed) sensor_Jammed = true
    } else if (errorInjectionMode === "FP2") {
      // 예: OVERLOAD 센서만 오탐
      if (!real_Overload) sensor_Overload = true
    } else if (errorInjectionMode === "FP3") {
      // 예: MISALIGN 센서만 오탐
      if (!lastIsMisaligned) sensor_Misaligned = true 
    }
  } else if (errorInjectionMode.startsWith("FN")) {
    if (errorInjectionMode === "FN1") {
      // 예: JAM 센서만 미탐
      if (real_Jammed) sensor_Jammed = false 
    } else if (errorInjectionMode === "FN2") {
      // 예: OVERLOAD 센서만 미탐
      if (real_Overload) sensor_Overload = false
    } else if (errorInjectionMode === "FN3") {
      // 예: MISALIGN 센서만 미탐
      if (lastIsMisaligned) sensor_Misaligned = false
    }
  }

  // --- 컨트롤러 연결 ---
  const ctrl = useElevatorController({
    isOverload:        sensor_Overload,
    hasJammedOnboard:  sensor_Jammed,
    isMisalignedSensor: sensor_Misaligned, 
  })

  // 동기화
  useEffect(() => {
    if (ctrl.isMisaligned !== lastIsMisaligned) {
      setLastIsMisaligned(ctrl.isMisaligned)
    }
  }, [ctrl.isMisaligned, lastIsMisaligned])

  // -------------------- 센서 성능 통계 (TP/FP/FN/TN) --------------------
  const [perfStats, setPerfStats] = useState({
    jam:      { TP: 0, FP: 0, FN: 0, TN: 0 },
    overload: { TP: 0, FP: 0, FN: 0, TN: 0 },
    misalign: { TP: 0, FP: 0, FN: 0, TN: 0 },
  })

  // 이전 (real, sensor) 상태 저장해서 변화 있을 때만 카운트
  const prevTruthRef = useRef({
    jamReal: null,
    jamSensor: null,
    ovReal: null,
    ovSensor: null,
    misReal: null,
    misSensor: null,
  })

  useEffect(() => {
    const prev = prevTruthRef.current
    const jamReal   = real_Jammed
    const jamSensor = sensor_Jammed
    const ovReal    = real_Overload
    const ovSensor  = sensor_Overload
    const misReal   = lastIsMisaligned
    const misSensor = sensor_Misaligned

    setPerfStats(prevStats => {
      let changed = false
      let nextStats = { ...prevStats }

      // JAM
      if (prev.jamReal !== jamReal || prev.jamSensor !== jamSensor) {
        nextStats = {
          ...nextStats,
          jam: updateConfusion(prevStats.jam, jamReal, jamSensor),
        }
        prev.jamReal = jamReal
        prev.jamSensor = jamSensor
        changed = true
      }

      // OVERLOAD
      if (prev.ovReal !== ovReal || prev.ovSensor !== ovSensor) {
        nextStats = {
          ...nextStats,
          overload: updateConfusion(prevStats.overload, ovReal, ovSensor),
        }
        prev.ovReal = ovReal
        prev.ovSensor = ovSensor
        changed = true
      }

      // MISALIGN
      if (prev.misReal !== misReal || prev.misSensor !== misSensor) {
        nextStats = {
          ...nextStats,
          misalign: updateConfusion(prevStats.misalign, misReal, misSensor),
        }
        prev.misReal = misReal
        prev.misSensor = misSensor
        changed = true
      }

      return changed ? nextStats : prevStats
    })
  }, [
    real_Jammed, sensor_Jammed,
    real_Overload, sensor_Overload,
    lastIsMisaligned, sensor_Misaligned
  ])

  const jamMetrics      = computeMetrics(perfStats.jam)
  const ovMetrics       = computeMetrics(perfStats.overload)
  const misalignMetrics = computeMetrics(perfStats.misalign)

  // =================================================================================
  // [핵심] 백엔드 자율제어 명령 처리 핸들러 (Backend Command Handler)
  // =================================================================================
  const handleBackendCommand = useCallback((command) => {
    const msg = ` ${command.type}: ${command.message || ''}`
    setLastCommand(msg)
    addLogEntry({
      timestamp: new Date().toISOString(),
      level: 'CMD',
      message: (autoMode ? "[AUTO] " : "[MANUAL] ") + msg
    })

    // autoMode 값은 "백엔드의 판단 방식 선택" 용도로만 사용되고,
    // 여기서는 수신된 명령을 항상 수행합니다.
    switch (command.type) {
      case "FIX_ALIGNMENT":
        if (ctrl.isMisaligned) {
          console.log("백엔드 명령: 정위치 수정 실행")
          ctrl.fixMisalign()
          alert(`[자율제어 알림]\n\n${command.message}\n(정위치 자동 수정을 시작합니다.)`)
        } else {
          console.log("이미 정위치 상태입니다 (명령 무시)")
        }
        break
      
      case "FORCE_OPEN":
        console.log("백엔드 명령: 문 강제 개방")
        if (ctrl.doorState !== 'open') {
          ctrl.openDoor() 
        }
        alert(`[비상 알림]\n\n${command.message}\n(안전을 위해 문을 개방합니다.)`)
        break

      case "OVERLOAD_WARN":
        console.log("백엔드 명령: 과부하 경고")
        alert(`[경고]\n\n${command.message}\n(최대 하중 500kg을 초과했습니다.)`)
        break

      case "EMERGENCY_STOP":
        alert(`[비상 정지]\n\n관제 센터로부터 비상 정지 명령이 수신되었습니다.`)
        // 필요 시 ctrl.emergencyStop() 추가
        break

      default:
        console.warn("Unknown command received:", command)
    }
  }, [ctrl, addLogEntry, autoMode]) 
  // =================================================================================

  // --- 네트워크 연결 ---
  const elevatorState = {
    currentFloor:      ctrl.currentFloor,
    realtimeFloor:     ctrl.realtimeFloor,
    speedFloorsPerSec: ctrl.speedFloorsPerSec,
    doorState:         ctrl.doorState,
    direction:         ctrl.direction,
    isOverload:        sensor_Overload,
    hasJammedOnboard:  sensor_Jammed,
    autonomousMode:    autoMode,   // 🔸 백엔드로 자율제어 모드 전달
  }
  const { isConnected } = useElevatorNetwork(elevatorState, handleBackendCommand)

  const { 
    currentFloor, carFloor, realtimeFloor, queue, direction, doorState, 
    moveDuration, speedFloorsPerSec, isMisaligned, isMoving 
  } = ctrl
  const doorLooksOpen = doorState === "open" || doorState === "opening"

  const floorIndexFromBottom = (f) => f - 1
  const currentIndex = floorIndexFromBottom(carFloor)
  const carBottom = Math.max(0, currentIndex * FLOOR_HEIGHT + FLOOR_BASE_OFFSET + 10)
  const realtimeIndex = floorIndexFromBottom(realtimeFloor)
  const realtimePx = Math.max(0, realtimeIndex * FLOOR_HEIGHT + FLOOR_BASE_OFFSET + 10)
  const displayFloor = Math.round(realtimeFloor)

  // 정위치 시간 측정
  useEffect(() => {
    const isStopped = Math.abs(speedFloorsPerSec) <= 0.01
    const dist = Math.abs(realtimeFloor - Math.round(realtimeFloor))
    const isPosError = dist > 0.1

    let intervalId
    if (isStopped && isPosError) {
      if (misalignStartRef.current === null) misalignStartRef.current = Date.now()
      intervalId = setInterval(() => {
        if (misalignStartRef.current) setMisalignWaitTime(Date.now() - misalignStartRef.current)
      }, 100)
    } else {
      misalignStartRef.current = null
      setMisalignWaitTime(0)
      misalignLoggedRef.current = false
    }
    return () => { if (intervalId) clearInterval(intervalId) }
  }, [speedFloorsPerSec, realtimeFloor])

  // 이벤트 핸들러들...
  const handleAddPassenger = (e) => {
    e.preventDefault()
    if (spawnFloor === targetFloor) return alert("출발/목적층이 같습니다.")
    const weightKg = Math.floor(Math.random() * (MAX_WEIGHT_KG - MIN_WEIGHT_KG + 1)) + MIN_WEIGHT_KG
    const newPassenger = {
      id: nextPassengerId,
      from: spawnFloor,
      to: targetFloor,
      status: "waiting",
      weightKg,
      isJammed: false
    }
    setPassengers((prev) => [...prev, newPassenger])
    setNextPassengerId((id) => id + 1)
    if (spawnFloor === currentFloor && doorState === "closed" && !isMoving) ctrl.openDoor() 
    else ctrl.requestFloor(spawnFloor)
  }

  const handleAddJammedPassenger = () => {
    const from = currentFloor
    const to = from === 5 ? 1 : 5
    const weightKg = Math.floor(Math.random() * (MAX_WEIGHT_KG - MIN_WEIGHT_KG + 1)) + MIN_WEIGHT_KG
    const newPassenger = { id: nextPassengerId, from, to, status: "waiting", weightKg, isJammed: true }
    setPassengers((prev) => [...prev, newPassenger])
    setNextPassengerId((id) => id + 1)
    if (from === currentFloor && doorState === "closed" && !isMoving) ctrl.openDoor()
    else ctrl.requestFloor(from)
  }

  const handleUnloadPassenger = (id) => {
    if (!doorLooksOpen) return alert("문이 열린 상태에서만 승객이 내릴 수 있습니다.")
    const passengerToUnload = passengers.find((p) => p.id === id)
    if (!passengerToUnload || passengerToUnload.status !== "onboard") return
    setPassengers((prev) => prev.map((p) =>
      p.id === id && p.status === "onboard"
        ? { ...p, status: "done", to: currentFloor }
        : p
    ))
    const destFloor = passengerToUnload.to
    const isStillNeeded = passengers.some(p => {
       if (p.id === id || p.status === "done") return false 
       if (p.status === "onboard" && p.to === destFloor) return true
       if (p.status === "waiting" && p.from === destFloor) return true
       return false
    })
    if (!isStillNeeded) ctrl.removeRequest(destFloor)
  }

  // 문 열림 시 탑승 (센서값 차단)
  useEffect(() => {
    if (doorState !== "open" || sensor_Misaligned) return 
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
  }, [doorState, currentFloor, ctrl, sensor_Misaligned])

  // 로그 자동 추가
  useEffect(() => {
    if (sensor_Misaligned && misalignWaitTime > 2000 && !misalignLoggedRef.current) {
      addLogEntry({
        timestamp: new Date().toISOString(),
        level: 'WARN',
        message: '정위치 정차 실패 (1초 경과 - 위험 확정)'
      })
      misalignLoggedRef.current = true 
    }
  }, [sensor_Misaligned, misalignWaitTime, addLogEntry])

  useEffect(() => {
    if (sensor_Overload) addLogEntry({
      timestamp: new Date().toISOString(),
      level: 'ALERT',
      message: '과부하 알림 (500kg 초과)'
    })
  }, [sensor_Overload, addLogEntry])

  useEffect(() => {
    if (sensor_Jammed) addLogEntry({
      timestamp: new Date().toISOString(),
      level: 'ALERT',
      message: '문 끼임 승객 감지'
    })
  }, [sensor_Jammed, addLogEntry])

  const statusLabel = direction === "idle" ? "대기" : direction === "up" ? "상행" : "하행"
  const statusColor = direction === "idle" ? "#6b7280" : direction === "up" ? "#2563eb" : "#dc2626"

  // 🔸 센서 무결성 상태 (정상 / 오탐 / 미탐) – 아래 두 카드에서 같이 사용
  const getIntegrityStatus = (real, sensor) => {
    if (real === sensor) return { text: "정상 (Normal)", class: "status-ok" }
    if (!real && sensor) return { text: "⚠️ 오탐 (FP)", class: "status-fp" }
    if (real && !sensor) return { text: "🚨 미탐 (FN)", class: "status-fn" }
    return { text: "Unknown", class: "" }
  }
  const jamStatus = getIntegrityStatus(real_Jammed,   sensor_Jammed)
  const loadStatus = getIntegrityStatus(real_Overload, sensor_Overload)
  const posStatus  = getIntegrityStatus(lastIsMisaligned, sensor_Misaligned)

  // Render UI
  return (
    <div className="Dashboard">
      <header className="dash-header">
        <div className="dash-header-main">
          <div>
            <h1>CPS Elevator Simulator</h1>
            <p style={{fontSize: "0.8rem", color: isConnected ? "green" : "red", marginTop: "-8px", marginBottom: "4px"}}>
               {isConnected ? "● Online" : "○ Offline"}
            </p>

            {/* 🔸 자율제어 모드 토글 */}
            <div className="auto-mode-toggle">
              <span className="auto-mode-label">자율제어 모드</span>
              <button
                type="button"
                className={`auto-mode-chip ${autoMode ? "on" : "off"}`}
                onClick={() => setAutoMode(v => !v)}
              >
                {autoMode ? "ON" : "OFF"}
              </button>
            </div>

            <p style={{fontSize:"0.75rem", color:"#6b7280", marginTop:"4px", marginBottom:"8px"}}>
              {autoMode
                ? "백엔드가 여러 센서·상태를 종합 분석하여 자율 제어 판단을 수행합니다."
                : "단순 센서 기반 모드: 개별 센서 신호를 그대로 신뢰하는 판단 방식입니다."}
            </p>

            <p>현재 층: <b>{displayFloor}</b> <span style={{ color: statusColor }}>({statusLabel})</span></p>
            <p className="queue-info">대기 큐: {queue.length === 0 ? "없음" : queue.join(" → ")}</p>
            <p className="capacity-info">
              정격 적재 {MAX_LOAD_KG}kg · <span className={`capacity-count ${sensor_Overload ? "full" : ""}`}>현재 {onboardCount}명 / {onboardWeightKg}kg</span>
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
        {/* 왼쪽 패널 */}
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

          {/* 🔸 오탐/미탐 1·2·3 버튼 UI */}
          <div className="error-test-section" style={{marginTop: '20px', borderTop: '1px dashed #e2e8f0', paddingTop: '16px'}}>
            <h3 style={{fontSize:'0.95rem', color:'#475569', marginBottom:'8px'}}>🧪 센서 신뢰성 평가 (Injection)</h3>
            <div style={{display:'flex', flexDirection:'column', gap:'10px'}}>
              <div>
                <div style={{fontSize:'0.8rem', marginBottom:'4px'}}>오탐(FP) 시나리오</div>
                <div style={{display:'flex', gap:'6px'}}>
                  {[1,2,3].map(n => {
                    const mode = `FP${n}`
                    const active = errorInjectionMode === mode
                    return (
                      <button
                        key={mode}
                        type="button"
                        className={`tiny-inject-btn ${active ? "active-fp" : ""}`}
                        onClick={() => setErrorInjectionMode(prev => prev === mode ? "NONE" : mode)}
                      >
                        FP{n}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <div style={{fontSize:'0.8rem', marginBottom:'4px'}}>미탐(FN) 시나리오</div>
                <div style={{display:'flex', gap:'6px'}}>
                  {[1,2,3].map(n => {
                    const mode = `FN${n}`
                    const active = errorInjectionMode === mode
                    return (
                      <button
                        key={mode}
                        type="button"
                        className={`tiny-inject-btn ${active ? "active-fn" : ""}`}
                        onClick={() => setErrorInjectionMode(prev => prev === mode ? "NONE" : mode)}
                      >
                        FN{n}
                      </button>
                    )
                  })}
                </div>
              </div>

              <p style={{fontSize:'0.75rem', color:'#64748b', marginTop:'4px'}}>
                ※ 각 번호가 어떤 센서(끼임/과부하/정위치)에 주입되는지는 숨겨진 상태로 실험하도록 구성했습니다.
              </p>
            </div>
          </div>
        </div>

        {/* 중앙 샤프트 */}
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

        {/* 오른쪽 패널 */}
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
             {visiblePassengers.length === 0 ? (
               <p className="passenger-empty">대기 중인 승객이 없습니다.</p>
             ) : visiblePassengers.map(p => (
                <div key={p.id} className={"passenger-item" + (p.isJammed ? " jammed-item" : "")}>
                  <span className="passenger-route">{p.from}층 → {p.to}층 {p.isJammed ? "(끼임)" : ""}</span>
                  <span className="passenger-weight">{p.weightKg}kg</span>
                  <span className={`passenger-status ${p.status}`}>
                    {p.status === "waiting" ? "대기" : p.status === "onboard" ? "탑승 중" : "완료"}
                  </span>
                  {p.status === "onboard" && (
                    <button
                      className="unload-btn"
                      onClick={() => handleUnloadPassenger(p.id)}
                      disabled={!doorLooksOpen}
                    >
                      내리기
                    </button>
                  )}
                </div>
             ))}
           </div>
        </div>
      </div>
      
      {/* 하단 백엔드 모니터링 */}
      <section className="backend-panel">
        <div className="backend-inner">
          <div className="backend-header">
            <h2>백엔드 연동 · 센서 데이터 모니터링</h2>
            <p className="backend-subtitle">엘리베이터 상태를 백엔드와 주고받는 영역입니다.</p>
          </div>
          <div className="backend-grid">
            <div style={{display:'flex', flexDirection:'column', gap:'24px'}}>
                <div className="backend-card">
                <h3>실시간 센서 값 (Sensor Readings)</h3>
                <table className="backend-table">
                    <thead><tr><th>항목</th><th>값</th><th>단위</th><th>상태</th></tr></thead>
                    <tbody>
                    <tr><td>현재 층</td><td>{displayFloor}</td><td>층</td><td>-</td></tr>
                    <tr><td>카 위치</td><td>{realtimePx.toFixed(1)}</td><td>px</td><td>{sensor_Misaligned ? "정위치 실패" : "정상"}</td></tr>
                    <tr><td>속도</td><td>{speedFloorsPerSec.toFixed(2)}</td><td>층/초</td><td>{isMoving ? "이동 중" : "정지"}</td></tr>
                    <tr><td>문 상태</td><td>{doorState}</td><td>-</td><td>{sensor_Jammed ? "끼임 감지" : "정상"}</td></tr>
                    <tr><td>적재량</td><td>{onboardWeightKg}</td><td>kg</td><td>{sensor_Overload ? "과부하" : "정상"}</td></tr>
                    </tbody>
                </table>
                </div>
                
                <div className="backend-card backend-log">
                <h3>백엔드 이벤트 / 알람 로그</h3>
                <p className="backend-log-hint">최대 200개까지 표시됩니다.</p>
                <div className="backend-log-list">
                    {logEntries.length === 0 ? (
                      <div className="backend-log-item">[INFO] 로그가 없습니다</div>
                    ) : logEntries.map((entry, idx) => {
                        const color =
                          entry.level === 'ALERT' ? '#dc2626' :
                          entry.level === 'WARN'  ? '#f59e0b' :
                          entry.level === 'CMD'   ? '#3b82f6' :
                          undefined
                        return (
                          <div key={idx} className="backend-log-item" style={{ color }}>
                            [{new Date(entry.timestamp).toLocaleTimeString()}] [{entry.level}] {entry.message}
                          </div>
                        )
                    })}
                </div>
                </div>
            </div>

            <div style={{display:'flex', flexDirection:'column', gap:'24px'}}>
                <div className="backend-card">
                    <h3>🛡️ 자율 제어 센서 분석 행렬</h3>
                    {(() => {
                        const s_DoorObj   = sensor_Jammed ? 1 : 0 
                        const s_Overload  = sensor_Overload ? 1 : 0       
                        const s_PosError  = sensor_Misaligned ? 1 : 0
                        const isMotorRun  = (Math.abs(speedFloorsPerSec) > 0.01 || direction !== "idle") ? 1 : 0
                        const s_DoorClose = (doorState === "closing" || doorState === "closed") ? 1 : 0
                        const isWaitOver  = (misalignWaitTime > 1000 && sensor_Misaligned) ? 1 : 0

                        const matrixRows = [
                          {
                            id: "JAM",
                            name: "1. 승객 끼임 사고",
                            desc: "물체 감지 + 문 닫힘 시도",
                            bits: [s_DoorObj, 0, 0, 0, s_DoorClose],
                            fault: s_DoorObj && s_DoorClose,
                            status: jamStatus,
                          },
                          {
                            id: "OVL",
                            name: "2. 과부하 감지",
                            desc: "정격 하중 초과 (출발 차단)",
                            bits: [0, s_Overload, 0, 0, 0],
                            fault: s_Overload,
                            status: loadStatus,
                          },
                          {
                            id: "LVL",
                            name: "3. 정위치 이탈",
                            desc: "위치오차 + 정지(1초 경과)",
                            bits: [0, 0, s_PosError, isWaitOver, 0],
                            fault: s_PosError && isWaitOver,
                            status: posStatus,
                          },
                        ]
                        const sensors = ["물체감지", "과부하", "위치오차", "구동/대기", "닫힘시도"]
                        const isSystemFault = matrixRows.some(r => r.fault)

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
                                      {/* 🔸 여기서도 미탐/오탐/정상 뱃지 표시 */}
                                      <div className={`scenario-status-pill ${row.status.class}`}>
                                        {row.status.text}
                                      </div>
                                    </td>
                                    {row.bits.map((bit, i) => {
                                      const isRelevant =
                                        (row.id === "JAM" && (i===0 || i===4)) ||
                                        (row.id === "OVL" && (i===1)) ||
                                        (row.id === "LVL" && (i===2 || i===3))
                                      return (
                                        <td
                                          key={i}
                                          className={`bit-cell ${bit === 1 ? "on" : "off"} ${!isRelevant && bit===0 ? "dim" : ""}`}
                                        >
                                          {isRelevant || bit === 1
                                            ? bit
                                            : <span style={{opacity:0.1}}>0</span>}
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
                                : <span className="norm"> 🟢 SYSTEM NORMAL</span>}
                            </div>
                        </div>
                        )
                    })()}
                </div>

                <div className="backend-card">
                    <h3>📊 데이터 무결성 검증 (Data Integrity Check)</h3>
                    <table className="comparison-table">
                        <thead>
                          <tr>
                            <th>평가 항목</th>
                            <th>실제 물리 상태 (Ground Truth)</th>
                            <th>센서 입력 값 (Sensor Data)</th>
                            <th>진단 결과 (Diagnosis)</th>
                          </tr>
                        </thead>
                        <tbody>
                            <tr>
                              <td className="comp-label">문 끼임 (Jamming)</td>
                              <td className={real_Jammed ? "val-danger" : "val-safe"}>
                                {real_Jammed ? "있음 (True)" : "없음 (False)"}
                              </td>
                              <td className={sensor_Jammed ? "val-danger" : "val-safe"}>
                                {sensor_Jammed ? "감지 (1)" : "미감지 (0)"}
                              </td>
                              <td className={`comp-result ${jamStatus.class}`}>{jamStatus.text}</td>
                            </tr>
                            <tr>
                              <td className="comp-label">과부하 (Overload)</td>
                              <td className={real_Overload ? "val-danger" : "val-safe"}>
                                {real_Overload ? "초과 (True)" : "정상 (False)"}
                              </td>
                              <td className={sensor_Overload ? "val-danger" : "val-safe"}>
                                {sensor_Overload ? "감지 (1)" : "미감지 (0)"}
                              </td>
                              <td className={`comp-result ${loadStatus.class}`}>{loadStatus.text}</td>
                            </tr>
                            <tr>
                              <td className="comp-label">정위치 실패 (Leveling)</td>
                              <td className={lastIsMisaligned ? "val-danger" : "val-safe"}>
                                {lastIsMisaligned ? "오차 (True)" : "정상 (False)"}
                              </td>
                              <td className={sensor_Misaligned ? "val-danger" : "val-safe"}>
                                {sensor_Misaligned ? "감지 (1)" : "미감지 (0)"}
                              </td>
                              <td className={`comp-result ${posStatus.class}`}>{posStatus.text}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div className="backend-card">
                    <h3>📈 센서 성능 평가 (Precision / Recall)</h3>
                    <table className="comparison-table">
                      <thead>
                        <tr>
                          <th>항목</th>
                          <th>TP</th>
                          <th>FP</th>
                          <th>FN</th>
                          <th>TN</th>
                          <th>Precision</th>
                          <th>Recall</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="comp-label">문 끼임 (Jamming)</td>
                          <td>{jamMetrics.TP}</td>
                          <td>{jamMetrics.FP}</td>
                          <td>{jamMetrics.FN}</td>
                          <td>{jamMetrics.TN}</td>
                          <td>{formatPct(jamMetrics.precision)}</td>
                          <td>{formatPct(jamMetrics.recall)}</td>
                        </tr>
                        <tr>
                          <td className="comp-label">과부하 (Overload)</td>
                          <td>{ovMetrics.TP}</td>
                          <td>{ovMetrics.FP}</td>
                          <td>{ovMetrics.FN}</td>
                          <td>{ovMetrics.TN}</td>
                          <td>{formatPct(ovMetrics.precision)}</td>
                          <td>{formatPct(ovMetrics.recall)}</td>
                        </tr>
                        <tr>
                          <td className="comp-label">정위치 실패 (Leveling)</td>
                          <td>{misalignMetrics.TP}</td>
                          <td>{misalignMetrics.FP}</td>
                          <td>{misalignMetrics.FN}</td>
                          <td>{misalignMetrics.TN}</td>
                          <td>{formatPct(misalignMetrics.precision)}</td>
                          <td>{formatPct(misalignMetrics.recall)}</td>
                        </tr>
                      </tbody>
                    </table>
                    <p style={{fontSize:"0.75rem", color:"#6b7280", marginTop:"6px"}}>
                      * 상태가 바뀔 때마다 (실제/센서 조합 변화 시) 1샘플씩 카운트합니다.
                    </p>
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
