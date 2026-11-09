package com.amsidian.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 웹 앱이 넘겨 준 일정 스냅샷(JSON)을 보관하고 위젯이 읽는다.
 * 형식: { "ev": [[date, start, title, done(0|1)], ...], "hol": [date, ...] }  (date = yyyy-MM-dd, start = HH:mm 또는 "")
 */
final class CalStore {
    private static final String PREFS = "nosidian_cal";

    static final class Ev {
        String date, start, title;
        boolean done;
    }

    private CalStore() {}

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void saveSnapshot(Context c, String json) {
        prefs(c).edit().putString("snapshot", json).apply();
    }

    static void saveReminders(Context c, String json) {
        prefs(c).edit().putString("reminders", json).apply();
    }

    static String reminders(Context c) {
        return prefs(c).getString("reminders", "[]");
    }

    /** 날짜별 일정 (시간 없는 일정이 먼저, 이후 시각 순). 스냅샷이 없으면 빈 맵 */
    static Map<String, List<Ev>> events(Context c) {
        Map<String, List<Ev>> out = new HashMap<>();
        try {
            String s = prefs(c).getString("snapshot", null);
            if (s == null) return out;
            JSONArray arr = new JSONObject(s).optJSONArray("ev");
            if (arr == null) return out;
            for (int i = 0; i < arr.length(); i++) {
                JSONArray a = arr.getJSONArray(i);
                Ev e = new Ev();
                e.date = a.getString(0);
                e.start = a.optString(1, "");
                e.title = a.optString(2, "");
                e.done = a.optInt(3, 0) == 1;
                List<Ev> l = out.get(e.date);
                if (l == null) out.put(e.date, l = new ArrayList<>());
                l.add(e);
            }
        } catch (Exception ignored) {
            /* 깨진 스냅샷은 비어 있는 것으로 본다 */
        }
        return out;
    }

    static Set<String> holidays(Context c) {
        Set<String> out = new HashSet<>();
        try {
            String s = prefs(c).getString("snapshot", null);
            if (s == null) return out;
            JSONArray arr = new JSONObject(s).optJSONArray("hol");
            if (arr != null) for (int i = 0; i < arr.length(); i++) out.add(arr.getString(i));
        } catch (Exception ignored) {
        }
        return out;
    }
}
