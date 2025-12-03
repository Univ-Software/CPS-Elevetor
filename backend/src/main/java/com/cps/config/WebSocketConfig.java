package com.cps.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

/**
 * WebSocket configuration for STOMP messaging
 * Enables WebSocket communication between frontend and backend
 */
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    /**
     * Configure message broker for pub/sub messaging
     * - /topic: for broadcasting to multiple subscribers
     * - /app: for application destination prefix (handled by @MessageMapping)
     */
    @Override
    public void configureMessageBroker(MessageBrokerRegistry config) {
        // Enable simple broker for /topic destinations
        config.enableSimpleBroker("/topic");

        // Set application destination prefix for @MessageMapping
        config.setApplicationDestinationPrefixes("/app");
    }

    /**
     * Register STOMP endpoints with SockJS fallback
     * Frontend connects to: http://localhost:8088/ws
     */
    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws")
                .setAllowedOriginPatterns("*")  // Allow all origins (adjust for production)
                .withSockJS();  // Enable SockJS fallback for browsers without WebSocket support
    }
}
