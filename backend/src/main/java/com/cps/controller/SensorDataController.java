package com.cps.controller;

import com.cps.domain.SensorData;
import com.cps.dto.SensorDataRequest;
import com.cps.dto.SensorDataResponse;
import com.cps.repository.SensorDataRepository;
import com.cps.service.DangerLevel;
import com.cps.service.ElevatorLoggerService;
import com.cps.service.ElevatorStateTracker;
import com.cps.service.SensorAnalysisService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.SendTo;
import org.springframework.stereotype.Controller;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

/**
 * WebSocket controller for handling elevator sensor data
 * Flow: Receive → Parse → Analyze → Check State Change → Save (if changed) → Log (if changed) → Respond
 */
@Controller
@RequiredArgsConstructor
@Slf4j
public class SensorDataController {

    private final SensorDataRepository sensorDataRepository;
    private final SensorAnalysisService analysisService;
    private final ElevatorLoggerService loggerService;
    private final ElevatorStateTracker stateTracker;

    /**
     * Endpoint for receiving sensor data from frontend
     * Frontend sends to: /app/sensor-data
     * Response broadcasts to: /topic/sensor-response
     */
    @MessageMapping("/sensor-data")
    @SendTo("/topic/sensor-response")
    public SensorDataResponse processSensorData(SensorDataRequest request) {
        try {
            // Step 1: Validate Request
            if (!analysisService.validateRequest(request)) {
                log.error("Invalid sensor data request received");
                return buildErrorResponse("Invalid request data");
            }

            // Step 2: Parse timestamp
            LocalDateTime receivedTimestamp = parseTimestamp(request.getTimestamp());

            // Step 3: Analyze danger level
            DangerLevel dangerLevel = analysisService.analyzeDangerLevel(request);
            String analysisMessage = analysisService.generateAnalysisMessage(request, dangerLevel);

            // Step 4: Check if this state change should be saved and logged
            boolean shouldSaveAndLog = stateTracker.shouldSaveAndLog(request, dangerLevel);

            if (shouldSaveAndLog) {
                // Step 5: Build and save entity to database
                SensorData sensorData = buildSensorData(request, dangerLevel, analysisMessage, receivedTimestamp);
                SensorData savedData = sensorDataRepository.save(sensorData);

                // Step 6: Log with appropriate danger level
                loggerService.logSensorData(savedData);

                // Step 6-1: 자율 제어 분석 및 명령 전송 실행
                loggerService.analyzeAndSendCommand(savedData);

                // Step 7: Build and return response (broadcast to frontend)
                return buildSuccessResponse(savedData);
            } else {
                // State hasn't changed significantly - don't save, don't log, don't broadcast
                log.trace("Skipping save/log for unchanged state: {} - {}", request.getElevatorId(), dangerLevel);
                return null; // Returning null prevents broadcast to /topic/sensor-response
            }

        } catch (Exception e) {
            log.error("Error processing sensor data: {}", e.getMessage(), e);
            loggerService.log(DangerLevel.CRITICAL, "Error processing sensor data: " + e.getMessage());
            return buildErrorResponse("Error processing sensor data: " + e.getMessage());
        }
    }

    // --- Helper Methods ---

    private SensorData buildSensorData(SensorDataRequest request,
                                       DangerLevel dangerLevel,
                                       String analysisMessage,
                                       LocalDateTime receivedTimestamp) {
        return SensorData.builder()
                .elevatorId(request.getElevatorId())
                .currentFloor(request.getCurrentFloor())
                .realtimeFloor(request.getRealtimeFloor())
                .speed(request.getSpeed())
                .doorStatus(request.getDoorStatus())
                .direction(request.getDirection())
                .isOverloaded(request.getIsOverloaded())
                .isJammed(request.getIsJammed())
                .dangerLevel(dangerLevel.name())
                .analysisMessage(analysisMessage)
                .receivedTimestamp(receivedTimestamp)
                // 🔹 프론트에서 온 자율제어 모드 플래그 그대로 저장
                .autonomousMode(request.getAutonomousMode())
                .build();
    }

    private SensorDataResponse buildSuccessResponse(SensorData savedData) {
        return SensorDataResponse.builder()
                .id(savedData.getId())
                .elevatorId(savedData.getElevatorId())
                .currentFloor(savedData.getCurrentFloor())
                .realtimeFloor(savedData.getRealtimeFloor())
                .speed(savedData.getSpeed())
                .doorStatus(savedData.getDoorStatus())
                .direction(savedData.getDirection())
                .isOverloaded(savedData.getIsOverloaded())
                .isJammed(savedData.getIsJammed())
                .dangerLevel(savedData.getDangerLevel())
                .analysisMessage(savedData.getAnalysisMessage())
                .processedTimestamp(savedData.getProcessedTimestamp().toString())
                // 🔹 응답에도 자율제어 모드 포함 (원하면 프론트에서 표시 가능)
                .autonomousMode(savedData.getAutonomousMode())
                .build();
    }

    private SensorDataResponse buildErrorResponse(String errorMessage) {
        return SensorDataResponse.builder()
                .id(-1L)
                .dangerLevel("CRITICAL")
                .analysisMessage(errorMessage)
                .processedTimestamp(LocalDateTime.now().toString())
                .build();
    }

    private LocalDateTime parseTimestamp(String timestamp) {
        try {
            if (timestamp != null && !timestamp.isEmpty()) {
                return LocalDateTime.parse(timestamp, DateTimeFormatter.ISO_DATE_TIME);
            }
        } catch (Exception e) {
            log.warn("Failed to parse timestamp: {}", timestamp);
        }
        return LocalDateTime.now();
    }
}
