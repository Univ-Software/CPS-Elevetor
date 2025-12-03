package com.cps.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * [Input DTO] 프론트엔드(React)에서 전송하는 센서 데이터 규격
 * useElevatorNetwork.js의 payload와 필드명이 일치해야 함.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class SensorDataDTO {

    private String elevatorId;      // "E1"

    private Integer currentFloor;   // 논리 층 (1, 2, 3...)

    private Double realtimeFloor;   // 물리적 위치 (1.5, 2.7...) - 정위치 판단용

    private Double speed;           // 속도 - 정지 여부 판단용

    private String doorStatus;      // OPEN, CLOSED, CLOSING...

    private String direction;       // UP, DOWN, IDLE

    // Lombok이 boolean 필드의 getter를 'is'를 빼고 만드는 경우가 있어
    // @JsonProperty로 JSON 키값을 명시적으로 고정함.
    @JsonProperty("isOverloaded")
    private Boolean isOverloaded;   // 과부하 센서 값

    @JsonProperty("isJammed")
    private Boolean isJammed;       // 끼임 센서 값

    private String timestamp;       // 전송 시간
}