package com.amsidian.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OpenFilePlugin.class);
        registerPlugin(CalendarBridgePlugin.class);
        registerPlugin(PinnedHttpPlugin.class);
        registerPlugin(SecureStorePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
