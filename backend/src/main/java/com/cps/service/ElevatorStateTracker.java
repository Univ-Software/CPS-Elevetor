package com.cps.service;

import com.cps.dto.SensorDataRequest;
import lombok.Data;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Service for tracking elevator state changes
 * Prevents redundant database saves and logs for unchanged states
 */
@Service
public class ElevatorStateTracker {

    private final Map<String, ElevatorState> stateMap = new ConcurrentHashMap<>();

    /**
     * Check if this sensor data represents a significant change that should be saved
     * Returns true if:
     * - This is the first data from this elevator
     * - Danger level changed
     * - Door status changed
     * - Direction changed (except idle fluctuations)
     * - Floor changed
     * - Overload/Jammed status changed
     *
     * For LOW (idle) states, only save once when entering idle
     */
    public boolean shouldSaveAndLog(SensorDataRequest request, DangerLevel dangerLevel) {
        String elevatorId = request.getElevatorId();

        // First time seeing this elevator - always save
        if (!stateMap.containsKey(elevatorId)) {
            updateState(elevatorId, request, dangerLevel);
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

        // If it's LOW danger level and no significant changes, don't save
        if (dangerLevel == DangerLevel.LOW) {
            // Only save if there's a state change (entering idle or other parameter changed)
            if (!dangerLevelChanged && !doorStatusChanged && !directionChanged &&
                !floorChanged && !overloadChanged && !jammedChanged) {
                return false; // Skip saving - already in idle state
            }
        }

        // For any significant change, update state and return true
        if (dangerLevelChanged || doorStatusChanged || directionChanged ||
            floorChanged || overloadChanged || jammedChanged) {
            updateState(elevatorId, request, dangerLevel);
            return true;
        }

        // No significant change - don't save
        return false;
    }

    /**
     * Update tracked state for an elevator
     */
    private void updateState(String elevatorId, SensorDataRequest request, DangerLevel dangerLevel) {
        ElevatorState state = new ElevatorState();
        state.setDangerLevel(dangerLevel);
        state.setCurrentFloor(request.getCurrentFloor());
        state.setDoorStatus(request.getDoorStatus());
        state.setDirection(request.getDirection());
        state.setIsOverloaded(request.getIsOverloaded());
        state.setIsJammed(request.getIsJammed());

        stateMap.put(elevatorId, state);
    }

    /**
     * Inner class to track elevator state
     */
    @Data
    private static class ElevatorState {
        private DangerLevel dangerLevel;
        private Integer currentFloor;
        private String doorStatus;
        private String direction;
        private Boolean isOverloaded;
        private Boolean isJammed;
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
