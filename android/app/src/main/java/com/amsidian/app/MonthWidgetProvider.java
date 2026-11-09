package com.amsidian.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.format.DateUtils;
import android.text.style.ForegroundColorSpan;
import android.text.style.RelativeSizeSpan;
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

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, build(ctx));
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
        for (int id : ids) mgr.updateAppWidget(id, build(ctx));
    }

    private static PendingIntent action(Context ctx, String act, int code) {
        Intent i = new Intent(ctx, MonthWidgetProvider.class).setAction(act);
        return PendingIntent.getBroadcast(ctx, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static int color(Context ctx, int res) {
        return ctx.getResources().getColor(res, null);
    }

    static RemoteViews build(Context ctx) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_month);
        Map<String, List<CalStore.Ev>> ev = CalStore.events(ctx);
        Set<String> hol = CalStore.holidays(ctx);
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
            int n = list == null ? 0 : list.size();
            boolean inMonth = day.get(Calendar.MONTH) == month;
            boolean red = day.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY || hol.contains(key);
            int fg = color(ctx, red ? R.color.w_accent : inMonth ? R.color.w_text : R.color.w_muted);
            if (!inMonth) fg = (fg & 0x00FFFFFF) | 0x80000000; // 이웃 달은 흐리게

            SpannableStringBuilder sb = new SpannableStringBuilder(String.valueOf(day.get(Calendar.DAY_OF_MONTH)));
            sb.append('\n');
            int s = sb.length();
            sb.append(n == 0 ? " " : n == 1 ? "•" : n == 2 ? "••" : "•••");
            sb.setSpan(new RelativeSizeSpan(0.8f), s, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            sb.setSpan(new ForegroundColorSpan(color(ctx, R.color.w_accent)), s, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);

            int cid = ctx.getResources().getIdentifier("cell_" + i, "id", ctx.getPackageName());
            rv.setTextViewText(cid, sb);
            rv.setTextColor(cid, fg);
            rv.setInt(cid, "setBackgroundResource", key.equals(today) ? R.drawable.w_cell_today : R.drawable.w_cell);
            rv.setOnClickPendingIntent(cid, Links.pending(ctx, 100 + i, key, false));
            day.add(Calendar.DAY_OF_MONTH, 1);
        }

        rv.setOnClickPendingIntent(R.id.w_prev, action(ctx, ACT_PREV, 1));
        rv.setOnClickPendingIntent(R.id.w_next, action(ctx, ACT_NEXT, 2));
        rv.setOnClickPendingIntent(R.id.w_today, action(ctx, ACT_TODAY, 3));
        rv.setOnClickPendingIntent(R.id.w_add, Links.pending(ctx, 4, today, true));
        return rv;
    }
}
