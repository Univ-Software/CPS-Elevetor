package com.cps.service;

import com.cps.domain.SensorData;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.RequiredArgsConstructor; // 생성자 주입용
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.simp.SimpMessagingTemplate; // 웹소켓 전송용
import org.springframework.stereotype.Service;

import java.time.format.DateTimeFormatter;

/**
 * Service for logging elevator sensor data and executing autonomous controls
 */
@Service
@Slf4j
@RequiredArgsConstructor // final 필드를 위한 생성자 자동 생성
public class ElevatorLoggerService {

    // [추가] 프론트엔드로 메시지를 보내기 위한 템플릿
    private final SimpMessagingTemplate messagingTemplate;

    private static final DateTimeFormatter TIMESTAMP_FORMATTER =
        DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss.SSS");

    /**
     * Log sensor data based on danger level
     */
    public void logSensorData(SensorData sensorData) {
        // Null check for dangerLevel string
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
            case LOW:
                log.debug("[LOW] {}", logMessage);
                break;
            case NORMAL:
                log.info("[NORMAL] {}", logMessage);
                break;
            case WATCH:
                log.warn("[WATCH] ⚠️ {}", logMessage);
                break;
            case CRITICAL:
                log.error("[CRITICAL] 🚨 {}", logMessage);
                break;
        }
    }

    /**
     * [핵심 추가] 센서 데이터를 분석하여 자율 제어 명령을 프론트엔드로 전송
     */
    public void analyzeAndSendCommand(SensorData data) {
        
        // --- 시나리오 1: 정위치 이탈 (Leveling Fault) ---
        // 조건: 차가 멈췄는데(Speed < 0.01), 실제 위치가 정수 층에서 0.1 이상 벗어남
        double positionError = Math.abs(data.getRealtimeFloor() - Math.round(data.getRealtimeFloor()));
        boolean isStopped = Math.abs(data.getSpeed()) < 0.01;

        if (isStopped && positionError > 0.1) {
            // 프론트엔드로 'FIX_ALIGNMENT' 명령 전송
            sendCommand("FIX_ALIGNMENT", "위치 오차가 감지되었습니다. 정위치 자동 보정을 실시합니다.");
        }

        // --- 시나리오 2: 문 끼임 (Jamming) ---
        // 조건: 끼임 센서가 True인데, 문이 닫히려고 함 (CLOSING / CLOSED)
        if (Boolean.TRUE.equals(data.getIsJammed())) {
            String status = data.getDoorStatus();
            if (status != null && ("CLOSING".equalsIgnoreCase(status) || "CLOSED".equalsIgnoreCase(status))) {
                // 프론트엔드로 'FORCE_OPEN' 명령 전송
                sendCommand("FORCE_OPEN", "장애물이 감지되었습니다. 안전을 위해 문을 다시 엽니다.");
            }
        }

        // --- 시나리오 3: 과부하 (Overload) ---
        // 조건: 과부하 센서가 True임
        if (Boolean.TRUE.equals(data.getIsOverloaded())) {
            // 프론트엔드로 'OVERLOAD_WARN' 명령 전송
            sendCommand("OVERLOAD_WARN", "정격 하중을 초과했습니다. 안전을 위해 탑승객은 내려주세요.");
        }
    }

    /**
     * [추가] 웹소켓 명령 전송 헬퍼 메서드
     */
    private void sendCommand(String type, String message) {
        // 내부 DTO 생성
        ControlCommand command = new ControlCommand(type, message);
        
        // '/topic/control' 채널로 발송 (프론트엔드가 구독 중)
        messagingTemplate.convertAndSend("/topic/control", command);
        
        log.info("📤 [Auto-Control] Sent Command: {}", type);
    }

    /**
     * Format sensor data into a readable log message
     */
    private String formatLogMessage(SensorData sensorData) {
        return String.format(
            "Elevator[%s] | Floor: %.2f (%d) | Speed: %.2f f/s | Door: %s | Direction: %s | " +
            "Overload: %s | Jammed: %s | Analysis: %s | Time: %s",
            sensorData.getElevatorId(),
            sensorData.getRealtimeFloor(),
            sensorData.getCurrentFloor(),
            sensorData.getSpeed(),
            sensorData.getDoorStatus(),
            sensorData.getDirection(),
            Boolean.TRUE.equals(sensorData.getIsOverloaded()) ? "YES" : "NO",
            Boolean.TRUE.equals(sensorData.getIsJammed()) ? "YES" : "NO",
            sensorData.getAnalysisMessage(),
            sensorData.getProcessedTimestamp() != null ? 
                sensorData.getProcessedTimestamp().format(TIMESTAMP_FORMATTER) : "N/A"
        );
    }

    /**
     * Log a custom message with specified danger level
     */
    public void log(DangerLevel level, String message) {
        switch (level) {
            case LOW:
                log.debug("[LOW] {}", message);
                break;
            case NORMAL:
                log.info("[NORMAL] {}", message);
                break;
            case WATCH:
                log.warn("[WATCH] ⚠️ {}", message);
                break;
            case CRITICAL:
                log.error("[CRITICAL] 🚨 {}", message);
                break;
        }
    }

    /**
     * Log system events
     */
    public void logSystemEvent(String event) {
        log.info("[SYSTEM] {}", event);
    }

    /**
     * [추가] 명령 전송용 내부 DTO 클래스
     */
    @Data
    @AllArgsConstructor
    public static class ControlCommand {
        private String type;
        private String message;
    }
}