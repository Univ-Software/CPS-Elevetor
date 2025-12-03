package com.cps.service;

import com.cps.domain.SensorData;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import java.time.format.DateTimeFormatter;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Service for logging elevator sensor data and executing autonomous controls
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class ElevatorLoggerService {

    private final SimpMessagingTemplate messagingTemplate;

    private static final DateTimeFormatter TIMESTAMP_FORMATTER =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss.SSS");

    // 상태 지속 시간 및 명령 쿨다운 관리용 맵
    private final Map<String, Long> misalignStartTime    = new ConcurrentHashMap<>();
    private final Map<String, Long> lastCommandTime      = new ConcurrentHashMap<>();
    private final Map<String, Double> lastRealtimePos    = new ConcurrentHashMap<>();
    // 🔹 문이 닫히려고 시도하는 구간이 오래 지속되는지(끼임 FN) 체크용
    private final Map<String, Long> jamClosingStartTime  = new ConcurrentHashMap<>();

    // 상수 설정
    private static final long COMMAND_COOLDOWN_MS      = 5000;   // 같은 명령 쿨다운
    private static final long MISALIGN_WAIT_MS         = 2000;   // 정위치 오차 지속 시간
    private static final long JAM_WAIT_MS              = 1500;   // 문 끼임 패턴 지속 시간
    private static final double STOP_SPEED_THRESHOLD   = 0.02;   // 정지로 간주할 속도
    private static final double POS_ERROR_THRESHOLD    = 0.1;    // 위치 오차 허용 범위 (층 사이인지 여부)
    private static final double MOVEMENT_EPSILON       = 0.02;   // "움직였다"로 볼 최소 위치 변화량

    public void logSensorData(SensorData sensorData) {
        String levelStr = sensorData.getDangerLevel();
        if (levelStr == null) levelStr = "NORMAL";
        DangerLevel level;
        try {
            level = DangerLevel.valueOf(levelStr);
        } catch (IllegalArgumentException e) {
            level = DangerLevel.NORMAL;
        }

        String logMessage = formatLogMessage(sensorData);
        switch (level) {
            case LOW -> log.debug("[LOW] {}", logMessage);
            case NORMAL -> log.info("[NORMAL] {}", logMessage);
            case WATCH -> log.warn("[WATCH] ⚠️ {}", logMessage);
            case CRITICAL -> log.error("[CRITICAL] 🚨 {}", logMessage);
        }
    }

    /**
     * [핵심] 센서 데이터를 분석하여 제어 명령을 프론트엔드로 전송
     *
     * ➜ autoMode에 따라:
     *    - true  : 센서 + 물리정보(속도, 위치, 문 상태, 시간)를 종합해 FP/FN을 최대한 보정하는 "자율 제어"
     *    - false : 센서 플래그를 거의 그대로 믿는 "센서 기반 모드"
     *
     * 프론트는 수신된 명령을 그대로 실행하며,
     * autoMode 값은 프론트/백엔드가 어떤 판단 방식을 사용 중인지 설명용 메타 정보로 쓰입니다.
     */
    public void analyzeAndSendCommand(SensorData data) {
        String elevatorId = data.getElevatorId();
        long currentTime  = System.currentTimeMillis();

        // 🔹 프론트에서 넘어온 자율제어 모드 (null → OFF 취급)
        boolean autoMode = Boolean.TRUE.equals(data.getAutonomousMode());
        String modeTag = autoMode ? "[자율제어] " : "[센서기반] ";

        // -------------------------------
        // 공통: 기본 신호 및 파생 값 계산
        // -------------------------------
        boolean sensorJam      = Boolean.TRUE.equals(data.getIsJammed());
        boolean sensorOverload = Boolean.TRUE.equals(data.getIsOverloaded());
        String doorStatusRaw   = data.getDoorStatus();
        String directionRaw    = data.getDirection();

        String doorStatus = doorStatusRaw == null ? "" : doorStatusRaw.toUpperCase();
        String direction  = directionRaw == null ? "" : directionRaw.toUpperCase();

        double currentPos = data.getRealtimeFloor();   // 실수 층값 (예: 3.84)
        double targetPos  = Math.round(currentPos);    // 가장 가까운 정수 층
        double error      = Math.abs(currentPos - targetPos);
        double speed      = Math.abs(data.getSpeed());

        // 이전 위치와 비교해서 "실제로 움직였는지" 확인
        Double prevPos = lastRealtimePos.put(elevatorId, currentPos);
        boolean hasMoved = false;
        if (prevPos != null) {
            hasMoved = Math.abs(currentPos - prevPos) > MOVEMENT_EPSILON;
        }

        boolean stoppedSample  = !hasMoved && speed <= STOP_SPEED_THRESHOLD;
        boolean misaligned     = error >= POS_ERROR_THRESHOLD;   // 층 사이에 걸쳐 있으면 true
        boolean aligned        = !misaligned;                    // 정위치 근처면 true

        boolean doorClosing    = "CLOSING".equals(doorStatus);
        boolean doorClosed     = "CLOSED".equals(doorStatus);
        boolean doorClosingOrClosed = doorClosing || doorClosed; // 일부 로직에서 사용

        long durationMs = 0L;
        Long startTs = misalignStartTime.get(elevatorId);

        // ===========================
        // ① autoMode = true (자율 제어 모드)
        //    → 여러 신호를 조합해 FP/FN 보정 시도
        // ===========================
        if (autoMode) {

            // ---------------------------
            // [Leveling] 정위치 이탈 추론
            //
            //  - 센서 플래그를 아예 안 쓴다.
            //  - 오로지 "위치 오차 + 정지 상태 + 시간" 으로만 이상 판단.
            //  - 센서 오염(FP/FN)과 무관하게, 실제 패턴이 이상하면 FIX_ALIGNMENT 전송.
            // ---------------------------
            if (stoppedSample && misaligned) {
                if (startTs == null) {
                    misalignStartTime.put(elevatorId, currentTime);
                } else {
                    durationMs = currentTime - startTs;
                    if (durationMs >= MISALIGN_WAIT_MS) {
                        if (checkCooldown(elevatorId, "LVL_FIX")) {
                            log.warn("🚨 [Auto-Control] 정위치 오차가 {} ms 동안 지속됨. 자동 수정 명령 전송!", durationMs);
                            sendCommand(
                                    elevatorId,
                                    "FIX_ALIGNMENT",
                                    modeTag + "위치 오차(층 사이에서 정지)가 일정 시간 이상 지속되어 정위치 자동 보정을 실시합니다."
                            );
                        }
                    }
                }
            } else {
                // 움직이거나, 오차가 사라지면 타이머 리셋
                misalignStartTime.remove(elevatorId);
            }

            // ---------------------------
            // [Jamming] 문 끼임 추론
            //
            //   ✦ 중요한 포인트:
            //   - "층 사이(misaligned=true)"에서는 어떤 패턴이 와도
            //     ⇒ 절대 끼임으로 보지 않는다. (문을 열면 안 되기 때문)
            //
            //   (1) 센서 + 문 상태 조합으로 "신뢰 가능한 끼임"만 인정
            //       - sensorJam == true
            //       - doorStatus == CLOSING   (닫히는 중)
            //       - 엘리베이터는 정지 상태(stoppedSample)
            //       - 정위치 근처(aligned)
            //
            //   (2) FN 보정:
            //       - sensorJam == false 이어도
            //       - doorStatus == CLOSING
            //       - aligned && stoppedSample
            //       - 이 패턴이 JAM_WAIT_MS 이상 지속
            //         → 끼임 또는 문 고장으로 추론
            //
            //   (3) FP 보정:
            //       - sensorJam == true 인데
            //         · doorStatus 가 OPEN/OPENING 이거나
            //         · 엘리베이터가 움직이는 중(hasMoved || 속도 큼)
            //         ⇒ 센서 오탐으로 보고 무시 (로그만 남김)
            //
            //   ※ 실제 로그에서 보였던 버그:
            //     - 층 사이에서 멈춰 있음(misaligned=true) + CLOSED + 정지
            //     - jamDuration이 쌓여서 문 끼임으로 오해 → FORCE_OPEN 반복
            //     ⇒ 이번 수정으로 'aligned && CLOSING' 조건을 넣어 제거
            // ---------------------------
            long jamDuration = 0L;
            Long jamStartTs = jamClosingStartTime.get(elevatorId);

            // 층 정위치 근처 + 문이 "닫히는 중" + 정지 상태일 때만 끼임 후보로 본다.
            if (aligned && doorClosing && stoppedSample) {
                if (jamStartTs == null) {
                    jamClosingStartTime.put(elevatorId, currentTime);
                } else {
                    jamDuration = currentTime - jamStartTs;
                }
            } else {
                jamClosingStartTime.remove(elevatorId);
            }

            boolean jamBySensorReliable =
                    sensorJam && aligned && doorClosing && stoppedSample;

            boolean jamByPatternWithoutSensor =
                    !sensorJam && aligned && doorClosing && stoppedSample && jamDuration >= JAM_WAIT_MS;

            boolean jamInferred = jamBySensorReliable || jamByPatternWithoutSensor;

            // 센서와 추론이 상충하면 로그로 남겨서 "센서 오탐/미탐"을 관찰 가능하게
            if (sensorJam && !jamInferred) {
                // 센서가 말하는 끼임인데, 실제 패턴상 끼임 조건이 안 맞음 → 오탐 의심
                log.warn("⚠️ [Auto-Control] Jamming 센서 오탐 의심: elev={} doorStatus={} speed={} aligned={} moving={}",
                        elevatorId, doorStatus, speed, aligned, hasMoved);
            }
            if (!sensorJam && jamByPatternWithoutSensor) {
                // 패턴상 끼임이 확실한데 센서가 조용함 → 미탐 의심
                log.warn("⚠️ [Auto-Control] Jamming 센서 미탐 의심: elev={} doorStatus={} speed={} jamDuration={}",
                        elevatorId, doorStatus, speed, jamDuration);
            }

            // ⚠️ 정위치 실패(misaligned=true) 상태에서는 어떤 끼임 패턴도 강제 문열기 하지 않음
            if (jamInferred && aligned && !misaligned && checkCooldown(elevatorId, "JAM")) {
                sendCommand(
                        elevatorId,
                        "FORCE_OPEN",
                        modeTag + "문 닫힘 + 정지 상태가 비정상적으로 지속되어, 문 끼임/문 고장을 의심하고 문을 다시 엽니다."
                );
            }

            // ---------------------------
            // [Overload] 과부하 추론
            //
            //   현재 넘어오는 정보에 "실제 하중"은 없으므로,
            //   센서가 주는 isOverloaded 값에 의존할 수밖에 없음.
            //
            //   다만 FP를 조금 줄이기 위해:
            //   - '정지 상태(stoppedSample)' 에서만 센서를 신뢰
            //   - 이미 속도가 크거나(hasMoved) 이동 중인 상황에서의
            //     과부하 신호는 우선 노이즈로 간주 (로그만 남김)
            //
            //   → 미탐(FN)은 현 정보로는 근본적으로 복구 불가 (정직하게 명시)
            // ---------------------------
            boolean overloadCandidate = sensorOverload && stoppedSample;

            if (sensorOverload && !overloadCandidate) {
                log.warn("⚠️ [Auto-Control] Overload 센서 오탐 의심: elev={} speed={} doorStatus={} moving={}",
                        elevatorId, speed, doorStatus, hasMoved);
            }

            if (overloadCandidate && checkCooldown(elevatorId, "OVL")) {
                sendCommand(
                        elevatorId,
                        "OVERLOAD_WARN",
                        modeTag + "정지 상태에서 과부하가 감지되었습니다. 정격 하중을 초과하므로 탑승객을 줄여주세요."
                );
            }

        // ===========================
        // ② autoMode = false (센서 기반 모드)
        //    → 넘어오는 센서 플래그를 거의 그대로 신뢰
        // ===========================
        } else {
            // 정위치: 구형 시스템이라고 가정하고, 별도 자동 보정은 수행하지 않음
            misalignStartTime.remove(elevatorId);
            jamClosingStartTime.remove(elevatorId);

            // Jamming: 센서만 보고 즉시 대응
            if (sensorJam && checkCooldown(elevatorId, "JAM")) {
                sendCommand(
                        elevatorId,
                        "FORCE_OPEN",
                        modeTag + "문 끼임 센서가 활성화되었습니다. 문을 다시 엽니다."
                );
            }

            // Overload: 센서만 보고 즉시 경고
            if (sensorOverload && checkCooldown(elevatorId, "OVL")) {
                sendCommand(
                        elevatorId,
                        "OVERLOAD_WARN",
                        modeTag + "과부하 센서가 활성화되었습니다. 탑승 인원을 줄여주세요."
                );
            }
        }

        // 디버그용 레벨링 로그 (백엔드 튜닝용)
        log.debug(
                "[LEVELING] elev={} pos={} target={} err={} speed={} moved={} stoppedSample={} misaligned={} durationMs={} autoMode={}",
                elevatorId,
                String.format("%.2f", currentPos),
                String.format("%.0f", targetPos),
                String.format("%.2f", error),
                String.format("%.3f", speed),
                hasMoved,
                stoppedSample,
                misaligned,
                durationMs,
                autoMode ? "ON" : "OFF"
        );
    }

    /**
     * 명령 전송 쿨다운 체크 (도배 방지)
     *
     * @param type 명령 구분 키 (엘리베이터ID + 타입)
     */
    private boolean checkCooldown(String elevatorId, String type) {
        String key = elevatorId + "_" + type;
        long currentTime = System.currentTimeMillis();
        long lastTime = lastCommandTime.getOrDefault(key, 0L);

        if (currentTime - lastTime > COMMAND_COOLDOWN_MS) {
            lastCommandTime.put(key, currentTime);
            return true; // 전송 허용
        }
        return false; // 쿨다운 중
    }

    private void sendCommand(String elevatorId, String type, String message) {
        ControlCommand command = new ControlCommand(type, message);
        messagingTemplate.convertAndSend("/topic/control", command);
        log.info("📤 [Auto-Control] Sent Command to {}: {} - {}", elevatorId, type, message);
    }

    private String formatLogMessage(SensorData sensorData) {
        String modeStr = Boolean.TRUE.equals(sensorData.getAutonomousMode()) ? "AUTO" : "MANUAL";
        return String.format(
                "Mode: %s | Elevator[%s] | Floor: %.2f (%d) | Speed: %.2f f/s | Door: %s | Direction: %s | " +
                        "Overload: %s | Jammed: %s | Analysis: %s",
                modeStr,
                sensorData.getElevatorId(),
                sensorData.getRealtimeFloor(),
                sensorData.getCurrentFloor(),
                sensorData.getSpeed(),
                sensorData.getDoorStatus(),
                sensorData.getDirection(),
                Boolean.TRUE.equals(sensorData.getIsOverloaded()) ? "YES" : "NO",
                Boolean.TRUE.equals(sensorData.getIsJammed()) ? "YES" : "NO",
                sensorData.getAnalysisMessage()
        );
    }

    public void log(DangerLevel level, String message) {
        // 필요하다면 기존 커스텀 로그 메서드 구현
    }

    @Data
    @AllArgsConstructor
    public static class ControlCommand {
        private String type;
        private String message;
    }
}
