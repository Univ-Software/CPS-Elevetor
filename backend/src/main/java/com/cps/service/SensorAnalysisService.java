package com.cps.service;

import com.cps.dto.SensorDataRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * Service for analyzing elevator sensor data and determining danger levels
 * Implements analysis logic to classify sensor data into LOW, NORMAL, WATCH, or CRITICAL
 */
@Service
@Slf4j
public class SensorAnalysisService {

    // Thresholds for analysis
    private static final double HIGH_SPEED_THRESHOLD = 2.0;  // floors per second
    private static final double MISALIGNMENT_THRESHOLD = 0.15;  // deviation from floor center
    private static final double CRITICAL_MISALIGNMENT = 0.35;   // severe misalignment

    /**
     * Analyze sensor data and determine danger level
     * @return DangerLevel enum value
     */
    public DangerLevel analyzeDangerLevel(SensorDataRequest request) {
        List<String> issues = new ArrayList<>();
        DangerLevel dangerLevel = DangerLevel.LOW;

        // Check for critical conditions (highest priority)
        if (Boolean.TRUE.equals(request.getIsJammed())) {
            issues.add("Door jammed");
            dangerLevel = DangerLevel.CRITICAL;
        }

        if (Boolean.TRUE.equals(request.getIsOverloaded())) {
            issues.add("Elevator overloaded");
            if (dangerLevel.ordinal() < DangerLevel.CRITICAL.ordinal()) {
                dangerLevel = DangerLevel.CRITICAL;
            }
        }

        // Check for severe misalignment
        if (request.getRealtimeFloor() != null && request.getCurrentFloor() != null) {
            double misalignment = Math.abs(request.getRealtimeFloor() - request.getCurrentFloor());
            if (misalignment > CRITICAL_MISALIGNMENT && "IDLE".equalsIgnoreCase(request.getDirection())) {
                issues.add(String.format("Severe position misalignment: %.2f floors", misalignment));
                if (dangerLevel.ordinal() < DangerLevel.CRITICAL.ordinal()) {
                    dangerLevel = DangerLevel.CRITICAL;
                }
            } else if (misalignment > MISALIGNMENT_THRESHOLD && "IDLE".equalsIgnoreCase(request.getDirection())) {
                issues.add(String.format("Position misalignment detected: %.2f floors", misalignment));
                if (dangerLevel.ordinal() < DangerLevel.WATCH.ordinal()) {
                    dangerLevel = DangerLevel.WATCH;
                }
            }
        }

        // Check for speed anomalies (watch level)
        if (request.getSpeed() != null && Math.abs(request.getSpeed()) > HIGH_SPEED_THRESHOLD) {
            issues.add(String.format("High speed detected: %.2f f/s", request.getSpeed()));
            if (dangerLevel.ordinal() < DangerLevel.WATCH.ordinal()) {
                dangerLevel = DangerLevel.WATCH;
            }
        }

        // Check door status during movement (watch level)
        if ("OPEN".equalsIgnoreCase(request.getDoorStatus()) &&
            !"IDLE".equalsIgnoreCase(request.getDirection())) {
            issues.add("Door open during movement");
            if (dangerLevel.ordinal() < DangerLevel.WATCH.ordinal()) {
                dangerLevel = DangerLevel.WATCH;
            }
        }

        // If no issues, determine between LOW and NORMAL
        if (issues.isEmpty()) {
            if ("IDLE".equalsIgnoreCase(request.getDirection()) &&
                "CLOSED".equalsIgnoreCase(request.getDoorStatus())) {
                dangerLevel = DangerLevel.LOW;
            } else {
                dangerLevel = DangerLevel.NORMAL;
            }
        }

        return dangerLevel;
    }

    /**
     * Generate analysis message based on sensor data
     */
    public String generateAnalysisMessage(SensorDataRequest request, DangerLevel dangerLevel) {
        List<String> observations = new ArrayList<>();

        // Critical issues
        if (Boolean.TRUE.equals(request.getIsJammed())) {
            observations.add("DOOR JAMMED - Immediate attention required");
        }
        if (Boolean.TRUE.equals(request.getIsOverloaded())) {
            observations.add("OVERLOAD DETECTED - Reduce load immediately");
        }

        // Misalignment check
        if (request.getRealtimeFloor() != null && request.getCurrentFloor() != null) {
            double misalignment = Math.abs(request.getRealtimeFloor() - request.getCurrentFloor());
            if (misalignment > CRITICAL_MISALIGNMENT && "IDLE".equalsIgnoreCase(request.getDirection())) {
                observations.add(String.format("SEVERE MISALIGNMENT: %.2f floors off target", misalignment));
            } else if (misalignment > MISALIGNMENT_THRESHOLD && "IDLE".equalsIgnoreCase(request.getDirection())) {
                observations.add(String.format("Misalignment detected: %.2f floors", misalignment));
            }
        }

        // Speed check
        if (request.getSpeed() != null && Math.abs(request.getSpeed()) > HIGH_SPEED_THRESHOLD) {
            observations.add(String.format("High speed: %.2f f/s", request.getSpeed()));
        }

        // Door status check
        if ("OPEN".equalsIgnoreCase(request.getDoorStatus()) &&
            !"IDLE".equalsIgnoreCase(request.getDirection())) {
            observations.add("Door open during movement - Safety concern");
        }

        // Default messages based on danger level
        if (observations.isEmpty()) {
            switch (dangerLevel) {
                case LOW:
                    return "System idle, all parameters normal";
                case NORMAL:
                    return String.format("Normal operation: %s movement, door %s",
                        request.getDirection().toLowerCase(),
                        request.getDoorStatus().toLowerCase());
                case WATCH:
                    return "Monitoring elevated parameters";
                case CRITICAL:
                    return "Critical condition detected";
            }
        }

        return String.join("; ", observations);
    }

    /**
     * Validate sensor data request
     */
    public boolean validateRequest(SensorDataRequest request) {
        if (request == null) {
            log.warn("Received null sensor data request");
            return false;
        }

        if (request.getElevatorId() == null || request.getElevatorId().isEmpty()) {
            log.warn("Elevator ID is missing in request");
            return false;
        }

        if (request.getCurrentFloor() == null || request.getRealtimeFloor() == null) {
            log.warn("Floor data is missing in request");
            return false;
        }

        return true;
    }
}
