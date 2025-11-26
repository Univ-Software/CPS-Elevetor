package com.cps.controller;

import com.cps.domain.Direction;
import com.cps.dto.ControlCommand;
import com.cps.dto.ElevatorStatus;
import com.cps.service.ElevatorScheduler;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.handler.annotation.SendTo;
import org.springframework.stereotype.Controller;

import java.util.Map;

/**
 * WebSocket controller for real-time elevator control communication.
 * Handles bidirectional messaging between frontend and backend using STOMP protocol.
 */
@Slf4j
@Controller
@RequiredArgsConstructor
public class ElevatorSocketController {
    
    private final ElevatorScheduler elevatorScheduler;
    
    /**
     * Handle status reports from the elevator.
     * Receives current elevator state, processes it through the scheduler,
     * and broadcasts control commands to all connected clients.
     * 
     * @param status Current elevator status from frontend
     * @return Control command to be broadcast to /topic/control
     */
    @MessageMapping("/status-report")
    @SendTo("/topic/control")
    public ControlCommand handleStatusReport(@Payload ElevatorStatus status) {
        log.info("Received status report: Floor={}, Direction={}, Door={}, Obstructed={}, Passengers={}", 
                 status.getCurrentFloor(), 
                 status.getDirection(), 
                 status.getDoorStatus(),
                 status.isObstructed(),
                 status.getPassengerCount());
        
        // Process status through LOOK algorithm scheduler
        ControlCommand command = elevatorScheduler.processStatus(status);
        
        log.info("Sending control command: {} - {}", command.getCommandType(), command.getMessage());
        
        return command;
    }
    
    /**
     * Handle button press events (both hall calls and car calls).
     * Receives button press information and adds the request to the scheduler.
     * 
     * Expected payload format:
     * {
     *   "floor": 5,
     *   "type": "HALL_CALL" or "CAR_CALL",
     *   "direction": "UP" or "DOWN" (only for HALL_CALL)
     * }
     * 
     * @param buttonPress Button press information
     * @return Acknowledgment message
     */
    @MessageMapping("/press-button")
    @SendTo("/topic/button-ack")
    public Map<String, Object> handleButtonPress(@Payload Map<String, Object> buttonPress) {
        try {
            int floor = (Integer) buttonPress.get("floor");
            String type = (String) buttonPress.get("type");
            
            log.info("Received button press: Type={}, Floor={}", type, floor);
            
            if ("HALL_CALL".equalsIgnoreCase(type)) {
                // Hall call - button pressed outside elevator
                String directionStr = (String) buttonPress.get("direction");
                Direction direction = Direction.valueOf(directionStr.toUpperCase());
                elevatorScheduler.addHallCall(floor, direction);
                
                return Map.of(
                    "success", true,
                    "message", "Hall call registered for floor " + floor + " going " + direction,
                    "floor", floor,
                    "type", "HALL_CALL"
                );
                
            } else if ("CAR_CALL".equalsIgnoreCase(type)) {
                // Car call - button pressed inside elevator
                elevatorScheduler.addCarCall(floor);
                
                return Map.of(
                    "success", true,
                    "message", "Car call registered for floor " + floor,
                    "floor", floor,
                    "type", "CAR_CALL"
                );
            } else {
                log.warn("Unknown button press type: {}", type);
                return Map.of(
                    "success", false,
                    "message", "Unknown button type: " + type
                );
            }
            
        } catch (Exception e) {
            log.error("Error processing button press", e);
            return Map.of(
                "success", false,
                "message", "Error processing button press: " + e.getMessage()
            );
        }
    }
    
    /**
     * Emergency stop - clear all requests.
     * This can be triggered from frontend for emergency scenarios.
     * 
     * @return Acknowledgment of emergency stop
     */
    @MessageMapping("/emergency-stop")
    @SendTo("/topic/emergency")
    public Map<String, Object> handleEmergencyStop() {
        log.warn("EMERGENCY STOP activated - clearing all requests");
        elevatorScheduler.clearAllRequests();
        
        return Map.of(
            "success", true,
            "message", "Emergency stop activated - all requests cleared",
            "timestamp", System.currentTimeMillis()
        );
    }
    
    /**
     * Get current scheduler state (for monitoring/debugging).
     * 
     * @return Current state information
     */
    @MessageMapping("/get-state")
    @SendTo("/topic/state")
    public Map<String, Object> getState() {
        return Map.of(
            "currentFloor", elevatorScheduler.getCurrentFloor(),
            "currentDirection", elevatorScheduler.getCurrentDirection().toString(),
            "timestamp", System.currentTimeMillis()
        );
    }
}
