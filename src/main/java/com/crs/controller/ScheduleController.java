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
import org.springframework.web.bind.annotation.RestController;

// Replaces routes/schedules.js (fixed weekly class schedules of each room)
@RestController
@RequestMapping("/api/schedules")
public class ScheduleController {
    private static final Logger log = LoggerFactory.getLogger(ScheduleController.class);

    private final Db db;

    public ScheduleController(Db db) {
        this.db = db;
    }

    // Name of the teacher, or null if this id is not an active teacher account.
    private String findTeacherName(Object teacherId) {
        List<Map<String, Object>> rows = db.rows(
                "SELECT name FROM users WHERE id = ? AND role = 'teacher' AND account_status = 'active'", teacherId);
        return rows.isEmpty() ? null : String.valueOf(rows.get(0).get("name"));
    }

    @GetMapping
    public ResponseEntity<Object> list() {
        // label = the teacher's current name (old schedules without a teacher keep their old label)
        String sql = "SELECT fixed_schedules.id, fixed_schedules.room_id, rooms.name AS room_name, rooms.building, "
                + "fixed_schedules.day_of_week, fixed_schedules.start_time, fixed_schedules.end_time, "
                + "fixed_schedules.teacher_id, COALESCE(teachers.name, fixed_schedules.label) AS label "
                + "FROM fixed_schedules "
                + "JOIN rooms ON fixed_schedules.room_id = rooms.id "
                + "LEFT JOIN users AS teachers ON fixed_schedules.teacher_id = teachers.id "
                + "ORDER BY rooms.building, rooms.name, fixed_schedules.day_of_week, fixed_schedules.start_time";
        try {
            return Resp.json(db.rows(sql));
        } catch (DataAccessException e) {
            log.error("FETCH SCHEDULES ERROR", e);
            return Resp.fail(500, "Failed to fetch schedules.");
        }
    }

    @PostMapping
    public ResponseEntity<Object> create(@RequestBody Map<String, Object> body) {
        Object roomId = body.get("room_id");
        Object teacherId = body.get("teacher_id");
        Object day = body.get("day_of_week");
        String start = Helpers.str(body, "start_time");
        String end = Helpers.str(body, "end_time");

        if (Helpers.falsy(roomId) || Helpers.falsy(day) || Helpers.empty(start) || Helpers.empty(end)) {
            return Resp.fail(400, "Room, day, start time, and end time are required.");
        }

        if (Helpers.falsy(teacherId)) {
            return Resp.fail(400, "Please choose a teacher.");
        }

        if (start.compareTo(end) >= 0) {
            return Resp.fail(400, "End time must be later than start time.");
        }

        try {
            String teacherName = findTeacherName(teacherId);
            if (teacherName == null) {
                return Resp.fail(400, "Please choose a teacher from the list.");
            }

            List<Map<String, Object>> existing = db.rows(
                    "SELECT id FROM fixed_schedules WHERE room_id = ? AND day_of_week = ? "
                            + "AND start_time < ? AND end_time > ?", roomId, day, end, start);

            if (!existing.isEmpty()) {
                return Resp.fail(400, "This room already has a fixed schedule that overlaps this time.");
            }

            long id = db.insert("INSERT INTO fixed_schedules (room_id, teacher_id, day_of_week, start_time, end_time, label) "
                    + "VALUES (?, ?, ?, ?, ?, ?)", roomId, teacherId, day, start, end, teacherName);

            return Resp.json(Resp.map("message", "Schedule added successfully.", "id", id));
        } catch (DataAccessException e) {
            log.error("CREATE SCHEDULE ERROR", e);
            return Resp.fail(500, "Failed to add schedule.");
        }
    }

    @PutMapping("/{id}")
    public ResponseEntity<Object> update(@PathVariable("id") String scheduleId,
                                         @RequestBody Map<String, Object> body) {
        Object teacherId = body.get("teacher_id");
        Object day = body.get("day_of_week");
        String start = Helpers.str(body, "start_time");
        String end = Helpers.str(body, "end_time");

        if (Helpers.falsy(day) || Helpers.empty(start) || Helpers.empty(end)) {
            return Resp.fail(400, "Day, start time, and end time are required.");
        }

        if (Helpers.falsy(teacherId)) {
            return Resp.fail(400, "Please choose a teacher.");
        }

        if (start.compareTo(end) >= 0) {
            return Resp.fail(400, "End time must be later than start time.");
        }

        try {
            List<Map<String, Object>> rows = db.rows("SELECT room_id FROM fixed_schedules WHERE id = ?", scheduleId);
            if (rows.isEmpty()) {
                return Resp.fail(404, "Schedule not found.");
            }

            String teacherName = findTeacherName(teacherId);
            if (teacherName == null) {
                return Resp.fail(400, "Please choose a teacher from the list.");
            }

            Object roomId = rows.get(0).get("room_id");

            List<Map<String, Object>> existing = db.rows(
                    "SELECT id FROM fixed_schedules WHERE room_id = ? AND day_of_week = ? AND id != ? "
                            + "AND start_time < ? AND end_time > ?", roomId, day, scheduleId, end, start);

            if (!existing.isEmpty()) {
                return Resp.fail(400, "This room already has a fixed schedule that overlaps this time.");
            }

            int changed = db.update("UPDATE fixed_schedules SET teacher_id = ?, day_of_week = ?, start_time = ?, "
                    + "end_time = ?, label = ? WHERE id = ?", teacherId, day, start, end, teacherName, scheduleId);

            if (changed == 0) {
                return Resp.fail(404, "Schedule not found.");
            }

            return Resp.json(Resp.map("message", "Schedule updated successfully."));
        } catch (DataAccessException e) {
            log.error("UPDATE SCHEDULE ERROR", e);
            return Resp.fail(500, "Failed to update schedule.");
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Object> delete(@PathVariable("id") String scheduleId) {
        try {
            int changed = db.update("DELETE FROM fixed_schedules WHERE id = ?", scheduleId);
            if (changed == 0) {
                return Resp.fail(404, "Schedule not found.");
            }
            return Resp.json(Resp.map("message", "Schedule deleted successfully."));
        } catch (DataAccessException e) {
            log.error("DELETE SCHEDULE ERROR", e);
            return Resp.fail(500, "Failed to delete schedule.");
        }
    }
}