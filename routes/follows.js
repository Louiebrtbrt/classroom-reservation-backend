const express = require("express");
const db = require("../db");

const router = express.Router();

router.get("/", (req, res) => {
    const studentId = req.query.student_id;

    const sql = `
        SELECT
            follows.id,
            follows.student_id,
            follows.teacher_id,
            follows.status,
            follows.created_at,
            students.name AS student_name,
            teachers.name AS teacher_name
        FROM follows
        JOIN users AS students ON follows.student_id = students.id
        JOIN users AS teachers ON follows.teacher_id = teachers.id
        ${studentId ? "WHERE follows.student_id = ?" : ""}
        ORDER BY follows.created_at DESC
    `;

    const params = studentId ? [studentId] : [];

    db.query(sql, params, (err, results) => {
        if (err) {
            console.error("FETCH FOLLOWS ERROR:", err);
            return res.status(500).json({
                error: "Failed to fetch follows."
            });
        }

        res.json(results);
    });
});

router.post("/", (req, res) => {
    const { student_id, teacher_id } = req.body;

    if (!student_id || !teacher_id) {
        return res.status(400).json({
            error: "Student ID and teacher ID are required."
        });
    }

    const checkSql = `
        SELECT *
        FROM follows
        WHERE student_id = ? AND teacher_id = ?
    `;

    db.query(checkSql, [student_id, teacher_id], (err, results) => {
        if (err) {
            console.error("CHECK FOLLOW ERROR:", err);
            return res.status(500).json({
                error: "Failed to check follow request."
            });
        }

        if (results.length > 0) {
            const existing = results[0];

            if (existing.status === "accepted") {
                return res.status(400).json({
                    error: "You are already following this teacher."
                });
            }

            const updateSql = `
                UPDATE follows
                SET status = 'pending'
                WHERE id = ?
            `;

            db.query(updateSql, [existing.id], (err) => {
                if (err) {
                    console.error("UPDATE FOLLOW ERROR:", err);
                    return res.status(500).json({
                        error: "Failed to update follow request."
                    });
                }

                res.json({
                    message: "Follow request sent again."
                });
            });

            return;
        }

        const insertSql = `
            INSERT INTO follows (student_id, teacher_id, status)
            VALUES (?, ?, 'pending')
        `;

        db.query(insertSql, [student_id, teacher_id], (err, result) => {
            if (err) {
                console.error("CREATE FOLLOW ERROR:", err);
                return res.status(500).json({
                    error: "Failed to create follow request."
                });
            }

            res.json({
                message: "Follow request sent.",
                id: result.insertId
            });
        });
    });
});

router.put("/:id/approve", (req, res) => {
    const followId = req.params.id;

    const sql = `
        UPDATE follows
        SET status = 'accepted'
        WHERE id = ?
    `;

    db.query(sql, [followId], (err, result) => {
        if (err) {
            console.error("APPROVE FOLLOW ERROR:", err);
            return res.status(500).json({
                error: "Failed to approve follow request."
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                error: "Follow request not found."
            });
        }

        res.json({
            message: "Follow request approved."
        });
    });
});


router.put("/:id/reject", (req, res) => {
    const followId = req.params.id;

    const sql = `
        UPDATE follows
        SET status = 'rejected'
        WHERE id = ?
    `;

    db.query(sql, [followId], (err, result) => {
        if (err) {
            console.error("REJECT FOLLOW ERROR:", err);
            return res.status(500).json({
                error: "Failed to reject follow request."
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                error: "Follow request not found."
            });
        }

        res.json({
            message: "Follow request rejected."
        });
    });
});

router.delete("/:id", (req, res) => {
    const followId = req.params.id;

    const sql = `DELETE FROM follows WHERE id = ?`;

    db.query(sql, [followId], (err, result) => {
        if (err) {
            console.error("UNFOLLOW ERROR:", err);
            return res.status(500).json({
                error: "Failed to unfollow."
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                error: "Follow request not found."
            });
        }

        res.json({
            message: "Unfollowed successfully."
        });
    });
});
module.exports = router;