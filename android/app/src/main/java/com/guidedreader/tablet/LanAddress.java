package com.guidedreader.tablet;

import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.io.UnsupportedEncodingException;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/** A literal private IPv4 origin, never DNS, public URLs or embedded credentials. */
public final class LanAddress {
    public final String origin;
    public final String readerUrl;
    private final String scheme;
    private final String host;
    private final int port;

    private LanAddress(URI uri) {
        scheme = uri.getScheme().toLowerCase(Locale.ROOT);
        host = uri.getHost();
        port = uri.getPort() == -1 ? defaultPort(scheme) : uri.getPort();
        origin = scheme + "://" + host + (port == defaultPort(scheme) ? "" : ":" + port);
        readerUrl = origin + "/?tablet=1";
    }

    public static final class Launch {
        public final LanAddress address;
        public final String url;

        private Launch(LanAddress address, String url) {
            this.address = address;
            this.url = url;
        }
    }

    /** Used only for the user's freshly pasted full launch URL. Never persist url. */
    public static Launch launch(String input) {
        URI uri = parse(input);
        requireRoot(uri);
        String token = null;
        Set<String> keys = new HashSet<>();
        String query = uri.getRawQuery();
        if (query != null) {
            for (String pair : query.split("&", -1)) {
                String[] parts = pair.split("=", 2);
                String key = decode(parts[0]);
                if (!keys.add(key)) throw invalid("连接地址包含重复参数，请重新复制电脑上的完整地址。");
                String value = parts.length == 2 ? decode(parts[1]) : "";
                if ("token".equals(key)) token = value;
            }
        }
        if (token == null || token.isEmpty() || token.length() > 512
                || token.codePoints().anyMatch(Character::isWhitespace)
                || token.codePoints().anyMatch(Character::isISOControl)) {
            throw invalid("请粘贴电脑本次连接页里的完整地址，包含登录凭证。");
        }
        LanAddress address = new LanAddress(uri);
        String encoded;
        try { encoded = URLEncoder.encode(token, StandardCharsets.UTF_8.name()).replace("+", "%20"); }
        catch (UnsupportedEncodingException impossible) { throw new IllegalStateException("UTF-8 unavailable", impossible); }
        return new Launch(address, address.readerUrl + "&token=" + encoded);
    }

    /** The QR link wraps one complete LAN launch URL, decoded exactly once. */
    public static Launch deepLink(String input) {
        if (input == null || input.getBytes(StandardCharsets.UTF_8).length > 12 * 1024
                || input.codePoints().anyMatch(Character::isWhitespace)
                || input.codePoints().anyMatch(Character::isISOControl)) {
            throw invalid("扫码连接地址无效，请使用电脑本次连接页提供的二维码。");
        }
        try {
            URI uri = new URI(input);
            if (!"guidedreader".equalsIgnoreCase(uri.getScheme())
                    || !"connect".equalsIgnoreCase(uri.getHost())
                    || !"connect".equalsIgnoreCase(uri.getRawAuthority())
                    || uri.getRawUserInfo() != null || uri.getPort() != -1
                    || uri.getRawFragment() != null
                    || uri.getRawPath() != null && !uri.getRawPath().isEmpty()) {
                throw invalid("扫码连接地址无效，请使用电脑本次连接页提供的二维码。");
            }
            String query = uri.getRawQuery();
            if (query == null || query.indexOf('&') >= 0 || !query.startsWith("url=") || query.length() <= 4) {
                throw invalid("扫码连接地址必须包含一个完整的局域网连接地址。");
            }
            return launch(decode(query.substring(4)));
        } catch (URISyntaxException ignored) {
            throw invalid("扫码连接地址格式无效，请从电脑重新扫码。");
        }
    }

    /** Saved preferences contain only this canonical, token-free Reader URL. */
    public static LanAddress saved(String input) {
        URI uri = parse(input);
        requireRoot(uri);
        if (!"tablet=1".equals(uri.getRawQuery())) throw invalid("已保存的连接无效，请重新连接。");
        return new LanAddress(uri);
    }

    public boolean sameOrigin(String input) {
        try {
            URI uri = parse(input);
            int candidatePort = uri.getPort() == -1 ? defaultPort(uri.getScheme()) : uri.getPort();
            return scheme.equalsIgnoreCase(uri.getScheme()) && host.equals(uri.getHost()) && port == candidatePort;
        } catch (IllegalArgumentException ignored) {
            return false;
        }
    }

    public boolean isProbe(String input) {
        if (!sameOrigin(input)) return false;
        try { return "/tablet-pen-check.html".equals(new URI(input).getRawPath()); }
        catch (URISyntaxException ignored) { return false; }
    }

    private static URI parse(String input) {
        if (input == null || input.length() > 8192) throw invalid("连接地址无效。");
        String value = input.trim();
        if (value.codePoints().anyMatch(Character::isWhitespace)
                || value.codePoints().anyMatch(Character::isISOControl)) throw invalid("连接地址中不能包含空格或换行。");
        try {
            URI uri = new URI(value);
            String scheme = uri.getScheme();
            if (!("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))
                    || uri.getRawUserInfo() != null || uri.getRawFragment() != null
                    || uri.getHost() == null || !privateIpv4(uri.getHost())
                    || uri.getPort() == 0 || uri.getPort() > 65535 || uri.getPort() < -1
                    || uri.getRawAuthority() == null
                    || !uri.getRawAuthority().matches("[0-9.]+(?::[0-9]+)?")) {
                throw invalid("只支持电脑的局域网 IPv4 地址（10.x、172.16–31.x、192.168.x），使用 http 或 https。");
            }
            return uri;
        } catch (URISyntaxException ignored) {
            throw invalid("连接地址格式无效，请从电脑重新复制。");
        }
    }

    private static boolean privateIpv4(String host) {
        String[] parts = host.split("\\.", -1);
        if (parts.length != 4) return false;
        int[] bytes = new int[4];
        for (int index = 0; index < 4; index++) {
            if (parts[index].isEmpty() || parts[index].length() > 3
                    || parts[index].length() > 1 && parts[index].startsWith("0")) return false;
            for (int character = 0; character < parts[index].length(); character++) {
                if (!Character.isDigit(parts[index].charAt(character))) return false;
            }
            try { bytes[index] = Integer.parseInt(parts[index]); }
            catch (NumberFormatException ignored) { return false; }
            if (bytes[index] > 255) return false;
        }
        return bytes[0] == 10 || bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31
                || bytes[0] == 192 && bytes[1] == 168;
    }

    private static void requireRoot(URI uri) {
        if (!(uri.getRawPath() == null || uri.getRawPath().isEmpty() || "/".equals(uri.getRawPath()))) {
            throw invalid("请使用电脑连接页提供的 Reader 首页地址。");
        }
    }

    private static String decode(String value) {
        try { return URLDecoder.decode(value, StandardCharsets.UTF_8.name()); }
        catch (IllegalArgumentException | UnsupportedEncodingException ignored) { throw invalid("连接参数格式无效，请重新复制。"); }
    }

    private static int defaultPort(String scheme) { return "https".equalsIgnoreCase(scheme) ? 443 : 80; }
    private static IllegalArgumentException invalid(String message) { return new IllegalArgumentException(message); }
}
