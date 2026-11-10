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
import android.text.style.BackgroundColorSpan;
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

    /** 글자 폭 추정: 한글·한자는 1, 그 외는 0.55 */
    private static float units(String s) {
        float u = 0;
        for (int i = 0; i < s.length(); i++) u += s.charAt(i) >= 0x1100 ? 1f : 0.55f;
        return u;
    }

    /** 칸 너비(최대 폭 단위)에 맞춰 제목을 줄이고 넘치면 … 를 붙인다 */
    private static String fit(String s, float max) {
        s = s.replace('\n', ' ').trim();
        if (units(s) <= max) return s;
        StringBuilder sb = new StringBuilder();
        float u = 0;
        for (int i = 0; i < s.length(); i++) {
            float w = s.charAt(i) >= 0x1100 ? 1f : 0.55f;
            if (u + w > max - 0.7f) break;
            sb.append(s.charAt(i));
            u += w;
        }
        return sb.append('…').toString();
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
        float maxUnits = Math.max(2f, (colDp - 2f) / 9f); // 9sp 글자 기준
        int lines = Math.max(2, (int) ((rowDp - 4 - 15) / 11.5f)); // 날짜 줄을 뺀 나머지 줄 수 (+N 줄 포함)
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

            SpannableStringBuilder sb = new SpannableStringBuilder(String.valueOf(day.get(Calendar.DAY_OF_MONTH)));
            // 일정이 lines 줄 안에 다 들어가면 모두, 아니면 (lines-1)개 + "+N"
            int shown = n <= lines ? n : lines - 1;
            int accent = color(ctx, R.color.w_accent);
            int chipBg = (accent & 0x00FFFFFF) | 0x2E000000;
            for (int k = 0; k < shown; k++) {
                boolean isHol = hn != null && k == 0;
                CalStore.Ev e = isHol ? null : list.get(k - (hn != null ? 1 : 0));
                String text = fit(isHol ? hn : e.title, maxUnits);
                sb.append('\n');
                int s = sb.length();
                sb.append(text);
                sb.setSpan(new RelativeSizeSpan(0.75f), s, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                int chipFg = isHol ? accent : (e.done ? (color(ctx, R.color.w_muted)) : color(ctx, R.color.w_text));
                sb.setSpan(new ForegroundColorSpan(chipFg), s, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                sb.setSpan(new BackgroundColorSpan(chipBg), s, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            }
            if (n > shown) {
                sb.append('\n');
                int s = sb.length();
                sb.append('+').append(String.valueOf(n - shown));
                sb.setSpan(new RelativeSizeSpan(0.75f), s, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                sb.setSpan(new ForegroundColorSpan(color(ctx, R.color.w_muted)), s, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            }

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
        return rv;
    }
}
