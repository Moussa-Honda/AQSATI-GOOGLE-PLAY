package com.installment.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.provider.Settings;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKeys;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.security.MessageDigest;

@CapacitorPlugin(name = "License")
public class LicensePlugin extends Plugin {

    private static final String SECRET_SALT = "NAYEF_FAZATK_2026_SECURITY_SALT";
    private static final String DEVICE_SALT = "DEVICE_SALT";

    private SharedPreferences getPrefs() {
        try {
            String masterKeyAlias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC);
            return EncryptedSharedPreferences.create(
                "license_prefs",
                masterKeyAlias,
                getContext(),
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            );
        } catch (Exception e) {
            return getContext().getSharedPreferences("license_prefs_fallback", Context.MODE_PRIVATE);
        }
    }

    private String generateNumericHash(String input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(input.getBytes());
            long numericCode = 0;
            for (int i = 0; i < 8; i++) {
                numericCode = (numericCode * 256 + (hash[i] & 0xFFL)) % 100000000;
            }
            return String.format(java.util.Locale.US, "%08d", numericCode);
        } catch (Exception e) {
            return "00000000";
        }
    }

    private String getInternalDeviceId() {
        try {
            String androidId = Settings.Secure.getString(getContext().getContentResolver(), Settings.Secure.ANDROID_ID);
            if (androidId == null) androidId = "0000000000000000";
            
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest((androidId + DEVICE_SALT).getBytes());
            int shortId = 0;
            for (int i = 0; i < 4; i++) {
                shortId = (shortId * 256) + (hash[i] & 0xFF);
            }
            return String.format(java.util.Locale.US, "%06d", Math.abs(shortId % 1000000));
        } catch (Exception e) {
            return "000000";
        }
    }

    @PluginMethod
    public void getDeviceId(PluginCall call) {
        try {
            String deviceNumericId = getInternalDeviceId();
            JSObject ret = new JSObject();
            ret.put("deviceId", deviceNumericId);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("ERR_GET_ID_FAILED");
        }
    }

    @PluginMethod
    public void activateLicense(PluginCall call) {
        String code = call.getString("code");
        if (code == null) {
            call.reject("ERR_MISSING_CODE");
            return;
        }
        
        // Convert any Arabic-Indic digits to Western digits just in case
        String cleanCode = code.trim().replace('٠','0').replace('١','1').replace('٢','2').replace('٣','3').replace('٤','4')
                                   .replace('٥','5').replace('٦','6').replace('٧','7').replace('٨','8').replace('٩','9');
                                   
        if (cleanCode.length() != 9) {
            call.reject("ERR_INVALID_FORMAT");
            return;
        }

        try {
            String deviceId = getInternalDeviceId();
            String[] durations = {"30", "90", "180", "365", "9999"};
            String typeDigit = cleanCode.substring(0, 1);
            String codeHash = cleanCode.substring(1);

            String matchedDuration = null;
            for (String d : durations) {
                String expectedHash = generateNumericHash(deviceId + d + SECRET_SALT);
                if (expectedHash.equals(codeHash)) {
                    String expectedType;
                    switch (d) {
                        case "30": expectedType = "1"; break;
                        case "90": expectedType = "3"; break;
                        case "180": expectedType = "6"; break;
                        case "365": expectedType = "9"; break;
                        default: expectedType = "0"; break;
                    }
                    if (typeDigit.equals(expectedType)) {
                        matchedDuration = d;
                        break;
                    }
                }
            }

            if (matchedDuration == null) {
                call.reject("ERR_WRONG_CODE");
                return;
            }

            SharedPreferences prefs = getPrefs();
            long now = System.currentTimeMillis() / 1000;
            long currentExpiry = prefs.getLong("expiry", 0);
            long expiry;
            if (matchedDuration.equals("9999")) {
                expiry = 2147483647L;
            } else if (currentExpiry > 2100000000L) {
                expiry = currentExpiry;
            } else {
                long baseTime = Math.max(now, currentExpiry);
                expiry = baseTime + (Long.parseLong(matchedDuration) * 24 * 60 * 60);
            }

            // Derive a unique key for this license/device combination
            String keySource = deviceId + cleanCode + SECRET_SALT;
            String derivedKey = generateNumericHash(keySource).substring(0, 8); // Simple 8-char key

            prefs.edit()
                .putString("license_code", cleanCode)
                .putLong("expiry", expiry)
                .putLong("last_seen_time", now)
                .putString("derived_key", derivedKey)
                .remove("trial_start_time")
                .remove("trial_expiry")
                .apply();

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("expiry", expiry);
            ret.put("isTrial", false);
            ret.put("key", derivedKey);
            call.resolve(ret);

        } catch (Exception e) {
            call.reject("ERR_ACTIVATION_FAILED");
        }
    }

    @PluginMethod
    public void checkLicense(PluginCall call) {
        SharedPreferences prefs = getPrefs();
        String code = prefs.getString("license_code", null);
        long expiry = prefs.getLong("expiry", 0);
        long lastSeen = prefs.getLong("last_seen_time", 0);
        String key = prefs.getString("derived_key", "DUMMY_KEY");
        long now = System.currentTimeMillis() / 1000;

        if (now < lastSeen - 3600) { // Allow 1 hour clock drift
            call.reject("ERR_TIME_TAMPERED");
            return;
        }

        // إذا لم يكن هناك كود تفعيل مسجل، نفحص فترة السماح المجانية لمدة شهر (30 يوم) للمستخدم الجديد
        if (code == null) {
            long trialStart = prefs.getLong("trial_start_time", 0);
            long trialExpiry = prefs.getLong("trial_expiry", 0);

            // أول تشغيل للتطبيق على هذا الجهاز: منح فترة سماح شهر (30 يوم) تلقائياً
            if (trialStart == 0) {
                trialStart = now;
                trialExpiry = now + (30L * 24 * 60 * 60); // 30 يوماً
                prefs.edit()
                    .putLong("trial_start_time", trialStart)
                    .putLong("trial_expiry", trialExpiry)
                    .putLong("last_seen_time", now)
                    .putString("derived_key", "AQSATI_TRIAL_KEY")
                    .apply();
            }

            if (now > trialExpiry) {
                call.reject("ERR_EXPIRED");
                return;
            }

            prefs.edit().putLong("last_seen_time", now).apply();

            JSObject ret = new JSObject();
            ret.put("isValid", true);
            ret.put("expiry", trialExpiry);
            ret.put("isTrial", true);
            ret.put("key", "AQSATI_TRIAL_KEY");
            call.resolve(ret);
            return;
        }

        if (now > expiry) {
            call.reject("ERR_EXPIRED");
            return;
        }

        prefs.edit().putLong("last_seen_time", now).apply();

        JSObject ret = new JSObject();
        ret.put("isValid", true);
        ret.put("expiry", expiry);
        ret.put("isTrial", false);
        ret.put("key", key);
        call.resolve(ret);
    }

}
