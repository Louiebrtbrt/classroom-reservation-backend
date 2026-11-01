const express = require("express");
const db = require("../db");

const router = express.Router();

router.get("/", (req, res) => {
    const sql = `
        SELECT
            fixed_schedules.id,
            fixed_schedules.room_id,
            rooms.name AS room_name,
            rooms.building,
            fixed_schedules.day_of_week,
            fixed_schedules.start_time,
            fixed_schedules.end_time,
            fixed_schedules.label
        FROM fixed_schedules
        JOIN rooms ON fixed_schedules.room_id = rooms.id
        ORDER BY rooms.building, rooms.name, fixed_schedules.day_of_week, fixed_schedules.start_time
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error("FETCH SCHEDULES ERROR:", err);
            return res.status(500).json({ error: "Failed to fetch schedules." });
        }

        res.json(results);
    });
});

router.post("/", (req, res) => {
    const { room_id, day_of_week, start_time, end_time, label } = req.body;

    if (!room_id || !day_of_week || !start_time || !end_time) {
        return res.status(400).json({ error: "Room, day, start time, and end time are required." });
    }

    if (start_time >= end_time) {
        return res.status(400).json({ error: "End time must be later than start time." });
    }

    const overlapSql = `
        SELECT id FROM fixed_schedules
        WHERE room_id = ? AND day_of_week = ?
        AND start_time < ? AND end_time > ?
    `;

    db.query(overlapSql, [room_id, day_of_week, end_time, start_time], (err, existing) => {
        if (err) {
            console.error("CHECK SCHEDULE OVERLAP ERROR:", err);
            return res.status(500).json({ error: "Failed to add schedule." });
        }

        if (existing.length > 0) {
            return res.status(400).json({ error: "This room already has a fixed schedule that overlaps this time." });
        }

        const insertSql = `
            INSERT INTO fixed_schedules (room_id, day_of_week, start_time, end_time, label)
            VALUES (?, ?, ?, ?, ?)
        `;

        db.query(insertSql, [room_id, day_of_week, start_time, end_time, label || null], (err, result) => {
            if (err) {
                console.error("CREATE SCHEDULE ERROR:", err);
                return res.status(500).json({ error: "Failed to add schedule." });
            }

            res.json({ message: "Schedule added successfully.", id: result.insertId });
        });
    });
});

router.put("/:id", (req, res) => {
    const scheduleId = req.params.id;
    const { day_of_week, start_time, end_time, label } = req.body;

    if (!day_of_week || !start_time || !end_time) {
        return res.status(400).json({ error: "Day, start time, and end time are required." });
    }

    if (start_time >= end_time) {
        return res.status(400).json({ error: "End time must be later than start time." });
    }

    const lookupSql = `SELECT room_id FROM fixed_schedules WHERE id = ?`;

    db.query(lookupSql, [scheduleId], (err, rows) => {
        if (err) {
            console.error("LOOKUP SCHEDULE ERROR:", err);
            return res.status(500).json({ error: "Failed to update schedule." });
        }

        if (rows.length === 0) {
            return res.status(404).json({ error: "Schedule not found." });
        }

        const roomId = rows[0].room_id;

        const overlapSql = `
            SELECT id FROM fixed_schedules
            WHERE room_id = ? AND day_of_week = ? AND id != ?
            AND start_time < ? AND end_time > ?
        `;

        db.query(overlapSql, [roomId, day_of_week, scheduleId, end_time, start_time], (err, existing) => {
            if (err) {
                console.error("CHECK SCHEDULE OVERLAP ERROR:", err);
                return res.status(500).json({ error: "Failed to update schedule." });
            }

            if (existing.length > 0) {
                return res.status(400).json({ error: "This room already has a fixed schedule that overlaps this time." });
            }

            const updateSql = `
                UPDATE fixed_schedules
                SET day_of_week = ?, start_time = ?, end_time = ?, label = ?
                WHERE id = ?
            `;

            db.query(updateSql, [day_of_week, start_time, end_time, label || null, scheduleId], (err, result) => {
                if (err) {
                    console.error("UPDATE SCHEDULE ERROR:", err);
                    return res.status(500).json({ error: "Failed to update schedule." });
                }

                if (result.affectedRows === 0) {
                    return res.status(404).json({ error: "Schedule not found." });
                }

                res.json({ message: "Schedule updated successfully." });
            });
        });
    });
});

router.delete("/:id", (req, res) => {
    const scheduleId = req.params.id;

    const sql = `DELETE FROM fixed_schedules WHERE id = ?`;

    db.query(sql, [scheduleId], (err, result) => {
        if (err) {
            console.error("DELETE SCHEDULE ERROR:", err);
            return res.status(500).json({ error: "Failed to delete schedule." });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "Schedule not found." });
        }

        res.json({ message: "Schedule deleted successfully." });
    });
});

module.exports = router;
