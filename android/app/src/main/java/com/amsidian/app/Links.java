package com.amsidian.app;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import java.util.Calendar;
import java.util.Locale;

/** 위젯·알림에서 앱의 캘린더를 여는 딥링크: com.amsidian.app://calendar?date=yyyy-MM-dd[&add=1] */
final class Links {
    private Links() {}

    static String ymd(Calendar c) {
        return String.format(Locale.US, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
    }

    static Intent open(Context ctx, String date, boolean add) {
        Uri.Builder b = new Uri.Builder().scheme("com.amsidian.app").authority("calendar").appendQueryParameter("date", date);
        if (add) b.appendQueryParameter("add", "1");
        Intent i = new Intent(Intent.ACTION_VIEW, b.build());
        i.setClass(ctx, MainActivity.class); // 명시적 인텐트: 다른 앱으로 새지 않는다
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return i;
    }

    static PendingIntent pending(Context ctx, int requestCode, String date, boolean add) {
        return PendingIntent.getActivity(ctx, requestCode, open(ctx, date, add), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
