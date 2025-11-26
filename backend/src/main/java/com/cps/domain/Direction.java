package com.cps.domain;

/**
 * Represents the direction of elevator movement.
 * Used by the LOOK scheduling algorithm to determine elevator travel direction.
 */
public enum Direction {
    /**
     * Elevator is moving upward
     */
    UP,
    
    /**
     * Elevator is moving downward
     */
    DOWN,
    
    /**
     * Elevator is idle (not moving)
     */
    IDLE
}
