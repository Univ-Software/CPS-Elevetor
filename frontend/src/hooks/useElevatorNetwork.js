// src/hooks/useElevatorNetwork.js
import { useEffect, useRef, useState } from "react";
import { Client } from "@stomp/stompjs";
import SockJS from "sockjs-client";

// 백엔드로 보낼 주기 (ms) - 0.1초마다 전송
const SEND_INTERVAL = 100;

export function useElevatorNetwork(elevatorState, onCommandReceived) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastResponse, setLastResponse] = useState(null);
  const clientRef = useRef(null);

  // ▼ 최신 상태를 담아둘 Ref (타이머 리셋 방지)
  const latestStateRef = useRef(elevatorState);
  useEffect(() => {
    latestStateRef.current = elevatorState;
  }, [elevatorState]);

  // 콜백 함수 Ref 저장
  const onCommandRef = useRef(onCommandReceived);
  useEffect(() => {
    onCommandRef.current = onCommandReceived;
  }, [onCommandReceived]);

  // 1. 소켓 연결 (최초 1회만 실행)
  useEffect(() => {
    const wsUrl =
      process.env.NODE_ENV === "production"
        ? "http://localhost/ws"
        : "http://localhost:8088/ws"; // 기존 설정 유지

    const socket = new SockJS(wsUrl);
    const client = new Client({
      webSocketFactory: () => socket,
      reconnectDelay: 5000,
      onConnect: () => {
        console.log("✅ Backend Connected!");
        setIsConnected(true);

        // [구독 1] 백엔드 분석 결과 수신
        client.subscribe("/topic/sensor-response", (message) => {
          try {
            const response = JSON.parse(message.body);
            setLastResponse(response);

            if (response.dangerLevel === "CRITICAL") {
              console.error("🚨 CRITICAL:", response.analysisMessage);
            } else if (response.dangerLevel === "WATCH") {
              console.warn("⚠️ WATCH:", response.analysisMessage);
            }
          } catch (err) {
            console.error("Failed to parse response:", err);
          }
        });

        // [구독 2] 제어 명령 수신
        client.subscribe("/topic/control", (message) => {
          if (onCommandRef.current) {
            try {
              const command = JSON.parse(message.body);
              console.log("📩 Command Received:", command);
              onCommandRef.current(command);
            } catch (e) {
              console.error("JSON Parse Error (Control):", e);
            }
          }
        });
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

  // 2. 데이터 전송 루프
  useEffect(() => {
    if (!isConnected) return;

    const intervalId = setInterval(() => {
      if (!clientRef.current || !clientRef.current.connected) return;

      const currentState = latestStateRef.current;

      const payload = {
        elevatorId: "E1",
        currentFloor: currentState.currentFloor,
        // 소수점 정리해서 전송
        realtimeFloor: parseFloat(currentState.realtimeFloor.toFixed(2)),
        speed: parseFloat(currentState.speedFloorsPerSec.toFixed(2)),
        doorStatus: currentState.doorState.toUpperCase(),
        direction: currentState.direction.toUpperCase(),
        isOverloaded: currentState.isOverload,
        hasJammedOnboard: currentState.hasJammedOnboard, // ← 이름 바뀌었으면 dto에 맞게 조정
        isJammed: currentState.hasJammedOnboard,
        // 🔸 자율제어 모드 플래그 추가 (백엔드에서 필요시 사용)
        autonomousMode:
          currentState.autonomousMode === undefined
            ? true
            : currentState.autonomousMode,
        timestamp: new Date().toISOString(),
      };

      try {
        clientRef.current.publish({
          destination: "/app/sensor-data",
          body: JSON.stringify(payload),
        });
      } catch (err) {
        console.error("Publish Error:", err);
      }
    }, SEND_INTERVAL);

    return () => clearInterval(intervalId);
  }, [isConnected]);

  return { isConnected, lastResponse };
}
