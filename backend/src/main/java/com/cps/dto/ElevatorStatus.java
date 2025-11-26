package com.cps.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Data Transfer Object representing the current status of the elevator.
 * Received from the frontend/physical sensors.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class ElevatorStatus {
    
    /**
     * Current floor number where the elevator is positioned
     */
    private int currentFloor;
    
    /**
     * Status of elevator doors (e.g., "OPEN", "CLOSED", "OPENING", "CLOSING")
     */
    private String doorStatus;
    
    /**
     * Indicates if door obstruction is detected (crucial for safety)
     * If true, elevator should not close doors
     */
    private boolean isObstructed;
    
    /**
     * Number of passengers currently in the elevator
     */
    private int passengerCount;
    
    /**
     * Current direction of elevator movement ("UP", "DOWN", "IDLE")
     */
    private String direction;
}
