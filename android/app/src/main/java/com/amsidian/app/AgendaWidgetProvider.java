package com.amsidian.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Paint;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.format.DateUtils;
import android.text.style.StrikethroughSpan;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Map;

/** 일정 목록 위젯: 오늘부터 30일, 날짜 머리글 + 일정. 항목을 누르면 앱의 그 날로 간다. */
public class AgendaWidgetProvider extends AppWidgetProvider {
    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, build(ctx, id));
        mgr.notifyAppWidgetViewDataChanged(ids, R.id.w_list);
    }

    static void refresh(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, AgendaWidgetProvider.class));
        for (int id : ids) mgr.updateAppWidget(id, build(ctx, id));
        mgr.notifyAppWidgetViewDataChanged(ids, R.id.w_list);
    }

    static RemoteViews build(Context ctx, int widgetId) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_agenda);
        Intent svc = new Intent(ctx, AgendaService.class);
        svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        svc.setData(android.net.Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
        rv.setRemoteAdapter(R.id.w_list, svc);
        rv.setEmptyView(R.id.w_list, R.id.w_empty);
        String today = Links.ymd(Calendar.getInstance());
        rv.setTextViewText(R.id.w_title, DateUtils.formatDateTime(ctx, System.currentTimeMillis(), DateUtils.FORMAT_SHOW_DATE | DateUtils.FORMAT_SHOW_WEEKDAY));
        rv.setOnClickPendingIntent(R.id.w_add, Links.pending(ctx, 4, today, true));
        rv.setOnClickPendingIntent(R.id.w_title, Links.pending(ctx, 5, today, false));
        // 목록 항목 클릭: 항목이 날짜를 채워 넣는다 (템플릿은 변경 가능해야 하므로 MUTABLE)
        Intent tpl = new Intent(Intent.ACTION_VIEW).setClass(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        rv.setPendingIntentTemplate(R.id.w_list, PendingIntent.getActivity(ctx, 6, tpl, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE));
        return rv;
    }

    public static class AgendaService extends RemoteViewsService {
        @Override
        public RemoteViewsFactory onGetViewFactory(Intent intent) {
            return new Factory(getApplicationContext());
        }
    }

    static final class Row {
        boolean header;
        String date, time, title;
        boolean done;
    }

    static final class Factory implements RemoteViewsService.RemoteViewsFactory {
        private final Context ctx;
        private final List<Row> rows = new ArrayList<>();

        Factory(Context c) {
            ctx = c;
        }

        @Override public void onCreate() {}
        @Override public void onDestroy() { rows.clear(); }

        @Override
        public void onDataSetChanged() {
            rows.clear();
            Map<String, List<CalStore.Ev>> ev = CalStore.events(ctx);
            Calendar c = Calendar.getInstance();
            for (int i = 0; i < 30 && rows.size() < 80; i++) {
                String key = Links.ymd(c);
                List<CalStore.Ev> l = ev.get(key);
                if (l != null && !l.isEmpty()) {
                    Row h = new Row();
                    h.header = true;
                    h.date = key;
                    h.title = DateUtils.formatDateTime(ctx, c.getTimeInMillis(), DateUtils.FORMAT_SHOW_DATE | DateUtils.FORMAT_SHOW_WEEKDAY | DateUtils.FORMAT_ABBREV_ALL);
                    if (i == 0) h.title = "● " + h.title;
                    rows.add(h);
                    for (CalStore.Ev e : l) {
                        Row r = new Row();
                        r.date = key;
                        r.time = e.start;
                        r.title = e.title;
                        r.done = e.done;
                        rows.add(r);
                    }
                }
                c.add(Calendar.DAY_OF_MONTH, 1);
            }
        }

        @Override public int getCount() { return rows.size(); }

        @Override
        public RemoteViews getViewAt(int pos) {
            if (pos < 0 || pos >= rows.size()) return null;
            Row r = rows.get(pos);
            RemoteViews v = new RemoteViews(ctx.getPackageName(), r.header ? R.layout.widget_item_header : R.layout.widget_item_event);
            if (r.header) {
                v.setTextViewText(R.id.i_title, r.title);
            } else {
                v.setTextViewText(R.id.i_time, r.time == null || r.time.isEmpty() ? ctx.getString(R.string.w_allday) : r.time);
                SpannableString s = new SpannableString(r.title);
                if (r.done) s.setSpan(new StrikethroughSpan(), 0, s.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                v.setTextViewText(R.id.i_title, s);
            }
            Intent fill = new Intent().setData(Links.open(ctx, r.date, false).getData());
            v.setOnClickFillInIntent(R.id.i_root, fill);
            return v;
        }

        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getViewTypeCount() { return 2; }
        @Override public long getItemId(int pos) { return pos; }
        @Override public boolean hasStableIds() { return false; }
    }
}
