package com.cps.service;

import com.cps.domain.SensorData;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.format.DateTimeFormatter;

/**
 * Service for logging elevator sensor data with appropriate danger levels
 * Outputs formatted logs to backend console for monitoring
 */
@Service
@Slf4j
public class ElevatorLoggerService {

    private static final DateTimeFormatter TIMESTAMP_FORMATTER =
        DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss.SSS");

    /**
     * Log sensor data based on danger level
     */
    public void logSensorData(SensorData sensorData) {
        DangerLevel level = DangerLevel.valueOf(sensorData.getDangerLevel());

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
     * Format sensor data into a readable log message
     */
    private String formatLogMessage(SensorData sensorData) {
        return String.format(
            "Elevator[%s] | Floor: %d (%.2f) | Speed: %.2f f/s | Door: %s | Direction: %s | " +
            "Overload: %s | Jammed: %s | Analysis: %s | Time: %s",
            sensorData.getElevatorId(),
            sensorData.getCurrentFloor(),
            sensorData.getRealtimeFloor(),
            sensorData.getSpeed(),
            sensorData.getDoorStatus(),
            sensorData.getDirection(),
            sensorData.getIsOverloaded() ? "YES" : "NO",
            sensorData.getIsJammed() ? "YES" : "NO",
            sensorData.getAnalysisMessage(),
            sensorData.getProcessedTimestamp().format(TIMESTAMP_FORMATTER)
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
}
