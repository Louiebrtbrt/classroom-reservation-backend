package com.crs;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

// Replaces server.js: starts the server. @EnableScheduling is for the auto check-out job.
@SpringBootApplication
@EnableScheduling
public class CrsApplication {
    public static void main(String[] args) {
        SpringApplication.run(CrsApplication.class, args);
    }
}
