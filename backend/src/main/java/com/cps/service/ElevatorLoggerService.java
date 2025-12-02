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

    // 상수 설정
    private static final long COMMAND_COOLDOWN_MS = 5000;
    private static final long MISALIGN_WAIT_MS = 2000;
    private static final double STOP_SPEED_THRESHOLD = 0.01; // 정지로 간주할 속도
    private static final double POS_ERROR_THRESHOLD = 0.1;   // 위치 오차 허용 범위

    public void logSensorData(SensorData sensorData) {
        String levelStr = sensorData.getDangerLevel();
        if (levelStr == null) levelStr = "NORMAL";
        DangerLevel level;
        try { level = DangerLevel.valueOf(levelStr); } 
        catch (IllegalArgumentException e) { level = DangerLevel.NORMAL; }

        String logMessage = formatLogMessage(sensorData);
        switch (level) {
            case LOW: log.debug("[LOW] {}", logMessage); break;
            case NORMAL: log.info("[NORMAL] {}", logMessage); break;
            case WATCH: log.warn("[WATCH] ⚠️ {}", logMessage); break;
            case CRITICAL: log.error("[CRITICAL] 🚨 {}", logMessage); break;
        }
    }

    /**
     * [핵심] 센서 데이터를 분석하여 자율 제어 명령을 프론트엔드로 전송
     */
    public void analyzeAndSendCommand(SensorData data) {
        String elevatorId = data.getElevatorId();
        long currentTime = System.currentTimeMillis();

        // --------------------------------------------------------
        // 시나리오 1: 정위치 이탈 (Leveling Fault)
        // 조건: 완전 정지(Speed~0) + 위치 오차(Error>0.1) + 2초 이상 지속
        // --------------------------------------------------------
        
        double currentPos = data.getRealtimeFloor();
        // 가장 가까운 정수 층 (예: 2.3층이면 2층, 2.7층이면 3층)
        double targetPos = Math.round(currentPos); 
        double error = Math.abs(currentPos - targetPos);
        double speed = Math.abs(data.getSpeed());

        // 1. 현재 상태가 "멈췄고 & 위치가 틀렸는지" 확인
        // (이동 중에는 speed > 0.01 이므로 false가 됨)
        boolean isSuspicious = (speed <= STOP_SPEED_THRESHOLD) && (error > POS_ERROR_THRESHOLD);

        if (isSuspicious) {
            // 의심스러운 상태가 처음 발생했으면 시간 기록
            misalignStartTime.putIfAbsent(elevatorId, currentTime);
            
            long duration = currentTime - misalignStartTime.get(elevatorId);

            // 2. 이 상태가 2초(MISALIGN_WAIT_MS) 넘게 지속되었는지 확인
            if (duration > MISALIGN_WAIT_MS) {
                // 3. 쿨다운 체크 후 명령 전송
                if (checkCooldown(elevatorId, "FIX")) {
                    log.warn("🚨 [Auto-Control] 정위치 오차 {}초 지속됨. 자동 수정 명령 전송!", duration / 1000);
                    sendCommand(elevatorId, "FIX_ALIGNMENT", "위치 오차가 감지되었습니다. 정위치 자동 보정을 실시합니다.");
                }
            }
        } else {
            // 움직이고 있거나 정위치라면 타이머 즉시 리셋!
            // (이 코드가 있어서 이동 중에는 절대 명령이 안 나감)
            misalignStartTime.remove(elevatorId);
        }

        // --------------------------------------------------------
        // 시나리오 2: 문 끼임 (Jamming)
        // --------------------------------------------------------
        if (Boolean.TRUE.equals(data.getIsJammed())) {
            String status = data.getDoorStatus();
            if (status != null && ("CLOSING".equalsIgnoreCase(status) || "CLOSED".equalsIgnoreCase(status))) {
                if (checkCooldown(elevatorId, "JAM")) {
                    sendCommand(elevatorId, "FORCE_OPEN", "장애물이 감지되었습니다. 안전을 위해 문을 다시 엽니다.");
                }
            }
        }

        // --------------------------------------------------------
        // 시나리오 3: 과부하 (Overload)
        // --------------------------------------------------------
        if (Boolean.TRUE.equals(data.getIsOverloaded())) {
            if (checkCooldown(elevatorId, "OVL")) {
                sendCommand(elevatorId, "OVERLOAD_WARN", "정격 하중을 초과했습니다. 안전을 위해 탑승객은 내려주세요.");
            }
        }
    }

    /**
     * 명령 전송 쿨다운 체크 (도배 방지)
     * @param key 명령 구분 키 (엘리베이터ID + 타입)
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
        log.info("📤 [Auto-Control] Sent Command: {}", type);
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
        // (기존 로그 메서드 유지)
    }

    @Data
    @AllArgsConstructor
    public static class ControlCommand {
        private String type;
        private String message;
    }
}