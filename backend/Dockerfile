# Build stage
FROM gradle:8.5-jdk17 AS build
WORKDIR /app

# Copy Gradle configuration files
COPY build.gradle settings.gradle ./
COPY gradle ./gradle

# Copy source code
COPY src ./src

# Build the application
RUN gradle build --no-daemon -x test

# Runtime stage
FROM eclipse-temurin:17-jre-alpine
WORKDIR /app

# Copy the built JAR file from build stage
COPY --from=build /app/build/libs/*.jar app.jar

# Expose application port
EXPOSE 8088

# Run the application
ENTRYPOINT ["java", "-jar", "app.jar"]
