package com.icalc.app;

import android.os.Bundle;

import androidx.core.splashscreen.SplashScreen;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Install then release immediately — no held splash while WebView boots.
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
        splashScreen.setKeepOnScreenCondition(() -> false);

        registerPlugin(EscPosNetworkPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
