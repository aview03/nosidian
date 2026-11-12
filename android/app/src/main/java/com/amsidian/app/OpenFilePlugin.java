package com.amsidian.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import androidx.core.content.FileProvider;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * 다른 앱(파일 관리자 등)에서 .md 를 "열기"/"공유"로 넘겨받는다.
 * 내용을 읽어 두었다가 JS 가 getPending() 으로 가져가고, 앱이 켜져 있을 때 들어오면 fileOpened 이벤트로 알린다.
 */
@CapacitorPlugin(name = "OpenFile")
public class OpenFilePlugin extends Plugin {
    private static final int MAX_BYTES = 5 * 1024 * 1024;
    private JSObject pending;

    @Override
    public void load() {
        take(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (take(intent)) notifyListeners("fileOpened", new JSObject());
    }

    @PluginMethod
    public void getPending(PluginCall call) {
        JSObject r = pending != null ? pending : new JSObject();
        pending = null;
        call.resolve(r);
    }

    /**
     * 받아 둔 파일을 그 형식을 여는 기본 앱(PDF 뷰어 등)으로 바로 연다. 공유 창을 거치지 않는다.
     * 앱이 내려받아 둔 임시 폴더(cache/nosidian-files) 안의 파일만 열 수 있다(다른 앱 파일을 JS 가 열게 하지 않는다).
     * 열 수 있는 앱이 없으면 reject("noapp") — 호출한 쪽이 공유 창으로 넘어간다.
     */
    @PluginMethod
    public void view(PluginCall call) {
        String uriStr = call.getString("uri");
        String mime = call.getString("mime");
        if (uriStr == null) {
            call.reject("잘못된 요청");
            return;
        }
        try {
            String p = Uri.parse(uriStr).getPath();
            if (p == null) throw new Exception("잘못된 파일");
            File f = new File(p).getCanonicalFile();
            File root = new File(getContext().getCacheDir(), "nosidian-files").getCanonicalFile();
            if (!f.getPath().startsWith(root.getPath() + File.separator) || !f.isFile()) throw new Exception("열 수 없는 파일");
            Uri u = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(u, mime == null || mime.isEmpty() ? "*/*" : mime);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("noapp");
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "열기 실패" : e.getMessage());
        }
    }

    /** 열어 본 문서를 원본 uri 에 덮어쓴다 (파일 관리자가 쓰기 권한을 주지 않았으면 실패) */
    @PluginMethod
    public void save(PluginCall call) {
        String uriStr = call.getString("uri");
        String content = call.getString("content");
        if (uriStr == null || content == null) {
            call.reject("잘못된 요청");
            return;
        }
        try (OutputStream out = getContext().getContentResolver().openOutputStream(Uri.parse(uriStr), "wt")) {
            if (out == null) throw new Exception("쓸 수 없는 파일");
            out.write(content.getBytes(StandardCharsets.UTF_8));
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "저장 실패" : e.getMessage());
        }
    }

    @SuppressWarnings("deprecation")
    private boolean take(Intent i) {
        if (i == null || i.getAction() == null) return false;
        String action = i.getAction();
        Uri uri = null;
        String text = null;
        if (Intent.ACTION_VIEW.equals(action)) {
            uri = i.getData();
        } else if (Intent.ACTION_SEND.equals(action)) {
            uri = i.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri == null) text = i.getStringExtra(Intent.EXTRA_TEXT);
        } else {
            return false;
        }
        if (uri != null && "com.amsidian.app".equals(uri.getScheme())) return false; // OAuth 복귀 주소

        try {
            JSObject o = new JSObject();
            if (uri != null) {
                o.put("name", displayName(uri));
                o.put("content", read(uri));
                if (Intent.ACTION_VIEW.equals(action)) o.put("uri", uri.toString());
            } else if (text != null && !text.isEmpty()) {
                String title = text.trim().split("\n", 2)[0].replaceAll("[\\\\/:*?\"<>|#]", "").trim();
                if (title.length() > 40) title = title.substring(0, 40).trim();
                o.put("name", title.isEmpty() ? "공유된 메모" : title);
                o.put("content", text);
            } else {
                return false;
            }
            pending = o;
            i.setAction(null); // 화면 회전 등으로 같은 intent 를 다시 처리하지 않도록
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private String displayName(Uri uri) {
        try (Cursor c = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                String n = c.getString(0);
                if (n != null && !n.isEmpty()) return n;
            }
        } catch (Exception ignored) {
        }
        String seg = uri.getLastPathSegment();
        return seg == null ? "shared.md" : seg.substring(seg.lastIndexOf('/') + 1);
    }

    private String read(Uri uri) throws Exception {
        try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
            if (in == null) throw new Exception("열 수 없는 파일");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > MAX_BYTES) throw new Exception("파일이 너무 큽니다");
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }
}
