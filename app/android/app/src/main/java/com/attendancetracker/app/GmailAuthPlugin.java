package com.attendancetracker.app;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.GoogleAuthException;
import com.google.android.gms.auth.GoogleAuthUtil;
import com.google.android.gms.auth.UserRecoverableAuthException;
import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.CommonStatusCodes;
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.tasks.Task;

import java.io.IOException;
import java.util.concurrent.TimeUnit;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Native Gmail sign-in for the Android app (Google Play Services).
 *
 * The web build signs in with an OAuth redirect, which can't come back into
 * the Android app. Here the phone's own Google account picker is used with
 * the gmail.readonly scope, and fresh access tokens come from
 * GoogleAuthUtil. Google recognises the app by its package name + signing
 * certificate SHA-1, registered as an "Android" OAuth client in the user's
 * Google Cloud project — so no client ID has to be typed into the app.
 */
@CapacitorPlugin(name = "GmailAuth")
public class GmailAuthPlugin extends Plugin {
    static final String GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    private GoogleSignInClient client() {
        GoogleSignInOptions gso = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestEmail()
            .requestScopes(new Scope(GMAIL_SCOPE))
            .build();
        return GoogleSignIn.getClient(getActivity(), gso);
    }

    /** Package name + signing SHA-1: what to register in Google Cloud. */
    @PluginMethod
    public void signingInfo(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("packageName", getContext().getPackageName());
        ret.put("sha1", signingSha1());
        call.resolve(ret);
    }

    /** Is a Google account connected with Gmail read access? */
    @PluginMethod
    public void status(PluginCall call) {
        GoogleSignInAccount account = GoogleSignIn.getLastSignedInAccount(getContext());
        JSObject ret = new JSObject();
        boolean ok = account != null && account.getAccount() != null
            && GoogleSignIn.hasPermissions(account, new Scope(GMAIL_SCOPE));
        ret.put("connected", ok);
        ret.put("email", ok ? account.getEmail() : null);
        call.resolve(ret);
    }

    /** Show the account picker; resolves with a Gmail access token. */
    @PluginMethod
    public void signIn(PluginCall call) {
        startActivityForResult(call, client().getSignInIntent(), "onSignInResult");
    }

    @ActivityCallback
    private void onSignInResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Task<GoogleSignInAccount> task = GoogleSignIn.getSignedInAccountFromIntent(result.getData());
        try {
            GoogleSignInAccount account = task.getResult(ApiException.class);
            fetchToken(call, account, true);
        } catch (ApiException e) {
            call.reject(messageFor(e.getStatusCode()), "SIGN_IN_" + e.getStatusCode());
        }
    }

    /** A fresh access token for the signed-in account (asks again for consent if Google needs it). */
    @PluginMethod
    public void getToken(PluginCall call) {
        GoogleSignInAccount account = GoogleSignIn.getLastSignedInAccount(getContext());
        if (account == null || account.getAccount() == null) {
            call.reject("Gmail is not connected.", "NOT_SIGNED_IN");
            return;
        }
        fetchToken(call, account, true);
    }

    /** Forget a token Google rejected (e.g. expired) so the next getToken fetches a new one. */
    @PluginMethod
    public void clearToken(PluginCall call) {
        final String token = call.getString("token", "");
        executor.execute(() -> {
            try {
                if (!token.isEmpty()) GoogleAuthUtil.clearToken(getContext(), token);
            } catch (Exception ignored) {
                // nothing to clear
            }
            call.resolve();
        });
    }

    /** Disconnect: revoke the app's Gmail access and sign out. */
    @PluginMethod
    public void signOut(PluginCall call) {
        final GoogleSignInClient c = client();
        c.revokeAccess().addOnCompleteListener(getActivity(), t -> c.signOut().addOnCompleteListener(getActivity(), t2 -> call.resolve()));
    }

    /** Turn the ~hourly background check of college email on or off. */
    @PluginMethod
    public void scheduleBackgroundCheck(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        String pattern = call.getString("pattern", "");
        String domain = call.getString("domain", "");
        android.content.SharedPreferences prefs = getContext().getSharedPreferences(GmailCheckWorker.PREFS, android.content.Context.MODE_PRIVATE);
        prefs.edit().putString(GmailCheckWorker.KEY_PATTERN, pattern).putString(GmailCheckWorker.KEY_DOMAIN, domain == null ? "" : domain)
            .putLong(GmailCheckWorker.KEY_SINCE, System.currentTimeMillis()).apply();
        WorkManager wm = WorkManager.getInstance(getContext());
        if (enabled && pattern != null && !pattern.isEmpty()) {
            PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(GmailCheckWorker.class, 1, TimeUnit.HOURS)
                .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build();
            wm.enqueueUniquePeriodicWork("college-email-check", ExistingPeriodicWorkPolicy.UPDATE, req);
        } else {
            wm.cancelUniqueWork("college-email-check");
        }
        call.resolve();
    }

    private void fetchToken(final PluginCall call, final GoogleSignInAccount account, final boolean allowConsent) {
        executor.execute(() -> {
            try {
                String token = GoogleAuthUtil.getToken(getContext(), account.getAccount(), "oauth2:" + GMAIL_SCOPE);
                JSObject ret = new JSObject();
                ret.put("accessToken", token);
                ret.put("email", account.getEmail());
                call.resolve(ret);
            } catch (UserRecoverableAuthException e) {
                Intent consent = e.getIntent();
                if (allowConsent && consent != null) {
                    getActivity().runOnUiThread(() -> startActivityForResult(call, consent, "onConsentResult"));
                } else {
                    call.reject("Google needs you to allow Gmail access again — tap Connect.", "CONSENT_NEEDED");
                }
            } catch (GoogleAuthException e) {
                call.reject("Google refused the sign-in: " + e.getMessage()
                    + ". Check the Android client (package name + SHA-1) in Google Cloud.", "GOOGLE_AUTH");
            } catch (IOException e) {
                call.reject("Couldn’t reach Google. Check your internet connection.", "NETWORK");
            }
        });
    }

    @ActivityCallback
    private void onConsentResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK) {
            call.reject("Gmail access wasn’t allowed.", "CONSENT_DENIED");
            return;
        }
        GoogleSignInAccount account = GoogleSignIn.getLastSignedInAccount(getContext());
        if (account == null) {
            call.reject("Gmail is not connected.", "NOT_SIGNED_IN");
            return;
        }
        fetchToken(call, account, false);
    }

    private static String messageFor(int code) {
        switch (code) {
            case 12501: // SIGN_IN_CANCELLED
                return "Sign-in was cancelled.";
            case CommonStatusCodes.DEVELOPER_ERROR: // 10
                return "Google doesn’t recognise this app yet. In Google Cloud, create an OAuth client of type Android with the package name and SHA-1 shown in Settings, and add your Gmail as a test user.";
            case CommonStatusCodes.NETWORK_ERROR: // 7
                return "Couldn’t reach Google. Check your internet connection.";
            default:
                return "Google sign-in failed (code " + code + ").";
        }
    }

    @SuppressWarnings("deprecation")
    private String signingSha1() {
        try {
            PackageManager pm = getContext().getPackageManager();
            String pkg = getContext().getPackageName();
            Signature[] sigs;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                PackageInfo info = pm.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES);
                sigs = info.signingInfo.hasMultipleSigners()
                    ? info.signingInfo.getApkContentsSigners()
                    : info.signingInfo.getSigningCertificateHistory();
            } else {
                sigs = pm.getPackageInfo(pkg, PackageManager.GET_SIGNATURES).signatures;
            }
            if (sigs == null || sigs.length == 0) return "";
            byte[] digest = MessageDigest.getInstance("SHA-1").digest(sigs[sigs.length - 1].toByteArray());
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < digest.length; i++) {
                if (i > 0) sb.append(':');
                sb.append(String.format("%02X", digest[i]));
            }
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }
}
