package com.cps.controller;

import com.cps.domain.SensorData;
import com.cps.dto.SensorDataResponse;
import com.cps.repository.SensorDataRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.stream.Collectors;

/**
 * REST API controller for querying saved sensor data
 * Provides endpoints to retrieve sensor data history from database
 */
@RestController
@RequestMapping("/api/sensor-data")
@RequiredArgsConstructor
public class SensorDataRestController {

    private final SensorDataRepository sensorDataRepository;

    /**
     * Get all sensor data records
     * GET /api/sensor-data
     */
    @GetMapping
    public ResponseEntity<List<SensorDataResponse>> getAllSensorData() {
        List<SensorData> data = sensorDataRepository.findAll();
        List<SensorDataResponse> responses = data.stream()
                .map(this::convertToResponse)
                .collect(Collectors.toList());
        return ResponseEntity.ok(responses);
    }

    /**
     * Get sensor data by elevator ID
     * GET /api/sensor-data/elevator/{elevatorId}
     */
    @GetMapping("/elevator/{elevatorId}")
    public ResponseEntity<List<SensorDataResponse>> getByElevatorId(@PathVariable String elevatorId) {
        List<SensorData> data = sensorDataRepository.findByElevatorIdOrderByProcessedTimestampDesc(elevatorId);
        List<SensorDataResponse> responses = data.stream()
                .map(this::convertToResponse)
                .collect(Collectors.toList());
        return ResponseEntity.ok(responses);
    }

    /**
     * Get latest N records for an elevator
     * GET /api/sensor-data/elevator/{elevatorId}/latest?limit=10
     */
    @GetMapping("/elevator/{elevatorId}/latest")
    public ResponseEntity<List<SensorDataResponse>> getLatestByElevatorId(
            @PathVariable String elevatorId,
            @RequestParam(defaultValue = "10") int limit) {
        List<SensorData> data = sensorDataRepository.findLatestByElevatorId(elevatorId, limit);
        List<SensorDataResponse> responses = data.stream()
                .map(this::convertToResponse)
                .collect(Collectors.toList());
        return ResponseEntity.ok(responses);
    }

    /**
     * Get sensor data by danger level
     * GET /api/sensor-data/danger-level/{level}
     */
    @GetMapping("/danger-level/{level}")
    public ResponseEntity<List<SensorDataResponse>> getByDangerLevel(@PathVariable String level) {
        List<SensorData> data = sensorDataRepository.findByDangerLevelOrderByProcessedTimestampDesc(level.toUpperCase());
        List<SensorDataResponse> responses = data.stream()
                .map(this::convertToResponse)
                .collect(Collectors.toList());
        return ResponseEntity.ok(responses);
    }

    /**
     * Get count of records by danger level
     * GET /api/sensor-data/stats/danger-level/{level}/count
     */
    @GetMapping("/stats/danger-level/{level}/count")
    public ResponseEntity<Long> countByDangerLevel(@PathVariable String level) {
        long count = sensorDataRepository.countByDangerLevel(level.toUpperCase());
        return ResponseEntity.ok(count);
    }

    /**
     * Get a single sensor data record by ID
     * GET /api/sensor-data/{id}
     */
    @GetMapping("/{id}")
    public ResponseEntity<SensorDataResponse> getById(@PathVariable Long id) {
        return sensorDataRepository.findById(id)
                .map(this::convertToResponse)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Convert entity to response DTO
     */
    private SensorDataResponse convertToResponse(SensorData data) {
        return SensorDataResponse.builder()
                .id(data.getId())
                .elevatorId(data.getElevatorId())
                .currentFloor(data.getCurrentFloor())
                .realtimeFloor(data.getRealtimeFloor())
                .speed(data.getSpeed())
                .doorStatus(data.getDoorStatus())
                .direction(data.getDirection())
                .isOverloaded(data.getIsOverloaded())
                .isJammed(data.getIsJammed())
                .dangerLevel(data.getDangerLevel())
                .analysisMessage(data.getAnalysisMessage())
                .processedTimestamp(data.getProcessedTimestamp().toString())
                .build();
    }
}
