export interface PasswordContext {
  username?: string;
  email?: string;
  name?: string;
}

export interface PasswordRuleItem {
  id: string;
  label: string;
  passed: boolean;
}

export interface PasswordValidationResult {
  valid: boolean;
  error?: string;
  score: number;
  strengthLabel: 'Sangat Lemah' | 'Lemah' | 'Sedang' | 'Kuat' | 'Sangat Kuat';
  rules: PasswordRuleItem[];
}

export const MIN_PASSWORD_LENGTH = 4;
export const MAX_PASSWORD_LENGTH = 8;

const COMMON_WEAK_PASSWORDS = new Set([
  '1234',
  '12345',
  '123456',
  '1234567',
  '12345678',
  '87654321',
  '0000',
  '000000',
  '00000000',
  'password',
  'qwerty',
  'qwertyui',
  'admin123',
  'abcdef',
  'abcdefgh',
  'letmein',
  'welcome'
]);

const WEAK_SUBSTRINGS = [
  '123456',
  '654321',
  'qwerty',
  'password',
  'asdfgh',
  'zxcvbn'
];

export function validateStrongPasswordClient(
  password: string,
  context?: PasswordContext
): PasswordValidationResult {
  const pwd = typeof password === 'string' ? password : '';
  const lower = pwd.toLowerCase();

  const hasValidLength = pwd.length >= MIN_PASSWORD_LENGTH && pwd.length <= MAX_PASSWORD_LENGTH;
  const hasNoSpaces = pwd.length > 0 && !/\s/.test(pwd);

  let notWeakOrCommon = pwd.length > 0 && !COMMON_WEAK_PASSWORDS.has(lower);
  if (notWeakOrCommon && pwd.length > 0) {
    for (const sub of WEAK_SUBSTRINGS) {
      if (lower.includes(sub)) {
        notWeakOrCommon = false;
        break;
      }
    }
    if (/(.)\1{3,}/.test(pwd)) {
      notWeakOrCommon = false;
    }
  }

  let notPersonalInfo = pwd.length > 0;
  if (context && pwd.length > 0) {
    const cleanUsername = context.username?.trim().toLowerCase() || '';
    const emailLocal = context.email?.includes('@')
      ? context.email.split('@')[0]?.trim().toLowerCase() || ''
      : '';
    if (cleanUsername.length >= 3 && lower === cleanUsername) {
      notPersonalInfo = false;
    }
    if (emailLocal.length >= 3 && lower === emailLocal) {
      notPersonalInfo = false;
    }
  }

  const rules: PasswordRuleItem[] = [
    {
      id: 'length',
      label: `Minimal ${MIN_PASSWORD_LENGTH} hingga maksimal ${MAX_PASSWORD_LENGTH} karakter`,
      passed: hasValidLength
    },
    {
      id: 'no_spaces',
      label: 'Tidak mengandung spasi',
      passed: hasNoSpaces
    },
    {
      id: 'no_common',
      label: 'Bukan sandi umum atau pengulangan karakter',
      passed: notWeakOrCommon
    },
    {
      id: 'no_identity',
      label: 'Tidak sama dengan username atau email akun',
      passed: notPersonalInfo
    }
  ];

  const passedCount = rules.filter(r => r.passed).length;
  let score = Math.round((passedCount / rules.length) * 75);
  if (hasValidLength && hasNoSpaces && notWeakOrCommon && notPersonalInfo) {
    if (pwd.length === MAX_PASSWORD_LENGTH) score += 25;
    else if (pwd.length >= 6) score += 18;
    else score += 10;
  }
  score = Math.min(100, Math.max(0, score));

  let strengthLabel: PasswordValidationResult['strengthLabel'] = 'Sangat Lemah';
  if (score >= 92 && rules.every(r => r.passed)) strengthLabel = 'Sangat Kuat';
  else if (score >= 75 && rules.every(r => r.passed)) strengthLabel = 'Kuat';
  else if (score >= 55) strengthLabel = 'Sedang';
  else if (score >= 30) strengthLabel = 'Lemah';

  let error: string | undefined;
  if (!pwd) {
    error = 'Kata sandi wajib diisi.';
  } else if (!hasNoSpaces) {
    error = 'Kata sandi tidak boleh mengandung spasi.';
  } else if (pwd.length < MIN_PASSWORD_LENGTH) {
    error = `Kata sandi minimal ${MIN_PASSWORD_LENGTH} karakter.`;
  } else if (pwd.length > MAX_PASSWORD_LENGTH) {
    error = `Kata sandi maksimal ${MAX_PASSWORD_LENGTH} karakter.`;
  } else if (!notWeakOrCommon) {
    error = 'Kata sandi terlalu umum atau mengandung pengulangan karakter yang mudah ditebak.';
  } else if (!notPersonalInfo) {
    error = 'Kata sandi tidak boleh sama dengan username atau nama akun email Anda.';
  }

  return {
    valid: !error,
    error,
    score,
    strengthLabel,
    rules
  };
}
