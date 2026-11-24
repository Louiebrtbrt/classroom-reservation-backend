package com.crs.controller;

import com.crs.util.Db;
import com.crs.util.Helpers;
import com.crs.util.Resp;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

// Replaces routes/follows.js
@RestController
@RequestMapping("/api/follows")
public class FollowController {
    private static final Logger log = LoggerFactory.getLogger(FollowController.class);

    private final Db db;

    public FollowController(Db db) {
        this.db = db;
    }

    @GetMapping
    public ResponseEntity<Object> list(@RequestParam(name = "student_id", required = false) String studentId) {
        boolean filter = !Helpers.empty(studentId);

        String sql = "SELECT follows.id, follows.student_id, follows.teacher_id, follows.status, follows.created_at, "
                + "students.name AS student_name, teachers.name AS teacher_name "
                + "FROM follows "
                + "JOIN users AS students ON follows.student_id = students.id "
                + "JOIN users AS teachers ON follows.teacher_id = teachers.id "
                + (filter ? "WHERE follows.student_id = ? " : "")
                + "ORDER BY follows.created_at DESC";

        try {
            List<Map<String, Object>> rows = filter ? db.rows(sql, studentId) : db.rows(sql);
            return Resp.json(rows);
        } catch (DataAccessException e) {
            log.error("FETCH FOLLOWS ERROR", e);
            return Resp.fail(500, "Failed to fetch follows.");
        }
    }

    @PostMapping
    public ResponseEntity<Object> create(@RequestBody Map<String, Object> body) {
        Object studentId = body.get("student_id");
        Object teacherId = body.get("teacher_id");

        if (Helpers.falsy(studentId) || Helpers.falsy(teacherId)) {
            return Resp.fail(400, "Student ID and teacher ID are required.");
        }

        List<Map<String, Object>> results;
        try {
            results = db.rows("SELECT * FROM follows WHERE student_id = ? AND teacher_id = ?", studentId, teacherId);
        } catch (DataAccessException e) {
            log.error("CHECK FOLLOW ERROR", e);
            return Resp.fail(500, "Failed to check follow request.");
        }

        if (!results.isEmpty()) {
            Map<String, Object> existing = results.get(0);

            if ("accepted".equals(existing.get("status"))) {
                return Resp.fail(400, "You are already following this teacher.");
            }

            try {
                db.update("UPDATE follows SET status = 'pending' WHERE id = ?", existing.get("id"));
            } catch (DataAccessException e) {
                log.error("UPDATE FOLLOW ERROR", e);
                return Resp.fail(500, "Failed to update follow request.");
            }

            return Resp.json(Resp.map("message", "Follow request sent again."));
        }

        try {
            long id = db.insert("INSERT INTO follows (student_id, teacher_id, status) VALUES (?, ?, 'pending')",
                    studentId, teacherId);
            return Resp.json(Resp.map("message", "Follow request sent.", "id", id));
        } catch (DataAccessException e) {
            log.error("CREATE FOLLOW ERROR", e);
            return Resp.fail(500, "Failed to create follow request.");
        }
    }

    @PutMapping("/{id}/approve")
    public ResponseEntity<Object> approve(@PathVariable("id") String followId) {
        try {
            int changed = db.update("UPDATE follows SET status = 'accepted' WHERE id = ?", followId);
            if (changed == 0) {
                return Resp.fail(404, "Follow request not found.");
            }
            return Resp.json(Resp.map("message", "Follow request approved."));
        } catch (DataAccessException e) {
            log.error("APPROVE FOLLOW ERROR", e);
            return Resp.fail(500, "Failed to approve follow request.");
        }
    }

    @PutMapping("/{id}/reject")
    public ResponseEntity<Object> reject(@PathVariable("id") String followId) {
        try {
            int changed = db.update("UPDATE follows SET status = 'rejected' WHERE id = ?", followId);
            if (changed == 0) {
                return Resp.fail(404, "Follow request not found.");
            }
            return Resp.json(Resp.map("message", "Follow request rejected."));
        } catch (DataAccessException e) {
            log.error("REJECT FOLLOW ERROR", e);
            return Resp.fail(500, "Failed to reject follow request.");
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Object> unfollow(@PathVariable("id") String followId) {
        try {
            int changed = db.update("DELETE FROM follows WHERE id = ?", followId);
            if (changed == 0) {
                return Resp.fail(404, "Follow request not found.");
            }
            return Resp.json(Resp.map("message", "Unfollowed successfully."));
        } catch (DataAccessException e) {
            log.error("UNFOLLOW ERROR", e);
            return Resp.fail(500, "Failed to unfollow.");
        }
    }
}
