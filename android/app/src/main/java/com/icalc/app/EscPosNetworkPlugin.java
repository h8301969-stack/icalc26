package com.icalc.app;

import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Raw TCP (JetDirect / port 9100) ESC/POS writer for WiFi thermal printers.
 */
@CapacitorPlugin(name = "EscPosNetwork")
public class EscPosNetworkPlugin extends Plugin {
    private final ExecutorService executor = Executors.newCachedThreadPool();

    @PluginMethod
    public void testConnection(PluginCall call) {
        final String host = call.getString("host");
        final Integer port = call.getInt("port", 9100);
        final Integer timeoutMs = call.getInt("timeoutMs", 4000);

        if (host == null || host.trim().isEmpty()) {
            call.reject("Host is required");
            return;
        }

        executor.execute(() -> {
            Socket socket = null;
            try {
                socket = new Socket();
                socket.connect(new InetSocketAddress(host.trim(), port), timeoutMs);
                JSObject ret = new JSObject();
                ret.put("ok", true);
                call.resolve(ret);
            } catch (Exception e) {
                JSObject ret = new JSObject();
                ret.put("ok", false);
                ret.put("message", e.getMessage());
                call.resolve(ret);
            } finally {
                if (socket != null) {
                    try {
                        socket.close();
                    } catch (Exception ignored) {
                    }
                }
            }
        });
    }

    @PluginMethod
    public void print(PluginCall call) {
        final String host = call.getString("host");
        final Integer port = call.getInt("port", 9100);
        final String dataBase64 = call.getString("dataBase64");
        final Integer timeoutMs = call.getInt("timeoutMs", 15000);

        if (host == null || host.trim().isEmpty()) {
            call.reject("Host is required");
            return;
        }
        if (dataBase64 == null || dataBase64.isEmpty()) {
            call.reject("Print data is required");
            return;
        }

        executor.execute(() -> {
            Socket socket = null;
            try {
                byte[] data = Base64.decode(dataBase64, Base64.DEFAULT);
                socket = new Socket();
                socket.connect(new InetSocketAddress(host.trim(), port), Math.min(timeoutMs, 8000));
                socket.setSoTimeout(timeoutMs);
                OutputStream out = socket.getOutputStream();
                out.write(data);
                out.flush();

                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("bytesWritten", data.length);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Network print failed: " + e.getMessage(), e);
            } finally {
                if (socket != null) {
                    try {
                        socket.close();
                    } catch (Exception ignored) {
                    }
                }
            }
        });
    }
}
