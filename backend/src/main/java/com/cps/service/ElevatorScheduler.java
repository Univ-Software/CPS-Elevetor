package com.cps.service;

import com.cps.domain.Direction;
import com.cps.dto.ControlCommand;
import com.cps.dto.ElevatorStatus;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.NavigableSet;
import java.util.TreeSet;

/**
 * Elevator Scheduler implementing the LOOK Algorithm (Scanning).
 * 
 * The LOOK algorithm moves the elevator in one direction, servicing all requests
 * in that direction until there are no more requests ahead, then reverses direction.
 * 
 * This is the "Cyber Brain" that handles all scheduling, safety checks, and control logic.
 * Thread-safe implementation using synchronized methods.
 */
@Slf4j
@Service
public class ElevatorScheduler {
    
    // Safety thresholds
    private static final double OVERLOAD_THRESHOLD_KG = 500.0;
    private static final double LEVELING_TOLERANCE_PX = 5.0;
    
    // Floor to pixel mapping constants (must match frontend)
    private static final double FLOOR_HEIGHT_PX = 110.0;
    private static final double FLOOR_BASE_OFFSET_PX = 30.0;
    private static final double CAR_OFFSET_PX = 10.0;
    
    /**
     * Requests for upward movement (ascending order)
     */
    private final NavigableSet<Integer> upRequests = new TreeSet<>();
    
    /**
     * Requests for downward movement (descending order)
     */
    private final NavigableSet<Integer> downRequests = new TreeSet<>(Collections.reverseOrder());
    
    /**
     * Current direction of elevator movement
     */
    private Direction currentDirection = Direction.IDLE;
    
    /**
     * Current floor of the elevator
     */
    private int currentFloor = 1;
    
    /**
     * Add a hall call request (button pressed outside elevator).
     * 
     * @param floor The floor where the button was pressed
     * @param dir The direction requested (UP or DOWN)
     */
    public synchronized void addHallCall(int floor, Direction dir) {
        log.info("Hall call added: Floor {}, Direction {}", floor, dir);
        
        if (dir == Direction.UP) {
            upRequests.add(floor);
        } else if (dir == Direction.DOWN) {
            downRequests.add(floor);
        }
        
        logRequestState();
    }
    
    /**
     * Add a car call request (button pressed inside elevator).
     * Determines which set to add to based on floor's position relative to current floor.
     * 
     * @param floor The destination floor requested
     */
    public synchronized void addCarCall(int floor) {
        log.info("Car call added: Floor {}", floor);
        
        if (floor > currentFloor) {
            upRequests.add(floor);
        } else if (floor < currentFloor) {
            downRequests.add(floor);
        }
        // If floor == currentFloor, ignore (already there)
        
        logRequestState();
    }
    
    /**
     * Process the current elevator status and determine the next control command.
     * Implements the LOOK scheduling algorithm with safety checks.
     * 
     * @param status Current elevator status from frontend
     * @return Control command to send to elevator
     */
    public synchronized ControlCommand processStatus(ElevatorStatus status) {
        // Update current state
        currentFloor = status.getCurrentFloor();
        
        // Parse direction from status
        try {
            if (status.getDirection() != null && !status.getDirection().isEmpty()) {
                currentDirection = Direction.valueOf(status.getDirection().toUpperCase());
            }
        } catch (IllegalArgumentException e) {
            log.warn("Invalid direction in status: {}", status.getDirection());
        }
        
        log.info("Processing status - Floor: {}, yPx: {}, Weight: {}kg, Direction: {}, Door: {}, Obstructed: {}", 
                 currentFloor, status.getYPx(), status.getCurrentKg(), 
                 currentDirection, status.getDoorStatus(), status.isObstructed());
        
        // SAFETY CHECK #1: Overload Protection
        if (status.getCurrentKg() >= OVERLOAD_THRESHOLD_KG) {
            log.error("OVERLOAD DETECTED! Current weight: {}kg >= Threshold: {}kg", 
                      status.getCurrentKg(), OVERLOAD_THRESHOLD_KG);
            
            // Clear movement commands, force door open
            ControlCommand overloadCommand = new ControlCommand(
                "OPEN",
                String.format("OVERLOAD ALERT! Current: %.1fkg / Max: %.1fkg - Please exit", 
                              status.getCurrentKg(), OVERLOAD_THRESHOLD_KG)
            );
            overloadCommand.setScheduledStops(getScheduledStops());
            overloadCommand.setTimestamp(System.currentTimeMillis());
            return overloadCommand;
        }
        
        // SAFETY CHECK #2: Door Obstruction
        if (status.isObstructed()) {
            log.warn("Door obstruction detected! Keeping doors open.");
            ControlCommand obstructionCommand = new ControlCommand(
                "WAIT", 
                "Door obstructed - waiting for clearance"
            );
            obstructionCommand.setScheduledStops(getScheduledStops());
            obstructionCommand.setTimestamp(System.currentTimeMillis());
            return obstructionCommand;
        }
        
        // If doors are open at a requested floor, remove it from requests
        if ("OPEN".equalsIgnoreCase(status.getDoorStatus())) {
            upRequests.remove(currentFloor);
            downRequests.remove(currentFloor);
        }
        
        // LOOK Algorithm Implementation with Leveling Check
        return determineNextCommand(status);
    }
    
    /**
     * Determine the next command based on LOOK algorithm.
     * Includes leveling/alignment safety check before opening doors.
     * 
     * @param status Current elevator status
     * @return Control command for elevator
     */
    private ControlCommand determineNextCommand(ElevatorStatus status) {
        // Check if we're at a requested floor
        boolean atRequestedFloor = upRequests.contains(currentFloor) || downRequests.contains(currentFloor);
        
        if (atRequestedFloor) {
            // SAFETY CHECK #3: Leveling/Alignment Check
            double targetFloorYPx = calculateFloorYPx(currentFloor);
            double currentYPx = status.getYPx();
            double alignmentError = Math.abs(currentYPx - targetFloorYPx);
            
            if (alignmentError > LEVELING_TOLERANCE_PX) {
                log.warn("LEVELING ERROR! Current yPx: {}, Target yPx: {}, Error: {}px > Tolerance: {}px",
                         currentYPx, targetFloorYPx, alignmentError, LEVELING_TOLERANCE_PX);
                
                // DO NOT open door - send STOP or micro-adjust command
                ControlCommand levelingCommand = new ControlCommand(
                    "STOP",
                    String.format("Leveling error detected (%.1fpx) - realigning to floor %d", 
                                  alignmentError, currentFloor)
                );
                levelingCommand.setScheduledStops(getScheduledStops());
                levelingCommand.setTimestamp(System.currentTimeMillis());
                return levelingCommand;
            }
            
            // Alignment is OK - open doors
            upRequests.remove(currentFloor);
            downRequests.remove(currentFloor);
            
            ControlCommand openCommand = new ControlCommand(
                "OPEN", 
                "Arrived at requested floor " + currentFloor
            );
            openCommand.setScheduledStops(getScheduledStops());
            openCommand.setTimestamp(System.currentTimeMillis());
            return openCommand;
        }
        
        // LOOK Algorithm: Continue in current direction if possible, otherwise reverse
        if (currentDirection == Direction.UP || currentDirection == Direction.IDLE) {
            // Check for requests above current floor
            Integer nextUp = upRequests.higher(currentFloor);
            if (nextUp != null) {
                currentDirection = Direction.UP;
                ControlCommand moveUpCommand = new ControlCommand(
                    "MOTOR_UP", 
                    "Moving up to floor " + nextUp
                );
                moveUpCommand.setScheduledStops(getScheduledStops());
                moveUpCommand.setTimestamp(System.currentTimeMillis());
                return moveUpCommand;
            }
            
            // No requests above, check for requests below
            Integer nextDown = downRequests.lower(currentFloor);
            if (nextDown != null) {
                currentDirection = Direction.DOWN;
                ControlCommand moveDownCommand = new ControlCommand(
                    "MOTOR_DOWN", 
                    "Changing direction - moving down to floor " + nextDown
                );
                moveDownCommand.setScheduledStops(getScheduledStops());
                moveDownCommand.setTimestamp(System.currentTimeMillis());
                return moveDownCommand;
            }
        }
        
        if (currentDirection == Direction.DOWN) {
            // Check for requests below current floor
            Integer nextDown = downRequests.lower(currentFloor);
            if (nextDown != null) {
                currentDirection = Direction.DOWN;
                ControlCommand moveDownCommand = new ControlCommand(
                    "MOTOR_DOWN", 
                    "Moving down to floor " + nextDown
                );
                moveDownCommand.setScheduledStops(getScheduledStops());
                moveDownCommand.setTimestamp(System.currentTimeMillis());
                return moveDownCommand;
            }
            
            // No requests below, check for requests above
            Integer nextUp = upRequests.higher(currentFloor);
            if (nextUp != null) {
                currentDirection = Direction.UP;
                ControlCommand moveUpCommand = new ControlCommand(
                    "MOTOR_UP", 
                    "Changing direction - moving up to floor " + nextUp
                );
                moveUpCommand.setScheduledStops(getScheduledStops());
                moveUpCommand.setTimestamp(System.currentTimeMillis());
                return moveUpCommand;
            }
        }
        
        // No requests at all - go idle
        currentDirection = Direction.IDLE;
        ControlCommand stopCommand = new ControlCommand(
            "STOP", 
            "No pending requests - elevator idle"
        );
        stopCommand.setScheduledStops(getScheduledStops());
        stopCommand.setTimestamp(System.currentTimeMillis());
        return stopCommand;
    }
    
    /**
     * Calculate the expected yPx position for a given floor number.
     * This must match the frontend's calculation for consistency.
     * 
     * Formula: yPx = (floor - 1) * FLOOR_HEIGHT_PX + FLOOR_BASE_OFFSET_PX + CAR_OFFSET_PX
     * 
     * @param floor The floor number (1-5)
     * @return The expected yPx position
     */
    private double calculateFloorYPx(int floor) {
        return (floor - 1) * FLOOR_HEIGHT_PX + FLOOR_BASE_OFFSET_PX + CAR_OFFSET_PX;
    }
    
    /**
     * Get the current scheduled stops in LOOK algorithm order.
     * This is the result of the LOOK algorithm that the frontend will display.
     * 
     * @return List of floor numbers in the order they will be serviced
     */
    private List<Integer> getScheduledStops() {
        List<Integer> scheduledStops = new ArrayList<>();
        
        // Add stops in LOOK order based on current direction
        if (currentDirection == Direction.UP || currentDirection == Direction.IDLE) {
            // Add upward requests first (ascending)
            scheduledStops.addAll(upRequests);
            // Then add downward requests (descending)
            scheduledStops.addAll(downRequests);
        } else if (currentDirection == Direction.DOWN) {
            // Add downward requests first (descending)
            scheduledStops.addAll(downRequests);
            // Then add upward requests (ascending)
            scheduledStops.addAll(upRequests);
        }
        
        return scheduledStops;
    }
    
    /**
     * Log current state of request queues (for debugging)
     */
    private void logRequestState() {
        log.debug("Request state - UP: {}, DOWN: {}", upRequests, downRequests);
    }
    
    /**
     * Get current direction (for testing/monitoring)
     */
    public synchronized Direction getCurrentDirection() {
        return currentDirection;
    }
    
    /**
     * Get current floor (for testing/monitoring)
     */
    public synchronized int getCurrentFloor() {
        return currentFloor;
    }
    
    /**
     * Clear all requests (for emergency/reset scenarios)
     */
    public synchronized void clearAllRequests() {
        log.warn("Clearing all elevator requests");
        upRequests.clear();
        downRequests.clear();
        currentDirection = Direction.IDLE;
    }
}
