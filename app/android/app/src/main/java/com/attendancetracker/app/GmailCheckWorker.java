package com.attendancetracker.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import com.google.android.gms.auth.GoogleAuthUtil;
import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Background Gmail check (about hourly, scheduled by GmailAuthPlugin).
 * Looks only at the SUBJECT and SENDER of mail that arrived since the app was
 * last used, and notifies when some match the categories chosen in Settings.
 * The full reading (and automatic adding) happens in the app when it opens —
 * the deadline readers live in the app's JavaScript.
 */
public class GmailCheckWorker extends Worker {
    static final String PREFS = "gmail_background_check";
    static final String KEY_PATTERN = "pattern";
    static final String KEY_DOMAIN = "domain";
    static final String KEY_SINCE = "sinceMs";
    private static final String CHANNEL = "college_email";
    private static final int NOTIFICATION_ID = 999_400;
    private static final String API = "https://gmail.googleapis.com/gmail/v1/users/me/messages";

    public GmailCheckWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String pattern = prefs.getString(KEY_PATTERN, "");
        if (pattern == null || pattern.isEmpty()) return Result.success();
        long since = prefs.getLong(KEY_SINCE, 0);
        long now = System.currentTimeMillis();
        if (since == 0) {
            prefs.edit().putLong(KEY_SINCE, now).apply();
            return Result.success();
        }
        GoogleSignInAccount account = GoogleSignIn.getLastSignedInAccount(ctx);
        if (account == null || account.getAccount() == null) return Result.success();
        try {
            String token = GoogleAuthUtil.getToken(ctx, account.getAccount(), "oauth2:" + GmailAuthPlugin.GMAIL_SCOPE);
            String q = "after:" + (since / 1000) + " -in:sent -in:chats -in:spam";
            JSONObject list = get(API + "?maxResults=20&q=" + URLEncoder.encode(q, "UTF-8"), token);
            JSONArray msgs = list.optJSONArray("messages");
            List<String> hits = new ArrayList<>();
            Pattern re = Pattern.compile(pattern);
            String domain = prefs.getString(KEY_DOMAIN, "");
            if (msgs != null) {
                for (int i = 0; i < msgs.length(); i++) {
                    String id = msgs.getJSONObject(i).getString("id");
                    JSONObject m = get(API + "/" + id + "?format=metadata&metadataHeaders=Subject&metadataHeaders=From", token);
                    String subject = header(m, "Subject");
                    String from = header(m, "From").toLowerCase();
                    if (domain != null && !domain.isEmpty() && !from.contains("@" + domain) && !from.contains("." + domain)) continue;
                    if (re.matcher(subject).find()) hits.add(subject);
                }
            }
            prefs.edit().putLong(KEY_SINCE, now).apply();
            if (!hits.isEmpty()) notify(ctx, hits);
            return Result.success();
        } catch (Exception e) {
            // consent needed / offline / Google refused — try again next time
            return Result.success();
        }
    }

    private static JSONObject get(String url, String token) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestProperty("Authorization", "Bearer " + token);
        c.setConnectTimeout(20_000);
        c.setReadTimeout(20_000);
        int code = c.getResponseCode();
        if (code != 200) throw new Exception("Gmail " + code);
        StringBuilder sb = new StringBuilder();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream()))) {
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
        }
        return new JSONObject(sb.toString());
    }

    private static String header(JSONObject msg, String name) {
        JSONObject payload = msg.optJSONObject("payload");
        JSONArray headers = payload == null ? null : payload.optJSONArray("headers");
        if (headers == null) return "";
        for (int i = 0; i < headers.length(); i++) {
            JSONObject h = headers.optJSONObject(i);
            if (h != null && name.equalsIgnoreCase(h.optString("name"))) return h.optString("value");
        }
        return "";
    }

    private static void notify(Context ctx, List<String> subjects) {
        if (Build.VERSION.SDK_INT >= 33
            && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
                nm.createNotificationChannel(new NotificationChannel(CHANNEL, "College email", NotificationManager.IMPORTANCE_DEFAULT));
            }
        }
        Intent open = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent tap = PendingIntent.getActivity(ctx, 0, open, flags);
        String title = subjects.size() == 1 ? "📬 New college email" : "📬 " + subjects.size() + " important college emails";
        String body = String.join(" · ", subjects.subList(0, Math.min(3, subjects.size())))
            + (subjects.size() > 3 ? " +" + (subjects.size() - 3) + " more" : "")
            + ". Open the app to add the deadlines.";
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(tap)
            .setAutoCancel(true);
        NotificationManagerCompat.from(ctx).notify(NOTIFICATION_ID, b.build());
    }
}
