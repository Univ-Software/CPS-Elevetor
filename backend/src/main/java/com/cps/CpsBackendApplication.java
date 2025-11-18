package com.cps;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.web.bind.annotation.*;
import jakarta.persistence.*;
import java.util.List;

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

// ===== Elevator Configuration Entity =====
@Entity
@Table(name = "elevator_conf")
class ElevatorConfEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private String elevator;  // Elevator ID or name

    @Column(nullable = false)
    private String door;  // Door status: "OPEN", "CLOSED", "OPENING", "CLOSING"

    @Column(nullable = false)
    private Integer person;  // Number of persons in elevator

    @Column(columnDefinition = "TEXT")
    private String sensors;  // JSON string for sensor data

    @Column(columnDefinition = "TEXT")
    private String hallcall;  // JSON string for hall call buttons pressed

    @Column(columnDefinition = "TEXT")
    private String carcall;  // JSON string for car call buttons pressed

    // Constructors
    public ElevatorConfEntity() {}

    public ElevatorConfEntity(String elevator, String door, Integer person, String sensors, String hallcall, String carcall) {
        this.elevator = elevator;
        this.door = door;
        this.person = person;
        this.sensors = sensors;
        this.hallcall = hallcall;
        this.carcall = carcall;
    }

    // Getters and Setters
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getElevator() { return elevator; }
    public void setElevator(String elevator) { this.elevator = elevator; }

    public String getDoor() { return door; }
    public void setDoor(String door) { this.door = door; }

    public Integer getPerson() { return person; }
    public void setPerson(Integer person) { this.person = person; }

    public String getSensors() { return sensors; }
    public void setSensors(String sensors) { this.sensors = sensors; }

    public String getHallcall() { return hallcall; }
    public void setHallcall(String hallcall) { this.hallcall = hallcall; }

    public String getCarcall() { return carcall; }
    public void setCarcall(String carcall) { this.carcall = carcall; }
}

// ===== Elevator Configuration Repository =====
interface ElevatorConfRepository extends JpaRepository<ElevatorConfEntity, Long> {
    ElevatorConfEntity findByElevator(String elevator);
}

// ===== Elevator Configuration REST Controller =====
@RestController
@RequestMapping("/api/elevator-conf")
class ElevatorConfController {

    private final ElevatorConfRepository repository;

    public ElevatorConfController(ElevatorConfRepository repository) {
        this.repository = repository;
    }

    @GetMapping
    public List<ElevatorConfEntity> getAllConfigurations() {
        return repository.findAll();
    }

    @GetMapping("/{id}")
    public ElevatorConfEntity getConfigurationById(@PathVariable Long id) {
        return repository.findById(id).orElse(null);
    }

    @GetMapping("/elevator/{elevator}")
    public ElevatorConfEntity getConfigurationByElevator(@PathVariable String elevator) {
        return repository.findByElevator(elevator);
    }

    @PostMapping
    public ElevatorConfEntity createConfiguration(@RequestBody ElevatorConfEntity config) {
        return repository.save(config);
    }

    @PutMapping("/{id}")
    public ElevatorConfEntity updateConfiguration(@PathVariable Long id, @RequestBody ElevatorConfEntity config) {
        config.setId(id);
        return repository.save(config);
    }

    @DeleteMapping("/{id}")
    public void deleteConfiguration(@PathVariable Long id) {
        repository.deleteById(id);
    }
}