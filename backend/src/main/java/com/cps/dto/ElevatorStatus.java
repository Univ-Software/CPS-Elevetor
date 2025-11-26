package com.cps.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Data Transfer Object representing the current status of the elevator.
 * Received from the frontend/physical sensors.
 * 
 * This DTO represents raw physical sensor data from the "Body" (Frontend).
 * The Frontend must NOT calculate routes or manage queues - it only reports sensor data.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class ElevatorStatus {
    
    /**
     * Unique identifier for the elevator
     */
    private String elevatorId;
    
    /**
     * Current floor number where the elevator is positioned (for UI display)
     */
    private int currentFloor;
    
    /**
     * ACTUAL physical position in pixels (float) for safety/leveling checks
     * This is the precise vertical position used by the Backend to validate alignment
     */
    private double yPx;
    
    /**
     * ACTUAL weight sensor data in kilograms (replaces passengerCount)
     * Used by Backend for overload protection safety checks
     */
    private double currentKg;
    
    /**
     * Status of elevator doors
     * ENUM values: OPEN, CLOSED, OPENING, CLOSING (UpperCase)
     */
    private String doorStatus;
    
    /**
     * Indicates if door obstruction is detected (crucial for safety)
     * Mapped from infrared safety sensor (jamSensor)
     * If true, elevator should not close doors
     */
    private boolean isObstructed;
    
    /**
     * Current direction of elevator movement
     * Values: "UP", "DOWN", "IDLE"
     */
    private String direction;
}
