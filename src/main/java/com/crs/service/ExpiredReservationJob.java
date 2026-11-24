package com.crs.service;

import com.crs.util.Db;
import com.crs.util.Helpers;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

// Replaces completeExpiredReservations() + setInterval(..., 60000) in server.js (auto check-out).
@Component
public class ExpiredReservationJob {
    private static final Logger log = LoggerFactory.getLogger(ExpiredReservationJob.class);

    private final Db db;

    public ExpiredReservationJob(Db db) {
        this.db = db;
    }

    // Runs every 60 seconds (first run after 60 seconds, like setInterval).
    @Scheduled(initialDelay = 60000, fixedRate = 60000)
    public void completeExpiredReservations() {
        String currentTime = Helpers.nowInManila();

        try {
            List<Map<String, Object>> reservations = db.rows(
                    "SELECT id, room_id, teacher_id FROM reservations WHERE status = 'approved' AND end_time <= ?",
                    currentTime);

            for (Map<String, Object> r : reservations) {
                try {
                    // 1. Mark the reservation as completed
                    db.update("UPDATE reservations SET status = 'completed' WHERE id = ?", r.get("id"));

                    // 2. Release the room (only if this teacher is still inside)
                    int released = db.update("UPDATE rooms SET status = 'vacant', teacher_id = NULL "
                            + "WHERE id = ? AND status = 'occupied' AND teacher_id = ?",
                            r.get("room_id"), r.get("teacher_id"));

                    log.info("Reservation {} completed and room {} released.", r.get("id"), r.get("room_id"));

                    // 3. Only log a check-out if the teacher was actually checked in
                    if (released > 0) {
                        db.update("INSERT INTO activity_logs (teacher_id, room_id, action, timestamp) "
                                + "VALUES (?, ?, 'check-out', ?)",
                                r.get("teacher_id"), r.get("room_id"), currentTime);
                    }
                } catch (DataAccessException e) {
                    log.error("AUTO CHECK-OUT ERROR", e);
                }
            }
        } catch (DataAccessException e) {
            log.error("CHECK EXPIRED RESERVATIONS ERROR", e);
        }
    }
}
