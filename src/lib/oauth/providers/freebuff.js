const freebuff = {
  config: { baseUrl: "https://www.codebuff.com" },
  flowType: "device_code",
  requestDeviceCode: async (config) => {
    const { requestFreebuffDeviceCode } = await import("@/lib/oauth/services/freebuff");
    const data = await requestFreebuffDeviceCode({ baseUrl: config.baseUrl });
    return {
      device_code: data.fingerprintId,
      user_code: data.fingerprintId.slice(0, 8).toUpperCase(),
      verification_uri: `${config.baseUrl}/login?auth_code=${encodeURIComponent(data.authCode)}`,
      verification_uri_complete: `${config.baseUrl}/login?auth_code=${encodeURIComponent(data.authCode)}`,
      expires_in: 300,
      interval: 2,
      _freebuffFingerprint: data,
      _freebuffAuthCode: data.authCode,
    };
  },
  pollToken: async (config, deviceCode, codeVerifier, extraData) => {
    const { pollFreebuffToken } = await import("@/lib/oauth/services/freebuff");
    const fingerprint = extraData?._freebuffFingerprint;
    if (!fingerprint) {
      return { ok: false, data: { error: "missing_fingerprint", error_description: "Missing device fingerprint" } };
    }
    try {
      const result = await pollFreebuffToken(fingerprint, { baseUrl: config.baseUrl });
      return {
        ok: true,
        data: {
          access_token: result.token,
          _freebuffEmail: result.email,
          _freebuffUserId: result.userId,
        },
      };
    } catch (error) {
      return { ok: false, data: { error: "poll_failed", error_description: error.message } };
    }
  },
  mapTokens: (tokens) => ({
    accessToken: tokens.access_token,
    refreshToken: null,
    expiresIn: null,
    email: tokens._freebuffEmail || null,
    providerSpecificData: {
      authMethod: "device_code_google_sso",
      userId: tokens._freebuffUserId || null,
    },
  }),
};

export default freebuff;
