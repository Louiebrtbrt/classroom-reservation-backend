package com.crs.controller;

import com.crs.service.EmailService;
import com.crs.util.Db;
import com.crs.util.Helpers;
import com.crs.util.Resp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

// Replaces routes/auth.js. All paths start with /api (same as app.use("/api", auth) in server.js).
@RestController
@RequestMapping("/api")
public class AuthController {
    private static final Logger log = LoggerFactory.getLogger(AuthController.class);

    private static final long TEN_MINUTES_MS = 10 * 60 * 1000L;
    private static final int MAX_RESET_ATTEMPTS = 5;

    // email -> { number of wrong tries, time when the counter resets }
    private final Map<String, long[]> resetFailures = new ConcurrentHashMap<>();

    private final Db db;
    private final EmailService emailService;

    public AuthController(Db db, EmailService emailService) {
        this.db = db;
        this.emailService = emailService;
    }

    // ------------------------------------------------------------------ login

    @PostMapping("/login")
    public ResponseEntity<Map<String, Object>> login(@RequestBody Map<String, Object> body) {
        String username = Helpers.str(body, "username");
        String password = Helpers.str(body, "password");

        String sql = "SELECT id, name, username, password, role, account_status, email_verified, "
                + "profile_image, student_id, year, block, course, class_subject FROM users WHERE username = ?";

        List<Map<String, Object>> results;
        try {
            results = db.rows(sql, username);
        } catch (DataAccessException e) {
            log.error("LOGIN ERROR", e);
            return Resp.error(500, "Database error");
        }

        if (results.isEmpty() || !Objects.equals(results.get(0).get("password"), password)) {
            return Resp.error(401, "Incorrect username or password.");
        }

        Map<String, Object> user = results.get(0);
        Object role = user.get("role");
        Object status = user.get("account_status");

        if ("teacher".equals(role) && "pending".equals(status)) {
            return Resp.error(403, "Your teacher account is still awaiting admin approval.");
        }

        if ("teacher".equals(role) && "rejected".equals(status)) {
            return Resp.error(403, "Your teacher account request was not approved. Contact your admin for details.");
        }

        if ("student".equals(role) && !Helpers.truthy(user.get("email_verified"))) {
            return Resp.error(403, "Please verify your email before signing in.");
        }

        user.remove("password");

        return Resp.ok(Resp.map("message", "Login successful", "user", user));
    }

    // -------------------------------------------------------- register student

    @PostMapping("/register/student")
    public ResponseEntity<Map<String, Object>> registerStudent(@RequestBody Map<String, Object> body) {
        String name = Helpers.str(body, "name");
        String email = Helpers.str(body, "email");
        String password = Helpers.str(body, "password");
        String confirmPassword = Helpers.str(body, "confirmPassword");

        if (Helpers.empty(name) || Helpers.empty(email) || Helpers.empty(password) || Helpers.empty(confirmPassword)) {
            return Resp.error(400, "Please fill in all required fields.");
        }

        if (!Helpers.isInstitutionalEmail(email)) {
            return Resp.error(400, "Please use your institutional email ending in @mabinicolleges.edu.ph.");
        }

        if (password.length() < 8) {
            return Resp.error(400, "Password must be at least 8 characters.");
        }

        if (!password.equals(confirmPassword)) {
            return Resp.error(400, "Passwords do not match.");
        }

        String code = Helpers.generateVerificationCode();
        String expires = Helpers.manilaTimeFromDate(Instant.now().plusMillis(TEN_MINUTES_MS));

        List<Map<String, Object>> existing;
        try {
            existing = db.rows("SELECT id, email_verified FROM users WHERE username = ?", email);
        } catch (DataAccessException e) {
            log.error("STUDENT REGISTER CHECK ERROR", e);
            return Resp.error(500, "Failed to register.");
        }

        // Email already used: if not verified yet, give it a new code. If verified, reject.
        if (!existing.isEmpty()) {
            if (Helpers.truthy(existing.get(0).get("email_verified"))) {
                return Resp.error(400, "That email is already registered.");
            }

            Object existingId = existing.get(0).get("id");
            try {
                db.update("UPDATE users SET name = ?, password = ?, verification_code = ?, "
                        + "verification_code_expires = ? WHERE id = ?", name, password, code, expires, existingId);
            } catch (DataAccessException e) {
                log.error("STUDENT REGISTER UPDATE ERROR", e);
                return Resp.error(500, "Failed to register.");
            }

            emailService.send(email, "Your CRS verification code",
                    "Your verification code is " + code + ". It expires in 10 minutes.");

            return Resp.ok(Resp.map("message", "Verification code sent to your email.",
                    "userId", existingId, "username", email));
        }

        long newId;
        try {
            newId = db.insert("INSERT INTO users (name, username, password, role, account_status, email_verified, "
                    + "verification_code, verification_code_expires) VALUES (?, ?, ?, 'student', 'active', 0, ?, ?)",
                    name, email, password, code, expires);
        } catch (DuplicateKeyException e) {
            return Resp.error(400, "That email is already registered.");
        } catch (DataAccessException e) {
            log.error("STUDENT REGISTER ERROR", e);
            return Resp.error(500, "Failed to register.");
        }

        emailService.send(email, "Your CRS verification code",
                "Your verification code is " + code + ". It expires in 10 minutes.");

        return Resp.ok(Resp.map("message", "Verification code sent to your email.",
                "userId", newId, "username", email));
    }

    // -------------------------------------------------------- register teacher

    @PostMapping("/register/teacher")
    public ResponseEntity<Map<String, Object>> registerTeacher(@RequestBody Map<String, Object> body) {
        String name = Helpers.str(body, "name");
        String email = Helpers.str(body, "email");
        String password = Helpers.str(body, "password");
        String confirmPassword = Helpers.str(body, "confirmPassword");
        String classSubject = Helpers.str(body, "class_subject");

        if (Helpers.empty(name) || Helpers.empty(email) || Helpers.empty(password)
                || Helpers.empty(confirmPassword) || Helpers.empty(classSubject)) {
            return Resp.error(400, "Please fill in all required fields.");
        }

        if (!Helpers.isValidEmail(email)) {
            return Resp.error(400, "Please enter a valid email address.");
        }

        if (password.length() < 8) {
            return Resp.error(400, "Password must be at least 8 characters.");
        }

        if (!password.equals(confirmPassword)) {
            return Resp.error(400, "Passwords do not match.");
        }

        long newId;
        try {
            newId = db.insert("INSERT INTO users (name, username, password, role, account_status, email_verified, "
                    + "class_subject) VALUES (?, ?, ?, 'teacher', 'pending', 1, ?)",
                    name, email, password, classSubject);
        } catch (DuplicateKeyException e) {
            return Resp.error(400, "That email is already registered.");
        } catch (DataAccessException e) {
            log.error("TEACHER REGISTER ERROR", e);
            return Resp.error(500, "Failed to register.");
        }

        emailService.send(email, "CRS teacher account received",
                "Your teacher account request has been submitted and is awaiting admin approval.");

        Map<String, Object> user = Resp.map("id", newId, "name", name, "username", email,
                "role", "teacher", "account_status", "pending");

        return Resp.ok(Resp.map("message", "Registration successful. Your account is awaiting admin approval.",
                "pending", true, "user", user));
    }

    // ------------------------------------------------------------- verify code

    @PostMapping("/verify-code")
    public ResponseEntity<Map<String, Object>> verifyCode(@RequestBody Map<String, Object> body) {
        String username = Helpers.str(body, "username");
        String code = Helpers.str(body, "code");

        if (Helpers.empty(username) || Helpers.empty(code)) {
            return Resp.error(400, "Email and code are required.");
        }

        String sql = "SELECT id, name, username, role, account_status, email_verified, verification_code, "
                + "verification_code_expires, profile_image, student_id, year, block, course, class_subject "
                + "FROM users WHERE username = ?";

        List<Map<String, Object>> results;
        try {
            results = db.rows(sql, username);
        } catch (DataAccessException e) {
            log.error("VERIFY CODE LOOKUP ERROR", e);
            return Resp.error(500, "Failed to verify code.");
        }

        if (results.isEmpty()) {
            return Resp.error(404, "Account not found.");
        }

        Map<String, Object> user = results.get(0);

        if (Helpers.truthy(user.get("email_verified"))) {
            return Resp.error(400, "This account is already verified.");
        }

        String savedCode = (String) user.get("verification_code");
        if (Helpers.empty(savedCode) || !savedCode.equals(code)) {
            return Resp.error(400, "Incorrect verification code.");
        }

        String savedExpires = (String) user.get("verification_code_expires");
        if (Helpers.empty(savedExpires) || savedExpires.compareTo(Helpers.nowInManila()) < 0) {
            return Resp.error(400, "This code has expired. Please sign up again.");
        }

        try {
            db.update("UPDATE users SET email_verified = 1, verification_code = NULL, "
                    + "verification_code_expires = NULL WHERE id = ?", user.get("id"));
        } catch (DataAccessException e) {
            log.error("VERIFY CODE UPDATE ERROR", e);
            return Resp.error(500, "Failed to verify code.");
        }

        user.remove("verification_code");
        user.remove("verification_code_expires");
        user.put("email_verified", 1);

        return Resp.ok(Resp.map("message", "Email verified successfully.", "user", user));
    }

    // ------------------------------------------------------------- resend code

    @PostMapping("/resend-code")
    public ResponseEntity<Map<String, Object>> resendCode(@RequestBody Map<String, Object> body) {
        String username = Helpers.str(body, "username");

        if (Helpers.empty(username)) {
            return Resp.error(400, "Email is required.");
        }

        List<Map<String, Object>> rows;
        try {
            rows = db.rows("SELECT id, email_verified FROM users WHERE username = ? AND role = 'student'", username);
        } catch (DataAccessException e) {
            log.error("RESEND CODE LOOKUP ERROR", e);
            return Resp.error(500, "Failed to resend code.");
        }

        if (rows.isEmpty()) {
            return Resp.error(404, "Account not found.");
        }

        if (Helpers.truthy(rows.get(0).get("email_verified"))) {
            return Resp.error(400, "This account is already verified.");
        }

        String code = Helpers.generateVerificationCode();
        String expires = Helpers.manilaTimeFromDate(Instant.now().plusMillis(TEN_MINUTES_MS));

        try {
            db.update("UPDATE users SET verification_code = ?, verification_code_expires = ? WHERE id = ?",
                    code, expires, rows.get(0).get("id"));
        } catch (DataAccessException e) {
            log.error("RESEND CODE UPDATE ERROR", e);
            return Resp.error(500, "Failed to resend code.");
        }

        emailService.send(username, "Your CRS verification code",
                "Your verification code is " + code + ". It expires in 10 minutes.");

        return Resp.ok(Resp.map("message", "Verification code resent."));
    }

    // --------------------------------------------------------- password reset

    private boolean tooManyResetAttempts(String email) {
        long[] entry = resetFailures.get(email);
        if (entry == null) return false;
        if (System.currentTimeMillis() > entry[1]) {
            resetFailures.remove(email);
            return false;
        }
        return entry[0] >= MAX_RESET_ATTEMPTS;
    }

    private void recordResetFailure(String email) {
        resetFailures.compute(email, (key, entry) -> {
            long now = System.currentTimeMillis();
            if (entry == null || now > entry[1]) {
                return new long[]{1, now + TEN_MINUTES_MS};
            }
            entry[0]++;
            return entry;
        });
    }

    @PostMapping("/forgot-password")
    public ResponseEntity<Map<String, Object>> forgotPassword(@RequestBody Map<String, Object> body) {
        String email = Objects.toString(Helpers.str(body, "email"), "").trim();
        Map<String, Object> reply = Resp.map("message", "If that email is registered, a reset code has been sent.");

        if (!Helpers.isValidEmail(email)) {
            return Resp.error(400, "Please enter a valid email address.");
        }

        List<Map<String, Object>> rows;
        try {
            rows = db.rows("SELECT id FROM users WHERE username = ? AND email_verified = 1", email);
        } catch (DataAccessException e) {
            log.error("FORGOT PASSWORD LOOKUP ERROR", e);
            return Resp.error(500, "Failed to send reset code.");
        }

        // Same answer whether or not the account exists, so nobody can check who is registered
        if (rows.isEmpty()) {
            return Resp.ok(reply);
        }

        String code = Helpers.generateVerificationCode();
        String expires = Helpers.manilaTimeFromDate(Instant.now().plusMillis(TEN_MINUTES_MS));

        try {
            db.update("UPDATE users SET verification_code = ?, verification_code_expires = ? WHERE id = ?",
                    code, expires, rows.get(0).get("id"));
        } catch (DataAccessException e) {
            log.error("FORGOT PASSWORD UPDATE ERROR", e);
            return Resp.error(500, "Failed to send reset code.");
        }

        emailService.send(email, "Your CRS password reset code",
                "Your password reset code is " + code + ". It expires in 10 minutes. "
                        + "If you didn't ask for this, you can ignore this email.");

        return Resp.ok(reply);
    }

    @PostMapping("/reset-password")
    public ResponseEntity<Map<String, Object>> resetPassword(@RequestBody Map<String, Object> body) {
        String email = Objects.toString(Helpers.str(body, "email"), "").trim();
        String code = Objects.toString(Helpers.str(body, "code"), "").trim();
        String newPassword = Helpers.str(body, "newPassword");
        String confirmPassword = Helpers.str(body, "confirmPassword");

        if (email.isEmpty() || code.isEmpty() || Helpers.empty(newPassword) || Helpers.empty(confirmPassword)) {
            return Resp.error(400, "Please fill in all fields.");
        }

        if (newPassword.length() < 8) {
            return Resp.error(400, "Password must be at least 8 characters.");
        }

        if (!newPassword.equals(confirmPassword)) {
            return Resp.error(400, "Passwords do not match.");
        }

        if (tooManyResetAttempts(email)) {
            return Resp.error(429, "Too many incorrect attempts. Please wait 10 minutes and try again.");
        }

        List<Map<String, Object>> rows;
        try {
            rows = db.rows("SELECT id, verification_code, verification_code_expires FROM users "
                    + "WHERE username = ? AND email_verified = 1", email);
        } catch (DataAccessException e) {
            log.error("RESET PASSWORD LOOKUP ERROR", e);
            return Resp.error(500, "Failed to reset password.");
        }

        Map<String, Object> user = rows.isEmpty() ? null : rows.get(0);
        boolean valid = false;
        if (user != null) {
            String savedCode = (String) user.get("verification_code");
            String savedExpires = (String) user.get("verification_code_expires");
            valid = !Helpers.empty(savedCode) && savedCode.equals(code)
                    && !Helpers.empty(savedExpires) && savedExpires.compareTo(Helpers.nowInManila()) >= 0;
        }

        if (!valid) {
            recordResetFailure(email);
            return Resp.error(400, "That code is incorrect or has expired.");
        }

        try {
            db.update("UPDATE users SET password = ?, verification_code = NULL, verification_code_expires = NULL "
                    + "WHERE id = ?", newPassword, user.get("id"));
        } catch (DataAccessException e) {
            log.error("RESET PASSWORD UPDATE ERROR", e);
            return Resp.error(500, "Failed to reset password.");
        }

        resetFailures.remove(email);
        return Resp.ok(Resp.map("message", "Password updated. You can now sign in."));
    }
}
