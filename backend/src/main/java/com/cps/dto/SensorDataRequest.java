package com.cps.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * DTO for receiving sensor data from frontend via WebSocket
 * Matches the payload structure sent from useElevatorNetwork.js
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class SensorDataRequest {
    private String elevatorId;          // Elevator identifier (e.g., "E1")
    private Integer currentFloor;       // Current logical floor
    private Double realtimeFloor;       // Real-time position with decimals
    private Double speed;               // Speed in floors per second
    private String doorStatus;          // OPEN, CLOSED, OPENING, CLOSING
    private String direction;           // UP, DOWN, IDLE
    private Boolean isOverloaded;       // Overload status
    private Boolean isJammed;           // Door jam status
    private String timestamp;           // ISO timestamp from frontend
}
