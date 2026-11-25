import React, { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  ClipboardList,
  Briefcase,
  FileText,
  Library,
  Users,
  CalendarCheck,
  GitBranch,
  GanttChartSquare,
  CalendarDays,
  Truck,
  Archive,
  BarChart3,
  UserCog,
  Settings,
  ShieldCheck,
  Bell,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import {
  ApiError,
  apiFetch,
  getLocalAuthToken,
  publicPostJson,
  restoreLocalSession,
  setLocalAuthToken,
} from './lib/api';
import type { AppRole, AppUser, NotificationItem } from './types/ankal';
import { AnkalLogo, formatDateTimeId } from './components/ui/Common';
import { LoginView } from './components/LoginView';
import { DashboardView } from './components/modules/DashboardView';
import { RequestsView } from './components/modules/RequestsView';
import { JobsView } from './components/modules/JobsView';
import { PersonnelView } from './components/modules/PersonnelView';
import { AvailabilityView } from './components/modules/AvailabilityView';
import { SchedulingView } from './components/modules/SchedulingView';
import { GanttView } from './components/modules/GanttView';
import { CalendarView } from './components/modules/CalendarView';
import { VehiclesView } from './components/modules/VehiclesView';
import { SpsDocumentsView } from './components/modules/SpsDocumentsView';
import { TemplatesAndImportView } from './components/modules/TemplatesAndImportView';
import { ArchiveView } from './components/modules/ArchiveView';
import { ReportsAuditView } from './components/modules/ReportsAuditView';
import { UsersSettingsView } from './components/modules/UsersSettingsView';

type NavKey =
  | 'dashboard'
  | 'requests'
  | 'jobs'
  | 'sps'
  | 'templates'
  | 'personnel'
  | 'availability'
  | 'scheduling'
  | 'gantt'
  | 'calendar'
  | 'vehicles'
  | 'archive'
  | 'reports'
  | 'users'
  | 'settings'
  | 'audit';

interface NavSection {
  title: string;
  items: Array<{
    key: NavKey;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    roles?: AppRole[];
  }>;
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Operasional Utama',
    items: [
      { key: 'dashboard', label: 'Dasbor', icon: LayoutDashboard, roles: ['SPV_SAMPLING', 'MANAGEMENT'] },
      { key: 'requests', label: 'Permintaan Sampling', icon: ClipboardList },
      { key: 'jobs', label: 'Manajemen Pekerjaan', icon: Briefcase },
    ],
  },
  {
    title: 'Personel & Jadwal',
    items: [
      { key: 'personnel', label: 'Manajemen Personel', icon: Users, roles: ['SPV_SAMPLING', 'MANAGEMENT'] },
      { key: 'availability', label: 'Ketersediaan Personel', icon: CalendarCheck, roles: ['SPV_SAMPLING', 'MANAGEMENT'] },
      { key: 'scheduling', label: 'Penjadwalan & Penugasan', icon: GitBranch, roles: ['SPV_SAMPLING', 'MANAGEMENT'] },
      { key: 'gantt', label: 'Gantt Chart', icon: GanttChartSquare },
      { key: 'calendar', label: 'Kalender Operasional', icon: CalendarDays, roles: ['SPV_SAMPLING', 'MANAGEMENT'] },
      { key: 'vehicles', label: 'Manajemen Kendaraan', icon: Truck, roles: ['SPV_SAMPLING', 'MANAGEMENT'] },
    ],
  },
  {
    title: 'Dokumen SPS',
    items: [
      { key: 'sps', label: 'Dokumen SPS', icon: FileText, roles: ['SPV_SAMPLING', 'MANAGEMENT'] },
      { key: 'templates', label: 'Template & Impor SPS', icon: Library, roles: ['SPV_SAMPLING', 'MANAGEMENT'] },
      { key: 'archive', label: 'Arsip Dokumen', icon: Archive, roles: ['SPV_SAMPLING', 'MANAGEMENT'] },
    ],
  },
  {
    title: 'Tata Kelola',
    items: [
      { key: 'reports', label: 'Laporan & Analitik', icon: BarChart3, roles: ['MANAGEMENT'] },
      { key: 'users', label: 'Manajemen Pengguna', icon: UserCog, roles: ['MANAGEMENT'] },
      { key: 'settings', label: 'Pengaturan Sistem', icon: Settings, roles: ['MANAGEMENT'] },
      { key: 'audit', label: 'Log Audit', icon: ShieldCheck, roles: ['MANAGEMENT'] },
    ],
  },
];

const ALL_NAV_ITEMS = NAV_SECTIONS.flatMap((s) => s.items);

function canAccessRoute(role: AppRole, route: string): boolean {
  const item = ALL_NAV_ITEMS.find((i) => i.key === route);
  if (!item) return false;
  return !item.roles || item.roles.includes(role);
}

function getDefaultRouteForRole(role: AppRole): NavKey {
  return role === 'KAE_SALES' ? 'requests' : 'dashboard';
}

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authErrorCode, setAuthErrorCode] = useState<string | null>(null);
  const [activeRoute, setActiveRoute] = useState<NavKey>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);

  const navigateSafe = (role: AppRole, target: string) => {
    if (canAccessRoute(role, target)) {
      setActiveRoute(target as NavKey);
    } else {
      setActiveRoute(getDefaultRouteForRole(role));
    }
  };

  const fetchProfileAndNotifications = async () => {
    try {
      const me = await apiFetch<{ user: AppUser }>('/api/me');
      setAppUser(me.user);
      setPendingEmail(null);
      setActiveRoute((prev) =>
        canAccessRoute(me.user.role, prev) ? prev : getDefaultRouteForRole(me.user.role)
      );
      const notifs = await apiFetch<NotificationItem[]>('/api/notifications');
      setNotifications(notifs);
      setAuthError(null);
      setAuthErrorCode(null);
    } catch (err: unknown) {
      setAppUser(null);
      setAuthError(err instanceof Error ? err.message : 'Gagal memverifikasi sesi pengguna.');
      setAuthErrorCode(err instanceof ApiError ? err.code || null : null);
    }
  };

  const handleSignOut = async () => {
    try {
      await publicPostJson('/api/auth/logout', {});
    } catch {
      // ignore logout error
    }
    setLocalAuthToken(null);
    setAppUser(null);
    setPendingEmail(null);
    setAuthError(null);
    setAuthErrorCode(null);
    setNotifications([]);
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const token = getLocalAuthToken() || (await restoreLocalSession());
        if (!mounted) return;
        if (token) {
          await fetchProfileAndNotifications();
        } else {
          setAppUser(null);
          setAuthError(null);
          setAuthErrorCode(null);
          setNotifications([]);
        }
      } finally {
        if (mounted) setAuthReady(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const refreshNotificationsOnly = async () => {
    if (!appUser) return;
    try {
      const notifs = await apiFetch<NotificationItem[]>('/api/notifications');
      setNotifications(notifs);
    } catch {
      // ignore transient notification polling failure
    }
  };

  const handleNotificationClick = async (n: NotificationItem) => {
    try {
      await apiFetch(`/api/notifications/${n.id}/read`, { method: 'POST' });
    } catch {
      // ignore
    }
    setNotifOpen(false);
    if (n.targetRoute && appUser) {
      navigateSafe(appUser.role, n.targetRoute);
    }
    await refreshNotificationsOnly();
  };

  const handleMarkAllRead = async () => {
    await apiFetch('/api/notifications/read-all', { method: 'POST' });
    await refreshNotificationsOnly();
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
        <div className="bg-white border border-slate-200 rounded-lg px-8 py-6 text-center space-y-2">
          <AnkalLogo />
          <p className="text-xs text-slate-500">Memuat sistem operasional PT ANKAL...</p>
        </div>
      </div>
    );
  }

  if (!appUser) {
    const blockedEmail = pendingEmail;
    if (
      blockedEmail &&
      (authErrorCode === 'REGISTRATION_PENDING' ||
        authErrorCode === 'REGISTRATION_REJECTED' ||
        authErrorCode === 'ACCOUNT_INACTIVE')
    ) {
      const isRejected = authErrorCode === 'REGISTRATION_REJECTED' || authErrorCode === 'ACCOUNT_INACTIVE';
      return (
        <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-lg p-7 shadow-sm space-y-4">
            <AnkalLogo />
            <div className="space-y-1.5">
              <h1 className="text-lg font-bold text-slate-900">
                {authErrorCode === 'REGISTRATION_REJECTED'
                  ? 'Registrasi Akun Ditolak'
                  : authErrorCode === 'ACCOUNT_INACTIVE'
                  ? 'Akun Dinonaktifkan'
                  : 'Menunggu Persetujuan Superadmin'}
              </h1>
              <p className="text-xs text-slate-600 leading-relaxed">
                Akun <span className="font-semibold text-slate-900">{blockedEmail}</span>{' '}
                {isRejected
                  ? 'tidak diizinkan mengakses sistem saat ini.'
                  : 'telah tercatat pada antrean registrasi PT ANKAL, namun belum disetujui oleh Superadmin.'}
              </p>
              {authError && (
                <div
                  className={`p-3 rounded text-xs border ${
                    isRejected
                      ? 'bg-red-50 border-red-200 text-red-700'
                      : 'bg-amber-50 border-amber-200 text-amber-800'
                  }`}
                >
                  {authError}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={handleSignOut}
                className="px-3.5 py-2 text-xs font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded-md cursor-pointer"
              >
                Kembali ke Halaman Login
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <>
        {authError && (
          <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-xs text-red-700 text-center">
            {authError}
          </div>
        )}
        <LoginView
          onLocalAuthenticated={fetchProfileAndNotifications}
          onPendingStatus={(email, code, message) => {
            setPendingEmail(email);
            setAuthErrorCode(code);
            setAuthError(message);
          }}
        />
      </>
    );
  }

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const renderSidebarContent = () => (
    <div className="flex flex-col h-full bg-white border-r border-slate-200">
      <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
        <AnkalLogo />
        <button
          type="button"
          onClick={() => setMobileMenuOpen(false)}
          aria-label="Tutup menu"
          className="lg:hidden p-1 text-slate-500 hover:bg-slate-100 rounded"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5" aria-label="Navigasi Utama">
        {NAV_SECTIONS.map((sec) => {
          const visibleItems = sec.items.filter(
            (item) => !item.roles || item.roles.includes(appUser.role)
          );
          if (visibleItems.length === 0) return null;
          return (
            <div key={sec.title}>
              <div className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {sec.title}
              </div>
              <div className="space-y-0.5">
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const active = activeRoute === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        setActiveRoute(item.key);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#f0fdf4] text-[#166534] font-semibold'
                          : 'text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-[#25AC43]' : 'text-slate-500'}`} />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="p-3 border-t border-slate-200 space-y-2">
        <div className="px-2 py-1.5">
          <div className="text-xs font-semibold text-slate-900 truncate">{appUser.fullName}</div>
          <div className="text-[11px] text-slate-500 truncate">{appUser.email}</div>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-red-50 hover:text-red-700 rounded-md transition-colors cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          <span>Keluar</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen">
        {renderSidebarContent()}
      </aside>

      {/* Mobile Drawer Sidebar */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-64 h-full">{renderSidebarContent()}</div>
          <div
            className="flex-1 bg-slate-900/40"
            onClick={() => setMobileMenuOpen(false)}
          />
        </div>
      )}

      {/* Main Content Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 h-14 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 no-print">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Buka menu navigasi"
              className="lg:hidden p-1.5 text-slate-600 hover:bg-slate-100 rounded"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-xs text-slate-500 hidden sm:block">
              PT Analitika Kalibrasi Laboratorium
              <span className="mx-2" aria-hidden="true">·</span>
              <span className="font-medium text-slate-800">
                {appUser.role === 'KAE_SALES'
                  ? 'Peran Aktif: KAE / Sales'
                  : appUser.role === 'SPV_SAMPLING'
                  ? 'Peran Aktif: SPV Sampling'
                  : 'Peran Aktif: Superadmin / Management'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Notification Bell */}
            <button
              type="button"
              onClick={() => setNotifOpen(true)}
              aria-label="Buka notifikasi operasional"
              className="relative p-2 text-slate-600 hover:bg-slate-100 rounded-md cursor-pointer"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[#25AC43] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                  {unreadCount}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Active Module Content */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto" key={activeRoute}>
          {(() => {
            const safeRoute = canAccessRoute(appUser.role, activeRoute)
              ? activeRoute
              : getDefaultRouteForRole(appUser.role);

            return (
              <>
                {safeRoute === 'dashboard' && (
                  <DashboardView
                    user={appUser}
                    onNavigate={(r) => navigateSafe(appUser.role, r)}
                    onNotificationsChanged={refreshNotificationsOnly}
                  />
                )}
                {safeRoute === 'requests' && (
                  <RequestsView
                    user={appUser}
                    onNavigate={(r) => navigateSafe(appUser.role, r)}
                    onChanged={refreshNotificationsOnly}
                  />
                )}
                {safeRoute === 'jobs' && (
                  <JobsView
                    user={appUser}
                    onNavigate={(r) => navigateSafe(appUser.role, r)}
                    onChanged={refreshNotificationsOnly}
                  />
                )}
                {safeRoute === 'personnel' && (
                  <PersonnelView user={appUser} onChanged={refreshNotificationsOnly} />
                )}
                {safeRoute === 'availability' && (
                  <AvailabilityView user={appUser} onChanged={refreshNotificationsOnly} />
                )}
                {safeRoute === 'scheduling' && (
                  <SchedulingView
                    user={appUser}
                    onNavigate={(r) => navigateSafe(appUser.role, r)}
                    onChanged={refreshNotificationsOnly}
                  />
                )}
                {safeRoute === 'gantt' && (
                  <GanttView user={appUser} onChanged={refreshNotificationsOnly} />
                )}
                {safeRoute === 'calendar' && <CalendarView />}
                {safeRoute === 'vehicles' && (
                  <VehiclesView user={appUser} onChanged={refreshNotificationsOnly} />
                )}
                {safeRoute === 'sps' && (
                  <SpsDocumentsView user={appUser} onChanged={refreshNotificationsOnly} />
                )}
                {safeRoute === 'templates' && (
                  <TemplatesAndImportView
                    user={appUser}
                    onNavigate={(r) => navigateSafe(appUser.role, r)}
                    onChanged={refreshNotificationsOnly}
                  />
                )}
                {safeRoute === 'archive' && (
                  <ArchiveView user={appUser} onChanged={refreshNotificationsOnly} />
                )}
                {safeRoute === 'reports' && <ReportsAuditView mode="reports" />}
                {safeRoute === 'audit' && <ReportsAuditView mode="audit" />}
                {safeRoute === 'users' && (
                  <UsersSettingsView mode="users" user={appUser} onChanged={fetchProfileAndNotifications} />
                )}
                {safeRoute === 'settings' && (
                  <UsersSettingsView mode="settings" user={appUser} onChanged={fetchProfileAndNotifications} />
                )}
              </>
            );
          })()}
        </main>
      </div>

      {/* Notification Slide-Over Drawer */}
      {notifOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" role="dialog" aria-modal="true" aria-label="Pusat Notifikasi">
          <div className="w-full max-w-md bg-white h-full border-l border-slate-200 flex flex-col shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Pusat Notifikasi Operasional</h2>
                <p className="text-xs text-slate-500 tabular-nums">{unreadCount} belum dibaca</p>
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    className="text-xs font-medium text-[#166534] hover:underline cursor-pointer"
                  >
                    Tandai Semua Dibaca
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setNotifOpen(false)}
                  aria-label="Tutup panel notifikasi"
                  className="p-1.5 text-slate-500 hover:bg-slate-100 rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {notifications.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  Belum ada notifikasi operasional.
                </div>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => handleNotificationClick(n)}
                    className={`w-full text-left px-5 py-3.5 hover:bg-slate-50 transition-colors cursor-pointer ${
                      !n.isRead ? 'bg-[#f0fdf4]/50' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                      <span className="font-mono font-semibold text-[#166534]">{n.recordNumber || n.eventType}</span>
                      <span className="tabular-nums">{formatDateTimeId(n.createdAt)}</span>
                    </div>
                    <div className="font-semibold text-xs text-slate-900 mt-1">{n.title}</div>
                    <div className="text-xs text-slate-600 mt-0.5">{n.description}</div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
