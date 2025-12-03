package com.cps.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * DTO for sending analyzed sensor data back to frontend
 * Includes danger level and analysis results
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SensorDataResponse {
    private Long id;                    // Database record ID
    private String elevatorId;
    private Integer currentFloor;
    private Double realtimeFloor;
    private Double speed;
    private String doorStatus;
    private String direction;
    private Boolean isOverloaded;
    private Boolean isJammed;
    private String dangerLevel;         // LOW, NORMAL, WATCH, CRITICAL
    private String analysisMessage;     // Human-readable analysis result
    private String processedTimestamp;  // Server processing timestamp

    // 🔹 이 레코드를 생성할 때 프론트가 어떤 모드였는지(자율제어 ON/OFF)
    private Boolean autonomousMode;
}
