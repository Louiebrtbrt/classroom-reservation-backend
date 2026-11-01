const express = require("express");
const db = require("../db");
const { nowInManila, isoDayOfWeek, to12h } = require("../helpers");

const router = express.Router();

router.get("/", (req, res) => {
    const sql = "SELECT * FROM rooms";

    db.query(sql, (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({
                error: "Failed to fetch rooms"
            });
        }

        res.json(results);
    });
});

router.post("/", (req, res) => {
    console.log("POST /api/rooms RECEIVED");
    console.log(req.body);

    const { room_code, name, building, floor } = req.body;

    if (!room_code || !name) {
        return res.status(400).json({
            error: "Room code and room name are required."
        });
    }

    const sql = `
        INSERT INTO rooms (room_code, name, building, floor, status)
        VALUES (?, ?, ?, ?, 'vacant')
    `;

    db.query(
        sql,
        [room_code, name, building || null, floor || null],
        (err, result) => {
            if (err) {
                console.error("MYSQL INSERT ERROR:", err);

                return res.status(500).json({
                    error: err.message
                });
            }

            console.log("ROOM INSERTED INTO MYSQL, ID:", result.insertId);

            res.json({
                message: "Room added successfully",
                id: result.insertId
            });
        }
    );
});

router.delete("/:id", (req, res) => {
    const roomId = req.params.id;

    db.getConnection((err, connection) => {
        if (err) {
            console.error("DELETE ROOM CONNECTION ERROR:", err);
            return res.status(500).json({ error: "Failed to delete room." });
        }

        connection.beginTransaction((err) => {
            if (err) {
                connection.release();
                console.error("DELETE ROOM TRANSACTION ERROR:", err);
                return res.status(500).json({ error: "Failed to delete room." });
            }

            function rollback(err) {
                console.error("DELETE ROOM ERROR:", err);
                connection.rollback(() => {
                    connection.release();
                    res.status(500).json({ error: "Failed to delete room." });
                });
            }

            connection.query("DELETE FROM activity_logs WHERE room_id = ?", [roomId], (err) => {
                if (err) return rollback(err);

                connection.query("DELETE FROM reservations WHERE room_id = ?", [roomId], (err) => {
                    if (err) return rollback(err);

                    connection.query("DELETE FROM rooms WHERE id = ?", [roomId], (err, result) => {
                        if (err) return rollback(err);

                        if (result.affectedRows === 0) {
                            return connection.rollback(() => {
                                connection.release();
                                res.status(404).json({ error: "Room not found." });
                            });
                        }

                        connection.commit((err) => {
                            if (err) return rollback(err);
                            connection.release();
                            res.json({ message: "Room and its related records deleted successfully." });
                        });
                    });
                });
            });
        });
    });
});

router.post("/:id/checkin", (req, res) => {
    const roomId = req.params.id;
    const { teacher_id, end_time, force } = req.body;

    if (!teacher_id) {
        return res.status(400).json({ error: "Teacher ID is required." });
    }

    const currentTime = nowInManila();
    const currentDate = currentTime.slice(0, 10);
    const currentTimeOnly = currentTime.slice(11);
    const currentDay = isoDayOfWeek(currentTime);

    const findSql = `
        SELECT id, name
        FROM rooms
        WHERE teacher_id = ? AND status = 'occupied'
    `;

    db.query(findSql, [teacher_id], (err, existingRooms) => {
        if (err) {
            console.error("CHECK EXISTING ROOM ERROR:", err);
            return res.status(500).json({ error: "Failed to check current room." });
        }

        if (existingRooms.length > 0) {
            return res.status(400).json({
                error: `You are already checked in to ${existingRooms[0].name}. Please check out first.`
            });
        }

        const ownSql = `
            SELECT id, end_time
            FROM reservations
            WHERE room_id = ? AND teacher_id = ? AND status = 'approved'
              AND start_time <= ? AND end_time > ?
            LIMIT 1
        `;

        db.query(ownSql, [roomId, teacher_id, currentTime, currentTime], (err, ownRows) => {
            if (err) {
                console.error("CHECK OWN RESERVATION ERROR:", err);
                return res.status(500).json({ error: "Failed to check reservation." });
            }

            const hasOwnReservation = ownRows.length > 0;
            let sessionEnd;

            if (hasOwnReservation) {
                sessionEnd = ownRows[0].end_time;
            } else if (end_time) {
                sessionEnd = `${currentDate} ${end_time.length === 5 ? end_time + ':00' : end_time}`;
            } else {
                return res.status(422).json({
                    needsTime: true,
                    error: "Please enter how long you will use this room."
                });
            }

            if (sessionEnd <= currentTime) {
                return res.status(400).json({ error: "End time must be later than the current time." });
            }

            const conflictSql = `
                SELECT start_time, end_time
                FROM reservations
                WHERE room_id = ? AND status = 'approved' AND teacher_id != ?
                  AND start_time < ? AND end_time > ?
                ORDER BY start_time
                LIMIT 1
            `;

            db.query(conflictSql, [roomId, teacher_id, sessionEnd, currentTime], (err, conflicts) => {
                if (err) {
                    console.error("CHECK RESERVATION CONFLICT ERROR:", err);
                    return res.status(500).json({ error: "Failed to check reservation." });
                }

                if (conflicts.length > 0) {
                    return res.status(400).json({
                        error: `This room is reserved by another teacher from ${to12h(conflicts[0].start_time.slice(11))} to ${to12h(conflicts[0].end_time.slice(11))}.`
                    });
                }

                function proceedCheckin() {
                    const sql = `
                        UPDATE rooms
                        SET status = 'occupied', teacher_id = ?
                        WHERE id = ? AND status = 'vacant'
                    `;

                    db.query(sql, [teacher_id, roomId], (err, result) => {
                        if (err) {
                            console.error("CHECK-IN ERROR:", err);
                            return res.status(500).json({ error: "Failed to check in." });
                        }

                        if (result.affectedRows === 0) {
                            return res.status(400).json({ error: "Room is not available." });
                        }

                        function finish() {
                            const logSql = `
                                INSERT INTO activity_logs (teacher_id, room_id, action, timestamp)
                                VALUES (?, ?, 'check-in', ?)
                            `;

                            db.query(logSql, [teacher_id, roomId, currentTime], (logErr) => {
                                if (logErr) {
                                    console.error("ACTIVITY LOG ERROR:", logErr);
                                }

                                res.json({ message: "Room checked in successfully." });
                            });
                        }

                        if (hasOwnReservation) {
                            return finish();
                        }

                        const insertSql = `
                            INSERT INTO reservations (room_id, teacher_id, start_time, end_time, status)
                            VALUES (?, ?, ?, ?, 'approved')
                        `;

                        db.query(insertSql, [roomId, teacher_id, currentTime, sessionEnd], (err) => {
                            if (err) {
                                console.error("CREATE CHECK-IN SESSION ERROR:", err);
                            }
                            finish();
                        });
                    });
                }

                if (force) {
                    return proceedCheckin();
                }

                const scheduleSql = `
                    SELECT start_time, end_time, label
                    FROM fixed_schedules
                    WHERE room_id = ? AND day_of_week = ?
                      AND start_time < ? AND end_time > ?
                    ORDER BY start_time
                    LIMIT 1
                `;

                db.query(scheduleSql, [roomId, currentDay, sessionEnd.slice(11), currentTimeOnly], (err, schedules) => {
                    if (err) {
                        console.error("CHECK FIXED SCHEDULE ERROR:", err);
                        return res.status(500).json({ error: "Failed to check schedule." });
                    }

                    if (schedules.length > 0) {
                        return res.status(409).json({
                            error: "This room has a fixed class scheduled for this time.",
                            scheduleConflict: true,
                            schedule_start: schedules[0].start_time,
                            schedule_end: schedules[0].end_time,
                            label: schedules[0].label || null
                        });
                    }

                    proceedCheckin();
                });
            });
        });
    });
});
router.post("/:id/checkout", (req, res) => {
    const roomId = req.params.id;
    const { teacher_id } = req.body;

    const currentTime = nowInManila();

    const sql = `
    UPDATE rooms
    SET status = 'vacant', teacher_id = NULL
    WHERE id = ? AND status = 'occupied' AND teacher_id = ?
`;
    db.query(sql, [roomId, teacher_id], (err, result) => {
        if (err) {
            console.error("CHECK-OUT ERROR:", err);

            return res.status(500).json({
                error: "Failed to check out."
            });
        }

        if (result.affectedRows === 0) {
            return res.status(400).json({
                error: "Room is not currently occupied."
            });
        }

        const logSql = `
    INSERT INTO activity_logs (teacher_id, room_id, action, timestamp)
    VALUES (?, ?, 'check-out', ?)
`;

db.query(logSql, [teacher_id, roomId, currentTime], (logErr) => {

    if (logErr) {
        console.error("ACTIVITY LOG ERROR:", logErr);
    }
});

        const completeSql = `
    UPDATE reservations
    SET status = 'completed'
    WHERE room_id = ? AND teacher_id = ? AND status = 'approved'
      AND start_time <= ? AND end_time > ?
`;

db.query(completeSql, [roomId, teacher_id, currentTime, currentTime], (completeErr) => {

    if (completeErr) {
        console.error("COMPLETE RESERVATION ON CHECKOUT ERROR:", completeErr);
    }

    res.json({
        message: "Room checked out successfully."
    });
});
    });
});

module.exports = router;