package com.crs.util;

import java.sql.PreparedStatement;
import java.sql.ResultSetMetaData;
import java.sql.Statement;
import java.sql.Types;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Component;

// Replaces db.js. Same idea as db.query(sql, [values]) in Node.
@Component
public class Db {
    private final JdbcTemplate jdbc;

    public Db(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Turns each row into a Map (column name -> value), like mysql2 did.
     * Dates and times are returned as plain text ("2026-11-23 14:00:00"),
     * same as dateStrings: true in the Node version, so the frontend does not change.
     */
    private static final RowMapper<Map<String, Object>> ROW_MAPPER = (rs, rowNum) -> {
        ResultSetMetaData md = rs.getMetaData();
        Map<String, Object> row = new LinkedHashMap<>();
        for (int i = 1; i <= md.getColumnCount(); i++) {
            int type = md.getColumnType(i);
            Object value;
            if (type == Types.DATE || type == Types.TIME || type == Types.TIMESTAMP
                    || type == Types.TIMESTAMP_WITH_TIMEZONE || type == Types.TIME_WITH_TIMEZONE) {
                String s = rs.getString(i);
                if (s != null && s.endsWith(".0")) s = s.substring(0, s.length() - 2);
                value = s;
            } else {
                value = rs.getObject(i);
            }
            row.put(md.getColumnLabel(i), value);
        }
        return row;
    };

    /** SELECT: returns a list of rows. */
    public List<Map<String, Object>> rows(String sql, Object... args) {
        return jdbc.query(sql, ROW_MAPPER, args);
    }

    /** INSERT / UPDATE / DELETE: returns the number of affected rows. */
    public int update(String sql, Object... args) {
        return jdbc.update(sql, args);
    }

    /** INSERT: returns the new row's id (like result.insertId). */
    public long insert(String sql, Object... args) {
        KeyHolder keys = new GeneratedKeyHolder();
        jdbc.update(con -> {
            PreparedStatement ps = con.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS);
            for (int i = 0; i < args.length; i++) {
                ps.setObject(i + 1, args[i]);
            }
            return ps;
        }, keys);
        Number key = keys.getKey();
        return key == null ? 0 : key.longValue();
    }

    /** For transactions later (delete user / delete room). */
    public JdbcTemplate jdbc() {
        return jdbc;
    }
}
