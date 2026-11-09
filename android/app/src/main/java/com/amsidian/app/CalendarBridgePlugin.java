package com.amsidian.app;

import android.Manifest;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.os.Build;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** 웹 앱 → 네이티브: 일정 스냅샷(위젯용)과 알림 목록(AlarmManager 용)을 받아 저장·등록한다. */
@CapacitorPlugin(
    name = "CalendarBridge",
    permissions = { @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notify") }
)
public class CalendarBridgePlugin extends Plugin {

    @PluginMethod
    public void setSnapshot(PluginCall call) {
        String snapshot = call.getString("snapshot");
        JSArray reminders = call.getArray("reminders", new JSArray());
        if (snapshot != null) CalStore.saveSnapshot(getContext(), snapshot);
        Reminders.schedule(getContext(), reminders);
        MonthWidgetProvider.refresh(getContext());
        AgendaWidgetProvider.refresh(getContext());
        call.resolve();
    }

    /** 홈 화면에 위젯 추가를 요청한다 (런처가 확인 창을 띄운다) */
    @PluginMethod
    public void pinWidget(PluginCall call) {
        AppWidgetManager m = AppWidgetManager.getInstance(getContext());
        if (Build.VERSION.SDK_INT < 26 || !m.isRequestPinAppWidgetSupported()) {
            call.reject("unsupported");
            return;
        }
        Class<?> cls = "agenda".equals(call.getString("type", "month")) ? AgendaWidgetProvider.class : MonthWidgetProvider.class;
        m.requestPinAppWidget(new ComponentName(getContext(), cls), null, null);
        call.resolve();
    }

    private boolean granted() {
        return NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
    }

    @PluginMethod
    public void notifyStatus(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", granted());
        call.resolve(r);
    }

    @PluginMethod
    public void requestNotify(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || granted()) {
            notifyStatus(call);
            return;
        }
        requestPermissionForAlias("notify", call, "notifyCallback");
    }

    @PermissionCallback
    private void notifyCallback(PluginCall call) {
        notifyStatus(call);
    }
}
