package com.cps.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Data Transfer Object representing a control command sent to the elevator.
 * Broadcast from backend to frontend for elevator actuation.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class ControlCommand {
    
    /**
     * Type of command to execute
     * Valid values: OPEN, CLOSE, MOTOR_UP, MOTOR_DOWN, STOP, WAIT
     */
    private String commandType;
    
    /**
     * Optional message providing additional context or information about the command
     */
    private String message;
    
    /**
     * Convenience constructor for commands without a message
     * @param commandType The type of command to execute
     */
    public ControlCommand(String commandType) {
        this.commandType = commandType;
        this.message = "";
    }
}
