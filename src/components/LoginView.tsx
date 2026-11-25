import React, { useState } from 'react';
import { ArrowRight, Lock, Mail, User } from 'lucide-react';
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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

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
      } else if (err instanceof ApiError && err.code === 'PASSWORD_NOT_SET') {
        setAuthTab('REGISTER');
        setInfoMsg(err.message);
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
              Daftar / Aktivasi Akun
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
                Email Perusahaan
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  id="auth-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nama@perusahaan.co.id"
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
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[#25AC43] hover:bg-[#1e8e36] disabled:opacity-60 text-white font-semibold text-sm rounded-md transition-colors cursor-pointer"
            >
              <span>
                {loading
                  ? 'Memproses...'
                  : authTab === 'LOGIN'
                  ? 'Masuk ke Sistem'
                  : 'Daftar & Ajukan Persetujuan'}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <p className="text-[11px] text-slate-500 text-center leading-relaxed pt-1">
            Data akun disimpan secara internal di database sistem. Setiap pendaftaran akun baru memerlukan persetujuan Superadmin sebelum dapat masuk.
          </p>
        </div>
      </div>
    </div>
  );
}
