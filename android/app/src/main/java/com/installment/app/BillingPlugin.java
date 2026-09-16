package com.installment.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKeys;
import com.android.billingclient.api.*;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONObject;

@CapacitorPlugin(name = "Billing")
public class BillingPlugin extends Plugin implements PurchasesUpdatedListener {

    private static final String PREFS_NAME = "billing_prefs";
    private static final String LICENSE_PREFS_NAME = "license_prefs";

    // Default Play Console product IDs and base plan identifiers
    public static final String PROD_SUB_MONTHLY = "aqsati_30d";
    public static final String PROD_SUB_QUARTERLY = "aqsati_90d";
    public static final String PROD_SUB_BIANNUAL = "aqsati_180d";
    public static final String PROD_SUB_ANNUAL = "aqsati_365d";
    public static final String PROD_INAPP_LIFETIME = "aqsati_lifetime";
    public static final String PROD_SUB_MAIN = "aqsati_subscription";

    private BillingClient billingClient;
    private boolean isConnecting = false;
    private final Map<String, ProductDetails> productDetailsCache = new HashMap<>();
    private PluginCall activePurchaseCall = null;

    private SharedPreferences getBillingPrefs() {
        try {
            String masterKeyAlias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC);
            return EncryptedSharedPreferences.create(
                PREFS_NAME,
                masterKeyAlias,
                getContext(),
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            );
        } catch (Exception e) {
            return getContext().getSharedPreferences(PREFS_NAME + "_fallback", Context.MODE_PRIVATE);
        }
    }

    private SharedPreferences getLicensePrefs() {
        try {
            String masterKeyAlias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC);
            return EncryptedSharedPreferences.create(
                LICENSE_PREFS_NAME,
                masterKeyAlias,
                getContext(),
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            );
        } catch (Exception e) {
            return getContext().getSharedPreferences(LICENSE_PREFS_NAME + "_fallback", Context.MODE_PRIVATE);
        }
    }

    @Override
    public void load() {
        super.load();
        initBillingClient();
    }

    private void initBillingClient() {
        if (billingClient != null) {
            return;
        }

        PendingPurchasesParams.Builder pendingParams = PendingPurchasesParams.newBuilder()
            .enableOneTimeProducts();
            
        try {
            pendingParams.enablePrepaidPlans();
        } catch (Throwable ignored) {
            // Safe fallback if prepaid plans builder method has varying signatures
        }

        billingClient = BillingClient.newBuilder(getContext())
            .setListener(this)
            .enablePendingPurchases(pendingParams.build())
            .build();
    }

    private void ensureConnected(final Runnable onSuccess, final Runnable onError) {
        initBillingClient();
        if (billingClient.isReady()) {
            if (onSuccess != null) onSuccess.run();
            return;
        }

        if (isConnecting) {
            if (onError != null) onError.run();
            return;
        }

        isConnecting = true;
        billingClient.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(@NonNull BillingResult billingResult) {
                isConnecting = false;
                if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    if (onSuccess != null) onSuccess.run();
                } else {
                    if (onError != null) onError.run();
                }
            }

            @Override
            public void onBillingServiceDisconnected() {
                isConnecting = false;
                if (onError != null) onError.run();
            }
        });
    }

    @PluginMethod
    public void initialize(final PluginCall call) {
        ensureConnected(
            () -> {
                JSObject ret = new JSObject();
                ret.put("isReady", true);
                call.resolve(ret);
            },
            () -> {
                JSObject ret = new JSObject();
                ret.put("isReady", false);
                ret.put("error", "BILLING_UNAVAILABLE");
                call.resolve(ret);
            }
        );
    }

    @PluginMethod
    public void getProducts(final PluginCall call) {
        ensureConnected(
            () -> queryProductsInternal(call),
            () -> call.reject("ERR_BILLING_DISCONNECTED", "تعذر الاتصال بمتجر Google Play")
        );
    }

    private void queryProductsInternal(final PluginCall call) {
        List<QueryProductDetailsParams.Product> productList = new ArrayList<>();

        // Subscriptions list
        productList.add(QueryProductDetailsParams.Product.newBuilder()
            .setProductId(PROD_SUB_MAIN)
            .setProductType(BillingClient.ProductType.SUBS)
            .build());
        productList.add(QueryProductDetailsParams.Product.newBuilder()
            .setProductId(PROD_SUB_MONTHLY)
            .setProductType(BillingClient.ProductType.SUBS)
            .build());
        productList.add(QueryProductDetailsParams.Product.newBuilder()
            .setProductId(PROD_SUB_QUARTERLY)
            .setProductType(BillingClient.ProductType.SUBS)
            .build());
        productList.add(QueryProductDetailsParams.Product.newBuilder()
            .setProductId(PROD_SUB_BIANNUAL)
            .setProductType(BillingClient.ProductType.SUBS)
            .build());
        productList.add(QueryProductDetailsParams.Product.newBuilder()
            .setProductId(PROD_SUB_ANNUAL)
            .setProductType(BillingClient.ProductType.SUBS)
            .build());

        // In-app (Lifetime)
        productList.add(QueryProductDetailsParams.Product.newBuilder()
            .setProductId(PROD_INAPP_LIFETIME)
            .setProductType(BillingClient.ProductType.INAPP)
            .build());

        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
            .setProductList(productList)
            .build();

        billingClient.queryProductDetailsAsync(params, (billingResult, queryProductDetailsResult) -> {
            if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                call.reject("ERR_QUERY_FAILED", billingResult.getDebugMessage());
                return;
            }

            List<ProductDetails> productDetailsList = queryProductDetailsResult != null ?
                queryProductDetailsResult.getProductDetailsList() : Collections.emptyList();

            JSArray productsArray = new JSArray();
            for (ProductDetails details : productDetailsList) {
                productDetailsCache.put(details.getProductId(), details);
                JSObject item = new JSObject();
                item.put("productId", details.getProductId());
                item.put("title", details.getTitle());
                item.put("description", details.getDescription());
                item.put("productType", details.getProductType());

                if (details.getProductType().equals(BillingClient.ProductType.INAPP)) {
                    ProductDetails.OneTimePurchaseOfferDetails oneTime = details.getOneTimePurchaseOfferDetails();
                    if (oneTime != null) {
                        item.put("formattedPrice", oneTime.getFormattedPrice());
                        item.put("currencyCode", oneTime.getPriceCurrencyCode());
                        item.put("priceAmountMicros", oneTime.getPriceAmountMicros());
                    }
                } else if (details.getProductType().equals(BillingClient.ProductType.SUBS)) {
                    List<ProductDetails.SubscriptionOfferDetails> subOffers = details.getSubscriptionOfferDetails();
                    if (subOffers != null && !subOffers.isEmpty()) {
                        ProductDetails.SubscriptionOfferDetails defaultOffer = subOffers.get(0);
                        item.put("offerToken", defaultOffer.getOfferToken());
                        item.put("basePlanId", defaultOffer.getBasePlanId());
                        List<ProductDetails.PricingPhase> phases = defaultOffer.getPricingPhases().getPricingPhaseList();
                        if (phases != null && !phases.isEmpty()) {
                            ProductDetails.PricingPhase phase = phases.get(0);
                            item.put("formattedPrice", phase.getFormattedPrice());
                            item.put("currencyCode", phase.getPriceCurrencyCode());
                            item.put("billingPeriod", phase.getBillingPeriod());
                        }

                        JSArray offersList = new JSArray();
                        for (ProductDetails.SubscriptionOfferDetails offer : subOffers) {
                            JSObject o = new JSObject();
                            o.put("basePlanId", offer.getBasePlanId());
                            o.put("offerToken", offer.getOfferToken());
                            if (!offer.getPricingPhases().getPricingPhaseList().isEmpty()) {
                                ProductDetails.PricingPhase p = offer.getPricingPhases().getPricingPhaseList().get(0);
                                o.put("formattedPrice", p.getFormattedPrice());
                                o.put("billingPeriod", p.getBillingPeriod());
                            }
                            offersList.put(o);
                        }
                        item.put("offers", offersList);
                    }
                }
                productsArray.put(item);
            }

            JSObject ret = new JSObject();
            ret.put("products", productsArray);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void purchase(final PluginCall call) {
        final String productId = call.getString("productId");
        final String offerToken = call.getString("offerToken");

        if (productId == null || productId.isEmpty()) {
            call.reject("ERR_MISSING_PRODUCT", "يرجى تحديد المنتج المراد شراؤه");
            return;
        }

        ensureConnected(
            () -> {
                ProductDetails details = productDetailsCache.get(productId);
                if (details == null) {
                    querySingleProductAndPurchase(productId, offerToken, call);
                    return;
                }
                launchBillingFlowForProduct(details, offerToken, call);
            },
            () -> call.reject("ERR_BILLING_DISCONNECTED", "متجر Google Play غير متاح حالياً")
        );
    }

    private void querySingleProductAndPurchase(String productId, String offerToken, PluginCall call) {
        List<QueryProductDetailsParams.Product> list = new ArrayList<>();
        list.add(QueryProductDetailsParams.Product.newBuilder()
            .setProductId(productId)
            .setProductType(productId.contains("lifetime") ? BillingClient.ProductType.INAPP : BillingClient.ProductType.SUBS)
            .build());

        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
            .setProductList(list)
            .build();

        billingClient.queryProductDetailsAsync(params, (billingResult, queryProductDetailsResult) -> {
            List<ProductDetails> productDetailsList = queryProductDetailsResult != null ?
                queryProductDetailsResult.getProductDetailsList() : Collections.emptyList();

            if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK && !productDetailsList.isEmpty()) {
                ProductDetails details = productDetailsList.get(0);
                productDetailsCache.put(details.getProductId(), details);
                launchBillingFlowForProduct(details, offerToken, call);
            } else {
                call.reject("ERR_PRODUCT_NOT_FOUND", "المنتج غير متوفر في Google Play");
            }
        });
    }

    private void launchBillingFlowForProduct(ProductDetails details, String offerToken, PluginCall call) {
        BillingFlowParams.ProductDetailsParams.Builder productParamsBuilder =
            BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(details);

        if (details.getProductType().equals(BillingClient.ProductType.SUBS)) {
            String selectedToken = offerToken;
            if (selectedToken == null || selectedToken.isEmpty()) {
                List<ProductDetails.SubscriptionOfferDetails> offers = details.getSubscriptionOfferDetails();
                if (offers != null && !offers.isEmpty()) {
                    selectedToken = offers.get(0).getOfferToken();
                }
            }
            if (selectedToken != null && !selectedToken.isEmpty()) {
                productParamsBuilder.setOfferToken(selectedToken);
            } else {
                call.reject("ERR_MISSING_OFFER", "عرض الاشتراك غير متاح");
                return;
            }
        }

        List<BillingFlowParams.ProductDetailsParams> list = new ArrayList<>();
        list.add(productParamsBuilder.build());

        BillingFlowParams flowParams = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(list)
            .build();

        activePurchaseCall = call;
        getActivity().runOnUiThread(() -> {
            BillingResult result = billingClient.launchBillingFlow(getActivity(), flowParams);
            if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                if (activePurchaseCall != null) {
                    activePurchaseCall.reject("ERR_LAUNCH_FAILED", result.getDebugMessage());
                    activePurchaseCall = null;
                }
            }
        });
    }

    @Override
    public void onPurchasesUpdated(@NonNull BillingResult billingResult, @Nullable List<Purchase> purchases) {
        int responseCode = billingResult.getResponseCode();

        if (responseCode == BillingClient.BillingResponseCode.OK && purchases != null) {
            for (Purchase purchase : purchases) {
                handlePurchase(purchase);
            }
            if (activePurchaseCall != null) {
                JSObject ret = getEntitlementInternal();
                ret.put("purchaseHandled", true);
                activePurchaseCall.resolve(ret);
                activePurchaseCall = null;
            }
        } else if (responseCode == BillingClient.BillingResponseCode.USER_CANCELED) {
            if (activePurchaseCall != null) {
                activePurchaseCall.reject("USER_CANCELED", "تم إلغاء عملية الشراء من قبل المستخدم");
                activePurchaseCall = null;
            }
        } else {
            if (activePurchaseCall != null) {
                activePurchaseCall.reject("ERR_PURCHASE_FAILED", billingResult.getDebugMessage());
                activePurchaseCall = null;
            }
        }
    }

    private boolean isTokenProcessed(String token) {
        if (token == null || token.isEmpty()) return false;
        SharedPreferences prefs = getBillingPrefs();
        String processed = prefs.getString("processed_tokens_list", "");
        return processed.contains("|" + token + "|");
    }

    private void markTokenProcessed(String token) {
        if (token == null || token.isEmpty()) return;
        SharedPreferences prefs = getBillingPrefs();
        String processed = prefs.getString("processed_tokens_list", "");
        if (!processed.contains("|" + token + "|")) {
            prefs.edit().putString("processed_tokens_list", processed + "|" + token + "|").apply();
        }
    }

    private void handlePurchase(Purchase purchase) {
        if (purchase == null) return;

        int state = purchase.getPurchaseState();
        String productId = purchase.getProducts().isEmpty() ? "unknown" : purchase.getProducts().get(0);
        String purchaseToken = purchase.getPurchaseToken();
        long purchaseTime = purchase.getPurchaseTime() / 1000; // seconds

        SharedPreferences billingPrefs = getBillingPrefs();
        SharedPreferences licensePrefs = getLicensePrefs();
        long now = System.currentTimeMillis() / 1000;

        if (state == Purchase.PurchaseState.PURCHASED) {
            boolean wasLifetime = billingPrefs.getBoolean("is_lifetime", false);
            boolean isLifetime = productId.contains("lifetime") || wasLifetime;
            
            String basePlanId = "";
            try {
                JSONObject json = new JSONObject(purchase.getOriginalJson());
                if (json.has("basePlanId")) {
                    basePlanId = json.getString("basePlanId");
                }
            } catch (Exception ignored) {
            }

            boolean alreadyProcessed = isTokenProcessed(purchaseToken);

            long expiry;
            if (isLifetime) {
                expiry = 2147483647L; // Far future / permanent lifetime
            } else if (alreadyProcessed) {
                // Idempotent: Do NOT add duration again for an already processed token
                expiry = billingPrefs.getLong("expiry_time", 0);
                if (expiry == 0) {
                    long durationSeconds = getDurationForProduct(productId, basePlanId);
                    expiry = Math.max(now, purchaseTime) + durationSeconds;
                }
            } else {
                // New purchase or new top-up token
                long durationSeconds = getDurationForProduct(productId, basePlanId);
                long currentExpiry = billingPrefs.getLong("expiry_time", 0);
                long baseTime = Math.max(now, currentExpiry);
                expiry = baseTime + durationSeconds;
                markTokenProcessed(purchaseToken);
            }

            // Save encrypted billing entitlement
            billingPrefs.edit()
                .putString("entitlement_state", isLifetime ? "LIFETIME" : "ACTIVE")
                .putString("product_id", productId)
                .putString("base_plan_id", basePlanId)
                .putString("purchase_token", purchaseToken)
                .putLong("purchase_time", purchaseTime)
                .putLong("expiry_time", expiry)
                .putBoolean("is_acknowledged", purchase.isAcknowledged())
                .putBoolean("is_lifetime", isLifetime)
                .putString("order_id", purchase.getOrderId() != null ? purchase.getOrderId() : "")
                .putLong("last_validated_time", now)
                .apply();

            // Synchronize with existing license_prefs so core app recognizes active status offline
            licensePrefs.edit()
                .putLong("expiry", expiry)
                .putLong("last_seen_time", now)
                .putString("derived_key", "GOOGLE_PLAY_ACTIVE")
                .apply();

            // Acknowledge if not yet acknowledged (Only for PURCHASED state!)
            if (!purchase.isAcknowledged()) {
                acknowledgePurchaseToken(purchaseToken);
            }
        } else if (state == Purchase.PurchaseState.PENDING) {
            // Record pending state WITHOUT granting full active entitlement
            // PENDING must NEVER be acknowledged or clobber an existing active/lifetime entitlement
            long existingExpiry = billingPrefs.getLong("expiry_time", 0);
            boolean wasLifetime = billingPrefs.getBoolean("is_lifetime", false);
            boolean currentlyValid = wasLifetime || (existingExpiry > now);

            SharedPreferences.Editor editor = billingPrefs.edit()
                .putString("pending_product_id", productId)
                .putString("pending_purchase_token", purchaseToken)
                .putLong("pending_purchase_time", purchaseTime)
                .putBoolean("is_acknowledged", false)
                .putLong("last_validated_time", now);

            if (!currentlyValid) {
                editor.putString("entitlement_state", "PENDING");
            }
            editor.apply();
        }
    }

    private long getDurationForProduct(String productId, String basePlanId) {
        String combined = ((productId != null ? productId : "") + " " + (basePlanId != null ? basePlanId : "")).toLowerCase();
        if (combined.contains("365d") || combined.contains("annual") || combined.contains("year")) {
            return 365L * 24 * 60 * 60;
        } else if (combined.contains("180d")) {
            return 180L * 24 * 60 * 60;
        } else if (combined.contains("90d")) {
            return 90L * 24 * 60 * 60;
        } else {
            // Default 30 days
            return 30L * 24 * 60 * 60;
        }
    }

    private void acknowledgePurchaseToken(String purchaseToken) {
        if (billingClient == null || !billingClient.isReady()) return;

        AcknowledgePurchaseParams params = AcknowledgePurchaseParams.newBuilder()
            .setPurchaseToken(purchaseToken)
            .build();

        billingClient.acknowledgePurchase(params, billingResult -> {
            if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                getBillingPrefs().edit().putBoolean("is_acknowledged", true).apply();
            }
        });
    }

    @PluginMethod
    public void queryPurchases(final PluginCall call) {
        ensureConnected(
            () -> queryPurchasesAsyncInternal(call, false),
            () -> {
                // Offline fallback: read existing local entitlement from cache
                JSObject ret = getEntitlementInternal();
                ret.put("offline", true);
                call.resolve(ret);
            }
        );
    }

    @PluginMethod
    public void restorePurchases(final PluginCall call) {
        ensureConnected(
            () -> queryPurchasesAsyncInternal(call, true),
            () -> call.reject("ERR_RESTORE_FAILED", "تعذر الاتصال بمتجر Google Play للتحقق من المشتريات")
        );
    }

    private void queryPurchasesAsyncInternal(final PluginCall call, final boolean isExplicitRestore) {
        QueryPurchasesParams subParams = QueryPurchasesParams.newBuilder()
            .setProductType(BillingClient.ProductType.SUBS)
            .build();

        QueryPurchasesParams inappParams = QueryPurchasesParams.newBuilder()
            .setProductType(BillingClient.ProductType.INAPP)
            .build();

        billingClient.queryPurchasesAsync(subParams, (subResult, subPurchases) -> {
            billingClient.queryPurchasesAsync(inappParams, (inappResult, inappPurchases) -> {
                List<Purchase> allPurchases = new ArrayList<>();
                if (subPurchases != null) allPurchases.addAll(subPurchases);
                if (inappPurchases != null) allPurchases.addAll(inappPurchases);

                boolean foundActive = false;
                for (Purchase p : allPurchases) {
                    if (p.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
                        handlePurchase(p);
                        foundActive = true;
                    }
                }

                JSObject ret = getEntitlementInternal();
                ret.put("foundActivePurchase", foundActive);
                ret.put("totalPurchasesFound", allPurchases.size());
                if (isExplicitRestore) {
                    ret.put("restoreCompleted", true);
                }
                call.resolve(ret);
            });
        });
    }

    @PluginMethod
    public void getEntitlement(PluginCall call) {
        call.resolve(getEntitlementInternal());
    }

    private JSObject getEntitlementInternal() {
        SharedPreferences billingPrefs = getBillingPrefs();
        SharedPreferences licensePrefs = getLicensePrefs();
        long now = System.currentTimeMillis() / 1000;

        String state = billingPrefs.getString("entitlement_state", "NONE");
        String productId = billingPrefs.getString("product_id", "");
        String basePlanId = billingPrefs.getString("base_plan_id", "");
        long expiryTime = billingPrefs.getLong("expiry_time", 0);
        boolean isLifetime = billingPrefs.getBoolean("is_lifetime", false);
        boolean isAcknowledged = billingPrefs.getBoolean("is_acknowledged", false);
        String purchaseToken = billingPrefs.getString("purchase_token", "");

        boolean isValid = false;
        if (isLifetime) {
            isValid = true;
            state = "LIFETIME";
        } else if ("ACTIVE".equals(state) && expiryTime > now) {
            isValid = true;
        } else if (expiryTime > 0 && expiryTime <= now) {
            state = "EXPIRED";
            isValid = false;
        }

        JSObject obj = new JSObject();
        obj.put("isValid", isValid);
        obj.put("state", state);
        obj.put("productId", productId);
        obj.put("basePlanId", basePlanId);
        obj.put("expiryTime", expiryTime);
        obj.put("isLifetime", isLifetime);
        obj.put("isAcknowledged", isAcknowledged);
        obj.put("hasPurchaseToken", !purchaseToken.isEmpty());

        // Check if legacy license code or trial exists as fallback
        long licenseExpiry = licensePrefs.getLong("expiry", 0);
        obj.put("unifiedExpiry", Math.max(expiryTime, licenseExpiry));
        return obj;
    }

    @PluginMethod
    public void openSubscriptionManagement(PluginCall call) {
        try {
            String packageName = getContext().getPackageName();
            String sku = call.getString("productId", PROD_SUB_MAIN);
            String url = "https://play.google.com/store/account/subscriptions?sku=" + sku + "&package=" + packageName;
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("opened", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("ERR_OPEN_FAILED", "تعذر فتح صفحة إدارة الاشتراكات في متجر Google Play");
        }
    }
}
