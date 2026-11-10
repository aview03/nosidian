package com.amsidian.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * 비밀값(PC 연결 토큰·API 키) 보안 저장소. Android Keystore 의 AES-256-GCM 키(내보낼 수 없음, 가능한 기기에서는 하드웨어 보관)로 암호화해
 * 앱 전용 SharedPreferences 에 둔다. 웹뷰의 localStorage 에는 비밀값이 남지 않는다.
 * - 값마다 이름(key)을 GCM 의 추가 인증 데이터(AAD)로 묶어, 다른 이름의 암호문을 바꿔치기해도 복호화되지 않는다.
 * - 키가 사라지거나 무효가 되면(백업 복원·기기 이전·보안 재설정) 복호화가 실패한다 → 그 항목을 지우고 invalid 로 알린다(자동으로 평문으로 되돌리지 않는다).
 * - 이 저장소는 백업·기기 이전에서 제외한다(backup_rules.xml · data_extraction_rules.xml).
 */
@CapacitorPlugin(name = "SecureStore")
public class SecureStorePlugin extends Plugin {
    private static final String ALIAS = "nosidian_secure_v1";
    private static final String PREFS = "nosidian_secure";
    private static final int MAX_VALUE = 16 * 1024;

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (!ks.containsAlias(ALIAS)) {
            KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            kg.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build());
            kg.generateKey();
        }
        return (SecretKey) ks.getKey(ALIAS, null);
    }

    private static boolean badName(String k) {
        return k == null || !k.matches("^[A-Za-z0-9._-]{1,64}$");
    }

    @PluginMethod
    public void set(PluginCall call) {
        String name = call.getString("key");
        String value = call.getString("value");
        if (badName(name) || value == null || value.length() > MAX_VALUE) {
            call.reject("bad arguments");
            return;
        }
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key());
            c.updateAAD(name.getBytes(StandardCharsets.UTF_8));
            byte[] ct = c.doFinal(value.getBytes(StandardCharsets.UTF_8));
            String blob = Base64.encodeToString(c.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP);
            if (!prefs().edit().putString(name, blob).commit()) {
                call.reject("write failed");
                return;
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("encrypt failed: " + e.getClass().getSimpleName());
        }
    }

    @PluginMethod
    public void get(PluginCall call) {
        String name = call.getString("key");
        if (badName(name)) {
            call.reject("bad arguments");
            return;
        }
        JSObject out = new JSObject();
        String blob = prefs().getString(name, null);
        if (blob == null) {
            out.put("value", JSObject.NULL);
            call.resolve(out);
            return;
        }
        try {
            String[] p = blob.split(":");
            byte[] iv = Base64.decode(p[0], Base64.NO_WRAP);
            byte[] ct = Base64.decode(p[1], Base64.NO_WRAP);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
            c.updateAAD(name.getBytes(StandardCharsets.UTF_8));
            out.put("value", new String(c.doFinal(ct), StandardCharsets.UTF_8));
            call.resolve(out);
        } catch (Exception e) {
            // 키가 없어졌거나 암호문이 변조됨: 쓸 수 없는 항목은 지우고 알린다
            prefs().edit().remove(name).commit();
            out.put("value", JSObject.NULL);
            out.put("invalid", true);
            call.resolve(out);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String name = call.getString("key");
        if (badName(name)) {
            call.reject("bad arguments");
            return;
        }
        prefs().edit().remove(name).commit();
        call.resolve();
    }
}
