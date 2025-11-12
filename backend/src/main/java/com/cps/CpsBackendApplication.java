package com.cps;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@SpringBootApplication
@RestController
public class CpsBackendApplication {

    public static void main(String[] args) {
        SpringApplication.run(CpsBackendApplication.class, args);
    }

    @GetMapping("/api/health")
    public String health() {
        return "CPS Backend is running";
    }

    @GetMapping("/api/status")
    public String status() {
        return "OK";
    }
}
