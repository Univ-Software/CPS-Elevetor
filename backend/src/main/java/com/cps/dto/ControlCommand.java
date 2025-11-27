package com.cps.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/**
 * Data Transfer Object representing a control command sent to the elevator.
 * Broadcast from backend to frontend for elevator actuation.
 * 
 * The Backend (Cyber Brain) drives the Frontend (Physical Body) using these commands.
 * The Backend must project the calculated queue for visualization.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class ControlCommand {
    
    /**
     * Type of command to execute
     * ENUM values: MOTOR_UP, MOTOR_DOWN, STOP, OPEN, CLOSE, WAIT
     */
    private String commandType;
    
    /**
     * Optional message providing additional context or information about the command
     */
    private String message;
    
    /**
     * Result of LOOK algorithm - scheduled stops in order
     * Frontend must render this list (read-only) for visualization
     */
    private List<Integer> scheduledStops;
    
    /**
     * Timestamp when the command was generated (milliseconds since epoch)
     */
    private long timestamp;
    
    /**
     * Convenience constructor for commands without scheduled stops
     * @param commandType The type of command to execute
     * @param message The message providing context
     */
    public ControlCommand(String commandType, String message) {
        this.commandType = commandType;
        this.message = message;
        this.scheduledStops = new ArrayList<>();
        this.timestamp = System.currentTimeMillis();
    }
    
    /**
     * Convenience constructor for commands without a message
     * @param commandType The type of command to execute
     */
    public ControlCommand(String commandType) {
        this.commandType = commandType;
        this.message = "";
        this.scheduledStops = new ArrayList<>();
        this.timestamp = System.currentTimeMillis();
    }
}
