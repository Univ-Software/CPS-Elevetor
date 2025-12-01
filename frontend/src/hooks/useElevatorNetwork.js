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
  
  // ▼▼▼ [핵심 수정 1] 최신 상태를 담아둘 Ref 생성 (타이머 리셋 방지용) ▼▼▼
  const latestStateRef = useRef(elevatorState);

  useEffect(() => {
    latestStateRef.current = elevatorState;
  }, [elevatorState]);
  // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

  // 콜백 함수 Ref 저장
  const onCommandRef = useRef(onCommandReceived);
  useEffect(() => {
    onCommandRef.current = onCommandReceived;
  }, [onCommandReceived]);

  // 1. 소켓 연결 (최초 1회만 실행)
  useEffect(() => {
    // 환경에 따른 URL 설정 로직 유지
    const wsUrl = process.env.NODE_ENV === 'production'
      ? "http://localhost/ws"
      : "http://localhost:8088/ws"; // 포트 번호 주의 (본인 설정에 맞게)

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
            // console.log("📥 Received analysis:", response); // 로그 너무 많으면 주석 처리
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

  // 2. 데이터 전송 루프 (타이머 리셋 없이 안정적 전송)
  useEffect(() => {
    if (!isConnected) return;

    const intervalId = setInterval(() => {
      if (!clientRef.current || !clientRef.current.connected) return;

      // ▼▼▼ [핵심 수정 2] Ref에서 최신 값을 꺼내서 전송 ▼▼▼
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
        isJammed: currentState.hasJammedOnboard,
        timestamp: new Date().toISOString(),
      };

      try {
        clientRef.current.publish({
          destination: "/api/sensor-data",
          body: JSON.stringify(payload),
        });
      } catch (err) {
        console.error("Publish Error:", err);
      }
    }, SEND_INTERVAL);

    return () => clearInterval(intervalId);
    
    // [중요] elevatorState를 의존성에서 제거 -> 타이머 끊김 해결
  }, [isConnected]); 

  return { isConnected, lastResponse };
}