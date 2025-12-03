package com.cps.repository;

import com.cps.domain.SensorData;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;

/**
 * Repository interface for SensorData entity
 * Provides database operations for sensor data storage and retrieval
 */
@Repository
public interface SensorDataRepository extends JpaRepository<SensorData, Long> {

    /**
     * Find all sensor data for a specific elevator
     */
    List<SensorData> findByElevatorIdOrderByProcessedTimestampDesc(String elevatorId);

    /**
     * Find sensor data by danger level
     */
    List<SensorData> findByDangerLevelOrderByProcessedTimestampDesc(String dangerLevel);

    /**
     * Find sensor data within a time range
     */
    List<SensorData> findByProcessedTimestampBetween(LocalDateTime start, LocalDateTime end);

    /**
     * Find latest N records for an elevator
     */
    @Query("SELECT s FROM SensorData s WHERE s.elevatorId = ?1 ORDER BY s.processedTimestamp DESC LIMIT ?2")
    List<SensorData> findLatestByElevatorId(String elevatorId, int limit);

    /**
     * Count records by danger level
     */
    long countByDangerLevel(String dangerLevel);
}
