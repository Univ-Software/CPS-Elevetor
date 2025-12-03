package com.cps.service;

import com.cps.dto.SensorDataRequest;
import lombok.Data;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Service for tracking elevator state changes
 * Prevents redundant database saves and logs for unchanged states
 *
 * Logging Strategy:
 * - LOW (idle): Log once when entering idle, then skip until state changes
 * - NORMAL (active): Log periodically (every 1 second) or when significant position change
 * - WATCH/CRITICAL: Always log immediately
 */
@Service
public class ElevatorStateTracker {

    private final Map<String, ElevatorState> stateMap = new ConcurrentHashMap<>();

    // For NORMAL states, log every N seconds during continuous movement
    private static final long NORMAL_LOG_INTERVAL_SECONDS = 1;

    // Position change threshold to trigger logging (in floors)
    private static final double POSITION_CHANGE_THRESHOLD = 0.3;

    /**
     * Check if this sensor data represents a significant change that should be saved
     * Returns true if:
     * - This is the first data from this elevator
     * - Danger level changed
     * - Door status changed
     * - Direction changed
     * - Floor changed
     * - Position changed significantly during movement
     * - Overload/Jammed status changed
     * - Time-based logging for active states (NORMAL)
     *
     * For LOW (idle) states, only save once when entering idle
     */
    public boolean shouldSaveAndLog(SensorDataRequest request, DangerLevel dangerLevel) {
        String elevatorId = request.getElevatorId();
        long currentTime = System.currentTimeMillis();

        // First time seeing this elevator - always save
        if (!stateMap.containsKey(elevatorId)) {
            updateState(elevatorId, request, dangerLevel, currentTime);
            return true;
        }

        ElevatorState previousState = stateMap.get(elevatorId);

        // Check for significant changes
        boolean dangerLevelChanged = !previousState.getDangerLevel().equals(dangerLevel);
        boolean doorStatusChanged = !previousState.getDoorStatus().equals(request.getDoorStatus());
        boolean directionChanged = !previousState.getDirection().equals(request.getDirection());
        boolean floorChanged = !previousState.getCurrentFloor().equals(request.getCurrentFloor());
        boolean overloadChanged = !previousState.getIsOverloaded().equals(request.getIsOverloaded());
        boolean jammedChanged = !previousState.getIsJammed().equals(request.getIsJammed());

        // Check for significant position change (for detecting movement)
        double positionChange = Math.abs(request.getRealtimeFloor() - previousState.getRealtimeFloor());
        boolean significantPositionChange = positionChange >= POSITION_CHANGE_THRESHOLD;

        // WATCH and CRITICAL states - always log immediately
        if (dangerLevel == DangerLevel.WATCH || dangerLevel == DangerLevel.CRITICAL) {
            if (dangerLevelChanged || doorStatusChanged || directionChanged ||
                floorChanged || overloadChanged || jammedChanged || significantPositionChange) {
                updateState(elevatorId, request, dangerLevel, currentTime);
                return true;
            }
        }

        // LOW (idle) states - only log once when entering idle
        if (dangerLevel == DangerLevel.LOW) {
            // Only save if there's a state change (entering idle or other parameter changed)
            if (!dangerLevelChanged && !doorStatusChanged && !directionChanged &&
                !floorChanged && !overloadChanged && !jammedChanged) {
                return false; // Skip saving - already in idle state
            }
        }

        // NORMAL (active movement) states - log periodically or on significant changes
        if (dangerLevel == DangerLevel.NORMAL) {
            long timeSinceLastLog = (currentTime - previousState.getLastLogTime()) / 1000; // seconds

            // Log if: state changed OR position changed significantly OR enough time passed
            if (dangerLevelChanged || doorStatusChanged || directionChanged ||
                floorChanged || overloadChanged || jammedChanged ||
                significantPositionChange ||
                timeSinceLastLog >= NORMAL_LOG_INTERVAL_SECONDS) {
                updateState(elevatorId, request, dangerLevel, currentTime);
                return true;
            }
        }

        // For any other significant change, update state and return true
        if (dangerLevelChanged || doorStatusChanged || directionChanged ||
            floorChanged || overloadChanged || jammedChanged || significantPositionChange) {
            updateState(elevatorId, request, dangerLevel, currentTime);
            return true;
        }

        // No significant change - don't save
        return false;
    }

    /**
     * Update tracked state for an elevator
     */
    private void updateState(String elevatorId, SensorDataRequest request, DangerLevel dangerLevel, long currentTime) {
        ElevatorState state = new ElevatorState();
        state.setDangerLevel(dangerLevel);
        state.setCurrentFloor(request.getCurrentFloor());
        state.setRealtimeFloor(request.getRealtimeFloor());
        state.setDoorStatus(request.getDoorStatus());
        state.setDirection(request.getDirection());
        state.setIsOverloaded(request.getIsOverloaded());
        state.setIsJammed(request.getIsJammed());
        state.setLastLogTime(currentTime);

        stateMap.put(elevatorId, state);
    }

    /**
     * Inner class to track elevator state
     */
    @Data
    private static class ElevatorState {
        private DangerLevel dangerLevel;
        private Integer currentFloor;
        private Double realtimeFloor;
        private String doorStatus;
        private String direction;
        private Boolean isOverloaded;
        private Boolean isJammed;
        private Long lastLogTime;  // milliseconds since epoch
    }

    /**
     * Clear state for an elevator (useful for testing)
     */
    public void clearState(String elevatorId) {
        stateMap.remove(elevatorId);
    }

    /**
     * Clear all states (useful for testing)
     */
    public void clearAllStates() {
        stateMap.clear();
    }
}
