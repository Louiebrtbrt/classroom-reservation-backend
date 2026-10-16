require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");

const nodemailer = require("nodemailer");

const mailer = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const app = express();

app.use(cors());
app.use(express.json({ limit: "5mb" }));

// MySQL connection
const db = mysql.createPool({
    host: process.env.MYSQLHOST,
    port: process.env.MYSQLPORT,
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    dateStrings: true,
        ssl: { rejectUnauthorized: false }
});

function nowInManila() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    }).formatToParts(new Date());
    const get = type => parts.find(p => p.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function isoDayOfWeek(dateTimeStr) {
    const datePart = dateTimeStr.slice(0, 10);
    const d = new Date(datePart + 'T00:00:00');
    const day = d.getDay();
    return day === 0 ? 7 : day;
}

function to12h(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

app.get("/api/schedules", (req, res) => {
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

app.post("/api/schedules", (req, res) => {
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

app.put("/api/schedules/:id", (req, res) => {
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

app.delete("/api/schedules/:id", (req, res) => {
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

function generateVerificationCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

function manilaTimeFromDate(date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    }).formatToParts(date);
    const get = type => parts.find(p => p.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isInstitutionalEmail(email) {
    return /^[^\s@]+@mabinicolleges\.edu\.ph$/i.test(email);
}

async function sendEmail(to, subject, message) {
    try {
        const response = await fetch("https://api.brevo.com/v3/smtp/email", {
            method: "POST",
            headers: {
                "api-key": process.env.BREVO_API_KEY,
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify({
                sender: { name: "Classroom Reservation System", email: "luwiserrano@gmail.com" },
                to: [{ email: to }],
                subject,
                textContent: message
            })
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error("EMAIL SEND ERROR:", response.status, errorBody);
            return;
        }

        console.log("EMAIL SENT to", to);
    } catch (err) {
        console.error("EMAIL SEND ERROR:", err);
    }
}

// Test MySQL connection


app.get("/api/rooms", (req, res) => {
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

app.post("/api/rooms", (req, res) => {
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

app.delete("/api/rooms/:id", (req, res) => {
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

app.post("/api/rooms/:id/checkin", (req, res) => {
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
app.post("/api/rooms/:id/checkout", (req, res) => {
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

app.post("/api/login", (req, res) => {
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

app.post("/api/register/student", (req, res) => {
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

app.post("/api/register/teacher", (req, res) => {
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

app.post("/api/verify-code", (req, res) => {
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

app.post("/api/resend-code", (req, res) => {
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

app.get("/api/follows", (req, res) => {
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

app.post("/api/follows", (req, res) => {
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

app.put("/api/follows/:id/approve", (req, res) => {
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


app.put("/api/follows/:id/reject", (req, res) => {
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

app.delete("/api/follows/:id", (req, res) => {
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

app.get("/api/users", (req, res) => {
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

app.get("/api/users/pending", (req, res) => {
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

app.put("/api/users/:id/approve", (req, res) => {
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

app.put("/api/users/:id/reject", (req, res) => {
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

app.put("/api/users/:id/profile", (req, res) => {
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

app.put("/api/users/:id/password", (req, res) => {
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

app.post("/api/reservations", (req, res) => {
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

app.get("/api/reservations", (req, res) => {

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

function completeExpiredReservations() {
    const currentTime = nowInManila();

    const sql = `
        SELECT id, room_id, teacher_id
        FROM reservations
        WHERE status = 'approved'
        AND end_time <= ?
    `;

    db.query(sql, [currentTime], (err, reservations) => {
        if (err) {
            console.error("CHECK EXPIRED RESERVATIONS ERROR:", err);
            return;
        }

        reservations.forEach(reservation => {

            // Mark reservation as completed
            const completeSql = `
                UPDATE reservations
                SET status = 'completed'
                WHERE id = ?
            `;

            db.query(completeSql, [reservation.id], (err) => {
                if (err) {
                    console.error("COMPLETE RESERVATION ERROR:", err);
                    return;
                }

                // Release the room
                const releaseRoomSql = `
                    UPDATE rooms
                    SET status = 'vacant',
                        teacher_id = NULL
                    WHERE id = ?
                    AND status = 'occupied'
                    AND teacher_id = ?
                `;

                db.query(
                    releaseRoomSql,
                    [reservation.room_id, reservation.teacher_id],
                    (err, releaseResult) => {
                        if (err) {
                            console.error("RELEASE ROOM ERROR:", err);
                            return;
                        }

                        console.log(
                            `Reservation ${reservation.id} completed and room ${reservation.room_id} released.`
                        );

                        // Only log a check-out if the teacher was actually checked in
                        if (releaseResult.affectedRows > 0) {
                            const logSql = `
                                INSERT INTO activity_logs (teacher_id, room_id, action, timestamp)
                                VALUES (?, ?, 'check-out', ?)
                            `;

                            db.query(logSql, [reservation.teacher_id, reservation.room_id, currentTime], (logErr) => {
                                if (logErr) {
                                    console.error("AUTO CHECK-OUT LOG ERROR:", logErr);
                                }
                            });
                        }
                    }
                );
            });
        });
    });
}

app.put("/api/reservations/:id/cancel", (req, res) => {
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

app.put("/api/reservations/:id/approve", (req, res) => {
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

app.delete("/api/users/:id", (req, res) => {
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
app.get("/api/activity-logs", (req, res) => {

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

const PORT = process.env.PORT || 3000;

setInterval(completeExpiredReservations, 60000);

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});