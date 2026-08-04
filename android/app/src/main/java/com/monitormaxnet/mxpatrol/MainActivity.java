package com.monitormaxnet.mxpatrol;

import android.Manifest;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.ImageFormat;
import android.graphics.SurfaceTexture;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.media.Image;
import android.media.ImageReader;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import android.util.Base64;
import android.util.Log;
import android.util.Size;
import android.util.SparseLongArray;
import android.view.KeyEvent;
import android.view.Surface;
import android.webkit.CookieManager;
import android.webkit.WebStorage;

import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import java.io.File;
import java.nio.ByteBuffer;
import java.util.Arrays;

import com.getcapacitor.BridgeActivity;

import org.json.JSONException;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final String HARDWARE_KEY_EVENT = "mxpatrolHardwareKey";
    private static final String HARDWARE_KEY_SCHEMA = "mxpatrol.hardwareKey.v1";
    private static final String INCIDENT_PHOTO_EVENT = "mxpatrolIncidentPhoto";
    private static final String INCIDENT_PHOTO_SCHEMA = "mxpatrol.incidentPhoto.v1";
    private static final String WEBVIEW_CACHE_CLEAR_KEY = "webview_cache_cleared_20260619_single_bundle";
    private static final String TAG = "MXHardwareKey";
    private static final int INCIDENT_PHOTO_PERMISSION_REQUEST = 5042;
    private static final int INCIDENT_PHOTO_HOLD_MS = 500;
    private static final int INCIDENT_PHOTO_KEY_CODE = KeyEvent.KEYCODE_VOLUME_UP;
    private static final int INCIDENT_PHOTO_SCAN_CODE = 115;
    private final SparseLongArray keyDownTimes = new SparseLongArray();
    private boolean incidentPhotoCaptureInProgress = false;
    private boolean pendingIncidentPhotoAfterPermission = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        clearLegacyWebViewCacheOnce();
        super.onCreate(savedInstanceState);

        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().clearCache(true);
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        final int keyCode = event.getKeyCode();

        if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
            keyDownTimes.put(keyCode, SystemClock.elapsedRealtime());
            emitHardwareKey(event, 0, "down");
        } else if (event.getAction() == KeyEvent.ACTION_UP) {
            final long startedAt = keyDownTimes.get(keyCode, SystemClock.elapsedRealtime());
            final long durationMs = SystemClock.elapsedRealtime() - startedAt;
            keyDownTimes.delete(keyCode);
            emitHardwareKey(event, durationMs, "up");
            if (isIncidentPhotoKey(event, durationMs)) {
                triggerIncidentPhotoCapture();
            }
        }

        return super.dispatchKeyEvent(event);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != INCIDENT_PHOTO_PERMISSION_REQUEST) return;

        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED && pendingIncidentPhotoAfterPermission) {
            pendingIncidentPhotoAfterPermission = false;
            triggerIncidentPhotoCapture();
        } else {
            pendingIncidentPhotoAfterPermission = false;
            emitIncidentPhotoError("camera_permission_denied");
        }
    }

    private boolean isIncidentPhotoKey(KeyEvent event, long durationMs) {
        return event.getKeyCode() == INCIDENT_PHOTO_KEY_CODE
            && event.getScanCode() == INCIDENT_PHOTO_SCAN_CODE
            && durationMs >= INCIDENT_PHOTO_HOLD_MS;
    }

    private void triggerIncidentPhotoCapture() {
        if (incidentPhotoCaptureInProgress) return;

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            pendingIncidentPhotoAfterPermission = true;
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.CAMERA}, INCIDENT_PHOTO_PERMISSION_REQUEST);
            emitIncidentPhotoError("camera_permission_requested");
            return;
        }

        incidentPhotoCaptureInProgress = true;
        HandlerThread thread = new HandlerThread("mxpatrol-incident-photo");
        thread.start();
        Handler handler = new Handler(thread.getLooper());

        try {
            CameraManager cameraManager = (CameraManager) getSystemService(CAMERA_SERVICE);
            String cameraId = findBackCameraId(cameraManager);
            if (cameraId == null) {
                incidentPhotoCaptureInProgress = false;
                thread.quitSafely();
                emitIncidentPhotoError("no_camera_available");
                return;
            }

            CameraCharacteristics characteristics = cameraManager.getCameraCharacteristics(cameraId);
            Size size = chooseJpegSize(characteristics);
            ImageReader reader = ImageReader.newInstance(size.getWidth(), size.getHeight(), ImageFormat.JPEG, 1);

            reader.setOnImageAvailableListener((imageReader) -> {
                Image image = null;
                try {
                    image = imageReader.acquireLatestImage();
                    if (image == null) {
                        emitIncidentPhotoError("empty_image");
                        return;
                    }
                    ByteBuffer buffer = image.getPlanes()[0].getBuffer();
                    byte[] bytes = new byte[buffer.remaining()];
                    buffer.get(bytes);
                    String base64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
                    emitIncidentPhotoCaptured(base64);
                } catch (Exception error) {
                    Log.w(TAG, "Incident photo read failed", error);
                    emitIncidentPhotoError("image_read_failed");
                } finally {
                    if (image != null) image.close();
                    imageReader.close();
                    incidentPhotoCaptureInProgress = false;
                    thread.quitSafely();
                }
            }, handler);

            cameraManager.openCamera(cameraId, new CameraDevice.StateCallback() {
                @Override
                public void onOpened(@NonNull CameraDevice camera) {
                    SurfaceTexture previewTexture = new SurfaceTexture(0);
                    previewTexture.setDefaultBufferSize(640, 480);
                    Surface previewSurface = new Surface(previewTexture);

                    try {
                        camera.createCaptureSession(Arrays.asList(previewSurface, reader.getSurface()), new CameraCaptureSession.StateCallback() {
                            @Override
                            public void onConfigured(@NonNull CameraCaptureSession session) {
                                try {
                                    CaptureRequest.Builder previewBuilder = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
                                    previewBuilder.addTarget(previewSurface);
                                    applyIncidentPhotoCaptureSettings(previewBuilder);
                                    session.setRepeatingRequest(previewBuilder.build(), null, handler);

                                    handler.postDelayed(() -> {
                                        try {
                                            CaptureRequest.Builder stillBuilder = camera.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE);
                                            stillBuilder.addTarget(reader.getSurface());
                                            applyIncidentPhotoCaptureSettings(stillBuilder);
                                            session.stopRepeating();
                                            session.capture(stillBuilder.build(), new CameraCaptureSession.CaptureCallback() {
                                                @Override
                                                public void onCaptureCompleted(@NonNull CameraCaptureSession session, @NonNull CaptureRequest request, @NonNull android.hardware.camera2.TotalCaptureResult result) {
                                                    closeIncidentPhotoCamera(session, camera, previewSurface, previewTexture);
                                                }

                                                @Override
                                                public void onCaptureFailed(@NonNull CameraCaptureSession session, @NonNull CaptureRequest request, @NonNull android.hardware.camera2.CaptureFailure failure) {
                                                    Log.w(TAG, "Incident photo capture failed: " + failure.getReason());
                                                    closeIncidentPhotoCamera(session, camera, previewSurface, previewTexture);
                                                    reader.close();
                                                    incidentPhotoCaptureInProgress = false;
                                                    thread.quitSafely();
                                                    emitIncidentPhotoError("capture_failed");
                                                }
                                            }, handler);
                                        } catch (CameraAccessException error) {
                                            Log.w(TAG, "Incident photo capture failed", error);
                                            closeIncidentPhotoCamera(session, camera, previewSurface, previewTexture);
                                            reader.close();
                                            incidentPhotoCaptureInProgress = false;
                                            thread.quitSafely();
                                            emitIncidentPhotoError("capture_failed");
                                        }
                                    }, 900);
                                } catch (CameraAccessException error) {
                                    Log.w(TAG, "Incident photo preview failed", error);
                                    closeIncidentPhotoCamera(session, camera, previewSurface, previewTexture);
                                    reader.close();
                                    incidentPhotoCaptureInProgress = false;
                                    thread.quitSafely();
                                    emitIncidentPhotoError("preview_failed");
                                }
                            }

                            @Override
                            public void onConfigureFailed(@NonNull CameraCaptureSession session) {
                                closeIncidentPhotoCamera(session, camera, previewSurface, previewTexture);
                                reader.close();
                                incidentPhotoCaptureInProgress = false;
                                thread.quitSafely();
                                emitIncidentPhotoError("camera_config_failed");
                            }
                        }, handler);
                    } catch (CameraAccessException error) {
                        Log.w(TAG, "Incident photo session failed", error);
                        camera.close();
                        previewSurface.release();
                        previewTexture.release();
                        reader.close();
                        incidentPhotoCaptureInProgress = false;
                        thread.quitSafely();
                        emitIncidentPhotoError("camera_session_failed");
                    }
                }

                @Override
                public void onDisconnected(@NonNull CameraDevice camera) {
                    camera.close();
                    reader.close();
                    incidentPhotoCaptureInProgress = false;
                    thread.quitSafely();
                    emitIncidentPhotoError("camera_disconnected");
                }

                @Override
                public void onError(@NonNull CameraDevice camera, int error) {
                    camera.close();
                    reader.close();
                    incidentPhotoCaptureInProgress = false;
                    thread.quitSafely();
                    emitIncidentPhotoError("camera_error_" + error);
                }
            }, handler);
        } catch (SecurityException error) {
            incidentPhotoCaptureInProgress = false;
            thread.quitSafely();
            emitIncidentPhotoError("camera_permission_missing");
        } catch (Exception error) {
            Log.w(TAG, "Incident photo capture setup failed", error);
            incidentPhotoCaptureInProgress = false;
            thread.quitSafely();
            emitIncidentPhotoError("capture_setup_failed");
        }
    }

    private void applyIncidentPhotoCaptureSettings(CaptureRequest.Builder builder) {
        builder.set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO);
        builder.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE);
        builder.set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON);
        builder.set(CaptureRequest.CONTROL_AWB_MODE, CaptureRequest.CONTROL_AWB_MODE_AUTO);
    }

    private void closeIncidentPhotoCamera(CameraCaptureSession session, CameraDevice camera, Surface previewSurface, SurfaceTexture previewTexture) {
        try { session.close(); } catch (Exception ignored) {}
        try { camera.close(); } catch (Exception ignored) {}
        try { previewSurface.release(); } catch (Exception ignored) {}
        try { previewTexture.release(); } catch (Exception ignored) {}
    }

    private String findBackCameraId(CameraManager cameraManager) throws CameraAccessException {
        String fallback = null;
        for (String cameraId : cameraManager.getCameraIdList()) {
            if (fallback == null) fallback = cameraId;
            CameraCharacteristics characteristics = cameraManager.getCameraCharacteristics(cameraId);
            Integer facing = characteristics.get(CameraCharacteristics.LENS_FACING);
            if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) return cameraId;
        }
        return fallback;
    }

    private Size chooseJpegSize(CameraCharacteristics characteristics) {
        StreamConfigurationMap map = characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
        Size fallback = new Size(1280, 960);
        if (map == null) return fallback;

        Size[] sizes = map.getOutputSizes(ImageFormat.JPEG);
        if (sizes == null || sizes.length == 0) return fallback;

        Size best = null;
        Size smallest = sizes[0];
        for (Size size : sizes) {
            if ((long) size.getWidth() * size.getHeight() < (long) smallest.getWidth() * smallest.getHeight()) smallest = size;
            if (size.getWidth() <= 1280 && size.getHeight() <= 960) {
                if (best == null || (long) size.getWidth() * size.getHeight() > (long) best.getWidth() * best.getHeight()) {
                    best = size;
                }
            }
        }
        return best != null ? best : smallest;
    }

    private void emitIncidentPhotoCaptured(String photoBase64) {
        emitIncidentPhoto("captured", photoBase64, null);
    }

    private void emitIncidentPhotoError(String reason) {
        emitIncidentPhoto("error", null, reason);
    }

    private void emitIncidentPhoto(String status, String photoBase64, String reason) {
        if (bridge == null || bridge.getWebView() == null) return;
        try {
            JSONObject detail = new JSONObject();
            detail.put("schema", INCIDENT_PHOTO_SCHEMA);
            detail.put("status", status);
            detail.put("capturedAtMs", System.currentTimeMillis());
            if (photoBase64 != null) detail.put("photoBase64", photoBase64);
            if (reason != null) detail.put("reason", reason);
            final String payload = detail.toString();
            Log.i(TAG, "IncidentPhoto " + status + (reason != null ? " " + reason : ""));
            bridge.getWebView().post(() -> bridge.getWebView().evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('" + INCIDENT_PHOTO_EVENT + "', { detail: " + payload + " }))",
                null
            ));
        } catch (JSONException ignored) {
            // All values are primitives, so serialization should not fail.
        }
    }

    private void clearLegacyWebViewCacheOnce() {
        SharedPreferences preferences = getSharedPreferences("mxpatrol", MODE_PRIVATE);
        if (preferences.getBoolean(WEBVIEW_CACHE_CLEAR_KEY, false)) return;

        try {
            WebStorage.getInstance().deleteAllData();
            CookieManager cookieManager = CookieManager.getInstance();
            cookieManager.removeAllCookies(null);
            cookieManager.flush();
            deleteDatabase("webview.db");
            deleteDatabase("webviewCache.db");
            deleteRecursively(new File(getApplicationInfo().dataDir, "app_webview"));
            deleteRecursively(getCacheDir());
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
                deleteRecursively(getCodeCacheDir());
            }
        } catch (Exception error) {
            Log.w(TAG, "Failed to clear legacy WebView cache", error);
        } finally {
            preferences.edit().putBoolean(WEBVIEW_CACHE_CLEAR_KEY, true).apply();
        }
    }

    private void deleteRecursively(File file) {
        if (file == null || !file.exists()) return;

        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursively(child);
                }
            }
        }

        if (!file.delete() && file.exists()) {
            Log.w(TAG, "Failed to delete WebView cache path: " + file.getAbsolutePath());
        }
    }

    private void emitHardwareKey(KeyEvent event, long durationMs, String action) {
        if (bridge == null) return;

        try {
            final int keyCode = event.getKeyCode();

            JSONObject key = new JSONObject();
            key.put("code", keyCode);
            key.put("name", KeyEvent.keyCodeToString(keyCode));
            key.put("scanCode", event.getScanCode());

            JSONObject device = new JSONObject();
            device.put("id", event.getDeviceId());
            device.put("source", event.getSource());

            JSONObject timing = new JSONObject();
            timing.put("durationMs", Math.max(0, durationMs));
            timing.put("eventTimeMs", event.getEventTime());
            timing.put("downTimeMs", event.getDownTime());
            timing.put("emittedAtMs", System.currentTimeMillis());

            JSONObject detail = new JSONObject();
            detail.put("schema", HARDWARE_KEY_SCHEMA);
            detail.put("keyCode", keyCode);
            detail.put("keyName", KeyEvent.keyCodeToString(keyCode));
            detail.put("durationMs", Math.max(0, durationMs));
            detail.put("sosCandidate", isSosCandidate(keyCode));
            detail.put("action", action);
            detail.put("key", key);
            detail.put("device", device);
            detail.put("timing", timing);
            detail.put("repeatCount", event.getRepeatCount());
            detail.put("metaState", event.getMetaState());
            final String payload = detail.toString();
            Log.i(TAG, payload);
            bridge.getWebView().post(() -> bridge.getWebView().evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('" + HARDWARE_KEY_EVENT + "', { detail: " + payload + " }))",
                null
            ));
        } catch (JSONException ignored) {
            // All values are primitives, so serialization should not fail.
        }
    }

    private boolean isSosCandidate(int keyCode) {
        return keyCode == 1079
            || (keyCode >= KeyEvent.KEYCODE_F1 && keyCode <= KeyEvent.KEYCODE_F4)
            || (keyCode >= KeyEvent.KEYCODE_BUTTON_1 && keyCode <= KeyEvent.KEYCODE_BUTTON_4)
            || (keyCode >= 285 && keyCode <= 288);
    }
}
