const CREDENTIAL_KEY = 'webauthn_credential_id';
const ENABLED_KEY = 'biometric_enabled';

export const isWebAuthnSupported = (): boolean => {
  return typeof window !== 'undefined'
    && !!window.PublicKeyCredential
    && !!navigator.credentials;
};

export const isBiometricEnabled = (): boolean => {
  return localStorage.getItem(ENABLED_KEY) === 'true';
};

export const registerBiometric = async (userId: string): Promise<void> => {
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: '커플 가계부', id: window.location.hostname },
      user: {
        id: new TextEncoder().encode(userId),
        name: userId,
        displayName: '커플 가계부',
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' },
        { alg: -257, type: 'public-key' },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60000,
    },
  }) as PublicKeyCredential | null;

  if (!credential) throw new Error('지문 등록에 실패했습니다.');

  const rawId = new Uint8Array(credential.rawId);
  const credId = btoa(String.fromCharCode(...rawId));
  localStorage.setItem(CREDENTIAL_KEY, credId);
  localStorage.setItem(ENABLED_KEY, 'true');
};

export const authenticateWithBiometric = async (): Promise<boolean> => {
  const credIdBase64 = localStorage.getItem(CREDENTIAL_KEY);
  if (!credIdBase64) return false;

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const credId = Uint8Array.from(atob(credIdBase64), (c) => c.charCodeAt(0));

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [{ id: credId, type: 'public-key' }],
      userVerification: 'required',
      timeout: 60000,
    },
  });

  return !!assertion;
};

export const disableBiometric = (): void => {
  localStorage.removeItem(CREDENTIAL_KEY);
  localStorage.removeItem(ENABLED_KEY);
};

export const markSessionUnlocked = (): void => {
  sessionStorage.setItem('biometric_unlocked', 'true');
};

export const isSessionUnlocked = (): boolean => {
  return sessionStorage.getItem('biometric_unlocked') === 'true';
};
