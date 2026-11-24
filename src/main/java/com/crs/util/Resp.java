package com.crs.util;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.ResponseEntity;

// Short ways to send JSON, matching the Node version: { "error": "..." } and res.json({...})
public final class Resp {
    private Resp() {}

    public static ResponseEntity<Map<String, Object>> error(int status, String message) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("error", message);
        return ResponseEntity.status(status).body(body);
    }

    public static ResponseEntity<Map<String, Object>> ok(Map<String, Object> body) {
        return ResponseEntity.ok(body);
    }

    /** Error as ResponseEntity<Object> (used by controllers that can also return a JSON array). */
    public static ResponseEntity<Object> fail(int status, String message) {
        return ResponseEntity.status(status).body((Object) map("error", message));
    }

    /** Any JSON body (object or array) with status 200. */
    public static ResponseEntity<Object> json(Object body) {
        return ResponseEntity.ok(body);
    }

    /** Any JSON body with a custom status (e.g. 409 with extra fields). */
    public static ResponseEntity<Object> withStatus(int status, Object body) {
        return ResponseEntity.status(status).body(body);
    }

    /** Build a JSON object from pairs: map("message", "Hi", "count", 3) */
    public static Map<String, Object> map(Object... pairs) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) {
            m.put(String.valueOf(pairs[i]), pairs[i + 1]);
        }
        return m;
    }
}
