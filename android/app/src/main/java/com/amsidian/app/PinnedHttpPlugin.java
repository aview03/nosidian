package com.amsidian.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.util.Iterator;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/**
 * 인증서 지문 고정(pinning) HTTPS 요청. 이 PC 의 파일 공유(자체 서명 인증서)에만 쓴다.
 * 서버 인증서의 SHA-256 지문이 pin 과 같을 때만 연결을 받아들인다 — 같지 않으면 요청을 보내기 전에 끊는다.
 * pin 이 비어 있으면 거절한다(검증 없이 받아들이는 모드가 없다). 일반 인터넷 사이트에는 쓰지 않는다.
 */
@CapacitorPlugin(name = "PinnedHttp")
public class PinnedHttpPlugin extends Plugin {
    private static final int MAX_RESPONSE = 48 * 1024 * 1024;

    private static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02x", x));
        return sb.toString();
    }

    @PluginMethod
    public void request(final PluginCall call) {
        final String url = call.getString("url", "");
        final String pin = call.getString("pin", "").trim().toLowerCase();
        if (!url.startsWith("https://")) {
            call.reject("https only");
            return;
        }
        if (!pin.matches("^[0-9a-f]{64}$")) {
            call.reject("pin required");
            return;
        }
        final String method = call.getString("method", "POST");
        final String body = call.getString("body", null);
        final int timeout = Math.max(1000, Math.min(120000, call.getInt("timeoutMs", 30000)));
        final JSObject headers = call.getObject("headers", new JSObject());

        new Thread(() -> {
            HttpsURLConnection conn = null;
            try {
                final String[] seen = new String[1];
                TrustManager tm = new X509TrustManager() {
                    @Override
                    public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {
                        throw new CertificateException("client certs not supported");
                    }

                    @Override
                    public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
                        try {
                            seen[0] = hex(MessageDigest.getInstance("SHA-256").digest(chain[0].getEncoded()));
                        } catch (Exception e) {
                            throw new CertificateException("pin mismatch");
                        }
                        if (!MessageDigest.isEqual(seen[0].getBytes(StandardCharsets.UTF_8), pin.getBytes(StandardCharsets.UTF_8))) {
                            throw new CertificateException("pin mismatch");
                        }
                    }

                    @Override
                    public X509Certificate[] getAcceptedIssuers() {
                        return new X509Certificate[0];
                    }
                };
                SSLContext ctx = SSLContext.getInstance("TLS");
                ctx.init(null, new TrustManager[] { tm }, null);
                conn = (HttpsURLConnection) new URL(url).openConnection();
                conn.setSSLSocketFactory(ctx.getSocketFactory());
                // 주소가 IP 라서 호스트 이름 검증은 의미가 없다 — 신원은 지문으로 확인한다
                conn.setHostnameVerifier((h, s) -> true);
                conn.setConnectTimeout(Math.min(timeout, 8000));
                conn.setReadTimeout(timeout);
                conn.setRequestMethod(method);
                conn.setInstanceFollowRedirects(false);
                Iterator<String> keys = headers.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    conn.setRequestProperty(k, headers.getString(k));
                }
                if (body != null) {
                    conn.setDoOutput(true);
                    byte[] data = body.getBytes(StandardCharsets.UTF_8);
                    conn.setFixedLengthStreamingMode(data.length);
                    try (OutputStream os = conn.getOutputStream()) {
                        os.write(data);
                    }
                }
                int status = conn.getResponseCode();
                InputStream is = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                if (is != null) {
                    byte[] buf = new byte[16384];
                    int n;
                    while ((n = is.read(buf)) > 0) {
                        bos.write(buf, 0, n);
                        if (bos.size() > MAX_RESPONSE) throw new Exception("response too large");
                    }
                    is.close();
                }
                JSObject out = new JSObject();
                out.put("status", status);
                out.put("text", new String(bos.toByteArray(), StandardCharsets.UTF_8));
                out.put("fp", seen[0] == null ? "" : seen[0]);
                call.resolve(out);
            } catch (Exception e) {
                String m = String.valueOf(e.getMessage());
                Throwable c = e.getCause();
                while (c != null) {
                    if (String.valueOf(c.getMessage()).contains("pin mismatch")) {
                        m = "pin mismatch";
                        break;
                    }
                    c = c.getCause();
                }
                call.reject(m.contains("pin mismatch") ? "pin mismatch" : m);
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }
}
