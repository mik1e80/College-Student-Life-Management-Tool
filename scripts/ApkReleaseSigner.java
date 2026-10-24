import com.android.apksig.ApkSigner;
import com.android.apksig.ApkVerifier;
import java.io.File;
import java.io.FileInputStream;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;

/** Signs with an existing local key; never emits or accepts passwords on argv. */
public final class ApkReleaseSigner {
    public static void main(String[] args) throws Exception {
        if (args.length != 4) throw new IllegalArgumentException("unsigned.apk signed.apk keystore.p12 alias");
        String password = System.getenv("YIRI_KEYSTORE_PASSWORD");
        if (password == null || password.isEmpty()) throw new IllegalStateException("Missing keystore password environment variable");
        char[] secret = password.toCharArray();
        KeyStore store = KeyStore.getInstance("PKCS12");
        try (FileInputStream in = new FileInputStream(args[2])) { store.load(in, secret); }
        PrivateKey key = (PrivateKey) store.getKey(args[3], secret);
        List<X509Certificate> certificates = new ArrayList<>();
        for (var cert : store.getCertificateChain(args[3])) certificates.add((X509Certificate) cert);
        var config = new ApkSigner.SignerConfig.Builder(args[3], key, certificates).build();
        new ApkSigner.Builder(List.of(config))
            .setInputApk(new File(args[0])).setOutputApk(new File(args[1]))
            .setMinSdkVersion(26).setV1SigningEnabled(true).setV2SigningEnabled(true)
            .setV3SigningEnabled(true).setV4SigningEnabled(false).build().sign();
        var verified = new ApkVerifier.Builder(new File(args[1])).setMinCheckedPlatformVersion(26).build().verify();
        if (!verified.isVerified() || !verified.isVerifiedUsingV2Scheme()) {
            throw new IllegalStateException("APK signature verification failed: " + verified.getAllErrors());
        }
        String fingerprint = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(certificates.get(0).getEncoded()));
        System.out.println("{\"verified\":true,\"v1\":" + verified.isVerifiedUsingV1Scheme()
            + ",\"v2\":" + verified.isVerifiedUsingV2Scheme() + ",\"v3\":" + verified.isVerifiedUsingV3Scheme()
            + ",\"certificateSha256\":\"" + fingerprint + "\"}");
        java.util.Arrays.fill(secret, '\0');
    }
}
