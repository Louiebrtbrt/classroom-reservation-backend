package com.crs.controller;

import com.crs.service.EmailService;
import com.crs.util.Db;
import com.crs.util.Helpers;
import com.crs.util.Resp;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

// Replaces routes/users.js
@RestController
@RequestMapping("/api/users")
public class UserController {
    private static final Logger log = LoggerFactory.getLogger(UserController.class);

    private final Db db;
    private final EmailService emailService;
    private final TransactionTemplate tx;

    public UserController(Db db, EmailService emailService, TransactionTemplate tx) {
        this.db = db;
        this.emailService = emailService;
        this.tx = tx;
    }

    // -------------------------------------------------------------- lists

    @GetMapping
    public ResponseEntity<Object> list() {
        String sql = "SELECT id, name, username, role, created_at, profile_image, student_id, year, block, course, "
                + "class_subject FROM users WHERE account_status = 'active' "
                + "AND (role != 'student' OR email_verified = 1) ORDER BY id ASC";
        try {
            return Resp.json(db.rows(sql));
        } catch (DataAccessException e) {
            log.error("FETCH USERS ERROR", e);
            return Resp.fail(500, "Failed to fetch users.");
        }
    }

    @GetMapping("/pending")
    public ResponseEntity<Object> pending() {
        String sql = "SELECT id, name, username, role, class_subject, created_at FROM users "
                + "WHERE role = 'teacher' AND account_status = 'pending' ORDER BY created_at ASC";
        try {
            return Resp.json(db.rows(sql));
        } catch (DataAccessException e) {
            log.error("FETCH PENDING TEACHERS ERROR", e);
            return Resp.fail(500, "Failed to fetch pending teachers.");
        }
    }

    // ------------------------------------------------- approve / reject teacher

    @PutMapping("/{id}/approve")
    public ResponseEntity<Object> approve(@PathVariable("id") String userId) {
        try {
            List<Map<String, Object>> rows = db.rows(
                    "SELECT username, name FROM users WHERE id = ? AND role = 'teacher'", userId);
            if (rows.isEmpty()) {
                return Resp.fail(404, "Teacher not found.");
            }
            Map<String, Object> teacher = rows.get(0);

            int changed = db.update("UPDATE users SET account_status = 'active' WHERE id = ? AND role = 'teacher'",
                    userId);
            if (changed == 0) {
                return Resp.fail(404, "Teacher not found.");
            }

            emailService.send(String.valueOf(teacher.get("username")), "CRS account approved",
                    "Hi " + teacher.get("name") + ", your teacher account has been approved. You can now sign in.");

            return Resp.json(Resp.map("message", "Teacher approved successfully."));
        } catch (DataAccessException e) {
            log.error("APPROVE TEACHER ERROR", e);
            return Resp.fail(500, "Failed to approve teacher.");
        }
    }

    @PutMapping("/{id}/reject")
    public ResponseEntity<Object> reject(@PathVariable("id") String userId) {
        try {
            List<Map<String, Object>> rows = db.rows(
                    "SELECT username, name FROM users WHERE id = ? AND role = 'teacher'", userId);
            if (rows.isEmpty()) {
                return Resp.fail(404, "Teacher not found.");
            }
            Map<String, Object> teacher = rows.get(0);

            int changed = db.update("UPDATE users SET account_status = 'rejected' WHERE id = ? AND role = 'teacher'",
                    userId);
            if (changed == 0) {
                return Resp.fail(404, "Teacher not found.");
            }

            emailService.send(String.valueOf(teacher.get("username")), "CRS account not approved",
                    "Hi " + teacher.get("name")
                            + ", your teacher account request was not approved. Contact your admin for details.");

            return Resp.json(Resp.map("message", "Teacher rejected successfully."));
        } catch (DataAccessException e) {
            log.error("REJECT TEACHER ERROR", e);
            return Resp.fail(500, "Failed to reject teacher.");
        }
    }

    // ------------------------------------------------------------ profile

    @PutMapping("/{id}/profile")
    public ResponseEntity<Object> updateProfile(@PathVariable("id") String userId,
                                                @RequestBody Map<String, Object> body) {
        String name = Helpers.str(body, "name");
        String studentId = Helpers.str(body, "student_id");

        if (name == null || name.trim().isEmpty()) {
            return Resp.fail(400, "Name is required.");
        }

        if (!Helpers.empty(studentId) && !studentId.matches("\\d{6}")) {
            return Resp.fail(400, "Student ID must be exactly 6 numbers.");
        }

        int changed;
        try {
            changed = db.update("UPDATE users SET name = ?, profile_image = ?, student_id = ?, year = ?, "
                            + "block = ?, course = ?, class_subject = ? WHERE id = ?",
                    name.trim(),
                    Helpers.orNull(body.get("profile_image")),
                    Helpers.orNull(body.get("student_id")),
                    Helpers.orNull(body.get("year")),
                    Helpers.orNull(body.get("block")),
                    Helpers.orNull(body.get("course")),
                    Helpers.orNull(body.get("class_subject")),
                    userId);
        } catch (DataAccessException e) {
            log.error("UPDATE PROFILE ERROR", e);
            return Resp.fail(500, "Failed to save profile.");
        }

        if (changed == 0) {
            return Resp.fail(404, "User not found.");
        }

        try {
            List<Map<String, Object>> rows = db.rows(
                    "SELECT id, name, username, role, profile_image, student_id, year, block, course, class_subject "
                            + "FROM users WHERE id = ?", userId);
            return Resp.json(Resp.map("message", "Profile updated successfully.",
                    "user", rows.isEmpty() ? null : rows.get(0)));
        } catch (DataAccessException e) {
            log.error("FETCH UPDATED USER ERROR", e);
            return Resp.fail(500, "Profile saved, but failed to reload it.");
        }
    }

    // ----------------------------------------------------------- password

    @PutMapping("/{id}/password")
    public ResponseEntity<Object> changePassword(@PathVariable("id") String userId,
                                                 @RequestBody Map<String, Object> body) {
        String currentPassword = Helpers.str(body, "currentPassword");
        String newPassword = Helpers.str(body, "newPassword");

        if (Helpers.empty(currentPassword) || Helpers.empty(newPassword)) {
            return Resp.fail(400, "Current and new password are required.");
        }

        if (newPassword.length() < 8) {
            return Resp.fail(400, "New password must be at least 8 characters.");
        }

        try {
            List<Map<String, Object>> rows = db.rows("SELECT password FROM users WHERE id = ?", userId);

            if (rows.isEmpty()) {
                return Resp.fail(404, "User not found.");
            }

            if (!Objects.equals(rows.get(0).get("password"), currentPassword)) {
                return Resp.fail(400, "Current password is incorrect.");
            }

            db.update("UPDATE users SET password = ? WHERE id = ?", newPassword, userId);
            return Resp.json(Resp.map("message", "Password changed successfully."));
        } catch (DataAccessException e) {
            log.error("CHANGE PASSWORD ERROR", e);
            return Resp.fail(500, "Failed to change password.");
        }
    }

    // ------------------------------------------------------------- delete

    // Transaction: delete everything that belongs to the user, or nothing at all.
    @DeleteMapping("/{id}")
    public ResponseEntity<Object> delete(@PathVariable("id") String userId) {
        try {
            Integer deleted = tx.execute(status -> {
                db.update("DELETE FROM activity_logs WHERE teacher_id = ?", userId);
                db.update("DELETE FROM follows WHERE student_id = ? OR teacher_id = ?", userId, userId);
                db.update("DELETE FROM reservations WHERE teacher_id = ?", userId);
                db.update("UPDATE rooms SET teacher_id = NULL WHERE teacher_id = ?", userId);
                int n = db.update("DELETE FROM users WHERE id = ?", userId);
                if (n == 0) {
                    status.setRollbackOnly();
                }
                return n;
            });

            if (deleted == null || deleted == 0) {
                return Resp.fail(404, "User not found.");
            }
            return Resp.json(Resp.map("message", "User and their related records deleted successfully."));
        } catch (DataAccessException e) {
            log.error("DELETE USER ERROR", e);
            return Resp.fail(500, "Failed to delete user.");
        }
    }
}
