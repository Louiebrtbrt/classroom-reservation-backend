const express = require("express");
const db = require("../db");

const router = express.Router();

router.get("/", (req, res) => {

    const sql = `
        SELECT
            activity_logs.id,
            activity_logs.teacher_id,
            users.name AS teacher_name,
            activity_logs.room_id,
            rooms.name AS room_name,
            activity_logs.action,
            activity_logs.timestamp
        FROM activity_logs
        JOIN users ON activity_logs.teacher_id = users.id
        JOIN rooms ON activity_logs.room_id = rooms.id
        ORDER BY activity_logs.timestamp DESC
    `;

    db.query(sql, (err, results) => {

        if (err) {
            console.error("FETCH ACTIVITY LOGS ERROR:", err);

            return res.status(500).json({
                error: "Failed to fetch activity logs."
            });
        }

        res.json(results);
    });
});
module.exports = router;