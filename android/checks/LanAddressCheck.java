package com.guidedreader.tablet;

import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/** Plain-Java check: no Android device, service, real token or library required. */
public final class LanAddressCheck {
    private static int checks;
    public static void main(String[] args) {
        LanAddress.Launch launch=LanAddress.launch("http://192.168.1.8:8876/?token=sample&tablet=1");
        check("http://192.168.1.8:8876/?tablet=1".equals(launch.address.readerUrl));
        check(launch.url.endsWith("&token=sample"));
        check(launch.address.sameOrigin("http://192.168.1.8:8876/tablet-pen-check.html"));
        check(!launch.address.sameOrigin("http://192.168.1.8:8877/"));
        check(!launch.address.sameOrigin("https://192.168.1.8:8876/"));
        check(launch.address.isProbe("http://192.168.1.8:8876/tablet-pen-check.html"));
        check(!launch.address.isProbe("http://192.168.1.8:8876/tablet-pen-check.html/extra"));
        check(LanAddress.launch("https://10.1.2.3:443/?token=sample").address.origin.equals("https://10.1.2.3"));
        check(LanAddress.launch("http://172.16.0.1/?token=sample").address.origin.equals("http://172.16.0.1"));
        check(LanAddress.launch("http://172.31.255.254/?token=sample").address.origin.equals("http://172.31.255.254"));
        String[] rejected={"http://8.8.8.8/?token=x","http://127.0.0.1/?token=x","http://localhost/?token=x",
                "http://172.15.1.1/?token=x","http://172.32.1.1/?token=x","http://192.169.1.1/?token=x",
                "http://010.1.2.3/?token=x","http://10.1.2.300/?token=x","http://10.1.2.3.evil/?token=x",
                "http://[fd00::1]/?token=x","file:///tmp/pdf","javascript:alert(1)","content://documents/pdf",
                "http://user@192.168.1.2/?token=x","http://10.1.2.3@192.168.1.2/?token=x",
                "http://192.168.1.2:0/?token=x","http://192.168.1.2:65536/?token=x","http://192.168.1.2:/?token=x",
                "http://192.168.1.2/?token=x#","http://192.168.1.2/?token=x&token=y",
                "http://192.168.1.2/?token=x&to%6Ben=y","http://192.168.1.2/?token=x%0Ay",
                "http://192.168.1.2/?token=","http://192.168.1.2/?tablet=1",
                "http://192.168.1.2/tablet-pen-check.html?token=x"};
        for(String value:rejected) {
            try {LanAddress.launch(value);throw new AssertionError("invalid address accepted");}
            catch(IllegalArgumentException expected){checks++;}
        }
        check(LanAddress.saved(launch.address.readerUrl).readerUrl.equals(launch.address.readerUrl));
        try {LanAddress.saved(launch.url);throw new AssertionError("token persisted");}
        catch(IllegalArgumentException expected){checks++;}
        String wrapped=deepLink("http://192.168.1.8:8876/?token=sample&tablet=1");
        check(LanAddress.deepLink(wrapped).url.equals(launch.url));
        check(LanAddress.deepLink(wrapped).address.readerUrl.equals(launch.address.readerUrl));
        check(LanAddress.deepLink(deepLink("https://10.1.2.3/?token=a%2Bb%2Fc")).url
                .equals("https://10.1.2.3/?tablet=1&token=a%2Bb%2Fc"));
        check(LanAddress.deepLink(deepLink("http://172.20.1.5/?token=a%252Fb")).url
                .equals("http://172.20.1.5/?tablet=1&token=a%252Fb"));
        String[] rejectedLinks={null,"",wrapped.replace("guidedreader:","http:"),
                wrapped.replace("//connect?","//other?"),wrapped.replace("//connect?","//user@connect?"),
                wrapped.replace("//connect?","//connect:80?"),wrapped.replace("//connect?","//connect:/?"),
                wrapped.replace("//connect?","//connect/?"),wrapped.replace("//connect?","//connect/path?"),
                wrapped+"#",wrapped+"#fragment", "guidedreader://connect", "guidedreader://connect?url=",
                wrapped+"&url=other", wrapped+"&extra=1", wrapped.replace("?url=","?ur%6C="),
                "guidedreader://connect?url=%zz",deepLink("http://8.8.8.8/?token=x"),
                deepLink("http://127.0.0.1/?token=x"),deepLink("http://192.168.1.8/?token=x#fragment"),
                deepLink("http://192.168.1.8/?token=x&token=y"),deepLink("http://192.168.1.8/?tablet=1"),
                deepLink("http://192.168.1.8/tablet-pen-check.html?token=x"),
                "guidedreader://connect?url=http%253A%252F%252F192.168.1.8%252F%253Ftoken%253Dx",
                wrapped+" ","guidedreader://connect?url="+repeat("a",12*1024),
                "guidedreader://connect?url="+repeat("\u4e2d",4200)};
        for(String value:rejectedLinks) {
            try {LanAddress.deepLink(value);throw new AssertionError("invalid deep link accepted");}
            catch(IllegalArgumentException expected){checks++;}
        }
        System.out.println("LAN address checks passed: "+checks);
    }
    private static String deepLink(String url) {
        try {return "guidedreader://connect?url="+URLEncoder.encode(url,StandardCharsets.UTF_8.name());}
        catch(UnsupportedEncodingException impossible){throw new AssertionError(impossible);}
    }
    private static String repeat(String value,int count) {StringBuilder result=new StringBuilder();for(int index=0;index<count;index++)result.append(value);return result.toString();}
    private static void check(boolean value) {if(!value)throw new AssertionError("address boundary failed");checks++;}
}
