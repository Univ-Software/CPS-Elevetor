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
  // --- 1. 기본 상태 관리 ---
  const [passengers, setPassengers] = useState([])
  const [spawnFloor, setSpawnFloor] = useState(1)
  const [targetFloor, setTargetFloor] = useState(5)
  const [nextPassengerId, setNextPassengerId] = useState(1)
  
  // 에러 주입 모드 (NONE, FP:오탐, FN:미탐)
  const [errorInjectionMode, setErrorInjectionMode] = useState("NONE");

  // 백엔드 로그 및 명령 상태
  const [lastCommand, setLastCommand] = useState(null)
  const [logEntries, setLogEntries] = useState([
    { timestamp: new Date().toISOString(), level: 'INFO', message: '시스템 시작 - 모니터링 대기 중' }
  ])

  // 정위치 오차 시간 측정용 Ref & 로그 중복 방지 Ref
  const [misalignWaitTime, setMisalignWaitTime] = useState(0);
  const misalignStartRef = useRef(null);
  const misalignLoggedRef = useRef(false);

  const addLogEntry = useCallback((entry) => {
    setLogEntries(prev => {
      const next = [entry, ...prev]
      return next.slice(0, 200)
    })
  }, [])

  // --- 2. 물리적 상태 계산 (Ground Truth) ---
  const visiblePassengers = passengers.filter((p) => p.status !== "done")
  const onboardPassengers = passengers.filter((p) => p.status === "onboard")
  
  const onboardCount = onboardPassengers.length
  const onboardWeightKg = onboardPassengers.reduce((sum, p) => sum + (p.weightKg ?? 0), 0)
  
  // [Real] 실제 물리적 상황
  const real_Overload = onboardWeightKg > MAX_LOAD_KG
  const real_Jammed = onboardPassengers.some((p) => p.isJammed)

  // --- 3. 센서 데이터 생성 (Sensor Layer + Error Injection) ---
  // 이 값들이 제어기와 백엔드로 넘어갑니다.
  let sensor_Overload = real_Overload;
  let sensor_Jammed = real_Jammed;

  if (errorInjectionMode === "FP") {
    // 오탐(False Positive): 실제로는 없는데(false), 센서는 감지(true)
    // 예: 유령 감지 (문이 안 닫힘)
    if (!real_Jammed) sensor_Jammed = true;
  } 
  else if (errorInjectionMode === "FN") {
    // 미탐(False Negative): 실제로는 있는데(true), 센서는 미감지(false)
    // 예: 센서 고장 (과부하인데 출발함 -> 사고 발생 시뮬레이션)
    if (real_Overload) sensor_Overload = false;
  }

  // --- 4. 컨트롤러 연결 (센서 값을 입력으로 줌) ---
  // 중요: 컨트롤러는 '센서 값'을 믿고 동작합니다.
  const ctrl = useElevatorController({
    isOverload: sensor_Overload,
    hasJammedOnboard: sensor_Jammed,
  })

  // 백엔드 명령 처리 핸들러
  const handleBackendCommand = useCallback((command) => {
    const msg = `[CMD] ${command.type}: ${command.message || ''}`;
    setLastCommand(msg);
    addLogEntry({ timestamp: new Date().toISOString(), level: 'CMD', message: msg })

    switch (command.type) {
      case "FIX_ALIGNMENT":
        if (ctrl.isMisaligned) {
            ctrl.fixMisalign();
            addLogEntry({ timestamp: new Date().toISOString(), level: 'INFO', message: '원격 정위치 수정 명령 실행 완료' });
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

  // --- 5. 네트워크 연결 (백엔드로 센서 값 전송) ---
  const elevatorState = {
    currentFloor: ctrl.currentFloor,
    realtimeFloor: ctrl.realtimeFloor,
    speedFloorsPerSec: ctrl.speedFloorsPerSec,
    doorState: ctrl.doorState,
    direction: ctrl.direction,
    // [중요] 백엔드에도 '오염된 센서 값'을 보냄 (현실 반영)
    isOverload: sensor_Overload,
    hasJammedOnboard: sensor_Jammed,
  }
  
  const { isConnected } = useElevatorNetwork(elevatorState, handleBackendCommand)

  const { 
    currentFloor, carFloor, realtimeFloor, queue, direction, doorState, 
    moveDuration, speedFloorsPerSec, isMisaligned, isMoving 
  } = ctrl

  const doorLooksOpen = doorState === "open" || doorState === "opening"

  // --- 6. 화면 렌더링용 계산 ---
  const floorIndexFromBottom = (f) => f - 1
  const currentIndex = floorIndexFromBottom(carFloor)
  const carBottom = Math.max(0, currentIndex * FLOOR_HEIGHT + FLOOR_BASE_OFFSET + 10)
  
  const realtimeIndex = floorIndexFromBottom(realtimeFloor)
  const realtimePx = Math.max(0, realtimeIndex * FLOOR_HEIGHT + FLOOR_BASE_OFFSET + 10)
  const displayFloor = Math.round(realtimeFloor)

  // ----------------------------------------------------------------
  // [로직] 정위치 오차 시간 측정
  // ----------------------------------------------------------------
  useEffect(() => {
    const isStopped = Math.abs(speedFloorsPerSec) <= 0.01;
    const dist = Math.abs(realtimeFloor - Math.round(realtimeFloor));
    const isPosError = dist > 0.1;

    let intervalId;

    if (isStopped && isPosError) {
        if (misalignStartRef.current === null) {
            misalignStartRef.current = Date.now();
        }
        intervalId = setInterval(() => {
            if (misalignStartRef.current) {
                setMisalignWaitTime(Date.now() - misalignStartRef.current);
            }
        }, 100);
    } else {
        misalignStartRef.current = null;
        setMisalignWaitTime(0);
        misalignLoggedRef.current = false;
    }

    return () => {
        if (intervalId) clearInterval(intervalId);
    }
  }, [speedFloorsPerSec, realtimeFloor]);


  // --- 7. 이벤트 핸들러 ---
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

  // 문 열림 시 탑승/하차 (정위치 실패 시 탑승 차단)
  useEffect(() => {
    if (doorState !== "open" || isMisaligned) return 

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

  // --- 8. 로그 자동 추가 (센서 값을 기준으로 기록) ---
  useEffect(() => {
    if (isMisaligned && misalignWaitTime > 2000 && !misalignLoggedRef.current) {
      addLogEntry({ timestamp: new Date().toISOString(), level: 'WARN', message: '[WARN] 정위치 정차 실패 (2초 경과 - 위험 확정)' })
      misalignLoggedRef.current = true; 
    }
  }, [isMisaligned, misalignWaitTime, addLogEntry])

  useEffect(() => {
    if (sensor_Overload) {
      addLogEntry({ timestamp: new Date().toISOString(), level: 'ALERT', message: '[ALERT] 과부하 알림 (500kg 초과)' })
    }
  }, [sensor_Overload, addLogEntry])

  useEffect(() => {
    if (sensor_Jammed) {
      addLogEntry({ timestamp: new Date().toISOString(), level: 'ALERT', message: '[ALERT] 문 끼임 승객 감지' })
    }
  }, [sensor_Jammed, addLogEntry])

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
              <button 
                className={`floor-btn ${errorInjectionMode === "FP" ? "inside" : ""}`}
                onClick={() => setErrorInjectionMode(prev => prev === "FP" ? "NONE" : "FP")}
                style={errorInjectionMode === "FP" ? {borderColor: '#f59e0b', color: '#b45309', background:'#fffbeb'} : {}}
              >
                {errorInjectionMode === "FP" ? "⚠️ 오탐(FP) 테스트 중..." : "오탐(FP) 유발 (센서 노이즈)"}
              </button>
              
              <button 
                className={`floor-btn ${errorInjectionMode === "FN" ? "inside" : ""}`}
                onClick={() => setErrorInjectionMode(prev => prev === "FN" ? "NONE" : "FN")}
                style={errorInjectionMode === "FN" ? {borderColor: '#ef4444', color: '#b91c1c', background:'#fef2f2'} : {}}
              >
                {errorInjectionMode === "FN" ? "🚨 미탐(FN) 테스트 중..." : "미탐(FN) 유발 (센서 고장)"}
              </button>
            </div>
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
            {/* 왼쪽 카드: 실시간 센서값 + 로그 */}
            <div style={{display:'flex', flexDirection:'column', gap:'24px'}}>
                <div className="backend-card">
                <h3>실시간 센서 값 (Sensor Readings)</h3>
                <table className="backend-table">
                    <thead><tr><th>항목</th><th>값</th><th>단위</th><th>상태</th></tr></thead>
                    <tbody>
                    <tr><td>현재 층</td><td>{displayFloor}</td><td>층</td><td>-</td></tr>
                    <tr><td>카 위치</td><td>{realtimePx.toFixed(1)}</td><td>px</td><td>{isMisaligned ? "정위치 실패" : "정상"}</td></tr>
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
                    ) : (
                    logEntries.map((entry, idx) => {
                        const color = entry.level === 'ALERT' ? '#dc2626' : entry.level === 'WARN' ? '#f59e0b' : entry.level === 'CMD' ? '#3b82f6' : undefined
                        return (
                        <div key={idx} className="backend-log-item" style={{ color }}>
                            [{new Date(entry.timestamp).toLocaleTimeString()}] [{entry.level}] {entry.message}
                        </div>
                        )
                    })
                    )}
                </div>
                </div>
            </div>

            {/* 오른쪽 카드: 안전 행렬 + 검증 테이블 */}
            <div style={{display:'flex', flexDirection:'column', gap:'24px'}}>
                {/* 1. 안전 제어 행렬 (Safety Matrix) */}
                <div className="backend-card">
                    <h3>🛡️ 자율 제어 센서 분석 행렬</h3>
                    
                    {(() => {
                        // --- 센서 데이터 (Input) - 오염된 값 사용 ---
                        const s_DoorObj   = sensor_Jammed ? 1 : 0; 
                        const s_Overload  = sensor_Overload ? 1 : 0;       
                        
                        // 기타 센서들 (정상)
                        const isPosError  = Math.abs(realtimeFloor - Math.round(realtimeFloor)) > 0.1 ? 1 : 0;
                        const isMotorRun  = (Math.abs(speedFloorsPerSec) > 0.01 || direction !== "idle") ? 1 : 0;
                        const s_DoorClose = (doorState === "closing" || doorState === "closed") ? 1 : 0;
                        const isWaitOver  = misalignWaitTime > 2000 ? 1 : 0;

                        // --- 안전 로직 (Logic) ---
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
                            name: "2. 과부하 감지", 
                            desc: "정격 하중 초과 (출발 차단)",
                            bits: [0, s_Overload, 0, 0, 0], 
                            fault: s_Overload 
                        },
                        { 
                            id: "LVL", 
                            name: "3. 정위치 이탈", 
                            desc: "위치오차 + 정지(2초 경과)",
                            bits: [0, 0, isPosError, isWaitOver, 0], 
                            fault: isPosError && isWaitOver
                        },
                        ];

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
                                    {/* 오탐/미탐 발생 시 시각적 표시 */}
                                    {row.id === "JAM" && errorInjectionMode === "FP" && <span style={{color:'orange', fontSize:'0.6rem', display:'block'}}> (Noise Injected)</span>}
                                    {row.id === "OVL" && errorInjectionMode === "FN" && <span style={{color:'red', fontSize:'0.6rem', display:'block'}}> (Sensor Dead)</span>}
                                    <div style={{fontSize:'0.65rem', fontWeight:'normal', opacity:0.7}}>{row.desc}</div>
                                    </td>
                                    {row.bits.map((bit, i) => {
                                    const isRelevant = 
                                        (row.id === "JAM" && (i===0 || i===4)) ||
                                        (row.id === "OVL" && (i===1)) ||
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

                {/* 2. 데이터 무결성 검증 테이블 (Verification Table) */}
                <div className="backend-card">
                    <h3>📊 데이터 무결성 검증 (Data Integrity Check)</h3>
                    {(() => {
                        // 진단 로직: 실제 값 vs 오염된 센서 값 비교
                        const getStatus = (real, sensor) => {
                            if (real === sensor) return { text: "정상 (Normal)", class: "status-ok" };
                            if (!real && sensor) return { text: "⚠️ 오탐 (False Positive)", class: "status-fp" };
                            if (real && !sensor) return { text: "🚨 미탐 (False Negative)", class: "status-fn" };
                            return { text: "Unknown", class: "" };
                        };

                        const jamStatus = getStatus(real_Jammed, sensor_Jammed);
                        const loadStatus = getStatus(real_Overload, sensor_Overload);

                        return (
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
                                        <td className={real_Jammed ? "val-danger" : "val-safe"}>{real_Jammed ? "있음 (True)" : "없음 (False)"}</td>
                                        <td className={sensor_Jammed ? "val-danger" : "val-safe"}>{sensor_Jammed ? "감지 (1)" : "미감지 (0)"}</td>
                                        <td className={`comp-result ${jamStatus.class}`}>{jamStatus.text}</td>
                                    </tr>
                                    <tr>
                                        <td className="comp-label">과부하 (Overload)</td>
                                        <td className={real_Overload ? "val-danger" : "val-safe"}>{real_Overload ? "초과 (True)" : "정상 (False)"}</td>
                                        <td className={sensor_Overload ? "val-danger" : "val-safe"}>{sensor_Overload ? "감지 (1)" : "미감지 (0)"}</td>
                                        <td className={`comp-result ${loadStatus.class}`}>{loadStatus.text}</td>
                                    </tr>
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