package com.cps;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Main Spring Boot application class for CPS Elevator Simulator.
 * 
 * This application implements a Cyber-Physical System for elevator control
 * using the LOOK scheduling algorithm with WebSocket (STOMP) communication.
 * 
 * Architecture:
 * - WebSocket communication for real-time control (/ws endpoint)
 * - LOOK algorithm for efficient elevator dispatching
 * - Modular package structure (config, domain, dto, service, controller)
 * 
 * REST API endpoints have been replaced with WebSocket messaging:
 * - /app/status-report: Receive elevator status updates
 * - /app/press-button: Handle button press events
 * - /topic/control: Broadcast control commands
 */
@SpringBootApplication
public class CpsBackendApplication {

    public static void main(String[] args) {
        SpringApplication.run(CpsBackendApplication.class, args);
    }
}
