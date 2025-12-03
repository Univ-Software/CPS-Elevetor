package com.cps.domain;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * Entity for storing elevator sensor data in PostgreSQL database
 * Includes analysis results and danger level classification
 */
@Entity
@Table(name = "sensor_data")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SensorData {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "elevator_id", nullable = false, length = 50)
    private String elevatorId;

    @Column(name = "current_floor")
    private Integer currentFloor;

    @Column(name = "realtime_floor")
    private Double realtimeFloor;

    @Column(name = "speed")
    private Double speed;

    @Column(name = "door_status", length = 20)
    private String doorStatus;

    @Column(name = "direction", length = 10)
    private String direction;

    @Column(name = "is_overloaded")
    private Boolean isOverloaded;

    @Column(name = "is_jammed")
    private Boolean isJammed;

    @Column(name = "danger_level", length = 20)
    private String dangerLevel;  // LOW, NORMAL, WATCH, CRITICAL

    @Column(name = "analysis_message", length = 500)
    private String analysisMessage;

    @Column(name = "received_timestamp")
    private LocalDateTime receivedTimestamp;

    @Column(name = "processed_timestamp")
    private LocalDateTime processedTimestamp;

    // 🔹 프론트에서만 쓰는 자율제어 모드 플래그 (DB에는 저장 안 함)
    @Transient
    private Boolean autonomousMode;

    @PrePersist
    protected void onCreate() {
        processedTimestamp = LocalDateTime.now();
    }
}
