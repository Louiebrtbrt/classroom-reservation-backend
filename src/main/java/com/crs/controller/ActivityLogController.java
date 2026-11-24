package com.crs.controller;

import com.crs.util.Db;
import com.crs.util.Resp;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

// Replaces routes/activityLogs.js
@RestController
@RequestMapping("/api/activity-logs")
public class ActivityLogController {
    private static final Logger log = LoggerFactory.getLogger(ActivityLogController.class);

    private final Db db;

    public ActivityLogController(Db db) {
        this.db = db;
    }

    @GetMapping
    public ResponseEntity<Object> list() {
        String sql = "SELECT activity_logs.id, activity_logs.teacher_id, users.name AS teacher_name, "
                + "activity_logs.room_id, rooms.name AS room_name, activity_logs.action, activity_logs.timestamp "
                + "FROM activity_logs "
                + "JOIN users ON activity_logs.teacher_id = users.id "
                + "JOIN rooms ON activity_logs.room_id = rooms.id "
                + "ORDER BY activity_logs.timestamp DESC";
        try {
            return Resp.json(db.rows(sql));
        } catch (DataAccessException e) {
            log.error("FETCH ACTIVITY LOGS ERROR", e);
            return Resp.fail(500, "Failed to fetch activity logs.");
        }
    }
}
