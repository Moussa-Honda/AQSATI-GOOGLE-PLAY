package com.installment.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.installment.app.LicensePlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LicensePlugin.class);
        registerPlugin(BillingPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
