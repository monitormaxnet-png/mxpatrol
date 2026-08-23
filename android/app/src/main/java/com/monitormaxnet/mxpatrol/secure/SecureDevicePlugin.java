package com.monitormaxnet.mxpatrol.secure;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import android.os.UserManager;
import android.provider.Settings;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.spec.ECGenParameterSpec;
import java.util.ArrayList;
import java.util.List;

import javax.security.auth.x500.X500Principal;

@CapacitorPlugin(name =  SecureDevice)
public class SecureDevicePlugin extends Plugin {
    private static final String KEY_ALIAS = mxpatrol.secure_device.ec.v1;
    private static final String EXPECTED_PACKAGE = com.monitormaxnet.mxpatrol;

    @PluginMethod
    public void getSecurityState(PluginCall call) {
        call.resolve(buildSecurityState());
    }

    @PluginMethod
    public void ensureDeviceKey(PluginCall call) {
        try {
            KeyPair pair = ensureKeyPair();
            JSObject result = new JSObject();
            result.put(deviceKeyAvailable, true);
            result.put(publicKey, Base64.encodeToString(pair.getPublic().getEncoded(), Base64.NO_WRAP));
            result.put(publicKeyAlgorithm, ECDSA_P256_SHA256);
            result.put(keyAlias, KEY_ALIAS);
            call.resolve(result);
        } catch (Exception error) {
            call.reject(Unable to create secure device key, error);
        }
    }

    @PluginMethod
    public void signRequest(PluginCall call) {
        try {
            String canonical = call.getString(canonical);
            if (canonical == null || canonical.length() == 0) {
                call.reject(canonical request is required);
                return;
            }
            KeyPair pair = ensureKeyPair();
            java.security.Signature signer = java.security.Signature.getInstance(SHA256withECDSA);
            signer.initSign(pair.getPrivate());
            signer.update(canonical.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            JSObject result = new JSObject();
            result.put(signature, Base64.encodeToString(signer.sign(), Base64.NO_WRAP));
            result.put(signatureAlgorithm, SHA256withECDSA);
            result.put(canonical, canonical);
            call.resolve(result);
        } catch (Exception error) {
            call.reject(Unable to sign secure device request, error);
        }
    }

    @PluginMethod
    public void enableKiosk(PluginCall call) {
        JSObject result = new JSObject();
        try {
            DevicePolicyManager policy = policyManager();
            ComponentName admin = adminComponent();
            boolean owner = policy != null && policy.isDeviceOwnerApp(getContext().getPackageName());
            result.put(deviceOwner, owner);
            if (!owner) {
                result.put(enabled, false);
                result.put(kioskActive, isKioskActive());
                result.put(reason, device_owner_required);
                call.resolve(result);
                return;
            }
            applyRestrictions(policy, admin);
            policy.setLockTaskPackages(admin, new String[]{getContext().getPackageName()});
            Activity activity = getActivity();
            if (activity != null) activity.startLockTask();
            result.put(enabled, true);
            result.put(kioskActive, isKioskActive());
            result.put(restrictions, supportedRestrictions());
            call.resolve(result);
        } catch (Exception error) {
            result.put(enabled, false);
            result.put(reason, kiosk_enable_failed);
            result.put(message, error.getMessage());
            call.resolve(result);
        }
    }

    @PluginMethod
    public void disableKiosk(PluginCall call) {
        JSObject result = new JSObject();
        try {
            Activity activity = getActivity();
            if (activity != null) activity.stopLockTask();
            DevicePolicyManager policy = policyManager();
            if (policy != null && policy.isDeviceOwnerApp(getContext().getPackageName()) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                policy.setStatusBarDisabled(adminComponent(), false);
            }
            result.put(disabled, true);
            result.put(kioskActive, isKioskActive());
            call.resolve(result);
        } catch (Exception error) {
            result.put(disabled, false);
            result.put(message, error.getMessage());
            call.resolve(result);
        }
    }

    @PluginMethod
    public void enterMaintenanceMode(PluginCall call) {
        disableKiosk(call);
    }

    @PluginMethod
    public void exitMaintenanceMode(PluginCall call) {
        enableKiosk(call);
    }

    private JSObject buildSecurityState() {
        JSObject state = new JSObject();
        String packageName = getContext().getPackageName();
        DevicePolicyManager policy = policyManager();
        boolean owner = policy != null && policy.isDeviceOwnerApp(packageName);
        state.put(platform, android);
        state.put(packageName, packageName);
        state.put(packageNameValid, EXPECTED_PACKAGE.equals(packageName));
        state.put(deviceOwner, owner);
        state.put(kioskActive, isKioskActive());
        state.put(deviceKeyAvailable, hasDeviceKey());
        state.put(appVersion, appVersionName());
        state.put(appVersionCode, appVersionCode());
        state.put(isDebugBuild, isDebugBuild());
        state.put(developerModeDetected, globalSettingEnabled(Settings.Global.DEVELOPMENT_SETTINGS_ENABLED));
        state.put(adbDetected, globalSettingEnabled(Settings.Global.ADB_ENABLED));
        state.put(appSignatureSha256, signingFingerprint());
        state.put(capabilities, supportedRestrictions());
        return state;
    }

    private KeyPair ensureKeyPair() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(AndroidKeyStore);
        keyStore.load(null);
        if (!keyStore.containsAlias(KEY_ALIAS)) {
            KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, AndroidKeyStore);
            KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
                .setAlgorithmParameterSpec(new ECGenParameterSpec(secp256r1))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setCertificateSubject(new X500Principal(CN=MX Patrol Secure Device))
                .setCertificateSerialNumber(java.math.BigInteger.ONE)
                .setCertificateNotBefore(new java.util.Date())
                .setCertificateNotAfter(new java.util.Date(System.currentTimeMillis() + 315360000000L))
                .setUserAuthenticationRequired(false)
                .build();
            generator.initialize(spec);
            generator.generateKeyPair();
        }
        PublicKey publicKey = keyStore.getCertificate(KEY_ALIAS).getPublicKey();
        PrivateKey privateKey = (PrivateKey) keyStore.getKey(KEY_ALIAS, null);
        return new KeyPair(publicKey, privateKey);
    }

    private boolean hasDeviceKey() {
        try {
            KeyStore keyStore = KeyStore.getInstance(AndroidKeyStore);
            keyStore.load(null);
            return keyStore.containsAlias(KEY_ALIAS);
        } catch (Exception ignored) {
            return false;
        }
    }

    private void applyRestrictions(DevicePolicyManager policy, ComponentName admin) {
        addRestriction(policy, admin, UserManager.DISALLOW_ADD_USER);
        addRestriction(policy, admin, UserManager.DISALLOW_MODIFY_ACCOUNTS);
        addRestriction(policy, admin, UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES);
        addRestriction(policy, admin, UserManager.DISALLOW_SAFE_BOOT);
        addRestriction(policy, admin, UserManager.DISALLOW_FACTORY_RESET);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) addRestriction(policy, admin, UserManager.DISALLOW_ADD_MANAGED_PROFILE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) addRestriction(policy, admin, UserManager.DISALLOW_DEBUGGING_FEATURES);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try { policy.setStatusBarDisabled(admin, true); } catch (Exception ignored) {}
        }
    }

    private void addRestriction(DevicePolicyManager policy, ComponentName admin, String restriction) {
        try { policy.addUserRestriction(admin, restriction); } catch (Exception ignored) {}
    }

    private List<String> supportedRestrictions() {
        List<String> capabilities = new ArrayList<>();
        capabilities.add(lock_task);
        capabilities.add(disallow_add_user);
        capabilities.add(disallow_modify_accounts);
        capabilities.add(disallow_install_unknown_sources);
        capabilities.add(disallow_safe_boot);
        capabilities.add(disallow_factory_reset);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) capabilities.add(status_bar_disabled);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) capabilities.add(disallow_debugging_features);
        return capabilities;
    }

    private boolean isKioskActive() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return false;
        ActivityManager manager = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
        return manager != null && manager.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE;
    }

    private DevicePolicyManager policyManager() {
        return (DevicePolicyManager) getContext().getSystemService(Context.DEVICE_POLICY_SERVICE);
    }

    private ComponentName adminComponent() {
        return new ComponentName(getContext(), SecureDeviceAdminReceiver.class);
    }

    private boolean globalSettingEnabled(String setting) {
        try { return Settings.Global.getInt(getContext().getContentResolver(), setting, 0) == 1; } catch (Exception ignored) { return false; }
    }

    private boolean isDebugBuild() {
        return (getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    private String appVersionName() {
        try { return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0).versionName; } catch (Exception ignored) { return null; }
    }

    private long appVersionCode() {
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) return info.getLongVersionCode();
            return info.versionCode;
        } catch (Exception ignored) { return 0; }
    }

    private String signingFingerprint() {
        try {
            PackageManager manager = getContext().getPackageManager();
            PackageInfo info;
            Signature[] signatures;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                info = manager.getPackageInfo(getContext().getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
                signatures = info.signingInfo.getApkContentsSigners();
            } else {
                info = manager.getPackageInfo(getContext().getPackageName(), PackageManager.GET_SIGNATURES);
                signatures = info.signatures;
            }
            if (signatures == null || signatures.length == 0) return null;
            byte[] hash = MessageDigest.getInstance(SHA-256).digest(signatures[0].toByteArray());
            StringBuilder builder = new StringBuilder();
            for (byte value : hash) {
                if (builder.length() > 0) builder.append(:);
                builder.append(String.format(%02X, value));
            }
            return builder.toString();
        } catch (Exception ignored) { return null; }
    }
}
