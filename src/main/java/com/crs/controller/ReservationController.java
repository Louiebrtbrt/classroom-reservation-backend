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
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

// Replaces routes/reservations.js
@RestController
@RequestMapping("/api/reservations")
public class ReservationController {
    private static final Logger log = LoggerFactory.getLogger(ReservationController.class);

    private final Db db;

    public ReservationController(Db db) {
        this.db = db;
    }

    // ------------------------------------------------------------ create

    @PostMapping
    public ResponseEntity<Object> create(@RequestBody Map<String, Object> body) {
        Object roomId = body.get("room_id");
        Object teacherId = body.get("teacher_id");
        String startTime = Helpers.str(body, "start_time");
        String endTime = Helpers.str(body, "end_time");

        if (Helpers.falsy(roomId) || Helpers.falsy(teacherId) || Helpers.empty(startTime) || Helpers.empty(endTime)) {
            return Resp.fail(400, "Room, teacher, start time, and end time are required.");
        }

        if (Helpers.startNotBeforeEnd(startTime, endTime)) {
            return Resp.fail(400, "End time must be later than start time.");
        }

        int dayOfWeek;
        try {
            dayOfWeek = Helpers.isoDayOfWeek(startTime);
        } catch (RuntimeException e) {
            return Resp.fail(400, "Invalid start time.");
        }
        String startTimeOnly = startTime.length() > 11 ? startTime.substring(11) : "00:00:00";
        String endTimeOnly = endTime.length() > 11 ? endTime.substring(11) : "00:00:00";

        String failMsg = "Failed to check schedule.";
        try {
            // 1. Fixed class schedule of the room on that day
            List<Map<String, Object>> scheduleConflicts = db.rows(
                    "SELECT start_time, end_time, label FROM fixed_schedules "
                            + "WHERE room_id = ? AND day_of_week = ? AND start_time < ? AND end_time > ? "
                            + "ORDER BY start_time LIMIT 1", roomId, dayOfWeek, endTimeOnly, startTimeOnly);

            if (!scheduleConflicts.isEmpty()) {
                Map<String, Object> c = scheduleConflicts.get(0);
                String s = String.valueOf(c.get("start_time"));
                String e = String.valueOf(c.get("end_time"));
                return Resp.withStatus(400, Resp.map(
                        "error", "This room has a fixed sched at " + Helpers.to12h(s) + " - " + Helpers.to12h(e) + ".",
                        "scheduleConflict", true,
                        "schedule_start", c.get("start_time"),
                        "schedule_end", c.get("end_time"),
                        "label", Helpers.orNull(c.get("label"))));
            }

            // 2. Other approved reservations that overlap
            failMsg = "Failed to check reservation.";
            List<Map<String, Object>> existing = db.rows(
                    "SELECT id FROM reservations WHERE room_id = ? AND status = 'approved' "
                            + "AND start_time < ? AND end_time > ?", roomId, endTime, startTime);

            if (!existing.isEmpty()) {
                return Resp.fail(400, "That room is already reserved during this time.");
            }

            failMsg = "Failed to create reservation.";
            long id = db.insert("INSERT INTO reservations (room_id, teacher_id, start_time, end_time, status) "
                    + "VALUES (?, ?, ?, ?, 'approved')", roomId, teacherId, startTime, endTime);

            return Resp.json(Resp.map("message", "Reservation confirmed.", "id", id));
        } catch (DataAccessException e) {
            log.error("CREATE RESERVATION ERROR", e);
            return Resp.fail(500, failMsg);
        }
    }

    // -------------------------------------------------------------- list

    @GetMapping
    public ResponseEntity<Object> list() {
        String sql = "SELECT reservations.id, reservations.room_id, rooms.name AS room_name, "
                + "reservations.teacher_id, users.name AS teacher_name, reservations.start_time, "
                + "reservations.end_time, reservations.status, reservations.created_at "
                + "FROM reservations "
                + "JOIN rooms ON reservations.room_id = rooms.id "
                + "JOIN users ON reservations.teacher_id = users.id "
                + "ORDER BY reservations.start_time ASC";
        try {
            return Resp.json(db.rows(sql));
        } catch (DataAccessException e) {
            log.error("FETCH RESERVATIONS ERROR", e);
            return Resp.fail(500, "Failed to fetch reservations.");
        }
    }

    // ------------------------------------------------------------ cancel

    @PutMapping("/{id}/cancel")
    public ResponseEntity<Object> cancel(@PathVariable("id") String reservationId,
                                         @RequestBody Map<String, Object> body) {
        Object userId = body.get("user_id");
        String role = Helpers.str(body, "role");

        if (Helpers.falsy(userId) || Helpers.empty(role)) {
            return Resp.fail(400, "User ID and role are required.");
        }

        try {
            List<Map<String, Object>> rows = db.rows(
                    "SELECT room_id, teacher_id FROM reservations WHERE id = ?", reservationId);

            if (rows.isEmpty()) {
                return Resp.fail(404, "Reservation not found.");
            }

            Object roomId = rows.get(0).get("room_id");
            Object teacherId = rows.get(0).get("teacher_id");

            int changed;
            if ("admin".equals(role)) {
                changed = db.update("UPDATE reservations SET status = 'cancelled' "
                        + "WHERE id = ? AND status IN ('pending', 'approved')", reservationId);
            } else {
                changed = db.update("UPDATE reservations SET status = 'cancelled' "
                        + "WHERE id = ? AND teacher_id = ? AND status IN ('pending', 'approved')",
                        reservationId, userId);
            }

            if (changed == 0) {
                return Resp.fail(400, "Reservation cannot be cancelled.");
            }

            // If the teacher is currently inside the room, free it and log the check-out
            String currentTime = Helpers.nowInManila();
            try {
                int released = db.update("UPDATE rooms SET status = 'vacant', teacher_id = NULL "
                        + "WHERE id = ? AND status = 'occupied' AND teacher_id = ?", roomId, teacherId);
                if (released > 0) {
                    db.update("INSERT INTO activity_logs (teacher_id, room_id, action, timestamp) "
                            + "VALUES (?, ?, 'check-out', ?)", teacherId, roomId, currentTime);
                }
            } catch (DataAccessException e) {
                log.error("RELEASE ROOM ON CANCEL ERROR", e);
            }

            return Resp.json(Resp.map("message", "Reservation cancelled successfully."));
        } catch (DataAccessException e) {
            log.error("CANCEL RESERVATION ERROR", e);
            return Resp.fail(500, "Failed to cancel reservation.");
        }
    }

    // ----------------------------------------------------------- approve

    @PutMapping("/{id}/approve")
    public ResponseEntity<Object> approve(@PathVariable("id") String reservationId) {
        try {
            int changed = db.update("UPDATE reservations SET status = 'approved' "
                    + "WHERE id = ? AND status = 'pending'", reservationId);
            if (changed == 0) {
                return Resp.fail(400, "Reservation cannot be approved.");
            }
            return Resp.json(Resp.map("message", "Reservation approved successfully."));
        } catch (DataAccessException e) {
            log.error("APPROVE RESERVATION ERROR", e);
            return Resp.fail(500, "Failed to approve reservation.");
        }
    }
}
