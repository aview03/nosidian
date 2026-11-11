package com.amsidian.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.text.format.DateUtils;
import android.view.View;
import android.widget.RemoteViews;

import java.text.DateFormatSymbols;
import java.util.Calendar;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** 월간 달력 위젯: 6주 격자 + 일정 점. 날짜를 누르면 앱의 그 날로, ‹ › 로 달을 넘긴다. */
public class MonthWidgetProvider extends AppWidgetProvider {
    static final String ACT_PREV = "com.amsidian.app.MONTH_PREV";
    static final String ACT_NEXT = "com.amsidian.app.MONTH_NEXT";
    static final String ACT_TODAY = "com.amsidian.app.MONTH_TODAY";
    private static final String KEY_OFF = "month_off";
    /** 칸 하나에 둘 수 있는 일정 줄(칩) 수 — widget_month.xml 의 ce_N_0..2 */
    private static final int MAX_CHIPS = 3;

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, build(ctx, mgr, id));
    }

    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager mgr, int id, android.os.Bundle opts) {
        mgr.updateAppWidget(id, build(ctx, mgr, id)); // 크기를 바꾸면 칸에 보이는 줄 수도 다시 계산
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String a = intent.getAction();
        if (ACT_PREV.equals(a) || ACT_NEXT.equals(a) || ACT_TODAY.equals(a)) {
            int off = CalStore.prefs(ctx).getInt(KEY_OFF, 0);
            off = ACT_PREV.equals(a) ? off - 1 : ACT_NEXT.equals(a) ? off + 1 : 0;
            CalStore.prefs(ctx).edit().putInt(KEY_OFF, off).apply();
            refresh(ctx);
            return;
        }
        super.onReceive(ctx, intent);
    }

    static void refresh(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, MonthWidgetProvider.class));
        for (int id : ids) mgr.updateAppWidget(id, build(ctx, mgr, id));
    }

    private static PendingIntent action(Context ctx, String act, int code) {
        Intent i = new Intent(ctx, MonthWidgetProvider.class).setAction(act);
        return PendingIntent.getBroadcast(ctx, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static int color(Context ctx, int res) {
        return ctx.getResources().getColor(res, null);
    }

    static RemoteViews build(Context ctx, AppWidgetManager mgr, int id) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_month);
        Map<String, List<CalStore.Ev>> ev = CalStore.events(ctx);
        Set<String> hol = CalStore.holidays(ctx);
        Map<String, String> holName = CalStore.holidayNames(ctx);

        // 위젯 크기(dp)에서 칸 하나의 너비·높이를 어림해, 일정 제목을 몇 줄·몇 글자까지 보일지 정한다
        android.os.Bundle o = mgr.getAppWidgetOptions(id);
        boolean land = ctx.getResources().getConfiguration().orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE;
        int wDp = o.getInt(land ? AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH : AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
        int hDp = o.getInt(land ? AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT : AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
        if (wDp <= 0) wDp = 300;
        if (hDp <= 0) hDp = 300;
        float colDp = (wDp - 16) / 7f;
        float rowDp = (hDp - 16 - 32 - 16) / 6f;
        int lines = Math.min(MAX_CHIPS, Math.max(2, (int) ((rowDp - 4 - 15) / 12.5f))); // 날짜 줄을 뺀 나머지 줄 수 (+N 줄 포함)
        int off = CalStore.prefs(ctx).getInt(KEY_OFF, 0);

        Calendar first = Calendar.getInstance();
        first.set(Calendar.DAY_OF_MONTH, 1);
        first.set(Calendar.HOUR_OF_DAY, 12);
        first.add(Calendar.MONTH, off);
        int month = first.get(Calendar.MONTH);
        rv.setTextViewText(R.id.w_title, DateUtils.formatDateTime(ctx, first.getTimeInMillis(), DateUtils.FORMAT_SHOW_DATE | DateUtils.FORMAT_NO_MONTH_DAY | DateUtils.FORMAT_SHOW_YEAR));

        String[] wd = DateFormatSymbols.getInstance().getShortWeekdays(); // 1=일 ... 7=토
        for (int i = 0; i < 7; i++) {
            int rid = ctx.getResources().getIdentifier("wd_" + i, "id", ctx.getPackageName());
            rv.setTextViewText(rid, wd[i + 1]);
            rv.setTextColor(rid, color(ctx, i == 0 ? R.color.w_accent : R.color.w_muted));
        }

        String today = Links.ymd(Calendar.getInstance());
        Calendar day = (Calendar) first.clone();
        day.add(Calendar.DAY_OF_MONTH, -(first.get(Calendar.DAY_OF_WEEK) - 1));
        for (int i = 0; i < 42; i++) {
            String key = Links.ymd(day);
            List<CalStore.Ev> list = ev.get(key);
            String hn = holName.get(key);
            int evN = list == null ? 0 : list.size();
            int n = evN + (hn != null ? 1 : 0); // 공휴일 이름이 맨 앞 한 줄
            boolean inMonth = day.get(Calendar.MONTH) == month;
            boolean red = day.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY || hol.contains(key);
            int fg = color(ctx, red ? R.color.w_accent : inMonth ? R.color.w_text : R.color.w_muted);
            if (!inMonth) fg = (fg & 0x00FFFFFF) | 0x80000000; // 이웃 달은 흐리게

            // 칸 = 날짜 + 일정 칩 최대 3줄(각 칩은 칸 폭을 꽉 채우는 박스, 글자는 한 줄 말줄임)
            int shown = n <= lines ? n : lines - 1; // 다 들어가면 모두, 아니면 (lines-1)개 + "+N"
            int accent = color(ctx, R.color.w_accent);
            int muted = color(ctx, R.color.w_muted);
            int cid = ctx.getResources().getIdentifier("cell_" + i, "id", ctx.getPackageName());
            int did = ctx.getResources().getIdentifier("cd_" + i, "id", ctx.getPackageName());
            rv.setTextViewText(did, String.valueOf(day.get(Calendar.DAY_OF_MONTH)));
            rv.setTextColor(did, fg);
            for (int k = 0; k < MAX_CHIPS; k++) {
                int eid = ctx.getResources().getIdentifier("ce_" + i + "_" + k, "id", ctx.getPackageName());
                if (k < shown) {
                    boolean isHol = hn != null && k == 0;
                    CalStore.Ev e = isHol ? null : list.get(k - (hn != null ? 1 : 0));
                    rv.setTextViewText(eid, (isHol ? hn : e.title).replace('\n', ' ').trim());
                    rv.setTextColor(eid, isHol ? accent : (e.done ? muted : color(ctx, R.color.w_text)));
                    rv.setViewVisibility(eid, View.VISIBLE);
                } else if (k == shown && n > shown) {
                    rv.setTextViewText(eid, "+" + (n - shown)); // 칩 없이 글자만
                    rv.setTextColor(eid, muted);
                    rv.setInt(eid, "setBackgroundResource", 0);
                    rv.setViewVisibility(eid, View.VISIBLE);
                } else {
                    rv.setViewVisibility(eid, View.GONE);
                }
            }
            rv.setInt(cid, "setBackgroundResource", key.equals(today) ? R.drawable.w_cell_today : R.drawable.w_cell);
            rv.setOnClickPendingIntent(cid, Links.pending(ctx, 100 + i, key, false));
            day.add(Calendar.DAY_OF_MONTH, 1);
        }

        rv.setOnClickPendingIntent(R.id.w_prev, action(ctx, ACT_PREV, 1));
        rv.setOnClickPendingIntent(R.id.w_next, action(ctx, ACT_NEXT, 2));
        rv.setOnClickPendingIntent(R.id.w_today, action(ctx, ACT_TODAY, 3));
        return rv;
    }
}
