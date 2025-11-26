package com.cps.service;

import com.cps.domain.Direction;
import com.cps.dto.ControlCommand;
import com.cps.dto.ElevatorStatus;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.NavigableSet;
import java.util.TreeSet;

/**
 * Elevator Scheduler implementing the LOOK Algorithm (Scanning).
 * 
 * The LOOK algorithm moves the elevator in one direction, servicing all requests
 * in that direction until there are no more requests ahead, then reverses direction.
 * 
 * Thread-safe implementation using synchronized methods.
 */
@Slf4j
@Service
public class ElevatorScheduler {
    
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
     * Implements the LOOK scheduling algorithm.
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
        
        log.info("Processing status - Floor: {}, Direction: {}, Door: {}, Obstructed: {}", 
                 currentFloor, currentDirection, status.getDoorStatus(), status.isObstructed());
        
        // SAFETY FIRST: If door is obstructed, keep it open and wait
        if (status.isObstructed()) {
            log.warn("Door obstruction detected! Keeping doors open.");
            return new ControlCommand("WAIT", "Door obstructed - waiting for clearance");
        }
        
        // If doors are open at a requested floor, remove it from requests
        if ("OPEN".equalsIgnoreCase(status.getDoorStatus())) {
            upRequests.remove(currentFloor);
            downRequests.remove(currentFloor);
        }
        
        // LOOK Algorithm Implementation
        return determineNextCommand();
    }
    
    /**
     * Determine the next command based on LOOK algorithm.
     * 
     * @return Control command for elevator
     */
    private ControlCommand determineNextCommand() {
        // Check if we're at a requested floor
        boolean atRequestedFloor = upRequests.contains(currentFloor) || downRequests.contains(currentFloor);
        
        if (atRequestedFloor) {
            upRequests.remove(currentFloor);
            downRequests.remove(currentFloor);
            return new ControlCommand("OPEN", "Arrived at requested floor " + currentFloor);
        }
        
        // LOOK Algorithm: Continue in current direction if possible, otherwise reverse
        if (currentDirection == Direction.UP || currentDirection == Direction.IDLE) {
            // Check for requests above current floor
            Integer nextUp = upRequests.higher(currentFloor);
            if (nextUp != null) {
                currentDirection = Direction.UP;
                return new ControlCommand("MOTOR_UP", "Moving up to floor " + nextUp);
            }
            
            // No requests above, check for requests below
            Integer nextDown = downRequests.lower(currentFloor);
            if (nextDown != null) {
                currentDirection = Direction.DOWN;
                return new ControlCommand("MOTOR_DOWN", "Changing direction - moving down to floor " + nextDown);
            }
        }
        
        if (currentDirection == Direction.DOWN) {
            // Check for requests below current floor
            Integer nextDown = downRequests.lower(currentFloor);
            if (nextDown != null) {
                currentDirection = Direction.DOWN;
                return new ControlCommand("MOTOR_DOWN", "Moving down to floor " + nextDown);
            }
            
            // No requests below, check for requests above
            Integer nextUp = upRequests.higher(currentFloor);
            if (nextUp != null) {
                currentDirection = Direction.UP;
                return new ControlCommand("MOTOR_UP", "Changing direction - moving up to floor " + nextUp);
            }
        }
        
        // No requests at all - go idle
        currentDirection = Direction.IDLE;
        return new ControlCommand("STOP", "No pending requests - elevator idle");
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
