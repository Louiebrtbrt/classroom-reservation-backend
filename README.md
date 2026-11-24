# CRS Backend (Java / Spring Boot)

Replaces the Node.js + Express backend. Same URLs, same JSON, so the frontend does not change.

## Run locally
1. Install JDK 17+ and Maven (IntelliJ and VS Code Java extensions already include Maven support).
2. Copy `.env.example` to `.env` and fill in the same values you used for Node.
   Local XAMPP MySQL: also add `MYSQL_SSL_MODE=DISABLED`.
3. Run: `mvn spring-boot:run`  (server starts on http://localhost:3000)
4. In the frontend `js/app.js`, point `API_BASE` to `http://localhost:3000` while testing.

## Converted so far
- server.js  -> CrsApplication.java, CorsConfig.java
- db.js      -> Db.java + application.properties
- helpers.js -> Helpers.java, EmailService.java
- routes/auth.js -> AuthController.java

## Still to convert
rooms, schedules, reservations, users, follows, activityLogs, auto check-out job
