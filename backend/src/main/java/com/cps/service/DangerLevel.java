package com.cps.service;

/**
 * Enum representing danger levels for elevator sensor data
 * Used for logging and alert classification
 */
public enum DangerLevel {
    LOW,        // Normal operation, no issues
    NORMAL,     // Standard operation
    WATCH,      // Potential concern, monitoring required
    CRITICAL    // Emergency situation, immediate attention required
}
