package com.guidedreader.tablet.debug;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.os.Bundle;

import com.chaquo.python.PyObject;
import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Set;

/**
 * Fixed, unauthenticated TLS checks inside the APK's own Python runtime.
 * No Reader import, library access, credential read, or configurable code/URL.
 */
public final class ProviderTlsCheck extends Instrumentation {
    private static final Set<Integer> EXPECTED_STATUSES = Set.of(401, 403, 404, 405);
    private static final Set<String> SAFE_ERRORS = Set.of("TIMEOUT", "DNS_FAILURE", "NETWORK_ERROR",
            "TLS_CERTIFICATE_ERROR", "TLS_ERROR", "TLS_CONTEXT_ERROR", "REDIRECT_BLOCKED",
            "HTTP_UNEXPECTED", "PYTHON_INIT_FAILED", "CHECK_FAILED");

    private static final String CHECK_CODE = """
            import json as _json
            import queue as _queue
            import socket as _socket
            import ssl as _ssl
            import threading as _threading
            import urllib.request as _request
            import urllib.error as _error

            class _NoRedirect(_request.HTTPRedirectHandler):
                def redirect_request(self, req, fp, code, msg, headers, newurl):
                    return None

            def _tls_probe(provider, url, output):
                status, failure = None, None
                try:
                    try:
                        context = _ssl.create_default_context()
                        if not context.check_hostname or context.verify_mode != _ssl.CERT_REQUIRED:
                            output.put({'provider': provider, 'httpstatus': None, 'safeerror': 'TLS_CONTEXT_ERROR'})
                            return
                    except Exception:
                        output.put({'provider': provider, 'httpstatus': None, 'safeerror': 'TLS_CONTEXT_ERROR'})
                        return
                    opener = _request.build_opener(_request.ProxyHandler({}), _NoRedirect(),
                        _request.HTTPSHandler(context=context))
                    request = _request.Request(url, method='HEAD',
                        headers={'User-Agent': 'GuidedReader-Android-TLS-QA', 'Accept': 'application/json'})
                    try:
                        with opener.open(request, timeout=10) as response:
                            status = int(response.status)
                    except _error.HTTPError as error:
                        status = int(error.code)
                        error.close()
                    if 300 <= status < 400:
                        failure = 'REDIRECT_BLOCKED'
                    elif not (200 <= status < 300 or status in (401, 403, 404, 405)):
                        failure = 'HTTP_UNEXPECTED'
                except _error.URLError as error:
                    reason = error.reason
                    if isinstance(reason, _ssl.SSLCertVerificationError):
                        failure = 'TLS_CERTIFICATE_ERROR'
                    elif isinstance(reason, _ssl.SSLError):
                        failure = 'TLS_ERROR'
                    elif isinstance(reason, (_socket.timeout, TimeoutError)):
                        failure = 'TIMEOUT'
                    elif isinstance(reason, _socket.gaierror):
                        failure = 'DNS_FAILURE'
                    else:
                        failure = 'NETWORK_ERROR'
                except _ssl.SSLCertVerificationError:
                    failure = 'TLS_CERTIFICATE_ERROR'
                except _ssl.SSLError:
                    failure = 'TLS_ERROR'
                except (_socket.timeout, TimeoutError):
                    failure = 'TIMEOUT'
                except Exception:
                    failure = 'CHECK_FAILED'
                output.put({'provider': provider, 'httpstatus': status, 'safeerror': failure})

            _rows = []
            for _provider, _url in (
                ('deepseek', 'https://api.deepseek.com/chat/completions'),
                ('zhipu', 'https://open.bigmodel.cn/api/paas/v4/chat/completions'),
            ):
                _output = _queue.Queue(maxsize=1)
                _worker = _threading.Thread(target=_tls_probe, args=(_provider, _url, _output), daemon=True)
                _worker.start()
                _worker.join(14)
                if _worker.is_alive() or _output.empty():
                    _rows.append({'provider': _provider, 'httpstatus': None, 'safeerror': 'TIMEOUT'})
                else:
                    _rows.append(_output.get_nowait())
            _reader_tls_report = _json.dumps(_rows, separators=(',', ':'))
            """;

    @Override public void onCreate(Bundle ignoredArguments) {
        super.onCreate(null);
        start();
    }

    @Override public void onStart() {
        JSONArray report;
        try {
            Context context = getTargetContext().getApplicationContext();
            if (!Python.isStarted()) Python.start(new AndroidPlatform(context));
            PyObject builtins = Python.getInstance().getModule("builtins");
            PyObject namespace = builtins.callAttr("dict");
            builtins.callAttr("exec", CHECK_CODE, namespace);
            String raw = builtins.callAttr("eval", "_reader_tls_report", namespace).toString();
            if (raw.length() > 2048) throw new IllegalStateException();
            report = sanitize(new JSONArray(raw));
        } catch (Exception ignored) {
            report = initializationFailure();
        }
        boolean passed = true;
        for (int index = 0; index < report.length(); index++) {
            JSONObject row = report.optJSONObject(index);
            int status = row == null ? -1 : row.optInt("httpstatus", -1);
            if (row == null || !row.isNull("safeerror")
                    || !((status >= 200 && status < 300) || EXPECTED_STATUSES.contains(status))) passed = false;
        }
        Bundle result = new Bundle();
        result.putString("report", report.toString());
        finish(passed ? Activity.RESULT_OK : Activity.RESULT_CANCELED, result);
    }

    private static JSONArray sanitize(JSONArray input) throws Exception {
        if (input.length() != 2) throw new IllegalArgumentException();
        JSONArray output = new JSONArray();
        String[] providers = {"deepseek", "zhipu"};
        for (int index = 0; index < providers.length; index++) {
            JSONObject source = input.getJSONObject(index);
            if (!providers[index].equals(source.optString("provider"))) throw new IllegalArgumentException();
            JSONObject row = new JSONObject().put("provider", providers[index]);
            int status = source.optInt("httpstatus", -1);
            row.put("httpstatus", status >= 100 && status <= 599 ? status : JSONObject.NULL);
            String failure = source.isNull("safeerror") ? null : source.optString("safeerror", "CHECK_FAILED");
            row.put("safeerror", failure == null ? JSONObject.NULL : SAFE_ERRORS.contains(failure) ? failure : "CHECK_FAILED");
            output.put(row);
        }
        return output;
    }

    private static JSONArray initializationFailure() {
        JSONArray output = new JSONArray();
        for (String provider : new String[]{"deepseek", "zhipu"}) {
            try {
                output.put(new JSONObject().put("provider", provider).put("httpstatus", JSONObject.NULL)
                        .put("safeerror", "PYTHON_INIT_FAILED"));
            } catch (Exception ignored) { /* Fixed JSON fields cannot fail. */ }
        }
        return output;
    }
}
