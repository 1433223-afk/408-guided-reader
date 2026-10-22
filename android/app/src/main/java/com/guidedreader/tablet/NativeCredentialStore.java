package com.guidedreader.tablet;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** App-private provider credentials. Never exposed to the WebView or APK assets. */
public final class NativeCredentialStore {
    private static final String KEY_ALIAS = "guided-reader-local-ai-v1";
    private static final String PREFERENCES = "reader_local_ai_encrypted";
    private static final int MAX_KEY_LENGTH = 8192;
    private static Context app;
    private static SharedPreferences preferences;

    private NativeCredentialStore() {}

    public static synchronized void initialize(Context context) {
        if (context == null) throw new IllegalArgumentException("缺少应用存储环境。");
        app = context.getApplicationContext();
        preferences = app.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    /** Returns null when absent or when device protection can no longer decrypt it. */
    public static synchronized String read(String provider) {
        requireProvider(provider);
        if (preferences == null) return null;
        String record = preferences.getString(provider, null);
        if (record == null) return null;
        try {
            String[] pieces = record.split(":", -1);
            if (pieces.length != 3 || !"v1".equals(pieces[0])) return null;
            byte[] iv = Base64.decode(pieces[1], Base64.NO_WRAP);
            byte[] encrypted = Base64.decode(pieces[2], Base64.NO_WRAP);
            if (iv.length != 12 || encrypted.length > MAX_KEY_LENGTH * 4 + 16) return null;
            SecretKey key = key(false);
            if (key == null) return null;
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
            cipher.updateAAD(provider.getBytes(StandardCharsets.UTF_8));
            String value = new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
            return value.isEmpty() || value.length() > MAX_KEY_LENGTH ? null : value;
        } catch (Exception ignored) {
            // Do not log ciphertext, credentials, or crypto exception arguments.
            return null;
        }
    }

    public static synchronized boolean isConfigured(String provider) {
        return read(provider) != null;
    }

    /** Null/blank explicitly removes the provider; callers preserve untouched inputs. */
    public static synchronized void write(String provider, String value) throws Exception {
        requireProvider(provider);
        if (preferences == null) throw new IllegalStateException("凭据存储尚未就绪。");
        String clean = value == null ? "" : value.trim();
        if (clean.isEmpty()) {
            if (!preferences.edit().remove(provider).commit()) throw new IllegalStateException("无法清除凭据。");
            return;
        }
        if (clean.length() > MAX_KEY_LENGTH || clean.indexOf('\n') >= 0 || clean.indexOf('\r') >= 0) {
            throw new IllegalArgumentException("API Key 内容无效，请重新粘贴。");
        }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key(true));
        cipher.updateAAD(provider.getBytes(StandardCharsets.UTF_8));
        byte[] encrypted = cipher.doFinal(clean.getBytes(StandardCharsets.UTF_8));
        String record = "v1:" + Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":"
                + Base64.encodeToString(encrypted, Base64.NO_WRAP);
        if (!preferences.edit().putString(provider, record).commit()) {
            throw new IllegalStateException("无法保存凭据，请检查设备存储。");
        }
    }

    public static synchronized boolean isOnline() {
        if (app == null) return false;
        try {
            ConnectivityManager connectivity = (ConnectivityManager) app.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (connectivity == null) return false;
            Network network = connectivity.getActiveNetwork();
            NetworkCapabilities capabilities = network == null ? null : connectivity.getNetworkCapabilities(network);
            // VALIDATED is Android's last general-connectivity probe, not a
            // check of our provider endpoints. Campus networks may block that
            // probe while AI remains reachable; let the real TLS call decide.
            return capabilities != null
                    && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (SecurityException ignored) {
            return false;
        }
    }

    private static SecretKey key(boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) {
            java.security.Key key = store.getKey(KEY_ALIAS, null);
            if (!(key instanceof SecretKey)) throw new GeneralSecurityException("Credential key unavailable");
            return (SecretKey) key;
        }
        if (!create) return null;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build());
        return generator.generateKey();
    }

    private static void requireProvider(String provider) {
        if (!"deepseek".equals(provider) && !"zhipu".equals(provider)) {
            throw new IllegalArgumentException("不支持该模型服务。");
        }
    }
}
