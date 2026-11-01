require("dotenv").config();
const express = require("express");
const cors = require("cors");


const app = express();

app.use(cors());
app.use(express.json({ limit: "5mb" }));

//routes-sched
app.use("/api/schedules", require("./routes/schedules"));

//routes-rooms
app.use("/api/rooms", require("./routes/rooms"));

//auth
app.use("/api", require("./routes/auth"));

//follows
app.use("/api/follows", require("./routes/follows"));

//users
app.use("/api/users", require("./routes/users"));

//reservations
app.use("/api/reservations", require("./routes/reservations"));

//activitylogs
app.use("/api/activity-logs", require("./routes/activityLogs"));

//db.js 
const db = require("./db");

//helper.js 
const { nowInManila } = require("./helpers");

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

const PORT = process.env.PORT || 3000;

setInterval(completeExpiredReservations, 60000);

    app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});