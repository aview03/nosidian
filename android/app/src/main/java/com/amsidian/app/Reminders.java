package com.amsidian.app;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 일정 알림. 앱이 꺼져 있어도 울리도록 AlarmManager 에 등록한다.
 * 정확한 시각 알람 권한을 요구하지 않는 setAndAllowWhileIdle 을 쓰므로 절전 모드에서는 몇 분 늦을 수 있다.
 */
public final class Reminders {
    static final String ACTION = "com.amsidian.app.REMIND";
    static final String CHANNEL = "events";
    private static final String KEY_IDS = "rem_ids";

    private Reminders() {}

    private static PendingIntent pi(Context c, int id, String title, String body, String date) {
        Intent i = new Intent(c, ReminderReceiver.class).setAction(ACTION).setData(Uri.parse("nosidian://remind/" + id));
        i.putExtra("title", title).putExtra("body", body).putExtra("date", date).putExtra("id", id);
        return PendingIntent.getBroadcast(c, id, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** 이전에 등록한 알람을 모두 지우고 목록대로 다시 등록한다. 항목: {id, at(ms), title, body, date} */
    static void schedule(Context c, JSONArray list) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        try {
            JSONArray old = new JSONArray(CalStore.prefs(c).getString(KEY_IDS, "[]"));
            for (int i = 0; i < old.length(); i++) am.cancel(pi(c, old.getInt(i), "", "", ""));
        } catch (Exception ignored) {
        }
        JSONArray ids = new JSONArray();
        long now = System.currentTimeMillis();
        for (int i = 0; i < list.length(); i++) {
            JSONObject o = list.optJSONObject(i);
            if (o == null) continue;
            long at = o.optLong("at");
            if (at <= now) continue;
            int id = o.optInt("id");
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi(c, id, o.optString("title"), o.optString("body"), o.optString("date")));
            ids.put(id);
        }
        CalStore.prefs(c).edit().putString(KEY_IDS, ids.toString()).apply();
        CalStore.saveReminders(c, list.toString());
    }

    static void rescheduleFromStore(Context c) {
        try {
            schedule(c, new JSONArray(CalStore.reminders(c)));
        } catch (Exception ignored) {
        }
    }

    static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, c.getString(R.string.w_channel), NotificationManager.IMPORTANCE_HIGH));
        }
    }

    public static final class ReminderReceiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context c, Intent intent) {
            if (!ACTION.equals(intent.getAction())) return;
            if (!NotificationManagerCompat.from(c).areNotificationsEnabled()) return;
            ensureChannel(c);
            int id = intent.getIntExtra("id", 0);
            String date = intent.getStringExtra("date");
            if (date == null) date = Links.ymd(java.util.Calendar.getInstance());
            NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_event)
                .setContentTitle(intent.getStringExtra("title"))
                .setContentText(intent.getStringExtra("body"))
                .setAutoCancel(true)
                .setCategory(NotificationCompat.CATEGORY_EVENT)
                .setContentIntent(Links.pending(c, id, date, false));
            try {
                NotificationManagerCompat.from(c).notify(id, b.build());
            } catch (SecurityException ignored) {
                /* 알림 권한이 사이에 회수된 경우 */
            }
        }
    }

    public static final class BootReceiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context c, Intent intent) {
            String a = intent.getAction();
            if (Intent.ACTION_BOOT_COMPLETED.equals(a) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) rescheduleFromStore(c);
        }
    }
}
