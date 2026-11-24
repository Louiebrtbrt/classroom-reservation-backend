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
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

// Replaces routes/rooms.js
@RestController
@RequestMapping("/api/rooms")
public class RoomController {
    private static final Logger log = LoggerFactory.getLogger(RoomController.class);

    private final Db db;
    private final TransactionTemplate tx;

    public RoomController(Db db, TransactionTemplate tx) {
        this.db = db;
        this.tx = tx;
    }

    // -------------------------------------------------------------- list

    @GetMapping
    public ResponseEntity<Object> list() {
        try {
            return Resp.json(db.rows("SELECT * FROM rooms"));
        } catch (DataAccessException e) {
            log.error("FETCH ROOMS ERROR", e);
            return Resp.fail(500, "Failed to fetch rooms");
        }
    }

    // --------------------------------------------------------------- add

    @PostMapping
    public ResponseEntity<Object> create(@RequestBody Map<String, Object> body) {
        String roomCode = Helpers.str(body, "room_code");
        String name = Helpers.str(body, "name");

        if (Helpers.empty(roomCode) || Helpers.empty(name)) {
            return Resp.fail(400, "Room code and room name are required.");
        }

        try {
            long id = db.insert("INSERT INTO rooms (room_code, name, building, floor, status) "
                    + "VALUES (?, ?, ?, ?, 'vacant')",
                    roomCode, name, Helpers.orNull(body.get("building")), Helpers.orNull(body.get("floor")));

            return Resp.json(Resp.map("message", "Room added successfully", "id", id));
        } catch (DataAccessException e) {
            log.error("MYSQL INSERT ERROR", e);
            return Resp.fail(500, e.getMostSpecificCause().getMessage());
        }
    }

    // ------------------------------------------------------------ delete

    // Transaction: all three deletes happen, or none of them.
    @DeleteMapping("/{id}")
    public ResponseEntity<Object> delete(@PathVariable("id") String roomId) {
        try {
            Integer deleted = tx.execute(status -> {
                db.update("DELETE FROM activity_logs WHERE room_id = ?", roomId);
                db.update("DELETE FROM reservations WHERE room_id = ?", roomId);
                int n = db.update("DELETE FROM rooms WHERE id = ?", roomId);
                if (n == 0) {
                    status.setRollbackOnly();
                }
                return n;
            });

            if (deleted == null || deleted == 0) {
                return Resp.fail(404, "Room not found.");
            }
            return Resp.json(Resp.map("message", "Room and its related records deleted successfully."));
        } catch (DataAccessException e) {
            log.error("DELETE ROOM ERROR", e);
            return Resp.fail(500, "Failed to delete room.");
        }
    }

    // ---------------------------------------------------------- check-in

    @PostMapping("/{id}/checkin")
    public ResponseEntity<Object> checkin(@PathVariable("id") String roomId,
                                          @RequestBody Map<String, Object> body) {
        Object teacherId = body.get("teacher_id");
        String endTimeInput = Helpers.str(body, "end_time");
        boolean force = !Helpers.falsy(body.get("force"));

        if (Helpers.falsy(teacherId)) {
            return Resp.fail(400, "Teacher ID is required.");
        }

        String currentTime = Helpers.nowInManila();
        String currentDate = currentTime.substring(0, 10);
        String currentTimeOnly = currentTime.substring(11);
        int currentDay = Helpers.isoDayOfWeek(currentTime);

        String failMsg = "Failed to check current room.";
        try {
            // 1. Already inside another room?
            List<Map<String, Object>> existingRooms = db.rows(
                    "SELECT id, name FROM rooms WHERE teacher_id = ? AND status = 'occupied'", teacherId);

            if (!existingRooms.isEmpty()) {
                return Resp.fail(400, "You are already checked in to " + existingRooms.get(0).get("name")
                        + ". Please check out first.");
            }

            // 2. Does the teacher have a reservation for this room right now?
            failMsg = "Failed to check reservation.";
            List<Map<String, Object>> ownRows = db.rows(
                    "SELECT id, end_time FROM reservations "
                            + "WHERE room_id = ? AND teacher_id = ? AND status = 'approved' "
                            + "AND start_time <= ? AND end_time > ? LIMIT 1",
                    roomId, teacherId, currentTime, currentTime);

            boolean hasOwnReservation = !ownRows.isEmpty();
            String sessionEnd;

            if (hasOwnReservation) {
                sessionEnd = String.valueOf(ownRows.get(0).get("end_time"));
            } else if (!Helpers.empty(endTimeInput)) {
                sessionEnd = currentDate + " " + (endTimeInput.length() == 5 ? endTimeInput + ":00" : endTimeInput);
            } else {
                return Resp.withStatus(422, Resp.map(
                        "needsTime", true,
                        "error", "Please enter how long you will use this room."));
            }

            if (sessionEnd.compareTo(currentTime) <= 0) {
                return Resp.fail(400, "End time must be later than the current time.");
            }

            // 3. Reserved by another teacher during this session?
            List<Map<String, Object>> conflicts = db.rows(
                    "SELECT start_time, end_time FROM reservations "
                            + "WHERE room_id = ? AND status = 'approved' AND teacher_id != ? "
                            + "AND start_time < ? AND end_time > ? ORDER BY start_time LIMIT 1",
                    roomId, teacherId, sessionEnd, currentTime);

            if (!conflicts.isEmpty()) {
                String s = String.valueOf(conflicts.get(0).get("start_time")).substring(11);
                String e = String.valueOf(conflicts.get(0).get("end_time")).substring(11);
                return Resp.fail(400, "This room is reserved by another teacher from "
                        + Helpers.to12h(s) + " to " + Helpers.to12h(e) + ".");
            }

            // 4. Fixed class schedule (skipped when the teacher confirms with force)
            if (!force) {
                failMsg = "Failed to check schedule.";
                List<Map<String, Object>> schedules = db.rows(
                        "SELECT start_time, end_time, label FROM fixed_schedules "
                                + "WHERE room_id = ? AND day_of_week = ? AND start_time < ? AND end_time > ? "
                                + "ORDER BY start_time LIMIT 1",
                        roomId, currentDay, sessionEnd.substring(11), currentTimeOnly);

                if (!schedules.isEmpty()) {
                    Map<String, Object> sc = schedules.get(0);
                    return Resp.withStatus(409, Resp.map(
                            "error", "This room has a fixed class scheduled for this time.",
                            "scheduleConflict", true,
                            "schedule_start", sc.get("start_time"),
                            "schedule_end", sc.get("end_time"),
                            "label", Helpers.orNull(sc.get("label"))));
                }
            }

            // 5. Occupy the room. "AND status = 'vacant'" makes this safe if two people scan at once.
            failMsg = "Failed to check in.";
            int updated = db.update("UPDATE rooms SET status = 'occupied', teacher_id = ? "
                    + "WHERE id = ? AND status = 'vacant'", teacherId, roomId);

            if (updated == 0) {
                return Resp.fail(400, "Room is not available.");
            }

            // 6. Walk-in (no reservation): create one for this session
            if (!hasOwnReservation) {
                try {
                    db.update("INSERT INTO reservations (room_id, teacher_id, start_time, end_time, status) "
                            + "VALUES (?, ?, ?, ?, 'approved')", roomId, teacherId, currentTime, sessionEnd);
                } catch (DataAccessException e) {
                    log.error("CREATE CHECK-IN SESSION ERROR", e);
                }
            }

            // 7. Activity log
            try {
                db.update("INSERT INTO activity_logs (teacher_id, room_id, action, timestamp) "
                        + "VALUES (?, ?, 'check-in', ?)", teacherId, roomId, currentTime);
            } catch (DataAccessException e) {
                log.error("ACTIVITY LOG ERROR", e);
            }

            return Resp.json(Resp.map("message", "Room checked in successfully."));
        } catch (DataAccessException e) {
            log.error("CHECK-IN ERROR", e);
            return Resp.fail(500, failMsg);
        }
    }

    // --------------------------------------------------------- check-out

    @PostMapping("/{id}/checkout")
    public ResponseEntity<Object> checkout(@PathVariable("id") String roomId,
                                           @RequestBody Map<String, Object> body) {
        Object teacherId = body.get("teacher_id");
        String currentTime = Helpers.nowInManila();

        try {
            int updated = db.update("UPDATE rooms SET status = 'vacant', teacher_id = NULL "
                    + "WHERE id = ? AND status = 'occupied' AND teacher_id = ?", roomId, teacherId);

            if (updated == 0) {
                return Resp.fail(400, "Room is not currently occupied.");
            }

            try {
                db.update("INSERT INTO activity_logs (teacher_id, room_id, action, timestamp) "
                        + "VALUES (?, ?, 'check-out', ?)", teacherId, roomId, currentTime);
            } catch (DataAccessException e) {
                log.error("ACTIVITY LOG ERROR", e);
            }

            try {
                db.update("UPDATE reservations SET status = 'completed' "
                        + "WHERE room_id = ? AND teacher_id = ? AND status = 'approved' "
                        + "AND start_time <= ? AND end_time > ?", roomId, teacherId, currentTime, currentTime);
            } catch (DataAccessException e) {
                log.error("COMPLETE RESERVATION ON CHECKOUT ERROR", e);
            }

            return Resp.json(Resp.map("message", "Room checked out successfully."));
        } catch (DataAccessException e) {
            log.error("CHECK-OUT ERROR", e);
            return Resp.fail(500, "Failed to check out.");
        }
    }
}
