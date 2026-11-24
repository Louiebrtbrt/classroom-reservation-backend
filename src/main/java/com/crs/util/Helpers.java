package com.crs.util;

import java.security.SecureRandom;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Map;
import java.util.regex.Pattern;

// Replaces helpers.js (everything except sendEmail, which is in EmailService).
public final class Helpers {
    private Helpers() {}

    private static final ZoneId MANILA = ZoneId.of("Asia/Manila");
    private static final DateTimeFormatter DB_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Pattern EMAIL = Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");
    private static final Pattern INSTITUTIONAL =
            Pattern.compile("^[^\\s@]+@mabinicolleges\\.edu\\.ph$", Pattern.CASE_INSENSITIVE);

    /** Current time in Manila as "yyyy-MM-dd HH:mm:ss" (same format the database uses). */
    public static String nowInManila() {
        return ZonedDateTime.now(MANILA).format(DB_FORMAT);
    }

    /** Any moment in time, shown in Manila time. */
    public static String manilaTimeFromDate(Instant instant) {
        return instant.atZone(MANILA).format(DB_FORMAT);
    }

    /** 1 = Monday ... 7 = Sunday, from a "yyyy-MM-dd HH:mm:ss" string. */
    public static int isoDayOfWeek(String dateTimeStr) {
        return LocalDate.parse(dateTimeStr.substring(0, 10)).getDayOfWeek().getValue();
    }

    /** "14:05:00" -> "2:05 PM" */
    public static String to12h(String timeStr) {
        String[] parts = timeStr.split(":");
        int h = Integer.parseInt(parts[0]);
        int m = Integer.parseInt(parts[1]);
        String period = h >= 12 ? "PM" : "AM";
        int hour12 = h % 12 == 0 ? 12 : h % 12;
        return hour12 + ":" + String.format("%02d", m) + " " + period;
    }

    /** 6-digit code (SecureRandom is safer than the old Math.random). */
    public static String generateVerificationCode() {
        return String.valueOf(100000 + RANDOM.nextInt(900000));
    }

    public static boolean isValidEmail(String email) {
        return email != null && EMAIL.matcher(email).matches();
    }

    public static boolean isInstitutionalEmail(String email) {
        return email != null && INSTITUTIONAL.matcher(email).matches();
    }

    // ---- small helpers for reading request bodies and database values ----

    /** Value from the JSON body as a String, or null if missing. */
    public static String str(Map<String, Object> body, String key) {
        Object v = body.get(key);
        return v == null ? null : String.valueOf(v);
    }

    /** JavaScript-style "falsy" check for text: null or empty. */
    public static boolean empty(String s) {
        return s == null || s.isEmpty();
    }

    /** True if a database value is 1 / true (like checking email_verified in JavaScript). */
    public static boolean truthy(Object v) {
        if (v == null) return false;
        if (v instanceof Boolean b) return b;
        if (v instanceof Number n) return n.intValue() != 0;
        return !String.valueOf(v).isEmpty() && !"0".equals(String.valueOf(v));
    }

    /** JavaScript-style falsy for any JSON value: null, "", 0, false. */
    public static boolean falsy(Object v) {
        if (v == null) return true;
        if (v instanceof Boolean b) return !b;
        if (v instanceof Number n) return n.doubleValue() == 0;
        return String.valueOf(v).isEmpty();
    }

    /** Same as (value || null) in JavaScript. */
    public static Object orNull(Object v) {
        return falsy(v) ? null : v;
    }

    /** True if start is the same as or later than end (like new Date(start) >= new Date(end)). */
    public static boolean startNotBeforeEnd(String start, String end) {
        try {
            LocalDateTime s = LocalDateTime.parse(start.trim().replace(' ', 'T'));
            LocalDateTime e = LocalDateTime.parse(end.trim().replace(' ', 'T'));
            return !s.isBefore(e);
        } catch (DateTimeParseException ex) {
            return start.compareTo(end) >= 0;
        }
    }
}
