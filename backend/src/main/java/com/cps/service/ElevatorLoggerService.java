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
    private final Map<String, Long> misalignStartTime = new ConcurrentHashMap<>();
    private final Map<String, Long> lastCommandTime = new ConcurrentHashMap<>();

    // 이전 실시간 위치 (정지 여부 판정용)
    private final Map<String, Double> lastRealtimePos = new ConcurrentHashMap<>();

    // 상수 설정
    private static final long COMMAND_COOLDOWN_MS = 5000;   // 같은 명령 쿨다운
    private static final long MISALIGN_WAIT_MS   = 2000;    // 정위치 오차 지속 시간
    private static final double STOP_SPEED_THRESHOLD = 0.02;  // 정지로 간주할 속도
    private static final double POS_ERROR_THRESHOLD  = 0.1;   // 위치 오차 허용 범위
    private static final double MOVEMENT_EPSILON     = 0.02;  // "움직였다"로 볼 최소 위치 변화량

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
     * [핵심] 센서 데이터를 분석하여 자율 제어 명령을 프론트엔드로 전송
     */
    public void analyzeAndSendCommand(SensorData data) {
        String elevatorId = data.getElevatorId();
        long currentTime = System.currentTimeMillis();

        // ===========================
        // 시나리오 1: 정위치 이탈 (Leveling Fault)
        // ===========================

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

        // 1) "정지 상태" 판정: 속도가 거의 0이고, 위치도 더 이상 변하지 않는 경우
        boolean stoppedSample = !hasMoved && speed <= STOP_SPEED_THRESHOLD;

        // 2) "정위치 오차" 판정
        // 🔥 변경 포인트: "0.1 이상"이면 오차로 본다 (>=)
        boolean misaligned = error >= POS_ERROR_THRESHOLD;

        long durationMs = 0L;
        Long startTs = misalignStartTime.get(elevatorId);

        if (stoppedSample && misaligned) {
            // 처음 감지되면 시작 시각 기록
            if (startTs == null) {
                misalignStartTime.put(elevatorId, currentTime);
            } else {
                durationMs = currentTime - startTs;
                // 오차 상태 + 정지 상태가 2초 이상 지속
                if (durationMs >= MISALIGN_WAIT_MS) {
                    if (checkCooldown(elevatorId, "LVL_FIX")) {
                        log.warn("🚨 [Auto-Control] 정위치 오차가 {} ms 동안 지속됨. 자동 수정 명령 전송!", durationMs);
                        sendCommand(
                                elevatorId,
                                "FIX_ALIGNMENT",
                                "위치 오차가 감지되었습니다. 정위치 자동 보정을 실시합니다."
                        );
                    }
                }
            }
        } else {
            // 움직이거나, 오차가 사라지면 타이머 리셋
            misalignStartTime.remove(elevatorId);
        }

        // 디버그용 레벨링 로그 (백엔드 튜닝용)
        log.debug(
                "[LEVELING] elev={} pos={} target={} err={} speed={} moved={} stoppedSample={} misaligned={} durationMs={}",
                elevatorId,
                String.format("%.2f", currentPos),
                String.format("%.0f", targetPos),
                String.format("%.2f", error),
                String.format("%.3f", speed),
                hasMoved,
                stoppedSample,
                misaligned,
                durationMs
        );

        // ===========================
        // 시나리오 2: 문 끼임 (Jamming)
        // ===========================
        if (Boolean.TRUE.equals(data.getIsJammed())) {
            String status = data.getDoorStatus();
            if (status != null &&
                    ("CLOSING".equalsIgnoreCase(status) || "CLOSED".equalsIgnoreCase(status))) {
                if (checkCooldown(elevatorId, "JAM")) {
                    sendCommand(
                            elevatorId,
                            "FORCE_OPEN",
                            "장애물이 감지되었습니다. 안전을 위해 문을 다시 엽니다."
                    );
                }
            }
        }

        // ===========================
        // 시나리오 3: 과부하 (Overload)
        // ===========================
        if (Boolean.TRUE.equals(data.getIsOverloaded())) {
            if (checkCooldown(elevatorId, "OVL")) {
                sendCommand(
                        elevatorId,
                        "OVERLOAD_WARN",
                        "정격 하중을 초과했습니다. 안전을 위해 탑승객은 내려주세요."
                );
            }
        }
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
        log.info("📤 [Auto-Control] Sent Command to {}: {}", elevatorId, type);
    }

    private String formatLogMessage(SensorData sensorData) {
        return String.format(
                "Elevator[%s] | Floor: %.2f (%d) | Speed: %.2f f/s | Door: %s | Direction: %s | " +
                        "Overload: %s | Jammed: %s | Analysis: %s",
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
