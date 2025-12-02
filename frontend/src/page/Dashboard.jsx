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
  // ... (기존 상태 변수들: passengers, spawnFloor 등 그대로 유지)
  const [passengers, setPassengers] = useState([])
  const [spawnFloor, setSpawnFloor] = useState(1)
  const [targetFloor, setTargetFloor] = useState(5)
  const [nextPassengerId, setNextPassengerId] = useState(1)
  
  // 에러 주입 모드
  const [errorInjectionMode, setErrorInjectionMode] = useState("NONE");

  // 로그 상태
  const [lastCommand, setLastCommand] = useState(null)
  const [logEntries, setLogEntries] = useState([
    { timestamp: new Date().toISOString(), level: 'INFO', message: '시스템 시작 - 모니터링 대기 중' }
  ])

  // 정위치 오차 시간 측정
  const [misalignWaitTime, setMisalignWaitTime] = useState(0);
  const misalignStartRef = useRef(null);
  const misalignLoggedRef = useRef(false);

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
  const [lastIsMisaligned, setLastIsMisaligned] = useState(false);

  // --- 센서 레이어 (오염 로직) ---
  let sensor_Overload = real_Overload;
  let sensor_Jammed = real_Jammed;
  let sensor_Misaligned = lastIsMisaligned;

  if (errorInjectionMode === "FP") {
    if (!real_Jammed) sensor_Jammed = true;
    if (!real_Overload) sensor_Overload = true;
    if (!lastIsMisaligned) sensor_Misaligned = true; 
  } else if (errorInjectionMode === "FN") {
    if (real_Overload) sensor_Overload = false;
    if (real_Jammed) sensor_Jammed = false; 
    if (lastIsMisaligned) sensor_Misaligned = false;
  }

  // --- 컨트롤러 연결 ---
  const ctrl = useElevatorController({
    isOverload: sensor_Overload,
    hasJammedOnboard: sensor_Jammed,
    isMisalignedSensor: sensor_Misaligned, 
  })

  // 동기화
  useEffect(() => {
    if (ctrl.isMisaligned !== lastIsMisaligned) {
        setLastIsMisaligned(ctrl.isMisaligned);
    }
  }, [ctrl.isMisaligned, lastIsMisaligned]);


  // =================================================================================
  // [핵심] 백엔드 자율제어 명령 처리 핸들러 (Backend Command Handler)
  // =================================================================================
  /* [백엔드 개발자 전달 사항]
    Spring Boot에서 'SimpMessagingTemplate'을 사용하여 '/topic/control' 채널로 
    아래 포맷의 JSON을 보내주세요.

    1. 정위치 자동 수정 명령
       { "type": "FIX_ALIGNMENT", "message": "위치 오차 감지됨. 자동 보정을 실시합니다." }

    2. 문 끼임 감지 -> 강제 개방 명령
       { "type": "FORCE_OPEN", "message": "장애물 감지됨. 문을 다시 엽니다." }

    3. 과부하 경고 명령
       { "type": "OVERLOAD_WARN", "message": "정격 하중 초과. 탑승객은 내려주세요." }
  */
  const handleBackendCommand = useCallback((command) => {
    // 1. 명령 수신 로그 기록
    const msg = ` ${command.type}: ${command.message || ''}`;
    setLastCommand(msg);
    addLogEntry({ timestamp: new Date().toISOString(), level: 'CMD', message: msg })

    // 2. 명령 타입별 자율 제어 실행
    switch (command.type) {
      // -----------------------------------------------------
      // CASE 1: 정위치 수정 (Leveling Correction)
      // -----------------------------------------------------
      case "FIX_ALIGNMENT":
        if (ctrl.isMisaligned) {
            console.log("백엔드 명령: 정위치 수정 실행");
            ctrl.fixMisalign(); // 컨트롤러의 보정 함수 실행
            alert(`[자율제어 알림]\n\n${command.message}\n(정위치 자동 수정을 시작합니다.)`);
        } else {
            console.log("이미 정위치 상태입니다 (명령 무시)");
        }
        break;
      
      // -----------------------------------------------------
      // CASE 2: 문 끼임 -> 강제 개방 (Safety Re-open)
      // -----------------------------------------------------
      case "FORCE_OPEN":
        console.log("백엔드 명령: 문 강제 개방");
        // 문이 닫혀있거나 닫는 중이면 다시 염
        if (ctrl.doorState !== 'open') {
            ctrl.openDoor(); 
        }
        // 사용자 알림
        alert(`[비상 알림]\n\n${command.message}\n(안전을 위해 문을 개방합니다.)`);
        break;

      // -----------------------------------------------------
      // CASE 3: 과부하 경고 (Overload Warning)
      // -----------------------------------------------------
      case "OVERLOAD_WARN":
        console.log("백엔드 명령: 과부하 경고");
        // 과부하 시에는 보통 동작을 멈추므로, 여기선 경고창만 띄움
        alert(`[경고]\n\n${command.message}\n(최대 하중 500kg을 초과했습니다.)`);
        break;

      // -----------------------------------------------------
      // CASE 4: 비상 정지 (Optional)
      // -----------------------------------------------------
      case "EMERGENCY_STOP":
        alert(`[비상 정지]\n\n관제 센터로부터 비상 정지 명령이 수신되었습니다.`);
        // 필요 시 ctrl.emergencyStop() 같은 함수 추가 구현 가능
        break;

      default:
        console.warn("Unknown command received:", command);
    }
  }, [ctrl, addLogEntry]); 
  // =================================================================================


  // --- 네트워크 연결 ---
  const elevatorState = {
    currentFloor: ctrl.currentFloor,
    realtimeFloor: ctrl.realtimeFloor,
    speedFloorsPerSec: ctrl.speedFloorsPerSec,
    doorState: ctrl.doorState,
    direction: ctrl.direction,
    isOverload: sensor_Overload,
    hasJammedOnboard: sensor_Jammed,
  }
  const { isConnected } = useElevatorNetwork(elevatorState, handleBackendCommand)

  // ... (이후 렌더링 로직은 기존과 동일하므로 생략하지 않고 전체 유지를 위해 아래 작성)
  
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
    const isStopped = Math.abs(speedFloorsPerSec) <= 0.01;
    const dist = Math.abs(realtimeFloor - Math.round(realtimeFloor));
    const isPosError = dist > 0.1;

    let intervalId;
    if (isStopped && isPosError) {
        if (misalignStartRef.current === null) misalignStartRef.current = Date.now();
        intervalId = setInterval(() => {
            if (misalignStartRef.current) setMisalignWaitTime(Date.now() - misalignStartRef.current);
        }, 100);
    } else {
        misalignStartRef.current = null;
        setMisalignWaitTime(0);
        misalignLoggedRef.current = false;
    }
    return () => { if (intervalId) clearInterval(intervalId); }
  }, [speedFloorsPerSec, realtimeFloor]);

  // 이벤트 핸들러들...
  const handleAddPassenger = (e) => {
    e.preventDefault()
    if (spawnFloor === targetFloor) return alert("출발/목적층이 같습니다.")
    const weightKg = Math.floor(Math.random() * (MAX_WEIGHT_KG - MIN_WEIGHT_KG + 1)) + MIN_WEIGHT_KG
    const newPassenger = { id: nextPassengerId, from: spawnFloor, to: targetFloor, status: "waiting", weightKg, isJammed: false }
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
    setPassengers((prev) => prev.map((p) => p.id === id && p.status === "onboard" ? { ...p, status: "done", to: currentFloor } : p))
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
      addLogEntry({ timestamp: new Date().toISOString(), level: 'WARN', message: '정위치 정차 실패 (1초 경과 - 위험 확정)' })
      misalignLoggedRef.current = true; 
    }
  }, [sensor_Misaligned, misalignWaitTime, addLogEntry])

  useEffect(() => {
    if (sensor_Overload) addLogEntry({ timestamp: new Date().toISOString(), level: 'ALERT', message: '과부하 알림 (500kg 초과)' })
  }, [sensor_Overload, addLogEntry])

  useEffect(() => {
    if (sensor_Jammed) addLogEntry({ timestamp: new Date().toISOString(), level: 'ALERT', message: '문 끼임 승객 감지' })
  }, [sensor_Jammed, addLogEntry])

  const statusLabel = direction === "idle" ? "대기" : direction === "up" ? "상행" : "하행"
  const statusColor = direction === "idle" ? "#6b7280" : direction === "up" ? "#2563eb" : "#dc2626"

  // Render UI
  return (
    <div className="Dashboard">
      <header className="dash-header">
        <div className="dash-header-main">
          <div>
            <h1>CPS Elevator Simulator</h1>
            <p style={{fontSize: "0.8rem", color: isConnected ? "green" : "red", marginTop: "-8px", marginBottom: "8px"}}>
               {isConnected ? "● Online" : "○ Offline"}
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
          <div className="error-test-section" style={{marginTop: '20px', borderTop: '1px dashed #e2e8f0', paddingTop: '16px'}}>
            <h3 style={{fontSize:'0.95rem', color:'#475569', marginBottom:'8px'}}>🧪 센서 신뢰성 평가 (Injection)</h3>
            <div style={{display:'flex', gap:'8px', flexDirection:'column'}}>
              <button className={`floor-btn ${errorInjectionMode === "FP" ? "inside" : ""}`} onClick={() => setErrorInjectionMode(prev => prev === "FP" ? "NONE" : "FP")} style={errorInjectionMode === "FP" ? {borderColor: '#f59e0b', color: '#b45309', background:'#fffbeb'} : {}}>{errorInjectionMode === "FP" ? "⚠️ 오탐(FP) 테스트 중..." : "오탐(FP) 유발 (센서 노이즈)"}</button>
              <button className={`floor-btn ${errorInjectionMode === "FN" ? "inside" : ""}`} onClick={() => setErrorInjectionMode(prev => prev === "FN" ? "NONE" : "FN")} style={errorInjectionMode === "FN" ? {borderColor: '#ef4444', color: '#b91c1c', background:'#fef2f2'} : {}}>{errorInjectionMode === "FN" ? "🚨 미탐(FN) 테스트 중..." : "미탐(FN) 유발 (센서 고장)"}</button>
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
                    {logEntries.length === 0 ? <div className="backend-log-item">[INFO] 로그가 없습니다</div> : logEntries.map((entry, idx) => {
                        const color = entry.level === 'ALERT' ? '#dc2626' : entry.level === 'WARN' ? '#f59e0b' : entry.level === 'CMD' ? '#3b82f6' : undefined
                        return <div key={idx} className="backend-log-item" style={{ color }}>[{new Date(entry.timestamp).toLocaleTimeString()}] [{entry.level}] {entry.message}</div>
                    })}
                </div>
                </div>
            </div>

            <div style={{display:'flex', flexDirection:'column', gap:'24px'}}>
                <div className="backend-card">
                    <h3>🛡️ 자율 제어 센서 분석 행렬</h3>
                    {(() => {
                        const s_DoorObj   = sensor_Jammed ? 1 : 0; 
                        const s_Overload  = sensor_Overload ? 1 : 0;       
                        const s_PosError = sensor_Misaligned ? 1 : 0;
                        const isMotorRun  = (Math.abs(speedFloorsPerSec) > 0.01 || direction !== "idle") ? 1 : 0;
                        const s_DoorClose = (doorState === "closing" || doorState === "closed") ? 1 : 0;
                        const isWaitOver  = (misalignWaitTime > 1000 && sensor_Misaligned) ? 1 : 0;

                        const matrixRows = [
                        { id: "JAM", name: "1. 승객 끼임 사고", desc: "물체 감지 + 문 닫힘 시도", bits: [s_DoorObj, 0, 0, 0, s_DoorClose], fault: s_DoorObj && s_DoorClose },
                        { id: "OVL", name: "2. 과부하 감지", desc: "정격 하중 초과 (출발 차단)", bits: [0, s_Overload, 0, 0, 0], fault: s_Overload },
                        { id: "LVL", name: "3. 정위치 이탈", desc: "위치오차 + 정지(1초 경과)", bits: [0, 0, s_PosError, isWaitOver, 0], fault: s_PosError && isWaitOver },
                        ];
                        const sensors = ["물체감지", "과부하", "위치오차", "구동/대기", "닫힘시도"];
                        const isSystemFault = matrixRows.some(r => r.fault);

                        return (
                        <div className="matrix-wrapper">
                            <table className="sensor-matrix">
                            <thead><tr><th className="matrix-corner">SCENARIO</th>{sensors.map((s, i) => <th key={i}>{s}</th>)}<th className="matrix-result-header">STATUS</th></tr></thead>
                            <tbody>
                                {matrixRows.map((row) => (
                                <tr key={row.id} className={row.fault ? "row-alert" : ""}>
                                    <td className="scenario-name" title={row.desc}>{row.name}
                                    {row.id === "JAM" && errorInjectionMode === "FP" && <span style={{color:'orange', fontSize:'0.6rem', display:'block'}}> (Noise Injected)</span>}
                                    {row.id === "OVL" && errorInjectionMode === "FN" && <span style={{color:'red', fontSize:'0.6rem', display:'block'}}> (Sensor Dead)</span>}
                                    <div style={{fontSize:'0.65rem', fontWeight:'normal', opacity:0.7}}>{row.desc}</div></td>
                                    {row.bits.map((bit, i) => {
                                    const isRelevant = (row.id === "JAM" && (i===0 || i===4)) || (row.id === "OVL" && (i===1)) || (row.id === "LVL" && (i===2 || i===3));
                                    return <td key={i} className={`bit-cell ${bit === 1 ? "on" : "off"} ${!isRelevant && bit===0 ? "dim" : ""}`}>{isRelevant || bit === 1 ? bit : <span style={{opacity:0.1}}>0</span>}</td>
                                    })}
                                    <td className="scenario-result">{row.fault ? "🚨 DANGER" : "✅ SAFE"}</td>
                                </tr>
                                ))}
                            </tbody>
                            </table>
                            <div className="system-summary">System Diagnosis: {isSystemFault ? <span className="crit"> 🛑 OPERATION HALTED</span> : <span className="norm"> 🟢 SYSTEM NORMAL</span>}</div>
                        </div>
                        );
                    })()}
                </div>

                <div className="backend-card">
                    <h3>📊 데이터 무결성 검증 (Data Integrity Check)</h3>
                    {(() => {
                        const getStatus = (real, sensor) => {
                            if (real === sensor) return { text: "정상 (Normal)", class: "status-ok" };
                            if (!real && sensor) return { text: "⚠️ 오탐 (False Positive)", class: "status-fp" };
                            if (real && !sensor) return { text: "🚨 미탐 (False Negative)", class: "status-fn" };
                            return { text: "Unknown", class: "" };
                        };
                        const jamStatus = getStatus(real_Jammed, sensor_Jammed);
                        const loadStatus = getStatus(real_Overload, sensor_Overload);
                        const posStatus = getStatus(lastIsMisaligned, sensor_Misaligned);

                        return (
                            <table className="comparison-table">
                                <thead><tr><th>평가 항목</th><th>실제 물리 상태 (Ground Truth)</th><th>센서 입력 값 (Sensor Data)</th><th>진단 결과 (Diagnosis)</th></tr></thead>
                                <tbody>
                                    <tr><td className="comp-label">문 끼임 (Jamming)</td><td className={real_Jammed ? "val-danger" : "val-safe"}>{real_Jammed ? "있음 (True)" : "없음 (False)"}</td><td className={sensor_Jammed ? "val-danger" : "val-safe"}>{sensor_Jammed ? "감지 (1)" : "미감지 (0)"}</td><td className={`comp-result ${jamStatus.class}`}>{jamStatus.text}</td></tr>
                                    <tr><td className="comp-label">과부하 (Overload)</td><td className={real_Overload ? "val-danger" : "val-safe"}>{real_Overload ? "초과 (True)" : "정상 (False)"}</td><td className={sensor_Overload ? "val-danger" : "val-safe"}>{sensor_Overload ? "감지 (1)" : "미감지 (0)"}</td><td className={`comp-result ${loadStatus.class}`}>{loadStatus.text}</td></tr>
                                    <tr><td className="comp-label">정위치 실패 (Leveling)</td><td className={lastIsMisaligned ? "val-danger" : "val-safe"}>{lastIsMisaligned ? "오차 (True)" : "정상 (False)"}</td><td className={sensor_Misaligned ? "val-danger" : "val-safe"}>{sensor_Misaligned ? "감지 (1)" : "미감지 (0)"}</td><td className={`comp-result ${posStatus.class}`}>{posStatus.text}</td></tr>
                                </tbody>
                            </table>
                        );
                    })()}
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