let localSessionToken: string | null = null;

export function setLocalAuthToken(token: string | null) {
  localSessionToken = token;
}

export function getLocalAuthToken(): string | null {
  return localSessionToken;
}

export async function getAuthToken(): Promise<string> {
  if (localSessionToken) {
    return localSessionToken;
  }
  throw new Error('Pengguna belum masuk.');
}

export async function restoreLocalSession(): Promise<string | null> {
  try {
    const res = await fetch('/api/auth/session', {
      method: 'GET',
      credentials: 'include',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.authenticated && typeof data.token === 'string') {
      localSessionToken = data.token;
      return data.token;
    }
    localSessionToken = null;
    return null;
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  status: number;
  code?: string;
  email?: string;
  constructor(message: string, status: number, code?: string, email?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.email = email;
  }
}

export async function publicPostJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let errMsg = `Permintaan gagal (${res.status})`;
    let errCode: string | undefined;
    let errEmail: string | undefined;
    try {
      const payload = await res.json();
      if (payload?.error) errMsg = payload.error;
      if (payload?.code) errCode = payload.code;
      if (payload?.email) errEmail = payload.email;
    } catch {
      // ignore non-json error body
    }
    throw new ApiError(errMsg, res.status, errCode, errEmail);
  }

  return res.json() as Promise<T>;
}

export async function apiFetch<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getAuthToken();
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('X-Requested-With', 'XMLHttpRequest');
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers,
  });

  if (!res.ok) {
    let errMsg = `Permintaan gagal (${res.status})`;
    let errCode: string | undefined;
    let errEmail: string | undefined;
    try {
      const payload = await res.json();
      if (payload?.error) errMsg = payload.error;
      if (payload?.code) errCode = payload.code;
      if (payload?.email) errEmail = payload.email;
    } catch {
      // ignore non-json error body
    }
    if (res.status === 401) {
      localSessionToken = null;
    }
    throw new ApiError(errMsg, res.status, errCode, errEmail);
  }

  return res.json() as Promise<T>;
}

export async function openAuthenticatedPdf(url: string, download = false) {
  const token = await getAuthToken();
  const sep = url.includes('?') ? '&' : '?';
  const fullUrl = download ? `${url}${sep}download=1` : url;
  const res = await fetch(fullUrl, {
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
  if (!res.ok) {
    throw new Error('Gagal mengunduh dokumen PDF.');
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  if (download) {
    link.download = 'ANKAL_SPS_Document.pdf';
  } else {
    link.target = '_blank';
  }
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 15000);
}

