import React, { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { ArrowRight, Lock, Mail, User } from 'lucide-react';
import { auth, googleAuthProvider } from '../lib/firebase';
import { ApiError, publicPostJson, setLocalAuthToken } from '../lib/api';
import { AnkalLogo } from './ui/Common';

interface LocalAuthResponse {
  status?: 'APPROVED' | 'PENDING';
  token?: string;
  code?: string;
  email?: string;
  message?: string;
}

export function LoginView({
  onLocalAuthenticated,
  onPendingStatus,
}: {
  onLocalAuthenticated: () => Promise<void>;
  onPendingStatus: (email: string, code: string, message: string) => void;
}) {
  const [authTab, setAuthTab] = useState<'LOGIN' | 'REGISTER'>('LOGIN');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    setGoogleLoading(true);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Gagal masuk dengan akun Google. Pastikan pop-up diizinkan pada browser.';
      setErrorMsg(message);
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);

    if (authTab === 'REGISTER') {
      if (password.length < 8) {
        setErrorMsg('Kata sandi minimal 8 karakter.');
        return;
      }
      if (password !== confirmPassword) {
        setErrorMsg('Konfirmasi kata sandi tidak cocok.');
        return;
      }
    }

    setLoading(true);
    try {
      if (authTab === 'LOGIN') {
        const res = await publicPostJson<LocalAuthResponse>('/api/auth/login', {
          email,
          password,
        });
        if (res.token) {
          setLocalAuthToken(res.token);
          await onLocalAuthenticated();
        }
      } else {
        const res = await publicPostJson<LocalAuthResponse>('/api/auth/register', {
          fullName,
          email,
          password,
        });
        if (res.status === 'APPROVED' && res.token) {
          setLocalAuthToken(res.token);
          await onLocalAuthenticated();
        } else {
          onPendingStatus(
            res.email || email.trim().toLowerCase(),
            res.code || 'REGISTRATION_PENDING',
            res.message ||
              'Registrasi akun Anda sedang menunggu persetujuan Superadmin sebelum dapat masuk ke sistem.'
          );
        }
      }
    } catch (err: unknown) {
      if (
        err instanceof ApiError &&
        (err.code === 'REGISTRATION_PENDING' ||
          err.code === 'REGISTRATION_REJECTED' ||
          err.code === 'ACCOUNT_INACTIVE')
      ) {
        onPendingStatus(err.email || email.trim().toLowerCase(), err.code, err.message);
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Gagal memproses autentikasi.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center py-10 px-4 sm:px-6">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-3">
          <div className="flex justify-center">
            <AnkalLogo />
          </div>
          <h1 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight leading-snug">
            Sistem Manajemen Operasional Lapangan &amp; Otomasi SPS Terpusat{' '}
            <span className="whitespace-nowrap">(ANKAL-FO-7.1-01)</span>
          </h1>
          <p className="text-xs text-slate-500">
            PT Analitika Kalibrasi Laboratorium
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-6 sm:p-7 shadow-sm space-y-5">
          {/* Tab Switcher: Masuk / Daftar */}
          <div className="grid grid-cols-2 border border-slate-200 rounded-md p-0.5 bg-slate-50 text-xs font-medium">
            <button
              type="button"
              onClick={() => {
                setAuthTab('LOGIN');
                setErrorMsg(null);
                setInfoMsg(null);
              }}
              className={`py-2 rounded transition-colors cursor-pointer ${
                authTab === 'LOGIN'
                  ? 'bg-white text-slate-900 shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Masuk
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthTab('REGISTER');
                setErrorMsg(null);
                setInfoMsg(null);
              }}
              className={`py-2 rounded transition-colors cursor-pointer ${
                authTab === 'REGISTER'
                  ? 'bg-white text-slate-900 shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Daftar Akun Baru
            </button>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">
              {errorMsg}
            </div>
          )}

          {infoMsg && (
            <div className="p-3 rounded-md bg-emerald-50 border border-emerald-200 text-xs text-emerald-700">
              {infoMsg}
            </div>
          )}

          <form onSubmit={handleEmailSubmit} className="space-y-3.5">
            {authTab === 'REGISTER' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="auth-fullname">
                  Nama Lengkap
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    id="auth-fullname"
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Nama lengkap personel"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#25AC43]/30 focus:border-[#25AC43]"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="auth-email">
                Email Perusahaan / Domain Sendiri
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  id="auth-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nama@domainperusahaan.co.id"
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#25AC43]/30 focus:border-[#25AC43]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="auth-password">
                Kata Sandi
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  id="auth-password"
                  type="password"
                  required
                  minLength={authTab === 'REGISTER' ? 8 : 1}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={authTab === 'REGISTER' ? 'Minimal 8 karakter' : 'Masukkan kata sandi'}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#25AC43]/30 focus:border-[#25AC43]"
                />
              </div>
            </div>

            {authTab === 'REGISTER' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="auth-confirm-password">
                  Konfirmasi Kata Sandi
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    id="auth-confirm-password"
                    type="password"
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Ulangi kata sandi"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#25AC43]/30 focus:border-[#25AC43]"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || googleLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[#25AC43] hover:bg-[#1e8e36] disabled:opacity-60 text-white font-semibold text-sm rounded-md transition-colors cursor-pointer"
            >
              <span>
                {loading
                  ? 'Memproses...'
                  : authTab === 'LOGIN'
                  ? 'Masuk dengan Email'
                  : 'Daftar & Ajukan Persetujuan'}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <div className="relative flex items-center py-1">
            <div className="flex-grow border-t border-slate-200" />
            <span className="shrink mx-3 text-[11px] uppercase tracking-wider text-slate-400">atau</span>
            <div className="flex-grow border-t border-slate-200" />
          </div>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading || googleLoading}
            className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 bg-white hover:bg-slate-50 border border-slate-300 disabled:opacity-60 text-slate-800 font-semibold text-sm rounded-md transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
              />
            </svg>
            <span>{googleLoading ? 'Menghubungkan ke Google...' : 'Masuk dengan Akun Google'}</span>
          </button>

          <p className="text-[11px] text-slate-500 text-center leading-relaxed pt-1">
            Setiap pendaftaran akun baru (Google maupun email perusahaan) memerlukan persetujuan Superadmin sebelum dapat mengakses sistem.
          </p>
        </div>
      </div>
    </div>
  );
}

