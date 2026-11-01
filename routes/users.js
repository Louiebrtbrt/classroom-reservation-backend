const express = require("express");
const db = require("../db");
const { sendEmail } = require("../helpers");

const router = express.Router();

router.get("/", (req, res) => {
    const sql = `
        SELECT id, name, username, role, created_at, profile_image, student_id, year, block, course, class_subject
        FROM users
        WHERE account_status = 'active'
        AND (role != 'student' OR email_verified = 1)
        ORDER BY id ASC
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error("FETCH USERS ERROR:", err);

            return res.status(500).json({
                error: "Failed to fetch users."
            });
        }

        res.json(results);
    });
});

router.get("/pending", (req, res) => {
    const sql = `
        SELECT id, name, username, role, class_subject, created_at
        FROM users
        WHERE role = 'teacher' AND account_status = 'pending'
        ORDER BY created_at ASC
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error("FETCH PENDING TEACHERS ERROR:", err);

            return res.status(500).json({
                error: "Failed to fetch pending teachers."
            });
        }

        res.json(results);
    });
});

router.put("/:id/approve", (req, res) => {
    const userId = req.params.id;

    const lookupSql = `SELECT username, name FROM users WHERE id = ? AND role = 'teacher'`;

    db.query(lookupSql, [userId], (err, rows) => {
        if (err) {
            console.error("APPROVE TEACHER LOOKUP ERROR:", err);
            return res.status(500).json({ error: "Failed to approve teacher." });
        }

        if (rows.length === 0) {
            return res.status(404).json({ error: "Teacher not found." });
        }

        const teacher = rows[0];

        const sql = `
            UPDATE users
            SET account_status = 'active'
            WHERE id = ? AND role = 'teacher'
        `;

        db.query(sql, [userId], (err, result) => {
            if (err) {
                console.error("APPROVE TEACHER ERROR:", err);
                return res.status(500).json({ error: "Failed to approve teacher." });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({ error: "Teacher not found." });
            }

            sendEmail(teacher.username, "CRS account approved", `Hi ${teacher.name}, your teacher account has been approved. You can now sign in.`);

            res.json({ message: "Teacher approved successfully." });
        });
    });
});

router.put("/:id/reject", (req, res) => {
    const userId = req.params.id;

    const lookupSql = `SELECT username, name FROM users WHERE id = ? AND role = 'teacher'`;

    db.query(lookupSql, [userId], (err, rows) => {
        if (err) {
            console.error("REJECT TEACHER LOOKUP ERROR:", err);
            return res.status(500).json({ error: "Failed to reject teacher." });
        }

        if (rows.length === 0) {
            return res.status(404).json({ error: "Teacher not found." });
        }

        const teacher = rows[0];

        const sql = `
            UPDATE users
            SET account_status = 'rejected'
            WHERE id = ? AND role = 'teacher'
        `;

        db.query(sql, [userId], (err, result) => {
            if (err) {
                console.error("REJECT TEACHER ERROR:", err);
                return res.status(500).json({ error: "Failed to reject teacher." });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({ error: "Teacher not found." });
            }

            sendEmail(teacher.username, "CRS account not approved", `Hi ${teacher.name}, your teacher account request was not approved. Contact your admin for details.`);

            res.json({ message: "Teacher rejected successfully." });
        });
    });
});

router.put("/:id/profile", (req, res) => {
    const userId = req.params.id;
    const { name, profile_image, student_id, year, block, course, class_subject } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ error: "Name is required." });
    }

    if (student_id && !/^\d{6}$/.test(student_id)) {
        return res.status(400).json({ error: "Student ID must be exactly 6 numbers." });
    }

    const sql = `
        UPDATE users
        SET name = ?,
            profile_image = ?,
            student_id = ?,
            year = ?,
            block = ?,
            course = ?,
            class_subject = ?
        WHERE id = ?
    `;

    db.query(
        sql,
        [name.trim(), profile_image || null, student_id || null, year || null, block || null, course || null, class_subject || null, userId],
        (err, result) => {
            if (err) {
                console.error("UPDATE PROFILE ERROR:", err);
                return res.status(500).json({ error: "Failed to save profile." });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({ error: "User not found." });
            }

            const selectSql = "SELECT id, name, username, role, profile_image, student_id, year, block, course, class_subject FROM users WHERE id = ?";

            db.query(selectSql, [userId], (err, rows) => {
                if (err) {
                    console.error("FETCH UPDATED USER ERROR:", err);
                    return res.status(500).json({ error: "Profile saved, but failed to reload it." });
                }

                res.json({ message: "Profile updated successfully.", user: rows[0] });
            });
        }
    );
});

router.put("/:id/password", (req, res) => {
    const userId = req.params.id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: "Current and new password are required." });
    }

    if (newPassword.length < 8) {
        return res.status(400).json({ error: "New password must be at least 8 characters." });
    }

    const sql = "SELECT password FROM users WHERE id = ?";

    db.query(sql, [userId], (err, rows) => {
        if (err) {
            console.error("CHANGE PASSWORD LOOKUP ERROR:", err);
            return res.status(500).json({ error: "Failed to change password." });
        }

        if (rows.length === 0) {
            return res.status(404).json({ error: "User not found." });
        }

        if (rows[0].password !== currentPassword) {
            return res.status(400).json({ error: "Current password is incorrect." });
        }

        const updateSql = "UPDATE users SET password = ? WHERE id = ?";

        db.query(updateSql, [newPassword, userId], (err) => {
            if (err) {
                console.error("CHANGE PASSWORD ERROR:", err);
                return res.status(500).json({ error: "Failed to change password." });
            }

            res.json({ message: "Password changed successfully." });
        });
    });
});

router.delete("/:id", (req, res) => {
    const userId = req.params.id;

    db.getConnection((err, connection) => {
        if (err) {
            console.error("DELETE USER CONNECTION ERROR:", err);
            return res.status(500).json({ error: "Failed to delete user." });
        }

        connection.beginTransaction((err) => {
            if (err) {
                connection.release();
                console.error("DELETE USER TRANSACTION ERROR:", err);
                return res.status(500).json({ error: "Failed to delete user." });
            }

            function rollback(err) {
                console.error("DELETE USER ERROR:", err);
                connection.rollback(() => {
                    connection.release();
                    res.status(500).json({ error: "Failed to delete user." });
                });
            }

            connection.query("DELETE FROM activity_logs WHERE teacher_id = ?", [userId], (err) => {
                if (err) return rollback(err);

                connection.query("DELETE FROM follows WHERE student_id = ? OR teacher_id = ?", [userId, userId], (err) => {
                    if (err) return rollback(err);

                    connection.query("DELETE FROM reservations WHERE teacher_id = ?", [userId], (err) => {
                        if (err) return rollback(err);

                        connection.query("UPDATE rooms SET teacher_id = NULL WHERE teacher_id = ?", [userId], (err) => {
                            if (err) return rollback(err);

                            connection.query("DELETE FROM users WHERE id = ?", [userId], (err, result) => {
                                if (err) return rollback(err);

                                if (result.affectedRows === 0) {
                                    return connection.rollback(() => {
                                        connection.release();
                                        res.status(404).json({ error: "User not found." });
                                    });
                                }

                                connection.commit((err) => {
                                    if (err) return rollback(err);
                                    connection.release();
                                    res.json({ message: "User and their related records deleted successfully." });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});
module.exports = router;