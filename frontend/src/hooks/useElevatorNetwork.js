// src/hooks/useElevatorNetwork.js
import { useEffect, useRef, useState } from "react";
import { Client } from "@stomp/stompjs";
import SockJS from "sockjs-client";

// 백엔드로 보낼 주기 (ms) - 0.1초마다 전송
const SEND_INTERVAL = 100; 

export function useElevatorNetwork(elevatorState) {
  const [isConnected, setIsConnected] = useState(false);
  const clientRef = useRef(null);

  // 1. 웹소켓 연결 설정
  useEffect(() => {
    const socket = new SockJS("http://localhost:8080/ws"); // 백엔드 주소 확인 필요
    const client = new Client({
      webSocketFactory: () => socket,
      reconnectDelay: 5000, // 끊기면 5초 뒤 재연결 시도
      onConnect: () => {
        console.log("✅ Backend Connected!");
        setIsConnected(true);
        
        // (옵션) 백엔드에서 오는 제어 명령 구독
        // client.subscribe("/topic/control", (msg) => { ... });
      },
      onStompError: (frame) => {
        console.error("❌ STOMP Error", frame);
      },
      onWebSocketClose: () => {
        console.log("⚠️ Connection Closed");
        setIsConnected(false);
      },
    });

    client.activate();
    clientRef.current = client;

    return () => {
      client.deactivate();
    };
  }, []);

  // 2. 주기적으로 센서 데이터 전송 (Throttling)
  useEffect(() => {
    if (!isConnected || !clientRef.current) return;

    const intervalId = setInterval(() => {
      // 보낼 데이터 패킷 구성 (DTO 구조에 맞게 수정)
      const payload = {
        elevatorId: "E1", // 엘리베이터 식별자
        currentFloor: elevatorState.currentFloor, // 논리 층
        realtimeFloor: parseFloat(elevatorState.realtimeFloor.toFixed(2)), // 실수 좌표 (핵심)
        speed: parseFloat(elevatorState.speedFloorsPerSec.toFixed(2)),     // 속도
        doorStatus: elevatorState.doorState.toUpperCase(), // OPEN, CLOSED...
        direction: elevatorState.direction.toUpperCase(),  // UP, DOWN, IDLE
        isOverloaded: elevatorState.isOverload,
        isJammed: elevatorState.hasJammedOnboard,
        timestamp: new Date().toISOString(),
      };

      try {
        clientRef.current.publish({
          destination: "/app/sensor-data", // 백엔드의 @MessageMapping 주소
          body: JSON.stringify(payload),
        });
      } catch (err) {
        console.error("Publish Error:", err);
      }
    }, SEND_INTERVAL);

    return () => clearInterval(intervalId);
  }, [isConnected, elevatorState]); // elevatorState가 최신 상태일 때만 갱신

  return { isConnected };
}