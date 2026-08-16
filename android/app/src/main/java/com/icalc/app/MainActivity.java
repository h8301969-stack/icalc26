package com.icalc.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(EscPosNetworkPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
