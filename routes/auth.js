const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const {
    nowInManila,
    manilaTimeFromDate,
    generateVerificationCode,
    isValidEmail,
    isInstitutionalEmail,
    sendEmail
} = require("../helpers");

const router = express.Router();

router.post("/login", (req, res) => {
    const { username, password } = req.body;

    const sql = "SELECT id, name, username, password, role, account_status, email_verified, profile_image, student_id, year, block, course, class_subject FROM users WHERE username = ?";

    db.query(sql, [username], (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({
                error: "Database error"
            });
        }

        if (results.length === 0 || results[0].password !== password) {
            return res.status(401).json({
                error: "Incorrect username or password."
            });
        }

        const user = results[0];

        if (user.role === "teacher" && user.account_status === "pending") {
            return res.status(403).json({
                error: "Your teacher account is still awaiting admin approval."
            });
        }

        if (user.role === "teacher" && user.account_status === "rejected") {
            return res.status(403).json({
                error: "Your teacher account request was not approved. Contact your admin for details."
            });
        }

        if (user.role === "student" && !user.email_verified) {
            return res.status(403).json({
                error: "Please verify your email before signing in."
            });
        }

        delete user.password;

        res.json({
            message: "Login successful",
            user: user
        });
    });
});

router.post("/register/student", (req, res) => {
    const { name, email, password, confirmPassword } = req.body;

    if (!name || !email || !password || !confirmPassword) {
        return res.status(400).json({ error: "Please fill in all required fields." });
    }

    if (!isInstitutionalEmail(email)) {
        return res.status(400).json({ error: "Please use your institutional email ending in @mabinicolleges.edu.ph." });
    }

    if (password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    if (password !== confirmPassword) {
        return res.status(400).json({ error: "Passwords do not match." });
    }

    const code = generateVerificationCode();
    const expires = manilaTimeFromDate(new Date(Date.now() + 10 * 60 * 1000));

    const checkSql = `SELECT id, email_verified FROM users WHERE username = ?`;

    db.query(checkSql, [email], (err, existing) => {
        if (err) {
            console.error("STUDENT REGISTER CHECK ERROR:", err);
            return res.status(500).json({ error: "Failed to register." });
        }

        if (existing.length > 0) {
            if (existing[0].email_verified) {
                return res.status(400).json({ error: "That email is already registered." });
            }

            const updateSql = `
                UPDATE users
                SET name = ?, password = ?, verification_code = ?, verification_code_expires = ?
                WHERE id = ?
            `;

            return db.query(updateSql, [name, password, code, expires, existing[0].id], (err) => {
                if (err) {
                    console.error("STUDENT REGISTER UPDATE ERROR:", err);
                    return res.status(500).json({ error: "Failed to register." });
                }

                sendEmail(email, "Your CRS verification code", `Your verification code is ${code}. It expires in 10 minutes.`);

                res.json({
                    message: "Verification code sent to your email.",
                    userId: existing[0].id,
                    username: email
                });
            });
        }

        const sql = `
            INSERT INTO users
            (name, username, password, role, account_status, email_verified, verification_code, verification_code_expires)
            VALUES (?, ?, ?, 'student', 'active', 0, ?, ?)
        `;

        db.query(sql, [name, email, password, code, expires], (err, result) => {
            if (err) {
                if (err.code === "ER_DUP_ENTRY") {
                    return res.status(400).json({ error: "That email is already registered." });
                }
                console.error("STUDENT REGISTER ERROR:", err);
                return res.status(500).json({ error: "Failed to register." });
            }

            sendEmail(email, "Your CRS verification code", `Your verification code is ${code}. It expires in 10 minutes.`);

            res.json({
                message: "Verification code sent to your email.",
                userId: result.insertId,
                username: email
            });
        });
    });
});

router.post("/register/teacher", (req, res) => {
    const { name, email, password, confirmPassword, class_subject } = req.body;

    if (!name || !email || !password || !confirmPassword || !class_subject) {
        return res.status(400).json({ error: "Please fill in all required fields." });
    }

    if (!isValidEmail(email)) {
        return res.status(400).json({ error: "Please enter a valid email address." });
    }

    if (password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    if (password !== confirmPassword) {
        return res.status(400).json({ error: "Passwords do not match." });
    }

    const sql = `
        INSERT INTO users
        (name, username, password, role, account_status, email_verified, class_subject)
        VALUES (?, ?, ?, 'teacher', 'pending', 1, ?)
    `;

    db.query(sql, [name, email, password, class_subject], (err, result) => {
        if (err) {
            if (err.code === "ER_DUP_ENTRY") {
                return res.status(400).json({ error: "That email is already registered." });
            }
            console.error("TEACHER REGISTER ERROR:", err);
            return res.status(500).json({ error: "Failed to register." });
        }

        sendEmail(email, "CRS teacher account received", "Your teacher account request has been submitted and is awaiting admin approval.");

        res.json({
            message: "Registration successful. Your account is awaiting admin approval.",
            pending: true,
            user: {
                id: result.insertId,
                name,
                username: email,
                role: "teacher",
                account_status: "pending"
            }
        });
    });
});

router.post("/verify-code", (req, res) => {
    const { username, code } = req.body;

    if (!username || !code) {
        return res.status(400).json({ error: "Email and code are required." });
    }

    const sql = `
        SELECT id, name, username, role, account_status, email_verified, verification_code, verification_code_expires,
               profile_image, student_id, year, block, course, class_subject
        FROM users
        WHERE username = ?
    `;

    db.query(sql, [username], (err, results) => {
        if (err) {
            console.error("VERIFY CODE LOOKUP ERROR:", err);
            return res.status(500).json({ error: "Failed to verify code." });
        }

        if (results.length === 0) {
            return res.status(404).json({ error: "Account not found." });
        }

        const user = results[0];

        if (user.email_verified) {
            return res.status(400).json({ error: "This account is already verified." });
        }

        if (!user.verification_code || user.verification_code !== code) {
            return res.status(400).json({ error: "Incorrect verification code." });
        }

        if (!user.verification_code_expires || user.verification_code_expires < nowInManila()) {
            return res.status(400).json({ error: "This code has expired. Please sign up again." });
        }

        const updateSql = `
            UPDATE users
            SET email_verified = 1, verification_code = NULL, verification_code_expires = NULL
            WHERE id = ?
        `;

        db.query(updateSql, [user.id], (err) => {
            if (err) {
                console.error("VERIFY CODE UPDATE ERROR:", err);
                return res.status(500).json({ error: "Failed to verify code." });
            }

            delete user.verification_code;
            delete user.verification_code_expires;
            user.email_verified = 1;

            res.json({
                message: "Email verified successfully.",
                user
            });
        });
    });
});

router.post("/resend-code", (req, res) => {
    const { username } = req.body;

    if (!username) {
        return res.status(400).json({ error: "Email is required." });
    }

    const sql = `SELECT id, email_verified FROM users WHERE username = ? AND role = 'student'`;

    db.query(sql, [username], (err, rows) => {
        if (err) {
            console.error("RESEND CODE LOOKUP ERROR:", err);
            return res.status(500).json({ error: "Failed to resend code." });
        }

        if (rows.length === 0) {
            return res.status(404).json({ error: "Account not found." });
        }

        if (rows[0].email_verified) {
            return res.status(400).json({ error: "This account is already verified." });
        }

        const code = generateVerificationCode();
        const expires = manilaTimeFromDate(new Date(Date.now() + 10 * 60 * 1000));

        const updateSql = `UPDATE users SET verification_code = ?, verification_code_expires = ? WHERE id = ?`;

        db.query(updateSql, [code, expires, rows[0].id], (err) => {
            if (err) {
                console.error("RESEND CODE UPDATE ERROR:", err);
                return res.status(500).json({ error: "Failed to resend code." });
            }

            sendEmail(username, "Your CRS verification code", `Your verification code is ${code}. It expires in 10 minutes.`);

            res.json({ message: "Verification code resent." });
        });
    });
});
/* ---------- Password reset ---------- */
const resetFailures = new Map(); // email -> { count, resetAt }
const MAX_RESET_ATTEMPTS = 5;

function tooManyResetAttempts(email) {
    const entry = resetFailures.get(email);
    if (!entry) return false;
    if (Date.now() > entry.resetAt) {
        resetFailures.delete(email);
        return false;
    }
    return entry.count >= MAX_RESET_ATTEMPTS;
}

function recordResetFailure(email) {
    const entry = resetFailures.get(email);
    if (!entry || Date.now() > entry.resetAt) {
        resetFailures.set(email, { count: 1, resetAt: Date.now() + 10 * 60 * 1000 });
    } else {
        entry.count++;
    }
}

router.post("/forgot-password", (req, res) => {
    const email = String(req.body.email || "").trim();
    const reply = { message: "If that email is registered, a reset code has been sent." };

    if (!isValidEmail(email)) {
        return res.status(400).json({ error: "Please enter a valid email address." });
    }

    const lookupSql = `SELECT id FROM users WHERE username = ? AND email_verified = 1`;

    db.query(lookupSql, [email], (err, rows) => {
        if (err) {
            console.error("FORGOT PASSWORD LOOKUP ERROR:", err);
            return res.status(500).json({ error: "Failed to send reset code." });
        }

        // Same answer whether or not the account exists, so nobody can check who is registered
        if (rows.length === 0) {
            return res.json(reply);
        }

        const code = String(crypto.randomInt(100000, 1000000));
        const expires = manilaTimeFromDate(new Date(Date.now() + 10 * 60 * 1000));

        const updateSql = `UPDATE users SET verification_code = ?, verification_code_expires = ? WHERE id = ?`;

        db.query(updateSql, [code, expires, rows[0].id], (err) => {
            if (err) {
                console.error("FORGOT PASSWORD UPDATE ERROR:", err);
                return res.status(500).json({ error: "Failed to send reset code." });
            }

            sendEmail(
                email,
                "Your CRS password reset code",
                `Your password reset code is ${code}. It expires in 10 minutes. If you didn't ask for this, you can ignore this email.`
            );

            res.json(reply);
        });
    });
});

router.post("/reset-password", (req, res) => {
    const email = String(req.body.email || "").trim();
    const code = String(req.body.code || "").trim();
    const { newPassword, confirmPassword } = req.body;

    if (!email || !code || !newPassword || !confirmPassword) {
        return res.status(400).json({ error: "Please fill in all fields." });
    }

    if (newPassword.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    if (newPassword !== confirmPassword) {
        return res.status(400).json({ error: "Passwords do not match." });
    }

    if (tooManyResetAttempts(email)) {
        return res.status(429).json({ error: "Too many incorrect attempts. Please wait 10 minutes and try again." });
    }

    const lookupSql = `
        SELECT id, verification_code, verification_code_expires
        FROM users
        WHERE username = ? AND email_verified = 1
    `;

    db.query(lookupSql, [email], (err, rows) => {
        if (err) {
            console.error("RESET PASSWORD LOOKUP ERROR:", err);
            return res.status(500).json({ error: "Failed to reset password." });
        }

        const user = rows[0];
        const valid =
            user &&
            user.verification_code &&
            user.verification_code === code &&
            user.verification_code_expires &&
            user.verification_code_expires >= nowInManila();

        if (!valid) {
            recordResetFailure(email);
            return res.status(400).json({ error: "That code is incorrect or has expired." });
        }

        const updateSql = `
            UPDATE users
            SET password = ?, verification_code = NULL, verification_code_expires = NULL
            WHERE id = ?
        `;

        db.query(updateSql, [newPassword, user.id], (err) => {
            if (err) {
                console.error("RESET PASSWORD UPDATE ERROR:", err);
                return res.status(500).json({ error: "Failed to reset password." });
            }

            resetFailures.delete(email);
            res.json({ message: "Password updated. You can now sign in." });
        });
    });
});
module.exports = router;