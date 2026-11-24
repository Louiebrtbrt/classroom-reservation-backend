Classroom Reservation System (MC Space Management) - Backend

A web-based system for managing classroom use: teachers reserve rooms or check in with a QR code, students see which rooms are vacant and where their teachers are, and admins manage rooms, schedules, and accounts.

This repository is the backend (REST API), built with Java and Spring Boot. The frontend lives in a separate repository: [TODO: link to the frontend repository]

Live system: [TODO: link to the GitHub Pages site]
API base URL: https://classroom-reservation-backend.onrender.com

Table of contents
Features
Tech stack
System architecture
Project structure
Database
API endpoints
Getting started (run locally)
Environment variables
Deployment
Known limitations and future improvements
Team
Features

Accounts and access

Three roles: Admin, Teacher, Student
Student sign-up with an institutional email (@mabinicolleges.edu.ph) and a 6-digit email verification code (10-minute expiry)
Teacher sign-up with admin approval (approve or reject, with an email notification)
Forgot and reset password through an emailed code, with an attempt limit
Profile page with picture and personal details, and change password

Rooms and schedules

Admin adds and removes rooms
Fixed weekly class schedules per room
Room status (vacant or occupied) shown in real time

Reservations and check-in

Teachers reserve a room for a date and time
Conflict checks against fixed schedules and other reservations (no double booking)
QR code check-in and check-out for each room
Automatic check-out when a session ends (runs every 60 seconds)
Activity log of every check-in and check-out

Students and teachers

Students follow teachers (teacher approves the request) and see which room a followed teacher is in
Dashboards for each role, and admin reports
Tech stack
Layer	Technology
Frontend	HTML, CSS, JavaScript (hosted on GitHub Pages)
Backend	Java 17, Spring Boot 3, Spring Web, Spring JDBC
Database	MySQL (hosted on Aiven)
Email	Brevo transactional email API
Hosting	Render (Docker)
Build tool	Maven
System architecture
Browser (GitHub Pages)
        |  HTTPS / JSON
        v
Spring Boot API (Render, Docker)  ---->  Brevo (verification and reset emails)
        |
        v
MySQL database (Aiven)

The frontend is a static site. It calls the REST API with fetch() and refreshes its data every few seconds.

Project structure
src/main/java/com/crs/
  CrsApplication.java          Application entry point
  config/
    CorsConfig.java            CORS settings
  controller/                  REST endpoints
    AuthController.java        Login, register, verify code, password reset
    UserController.java        Users, approvals, profile, password
    RoomController.java        Rooms, check-in, check-out
    ScheduleController.java    Fixed weekly schedules
    ReservationController.java Reservations
    FollowController.java      Student-teacher follows
    ActivityLogController.java Activity logs
  service/
    EmailService.java          Sends emails through Brevo
    ExpiredReservationJob.java Auto check-out (scheduled job)
  util/
    Db.java                    Database helper
    Helpers.java               Time (Asia/Manila), validation, small helpers
    Resp.java                  JSON response helpers
src/main/resources/
  application.properties       App settings
Dockerfile                     Container build for deployment
pom.xml                        Maven dependencies
Database

MySQL with six tables:

Table	Purpose	Main columns
users	Admins, teachers, students	id, name, username (email), password, role, account_status, email_verified, verification_code, verification_code_expires, profile_image, student_id, year, block, course, class_subject, created_at
rooms	Classrooms	id, room_code, name, building, floor, status, teacher_id
reservations	Room reservations and sessions	id, room_id, teacher_id, start_time, end_time, status, created_at
fixed_schedules	Recurring weekly classes	id, room_id, day_of_week, start_time, end_time, label
activity_logs	Check-in and check-out history	id, teacher_id, room_id, action, timestamp
follows	Student follows teacher	id, student_id, teacher_id, status, created_at

[TODO: add an ERD image or the SQL script here, for example docs/erd.png or docs/schema.sql]

API endpoints

All routes start with /api. Request and response bodies are JSON.

Authentication

Method	Path	Description
POST	/api/login	Sign in
POST	/api/register/student	Student sign-up (sends a verification code)
POST	/api/register/teacher	Teacher sign-up (awaits admin approval)
POST	/api/verify-code	Verify a student's email
POST	/api/resend-code	Resend the verification code
POST	/api/forgot-password	Send a password reset code
POST	/api/reset-password	Set a new password using the code

Users

Method	Path	Description
GET	/api/users	List active users
GET	/api/users/pending	List teachers awaiting approval
PUT	/api/users/{id}/approve	Approve a teacher
PUT	/api/users/{id}/reject	Reject a teacher
PUT	/api/users/{id}/profile	Update profile
PUT	/api/users/{id}/password	Change password
DELETE	/api/users/{id}	Delete a user and related records

Rooms

Method	Path	Description
GET	/api/rooms	List rooms
POST	/api/rooms	Add a room
DELETE	/api/rooms/{id}	Delete a room and related records
POST	/api/rooms/{id}/checkin	Check in to a room
POST	/api/rooms/{id}/checkout	Check out of a room

Schedules, reservations, follows, logs

Method	Path	Description
GET, POST	/api/schedules	List or add fixed schedules
PUT, DELETE	/api/schedules/{id}	Update or delete a schedule
GET, POST	/api/reservations	List or create reservations
PUT	/api/reservations/{id}/cancel	Cancel a reservation
PUT	/api/reservations/{id}/approve	Approve a pending reservation
GET, POST	/api/follows	List follows (optional ?student_id=) or send a follow request
PUT	/api/follows/{id}/approve	Approve a follow request
PUT	/api/follows/{id}/reject	Reject a follow request
DELETE	/api/follows/{id}	Unfollow
GET	/api/activity-logs	List check-in and check-out history
Getting started (run locally)

Requirements: JDK 17 or newer, a MySQL database, and Maven (included in VS Code's "Extension Pack for Java" and in IntelliJ IDEA).

Clone this repository.
git clone https://github.com/Louiebrtbrt/classroom-reservation-backend.git
Copy .env.example to .env and fill in the values (see below).
Run the application:
VS Code or IntelliJ: open CrsApplication.java and run it, or
Terminal: mvn spring-boot:run
The API starts at http://localhost:3000. Try http://localhost:3000/api/rooms.
To use the frontend with this local server, set API_BASE in the frontend's js/app.js to http://localhost:3000.
Environment variables
Variable	Description
MYSQLHOST	Database host
MYSQLPORT	Database port
MYSQLUSER	Database user
MYSQLPASSWORD	Database password
MYSQLDATABASE	Database name
BREVO_API_KEY	Brevo API key for sending emails
MYSQL_SSL_MODE	Optional. Defaults to REQUIRED. Use DISABLED for a local MySQL without SSL.
BREVO_SENDER_EMAIL	Optional. Verified sender address in Brevo.
PORT	Optional. Defaults to 3000. Render sets this automatically.

The .env file is listed in .gitignore and must never be committed.

Deployment
Part	Service
Frontend	GitHub Pages
Backend	Render (Docker runtime, built from the Dockerfile in this repository)
Database	Aiven (MySQL)
Email	Brevo

To deploy the backend: create a Render Web Service from this repository, set the runtime to Docker, and add the environment variables above. Render rebuilds automatically on every push to main.

Note: the Render free instance sleeps when idle, so the first request after a long break can take a minute or two.

Known limitations and future improvements
Passwords are currently stored as plain text. Planned: hash them with BCrypt.
The API does not yet use token-based authentication. Planned: JWT with role checks on the server.
CORS currently allows all origins. Planned: allow only the frontend's domain.
The email verification step has no attempt limit yet. Planned: rate limiting.
The frontend refreshes by polling every few seconds. Planned: WebSockets or server-sent events.