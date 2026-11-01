const express = require("express");
const db = require("../db");
const { nowInManila, isoDayOfWeek, to12h } = require("../helpers");

const router = express.Router();

router.post("/", (req, res) => {
    const { room_id, teacher_id, start_time, end_time } = req.body;

    if (!room_id || !teacher_id || !start_time || !end_time) {
        return res.status(400).json({
            error: "Room, teacher, start time, and end time are required."
        });
    }

    if (new Date(start_time) >= new Date(end_time)) {
        return res.status(400).json({
            error: "End time must be later than start time."
        });
    }

    const dayOfWeek = isoDayOfWeek(start_time);
    const startTimeOnly = start_time.slice(11) || "00:00:00";
    const endTimeOnly = end_time.slice(11) || "00:00:00";

    const scheduleSql = `
        SELECT start_time, end_time, label
        FROM fixed_schedules
        WHERE room_id = ? AND day_of_week = ?
          AND start_time < ? AND end_time > ?
        ORDER BY start_time
        LIMIT 1
    `;

    db.query(scheduleSql, [room_id, dayOfWeek, endTimeOnly, startTimeOnly], (err, scheduleConflicts) => {
        if (err) {
            console.error("CHECK FIXED SCHEDULE ERROR:", err);
            return res.status(500).json({ error: "Failed to check schedule." });
        }

        if (scheduleConflicts.length > 0) {
            const c = scheduleConflicts[0];
            return res.status(400).json({
                error: `This room has a fixed sched at ${to12h(c.start_time)} - ${to12h(c.end_time)}.`,
                scheduleConflict: true,
                schedule_start: c.start_time,
                schedule_end: c.end_time,
                label: c.label || null
            });
        }

        const checkSql = `
            SELECT id
            FROM reservations
            WHERE room_id = ?
            AND status = 'approved'
            AND start_time < ?
            AND end_time > ?
        `;

        db.query(checkSql, [room_id, end_time, start_time], (err, existing) => {
            if (err) {
                console.error("CHECK RESERVATION ERROR:", err);
                return res.status(500).json({ error: "Failed to check reservation." });
            }

            if (existing.length > 0) {
                return res.status(400).json({
                    error: "That room is already reserved during this time."
                });
            }

            const insertSql = `
                INSERT INTO reservations
                (room_id, teacher_id, start_time, end_time, status)
                VALUES (?, ?, ?, ?, 'approved')
            `;

            db.query(insertSql, [room_id, teacher_id, start_time, end_time], (err, result) => {
                if (err) {
                    console.error("CREATE RESERVATION ERROR:", err);
                    return res.status(500).json({ error: "Failed to create reservation." });
                }

                res.json({
                    message: "Reservation confirmed.",
                    id: result.insertId
                });
            });
        });
    });
});

router.get("/", (req, res) => {

    const sql = `
        SELECT
            reservations.id,
            reservations.room_id,
            rooms.name AS room_name,
            reservations.teacher_id,
            users.name AS teacher_name,
            reservations.start_time,
            reservations.end_time,
            reservations.status,
            reservations.created_at
        FROM reservations
        JOIN rooms ON reservations.room_id = rooms.id
        JOIN users ON reservations.teacher_id = users.id
        ORDER BY reservations.start_time ASC
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error("FETCH RESERVATIONS ERROR:", err);

            return res.status(500).json({
                error: "Failed to fetch reservations."
            });
        }

        res.json(results);
    });
});
router.put("/:id/cancel", (req, res) => {
    const reservationId = req.params.id;
    const { user_id, role } = req.body;

    if (!user_id || !role) {
        return res.status(400).json({
            error: "User ID and role are required."
        });
    }

    const lookupSql = `SELECT room_id, teacher_id FROM reservations WHERE id = ?`;

    db.query(lookupSql, [reservationId], (err, rows) => {
        if (err) {
            console.error("LOOKUP RESERVATION ERROR:", err);
            return res.status(500).json({ error: "Failed to cancel reservation." });
        }

        if (rows.length === 0) {
            return res.status(404).json({ error: "Reservation not found." });
        }

        const { room_id, teacher_id } = rows[0];

        let sql;
        let params;

        if (role === "admin") {
            sql = `
                UPDATE reservations
                SET status = 'cancelled'
                WHERE id = ?
                AND status IN ('pending', 'approved')
            `;
            params = [reservationId];
        } else {
            sql = `
                UPDATE reservations
                SET status = 'cancelled'
                WHERE id = ?
                AND teacher_id = ?
                AND status IN ('pending', 'approved')
            `;
            params = [reservationId, user_id];
        }

        db.query(sql, params, (err, result) => {

            if (err) {
                console.error("CANCEL RESERVATION ERROR:", err);

                return res.status(500).json({
                    error: "Failed to cancel reservation."
                });
            }

            if (result.affectedRows === 0) {
                return res.status(400).json({
                    error: "Reservation cannot be cancelled."
                });
            }

            const currentTime = nowInManila();

            const releaseRoomSql = `
                UPDATE rooms
                SET status = 'vacant',
                    teacher_id = NULL
                WHERE id = ?
                AND status = 'occupied'
                AND teacher_id = ?
            `;

            db.query(releaseRoomSql, [room_id, teacher_id], (err, releaseResult) => {
                if (err) {
                    console.error("RELEASE ROOM ON CANCEL ERROR:", err);
                }

                if (releaseResult && releaseResult.affectedRows > 0) {
                    const logSql = `
                        INSERT INTO activity_logs (teacher_id, room_id, action, timestamp)
                        VALUES (?, ?, 'check-out', ?)
                    `;

                    db.query(logSql, [teacher_id, room_id, currentTime], (logErr) => {
                        if (logErr) {
                            console.error("CANCEL CHECK-OUT LOG ERROR:", logErr);
                        }
                    });
                }

                res.json({
                    message: "Reservation cancelled successfully."
                });
            });
        });
    });
});

router.put("/:id/approve", (req, res) => {
    const reservationId = req.params.id;

    const sql = `
        UPDATE reservations
        SET status = 'approved'
        WHERE id = ?
        AND status = 'pending'
    `;

    db.query(sql, [reservationId], (err, result) => {

        if (err) {
            console.error("APPROVE RESERVATION ERROR:", err);

            return res.status(500).json({
                error: "Failed to approve reservation."
            });
        }

        if (result.affectedRows === 0) {
            return res.status(400).json({
                error: "Reservation cannot be approved."
            });
        }

        res.json({
            message: "Reservation approved successfully."
        });
    });
});
module.exports = router;