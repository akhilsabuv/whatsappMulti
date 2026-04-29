'use client';

import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { confirmAction } from '../lib/alerts';
import { csrfHeaders } from '../lib/csrf';
import type { DashboardView } from '../lib/dashboard-views';
import { DASHBOARD_VIEWS } from '../lib/dashboard-views';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || undefined;
const eventPageSize = 5;
const eventHistoryLimit = 80;

type SystemMetrics = {
  loadavg: [number, number, number];
  freemem: number;
  totalmem: number;
  cpus: number;
};

type DockerContainer = {
  Id: string;
  Names: string[];
  State: string;
  Status: string;
};

type DashboardSummary = {
  admins: number;
  apiUsers: number;
  sessions: number;
  connectedCount: number;
  disconnectedCount: number;
  qrPendingCount: number;
  queuedMessagesToday: number;
  sentMessagesToday: number;
  receivedMessagesToday: number;
  failedToday: number;
  recentConnectionEvents?: Array<{ eventType: string; payloadJson: any }>;
  systemHealth?: {
    backend: SystemMetrics;
    worker?: SystemMetrics | null;
  };
  containers?: DockerContainer[];
};

type ManagedUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive?: boolean;
  owner?: {
    id: string;
    name: string;
    email: string;
  } | null;
  portalShareUrl?: string | null;
  sessions: Array<{ id: string; label: string; status: string }>;
  apiKeys: Array<{ id: string; name: string; isActive: boolean; createdAt?: string; lastUsedAt?: string | null }>;
};

type GeneratedKeyCard = {
  userId: string;
  userName: string;
  userEmail: string;
  keyId: string;
  keyName: string;
  rawKey: string;
  swaggerUrl: string;
};

type CreateUserRole = 'API_USER' | 'ADMIN';
type AdminApiLanguage = 'curl' | 'javascript' | 'python' | 'php';

const adminApiLanguages: AdminApiLanguage[] = ['curl', 'javascript', 'python', 'php'];
const adminApiLanguageLabels: Record<AdminApiLanguage, string> = {
  curl: 'cURL',
  javascript: 'JavaScript',
  python: 'Python',
  php: 'PHP',
};

function buildCreateApiUserExamples(apiBaseUrl: string): Record<AdminApiLanguage, string> {
  const loginEndpoint = `${apiBaseUrl}/auth/login`;
  const createUserEndpoint = `${apiBaseUrl}/admin/api-users`;

  return {
    curl: `curl -X POST '${loginEndpoint}' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "email": "admin@example.com",
    "password": "admin-password"
  }'

curl -X POST '${createUserEndpoint}' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer ADMIN_ACCESS_TOKEN' \\
  -d '{
    "name": "Customer Support Bot",
    "email": "support-api@example.com"
  }'`,
    javascript: `const loginResponse = await fetch('${loginEndpoint}', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    email: 'admin@example.com',
    password: 'admin-password',
  }),
});

const { accessToken } = await loginResponse.json();

const response = await fetch('${createUserEndpoint}', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: \`Bearer \${accessToken}\`,
  },
  body: JSON.stringify({
    name: 'Customer Support Bot',
    email: 'support-api@example.com',
  }),
});

const data = await response.json();
console.log(data.apiKey.rawKey);`,
    python: `import requests

login_response = requests.post(
    '${loginEndpoint}',
    json={
        'email': 'admin@example.com',
        'password': 'admin-password',
    },
)

access_token = login_response.json()['accessToken']

response = requests.post(
    '${createUserEndpoint}',
    headers={
        'Authorization': f'Bearer {access_token}',
    },
    json={
        'name': 'Customer Support Bot',
        'email': 'support-api@example.com',
    },
)

print(response.json()['apiKey']['rawKey'])`,
    php: `<?php

$loginPayload = json_encode([
    'email' => 'admin@example.com',
    'password' => 'admin-password',
]);

$loginResponse = file_get_contents('${loginEndpoint}', false, stream_context_create([
    'http' => [
        'method' => 'POST',
        'header' => [
            'Content-Type: application/json',
        ],
        'content' => $loginPayload,
    ],
]));

$accessToken = json_decode($loginResponse, true)['accessToken'];

$payload = json_encode([
    'name' => 'Customer Support Bot',
    'email' => 'support-api@example.com',
]);

$response = file_get_contents('${createUserEndpoint}', false, stream_context_create([
    'http' => [
        'method' => 'POST',
        'header' => [
            'Content-Type: application/json',
            'Authorization: Bearer ' . $accessToken,
        ],
        'content' => $payload,
    ],
]));

echo $response;`,
  };
}

async function fetchJson(path: string, _token?: string) {
  const response = await fetch(`${apiUrl}${path}`, {
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${path}`);
  }
  return response.json();
}

async function deleteJson(path: string, _token?: string) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: csrfHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${path}`);
  }
  return response.json();
}

async function patchJson(path: string, _token: string | undefined, body: unknown) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      ...csrfHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${path}`);
  }
  return response.json();
}

function getSummaryPath(role: string) {
  return role === 'SUPERADMIN' ? '/superadmin/dashboard/summary' : '/admin/dashboard/summary';
}

function getUsersPath(role: string) {
  return role === 'SUPERADMIN' ? '/superadmin/users' : '/admin/users';
}

function CopyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-2">
      <rect x="9" y="9" width="10" height="10" rx="2" />
      <path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2">
      <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="9.5" cy="7" r="4" />
      <path d="M20 8v6" />
      <path d="M17 11h6" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2">
      <circle cx="8" cy="15" r="4" />
      <path d="M12 15h9" />
      <path d="M18 12v6" />
      <path d="M21 13v4" />
    </svg>
  );
}

function PulseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2">
      <path d="M3 12h4l3-7 4 14 3-7h4" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2">
      <path d="M12 3 5 6v5c0 5 3.5 8.5 7 10 3.5-1.5 7-5 7-10V6l-7-3Z" />
      <path d="m9.5 12 1.8 1.8 3.2-3.6" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-current">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2">
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function QrCodeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <path d="M14 14h1v1h-1z" />
      <path d="M17 14h4v7h-4z" />
      <path d="M14 17h1v4h-1z" />
    </svg>
  );
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' | 'up' | 'down' }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-2">
      {direction === 'left' ? <path d="m15 18-6-6 6-6" /> : null}
      {direction === 'right' ? <path d="m9 18 6-6-6-6" /> : null}
      {direction === 'up' ? <path d="m18 15-6-6-6 6" /> : null}
      {direction === 'down' ? <path d="m6 9 6 6 6-6" /> : null}
    </svg>
  );
}

function EventPagination({
  currentPage,
  totalPages,
  totalItems,
  startItem,
  endItem,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  startItem: number;
  endItem: number;
  onPageChange: (page: number) => void;
}) {
  if (totalItems <= eventPageSize) {
    return null;
  }

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-xs text-slate">
      <span>
        Showing {startItem}-{endItem} of {totalItems}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-white text-ink transition hover:border-signal hover:text-signal disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink"
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          aria-label="Previous activity page"
        >
          <ChevronIcon direction="left" />
        </button>
        <span className="min-w-[72px] text-center font-medium text-ink">
          {currentPage} / {totalPages}
        </span>
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-white text-ink transition hover:border-signal hover:text-signal disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink"
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          aria-label="Next activity page"
        >
          <ChevronIcon direction="right" />
        </button>
      </div>
    </div>
  );
}

function EventCard({
  event,
  eventKey,
  expanded,
  onToggle,
}: {
  event: string;
  eventKey: string;
  expanded: boolean;
  onToggle: (eventKey: string) => void;
}) {
  const [eventName, ...payloadParts] = event.split(': ');
  const payload = payloadParts.join(': ');
  const canExpand = event.length > 140;

  return (
    <article className="max-w-full rounded-[22px] border border-line bg-cloud px-4 py-3 text-sm leading-6 text-slate">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-ink">{payload ? `${eventName}:` : event}</p>
          {payload ? (
            <p
              className={`mt-1 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${
                expanded || !canExpand ? '' : 'max-h-[52px] overflow-hidden'
              }`}
            >
              {payload}
            </p>
          ) : null}
        </div>
        {canExpand ? (
          <button
            type="button"
            className="flex h-9 shrink-0 items-center gap-1 rounded-full border border-line bg-white px-3 text-xs font-semibold text-ink transition hover:border-signal hover:text-signal"
            onClick={() => onToggle(eventKey)}
            aria-expanded={expanded}
          >
            {expanded ? 'Collapse' : 'Expand'}
            <ChevronIcon direction={expanded ? 'up' : 'down'} />
          </button>
        ) : null}
      </div>
    </article>
  );
}

function MetricCard({ label, value, tone, icon }: { label: string; value: string; tone: 'blue' | 'green' | 'amber' | 'slate'; icon?: JSX.Element }) {
  const toneMap = {
    blue: 'bg-signal/12 text-signal',
    green: 'bg-warm/12 text-warm',
    amber: 'bg-amber-100 text-amber-700',
    slate: 'bg-cloud text-slate',
  } as const;

  const bgGradient = {
    blue: 'from-signal/5 to-transparent',
    green: 'from-warm/5 to-transparent',
    amber: 'from-amber-100/50 to-transparent',
    slate: 'from-slate-100 to-transparent',
  } as const;

  return (
    <article className={`group relative overflow-hidden rounded-[28px] border border-line bg-gradient-to-br ${bgGradient[tone]} bg-white p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-slate-200/50`}>
      <div className="relative z-10 flex items-center justify-between gap-3">
        <p className="text-sm font-medium uppercase tracking-wider text-slate/80">{label}</p>
        <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${toneMap[tone]} shadow-sm transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6`}>
          {icon}
        </span>
      </div>
      <p className="relative z-10 mt-6 text-4xl font-bold tracking-tight text-ink">{value}</p>
      <div className={`absolute -right-6 -top-6 h-32 w-32 rounded-full opacity-20 blur-3xl transition-all duration-500 group-hover:scale-150 group-hover:opacity-40 ${toneMap[tone].split(' ')[0]}`} />
    </article>
  );
}

export function formatRoleLabel(role: string) {
  if (role === 'SUPERADMIN') {
    return 'Superadmin';
  }
  if (role === 'API_USER') {
    return 'API User';
  }
  return 'Admin';
}

export function DashboardClient({ initialView = 'overview' }: { initialView?: DashboardView }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<{ name: string; role: string } | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [eventPage, setEventPage] = useState(1);
  const [expandedEventIds, setExpandedEventIds] = useState<Set<string>>(new Set());
  const [currentView, setCurrentView] = useState<DashboardView>(initialView);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [generatedKeys, setGeneratedKeys] = useState<GeneratedKeyCard[]>([]);
  const [selectedAdminApiLanguage, setSelectedAdminApiLanguage] = useState<AdminApiLanguage>('curl');
  const [passwordState, setPasswordState] = useState({
    currentPassword: '',
    newPassword: '',
  });
  const [changingPassword, setChangingPassword] = useState(false);
  const [createState, setCreateState] = useState({
    role: 'API_USER' as CreateUserRole,
    name: '',
    email: '',
    password: '',
    apiKeyName: '',
    sessionLabel: '',
  });

  useEffect(() => {
    fetchJson('/auth/me')
      .then((currentUser) => {
        setToken('cookie');
        setUser(currentUser);
      })
      .catch(() => {
        window.location.href = '/';
      });
  }, []);

  useEffect(() => {
    setCurrentView(initialView);
    if (initialView !== 'users') {
      setSearchTerm('');
    }
  }, [initialView]);

  useEffect(() => {
    setEventPage(1);
    setExpandedEventIds(new Set());
  }, [searchTerm, currentView]);

  useEffect(() => {
    if (user && user.role !== 'SUPERADMIN' && currentView === 'sessions') {
      setCurrentView('overview');
      router.replace('/dashboard/overview');
    }
  }, [currentView, router, user]);

  useEffect(() => {
    if (!token || !user) {
      return;
    }

    const summaryPath = getSummaryPath(user.role);
    Promise.all([fetchJson(summaryPath, token), fetchJson(getUsersPath(user.role), token)])
      .then(([summaryData, usersData]) => {
        setSummary(summaryData);
        setUsers(usersData);
        setEvents((current) => {
          if (current.length === 0 && summaryData?.recentConnectionEvents?.length > 0) {
            return summaryData.recentConnectionEvents
              .map((log: any) => `${log.eventType}: ${JSON.stringify(log.payloadJson)}`)
              .slice(0, eventHistoryLimit);
          }
          return current;
        });
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load dashboard');
      });

    const socket = io(socketUrl, { transports: ['websocket'], withCredentials: true });
    const eventNames = [
      'session.connected',
      'session.qr.updated',
      'session.disconnected',
      'session.reconnecting',
      'message.status.changed',
      'usage.message.count.changed',
    ];

    eventNames.forEach((name) => {
      socket.on(name, (payload) => {
        setEvents((current) => [`${name}: ${JSON.stringify(payload)}`, ...current].slice(0, eventHistoryLimit));
        void Promise.all([
          fetchJson(summaryPath, token).then((data) => setSummary(data)),
          fetchJson(getUsersPath(user.role), token).then((data) => setUsers(data)),
        ]).catch(() => {
          // Keep the last visible state if a realtime refresh fails.
        });
      });
    });

    return () => {
      socket.close();
    };
  }, [token, user]);

  async function createUser(forcedRole?: CreateUserRole) {
    if (!token || !user) {
      return;
    }

    const role = forcedRole ?? createState.role;
    setError(null);
    setNotice(null);
    if (!createState.name.trim()) {
      toast.error('Name is required.');
      return;
    }
    if (!createState.email.trim() || !createState.email.includes('@')) {
      toast.error('A valid email is required.');
      return;
    }
    if (role === 'ADMIN' && createState.password.trim().length < 8) {
      toast.error('Admin password must be at least 8 characters.');
      return;
    }

    const createPayload = {
      role,
      name: createState.name.trim(),
      email: createState.email.trim().toLowerCase(),
      ...(role === 'ADMIN' ? { password: createState.password } : {}),
      ...(role === 'API_USER' && createState.apiKeyName.trim() ? { apiKeyName: createState.apiKeyName.trim() } : {}),
      ...(role === 'API_USER' && createState.sessionLabel.trim() ? { sessionLabel: createState.sessionLabel.trim() } : {}),
    };

    const response = await fetch(`${apiUrl}${forcedRole === 'API_USER' ? '/admin/api-users' : '/admin/users'}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        ...csrfHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(createPayload),
    });

    if (!response.ok) {
      const failed = await response.json().catch(() => null);
      toast.error(failed?.message ?? 'Unable to create user');
      return;
    }

    const created = await response.json();
    if (created.apiKey?.rawKey) {
      setGeneratedKeys((current) => [
        {
          userId: created.user.id,
          userName: created.user.name,
          userEmail: created.user.email,
          keyId: created.apiKey.id,
          keyName: created.apiKey.name,
          rawKey: created.apiKey.rawKey,
          swaggerUrl: created.docs?.swaggerUrl ?? `${apiUrl}/docs`,
        },
        ...current.filter((item) => item.keyId !== created.apiKey.id),
      ].slice(0, 6));
      toast.success(`API user created for ${created.user.name}. API key generated and ready to copy.`);
    } else {
      toast.success(`${created.user.role === 'ADMIN' ? 'Admin' : 'User'} created for ${created.user.name}.`);
    }

    setCreateState({
      role: user.role === 'SUPERADMIN' ? 'ADMIN' : 'API_USER',
      name: '',
      email: '',
      password: '',
      apiKeyName: '',
      sessionLabel: '',
    });
    setShowCreatePanel(false);

    await Promise.all([
      fetchJson(getSummaryPath(user?.role ?? 'ADMIN'), token).then((data) => setSummary(data)),
      fetchJson(getUsersPath(user?.role ?? 'ADMIN'), token).then((data) => setUsers(data)),
    ]);
  }

  async function deleteUser(userId: string, userEmail: string) {
    if (!token || !user) {
      return;
    }

    const confirmed = await confirmAction({
      title: 'Delete user?',
      text: `${userEmail} will be removed with API keys, sessions, and logs.`,
      confirmButtonText: 'Delete user',
    });
    if (!confirmed) {
      return;
    }

    setError(null);
    setNotice(null);

    try {
      await deleteJson(`/admin/users/${userId}`, token);
      toast.success(`${userEmail} deleted successfully.`);
      await Promise.all([
        fetchJson(getSummaryPath(user.role), token).then((data) => setSummary(data)),
        fetchJson(getUsersPath(user.role), token).then((data) => setUsers(data)),
      ]);
      setGeneratedKeys((current) => current.filter((item) => item.userId !== userId));
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : 'Unable to delete user');
    }
  }

  async function setAdminStatus(userId: string, userEmail: string, isActive: boolean) {
    if (!token || !user || user.role !== 'SUPERADMIN') {
      return;
    }

    const actionLabel = isActive ? 'unblock' : 'block';
    const confirmed = await confirmAction({
      title: `${isActive ? 'Unblock' : 'Block'} admin?`,
      text: `${userEmail} will be ${isActive ? 'unblocked' : 'blocked'}.`,
      confirmButtonText: isActive ? 'Unblock admin' : 'Block admin',
      confirmButtonColor: '#1a73e8',
    });
    if (!confirmed) {
      return;
    }

    setError(null);
    setNotice(null);

    try {
      await patchJson(`/superadmin/admins/${userId}/status`, token, { isActive });
      toast.success(`${userEmail} ${isActive ? 'unblocked' : 'blocked'} successfully.`);
      await Promise.all([
        fetchJson(getSummaryPath(user.role), token).then((data) => setSummary(data)),
        fetchJson(getUsersPath(user.role), token).then((data) => setUsers(data)),
      ]);
    } catch (statusError) {
      toast.error(statusError instanceof Error ? statusError.message : 'Unable to update admin status');
    }
  }

  async function setApiKeyStatus(apiKeyId: string, keyName: string, userEmail: string, isActive: boolean) {
    if (!token || !user) {
      return;
    }

    const confirmed = await confirmAction({
      title: `${isActive ? 'Unblock' : 'Block'} API key?`,
      text: isActive
        ? `"${keyName}" will become the active key for ${userEmail}. Other active keys for this user will be blocked.`
        : `"${keyName}" will stop working for ${userEmail}.`,
      confirmButtonText: isActive ? 'Unblock key' : 'Block key',
      confirmButtonColor: isActive ? '#1a73e8' : '#dc2626',
    });
    if (!confirmed) {
      return;
    }

    setError(null);
    setNotice(null);

    try {
      await patchJson(`/admin/api-keys/${apiKeyId}/status`, token, { isActive });
      toast.success(`API key "${keyName}" ${isActive ? 'unblocked' : 'blocked'} successfully.`);
      await fetchJson(getUsersPath(user.role), token).then((data) => setUsers(data));
    } catch (statusError) {
      toast.error(statusError instanceof Error ? statusError.message : 'Unable to update API key status');
    }
  }

  async function deleteAdmin(userId: string, userEmail: string) {
    if (!token || !user || user.role !== 'SUPERADMIN') {
      return;
    }

    const confirmed = await confirmAction({
      title: 'Delete admin?',
      text: `${userEmail} and all API users under this admin will be deleted.`,
      confirmButtonText: 'Delete admin',
    });
    if (!confirmed) {
      return;
    }

    setError(null);
    setNotice(null);

    try {
      const result = await deleteJson(`/superadmin/admins/${userId}`, token);
      toast.success(`${userEmail} deleted successfully with ${result.deletedApiUsers ?? 0} child API users.`);
      await Promise.all([
        fetchJson(getSummaryPath(user.role), token).then((data) => setSummary(data)),
        fetchJson(getUsersPath(user.role), token).then((data) => setUsers(data)),
      ]);
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : 'Unable to delete admin');
    }
  }

  async function copyToClipboard(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied to clipboard.`);
    } catch {
      toast.error(`Unable to copy ${label.toLowerCase()}.`);
    }
  }

  async function changeOwnPassword() {
    if (!token || !user) {
      return;
    }

    if (passwordState.currentPassword.trim().length < 8 || passwordState.newPassword.trim().length < 8) {
      toast.error('Current password and new password must both be at least 8 characters.');
      return;
    }

    setChangingPassword(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`${apiUrl}/auth/change-password`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          ...csrfHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(passwordState),
      });

      if (!response.ok) {
        const failed = await response.json().catch(() => null);
        throw new Error(failed?.message ?? 'Unable to change password');
      }

      setPasswordState({
        currentPassword: '',
        newPassword: '',
      });
      toast.success(`Password updated successfully for ${user.role.toLowerCase()}.`);
    } catch (passwordError) {
      toast.error(passwordError instanceof Error ? passwordError.message : 'Unable to change password');
    } finally {
      setChangingPassword(false);
    }
  }

  async function logout() {
    await fetch(`${apiUrl}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: csrfHeaders(),
    }).catch(() => null);
    setToken(null);
    setUser(null);
    setSummary(null);
    setUsers([]);
    setEvents([]);
    setGeneratedKeys([]);
    setNotice(null);
    setError(null);
    window.location.href = '/';
  }

  function toggleEvent(eventKey: string) {
    setExpandedEventIds((current) => {
      const next = new Set(current);
      if (next.has(eventKey)) {
        next.delete(eventKey);
      } else {
        next.add(eventKey);
      }
      return next;
    });
  }

  if (!token || !user) {
    return <main className="p-10 text-slate">Loading dashboard...</main>;
  }

  const visibleMetrics = summary
    ? [
        { label: 'Admins', value: String(summary.admins), tone: 'slate' as const, icon: <ShieldIcon /> },
        { label: 'API Users', value: String(summary.apiUsers), tone: 'blue' as const, icon: <UsersIcon /> },
        { label: 'Connected', value: String(summary.connectedCount), tone: 'green' as const, icon: <PulseIcon /> },
        { label: 'Pending QR', value: String(summary.qrPendingCount), tone: 'amber' as const, icon: <QrCodeIcon /> },
        { label: 'Queued Today', value: String(summary.queuedMessagesToday), tone: 'slate' as const, icon: <ClockIcon /> },
        { label: 'Sent Today', value: String(summary.sentMessagesToday), tone: 'green' as const, icon: <SendIcon /> },
      ]
    : [];

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredUsers = normalizedSearch
    ? users.filter((managedUser) =>
        [
          managedUser.name,
          managedUser.email,
          managedUser.role,
          managedUser.sessions.map((session) => `${session.label} ${session.status}`).join(' '),
          managedUser.apiKeys.map((key) => key.name).join(' '),
        ].some((value) => value.toLowerCase().includes(normalizedSearch)),
      )
    : users;
  const filteredGeneratedKeys = normalizedSearch
    ? generatedKeys.filter((item) =>
        [item.userName, item.userEmail, item.keyName, item.rawKey].some((value) => value.toLowerCase().includes(normalizedSearch)),
      )
    : generatedKeys;
  const filteredEvents = normalizedSearch ? events.filter((event) => event.toLowerCase().includes(normalizedSearch)) : events;
  const eventTotalPages = Math.max(1, Math.ceil(filteredEvents.length / eventPageSize));
  const safeEventPage = Math.min(eventPage, eventTotalPages);
  const eventStartIndex = (safeEventPage - 1) * eventPageSize;
  const paginatedEvents = filteredEvents.slice(eventStartIndex, eventStartIndex + eventPageSize);
  const eventRangeStart = filteredEvents.length ? eventStartIndex + 1 : 0;
  const eventRangeEnd = Math.min(eventStartIndex + eventPageSize, filteredEvents.length);
  const createFields: Array<'name' | 'email' | 'password'> =
    createState.role === 'ADMIN' ? ['name', 'email', 'password'] : ['name', 'email'];

  const sentCount = summary?.sentMessagesToday ?? 0;
  const failedCount = summary?.failedToday ?? 0;
  const queuedCount = summary?.queuedMessagesToday ?? 0;
  const processedCount = sentCount + failedCount;
  const deliveryRate = processedCount ? Math.round((sentCount / processedCount) * 100) : 100;
  const queueTotal = sentCount + failedCount + queuedCount;
  const queuePressure = queueTotal ? Math.round((queuedCount / queueTotal) * 100) : 0;
  const connectionRate = summary?.sessions ? Math.round(((summary.connectedCount ?? 0) / summary.sessions) * 100) : 0;
  const createApiUserExamples = buildCreateApiUserExamples(apiUrl);
  const selectedCreateApiUserExample = createApiUserExamples[selectedAdminApiLanguage];

  const canViewSessionHealth = user.role === 'SUPERADMIN';
  const activeView = canViewSessionHealth || currentView !== 'sessions' ? currentView : 'overview';
  const navItems: Array<{ id: DashboardView; label: string; icon: JSX.Element }> = [
    { id: 'overview', label: 'Overview', icon: <GridIcon /> },
    { id: 'users', label: 'Managed Users', icon: <UsersIcon /> },
    { id: 'api', label: 'API', icon: <KeyIcon /> },
    { id: 'keys', label: 'API Keys', icon: <KeyIcon /> },
    ...(canViewSessionHealth ? [{ id: 'sessions' as const, label: 'Session Health', icon: <PulseIcon /> }] : []),
    { id: 'settings', label: 'Settings', icon: <ShieldIcon /> },
  ];

  const viewMeta: Record<DashboardView, { eyebrow: string; title: string; description: string }> = {
    overview: {
      eyebrow: 'Operations Dashboard',
      title: 'Control your WhatsApp workspace',
      description: 'Track delivery health, session stability, and daily throughput without mixing it with setup forms.',
    },
    users: {
      eyebrow: 'User Management',
      title: 'Create and manage access',
      description: 'Provision admins and API users, share portal URLs, and keep user ownership clean.',
    },
    api: {
      eyebrow: 'Admin API',
      title: 'Provision API users',
      description: 'Create API users under this admin account, issue their first key, and monitor whether their API access is usable.',
    },
    keys: {
      eyebrow: 'API Credentials',
      title: 'Share keys without losing control',
      description: 'Keep recently generated keys in one place so admins can copy and hand them over immediately.',
    },
    sessions: {
      eyebrow: 'Session Health',
      title: 'Watch live connection state',
      description: 'Monitor QR readiness, reconnect activity, and the latest session-side events from the worker.',
    },
    settings: {
      eyebrow: 'Security Settings',
      title: 'Protect the admin workspace',
      description: 'Change the password for the signed-in operator without exposing unrelated operational panels.',
    },
  };

  const currentMeta = viewMeta[activeView];

  return (
    <main className="drive-shell">
      <div className="drive-app">
        <aside className="drive-sidebar space-y-5">
          <div className="rounded-[28px] border border-line bg-gradient-to-br from-white via-white to-cloud px-5 py-5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-signal text-white shadow-float">
                <GridIcon />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate">Workspace</p>
                <h1 className="text-xl font-semibold text-ink">WhatsApp Ops</h1>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate">
              Admin operations, API user provisioning, live queue activity, and WhatsApp connection management.
            </p>
          </div>

          <nav className="space-y-2">
            {navItems.map((item) => (
              <Link
                key={item.id}
                className={activeView === item.id ? 'drive-nav-item-active w-full' : 'drive-nav-item w-full'}
                href={item.id === 'overview' ? '/dashboard/overview' : `/dashboard/${item.id}`}
                onClick={() => {
                  setOpenActionMenuId(null);
                  if (item.id !== 'users') {
                    setSearchTerm('');
                  }
                }}
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
          </nav>

          <section className="drive-section">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate">Signed In As</p>
            <div className="mt-4 rounded-3xl border border-line bg-white px-4 py-4">
              <p className="text-base font-semibold text-ink">{user.name}</p>
              <p className="mt-1 text-sm text-slate">{formatRoleLabel(user.role)}</p>
            </div>
            <button className="drive-button-secondary mt-4 w-full justify-center" onClick={logout}>
              Logout
            </button>
          </section>

          <section className="drive-section">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate">Quick Totals</p>
            <div className="mt-4 grid gap-3">
              <div className="rounded-3xl bg-white px-4 py-4">
                <p className="text-sm text-slate">Sessions</p>
                <p className="mt-2 text-2xl font-semibold text-ink">{summary?.sessions ?? '--'}</p>
              </div>
              <div className="rounded-3xl bg-white px-4 py-4">
                <p className="text-sm text-slate">Failed Today</p>
                <p className="mt-2 text-2xl font-semibold text-ink">{summary?.failedToday ?? '--'}</p>
              </div>
            </div>
          </section>
        </aside>

        <section className="space-y-6">
          <header className="drive-topbar">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.26em] text-signal">{currentMeta.eyebrow}</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-ink">{currentMeta.title}</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate">
                {currentMeta.description}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="drive-search min-w-[280px] max-w-xl">
                <SearchIcon />
                <input
                  className="w-full bg-transparent outline-none placeholder:text-slate"
                  value={searchTerm}
                  autoComplete="off"
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setSearchTerm(nextValue);
                    if (nextValue.trim() && activeView !== 'users' && document.activeElement === event.target) {
                      setCurrentView('users');
                      router.push('/dashboard/users');
                    }
                  }}
                  placeholder="Search users, sessions, and live activity"
                />
              </div>
              {searchTerm.trim() ? (
                <button className="drive-button-secondary" onClick={() => setSearchTerm('')}>
                  Clear
                </button>
              ) : null}
              <button className="drive-button-secondary" onClick={logout}>
                Logout
              </button>
            </div>
          </header>

          {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p> : null}

          {summary && activeView === 'overview' ? (
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visibleMetrics.map((metric) => (
                <MetricCard key={metric.label} label={metric.label} value={metric.value} tone={metric.tone} icon={metric.icon} />
              ))}
            </section>
          ) : null}

          {searchTerm.trim() ? (
            <section className="drive-section">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-signal">Search Results</p>
                  <h3 className="mt-2 text-2xl font-semibold text-ink">Matches for "{searchTerm}"</h3>
                </div>
                <span className="drive-badge bg-cloud text-slate">
                  {filteredUsers.length} users · {filteredGeneratedKeys.length} keys · {filteredEvents.length} events
                </span>
              </div>
            </section>
          ) : null}

          {activeView === 'overview' ? (
            <section className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
              <div className="space-y-6">
                <div className="drive-section">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-signal">Analytics Snapshot</p>
                      <h3 className="mt-2 text-2xl font-semibold text-ink">Daily performance</h3>
                    </div>
                    <span className="drive-badge bg-signal/10 text-signal">{deliveryRate}% delivery rate</span>
                  </div>
                  <div className="mt-6 grid gap-4 md:grid-cols-3">
                    <div className="rounded-[24px] border border-line bg-cloud p-4">
                      <p className="text-sm text-slate">Sent vs Failed</p>
                      <p className="mt-2 text-3xl font-semibold text-ink">{sentCount}:{failedCount}</p>
                      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white">
                        <div className="h-full rounded-full bg-warm" style={{ width: `${deliveryRate}%` }} />
                      </div>
                    </div>
                    <div className="rounded-[24px] border border-line bg-cloud p-4">
                      <p className="text-sm text-slate">Connection Rate</p>
                      <p className="mt-2 text-3xl font-semibold text-ink">{connectionRate}%</p>
                      <p className="mt-2 text-sm text-slate">
                        {summary?.connectedCount ?? 0} of {summary?.sessions ?? 0} sessions connected
                      </p>
                    </div>
                    <div className="rounded-[24px] border border-line bg-cloud p-4">
                      <p className="text-sm text-slate">Queue Pressure</p>
                      <p className="mt-2 text-3xl font-semibold text-ink">{queuePressure}%</p>
                      <p className="mt-2 text-sm text-slate">{queuedCount} messages are still waiting in queue</p>
                    </div>
                  </div>
                </div>

                <div className="drive-section">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-signal">Traffic Mix</p>
                      <h3 className="mt-2 text-2xl font-semibold text-ink">Message analytics</h3>
                    </div>
                  </div>
                  <div className="mt-6 space-y-4">
                    {[
                      { label: 'Sent', value: sentCount, color: 'bg-warm' },
                      { label: 'Queued', value: queuedCount, color: 'bg-signal' },
                      { label: 'Failed', value: failedCount, color: 'bg-red-500' },
                      { label: 'Received', value: summary?.receivedMessagesToday ?? 0, color: 'bg-amber-400' },
                    ].map((item) => {
                      const maxValue = Math.max(sentCount, queuedCount, failedCount, summary?.receivedMessagesToday ?? 0, 1);
                      const width = Math.max(8, Math.round((item.value / maxValue) * 100));
                      return (
                        <div key={item.label}>
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="font-medium text-ink">{item.label}</span>
                            <span className="text-slate">{item.value}</span>
                          </div>
                          <div className="mt-2 h-2 rounded-full bg-cloud">
                            <div className={`h-2 rounded-full ${item.color}`} style={{ width: `${width}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <section className="drive-section min-w-0 overflow-hidden">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-signal">Workspace Pulse</p>
                    <h3 className="mt-2 text-2xl font-semibold text-ink">What needs attention</h3>
                  </div>
                  <div className="mt-5 space-y-3">
                    <div className="rounded-[24px] border border-line bg-cloud p-4 text-sm text-slate">
                      <p className="font-semibold text-ink">Pending QR sessions</p>
                      <p className="mt-2">{summary?.qrPendingCount ?? 0} sessions are waiting for a QR scan.</p>
                    </div>
                    <div className="rounded-[24px] border border-line bg-cloud p-4 text-sm text-slate">
                      <p className="font-semibold text-ink">Failed sends</p>
                      <p className="mt-2">{failedCount} sends failed today and may need reconnect or retry checks.</p>
                    </div>
                    <div className="rounded-[24px] border border-line bg-cloud p-4 text-sm text-slate">
                      <p className="font-semibold text-ink">User footprint</p>
                      <p className="mt-2">{summary?.apiUsers ?? 0} API users are active under {summary?.admins ?? 0} admin accounts.</p>
                    </div>
                  </div>
                </section>

                <section className="drive-section">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-signal">Live Feed</p>
                    <h3 className="mt-2 text-2xl font-semibold text-ink">Session Events</h3>
                  </div>
                <div className="mt-5 space-y-3">
                  {paginatedEvents.length ? (
                    paginatedEvents.map((event, index) => {
                      const eventKey = `${event}-${eventStartIndex + index}`;
                      return (
                        <EventCard
                          key={eventKey}
                          event={event}
                          eventKey={eventKey}
                          expanded={expandedEventIds.has(eventKey)}
                          onToggle={toggleEvent}
                        />
                      );
                    })
                  ) : (
                      <p className="text-sm leading-6 text-slate">
                        {normalizedSearch ? 'No session events matched your search.' : 'Socket.IO event feed will appear here as sessions change.'}
                      </p>
                    )}
                </div>
                <EventPagination
                  currentPage={safeEventPage}
                  totalPages={eventTotalPages}
                  totalItems={filteredEvents.length}
                  startItem={eventRangeStart}
                  endItem={eventRangeEnd}
                  onPageChange={setEventPage}
                />
              </section>
              </div>
            </section>
          ) : null}

          {activeView === 'users' ? (
            <section className="grid gap-6 xl:grid-cols-[1.05fr_1.35fr]">
              <div className="drive-section">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-signal">Access Management</p>
                    <h3 className="mt-2 text-2xl font-semibold text-ink">Create User</h3>
                  </div>
                  <span className="drive-badge bg-signal/10 text-signal">{createState.role === 'ADMIN' ? 'Admin account' : 'API user account'}</span>
                </div>

                <div className="mt-5 grid gap-3">
                  <select
                    className="drive-input"
                    value={createState.role}
                    onChange={(event) => setCreateState((current) => ({ ...current, role: event.target.value as CreateUserRole }))}
                  >
                    {user.role === 'SUPERADMIN' ? <option value="ADMIN">Admin</option> : null}
                    <option value="API_USER">API User</option>
                  </select>
                  {createFields.map((field) => (
                    <input
                      key={field}
                      className="drive-input"
                      type={field === 'password' ? 'password' : field === 'email' ? 'email' : 'text'}
                      value={createState[field]}
                      onChange={(event) => setCreateState((current) => ({ ...current, [field]: event.target.value }))}
                      placeholder={field === 'name' ? 'Full name' : field === 'email' ? 'user@example.com' : 'Password'}
                    />
                  ))}
                </div>

                <p className="mt-4 text-sm leading-6 text-slate">
                  {createState.role === 'API_USER'
                    ? 'API users receive a generated key and primary session automatically so the admin can share access immediately.'
                    : 'Admin accounts are created for internal operators and can manage only their own API users.'}
                </p>

                <button className="drive-button-primary mt-5" onClick={() => void createUser()}>
                  Create {createState.role === 'ADMIN' ? 'admin' : 'user'}
                </button>
              </div>

              <div className="drive-section">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-signal">Managed Directory</p>
                  <h3 className="mt-2 text-2xl font-semibold text-ink">Managed Users</h3>
                </div>
                <div className="flex items-center gap-3">
                  <span className="drive-badge bg-cloud text-slate">{filteredUsers.length} visible</span>
                  <button className="drive-button-primary" onClick={() => setShowCreatePanel((current) => !current)}>
                    {showCreatePanel ? 'Hide form' : 'New user'}
                  </button>
                </div>
              </div>

              {showCreatePanel ? (
                <div className="mt-5 rounded-[24px] border border-line bg-cloud p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-signal">Access Management</p>
                      <h4 className="mt-2 text-xl font-semibold text-ink">Create User</h4>
                    </div>
                    <span className="drive-badge bg-white text-signal">
                      {createState.role === 'ADMIN' ? 'Admin account' : 'API user account'}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-3 lg:grid-cols-4">
                    <select
                      className="drive-input"
                      value={createState.role}
                      onChange={(event) => setCreateState((current) => ({ ...current, role: event.target.value as CreateUserRole }))}
                    >
                      {user.role === 'SUPERADMIN' ? <option value="ADMIN">Admin</option> : null}
                      <option value="API_USER">API User</option>
                    </select>
                    {createFields.map((field) => (
                      <input
                        key={field}
                        className="drive-input"
                        type={field === 'password' ? 'password' : field === 'email' ? 'email' : 'text'}
                        value={createState[field]}
                        onChange={(event) => setCreateState((current) => ({ ...current, [field]: event.target.value }))}
                        placeholder={field === 'name' ? 'Full name' : field === 'email' ? 'user@example.com' : 'Password'}
                      />
                    ))}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm leading-6 text-slate">
                      {createState.role === 'API_USER'
                        ? 'API users receive a generated key and primary session automatically.'
                        : 'Admin accounts are created for internal operators only.'}
                    </p>
                    <button className="drive-button-primary" onClick={() => void createUser()}>
                      Create {createState.role === 'ADMIN' ? 'admin' : 'user'}
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="mt-5 overflow-x-auto rounded-[28px] border border-line">
                <table className="drive-table min-w-full">
                  <thead>
              <tr>
                <th className="px-6 py-4">Name</th>
                <th className="px-6 py-4">Email</th>
                <th className="px-6 py-4">Owner</th>
                <th className="px-6 py-4">Role</th>
                <th className="px-6 py-4">Sessions</th>
                <th className="px-6 py-4">API Keys</th>
                <th className="px-6 py-4">Actions</th>
              </tr>
                  </thead>
                  <tbody>
              {filteredUsers.map((managedUser) => (
                    <tr key={managedUser.id}>
                  <td className="px-6 py-4 font-medium text-ink">{managedUser.name}</td>
                  <td className="px-6 py-4 text-slate">
                    <p className="font-medium text-ink">{managedUser.email}</p>
                    {managedUser.portalShareUrl ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          className="inline-flex items-center gap-2 rounded-full border border-line bg-cloud px-3 py-1.5 text-[11px] font-medium text-ink"
                          onClick={() => copyToClipboard(managedUser.portalShareUrl ?? '', `${managedUser.email} portal URL`)}
                          aria-label={`Copy portal URL for ${managedUser.email}`}
                          title={`Copy portal URL for ${managedUser.email}`}
                        >
                          <CopyIcon />
                          Copy URL
                        </button>
                      </div>
                    ) : null}
                  </td>
                  <td className="px-6 py-4 text-slate">
                    <p className="font-medium text-ink">{managedUser.owner?.name ?? 'Unknown creator'}</p>
                    <p className="mt-1 text-xs text-slate">{managedUser.owner?.email ?? 'No creator recorded'}</p>
                  </td>
                  <td className="px-6 py-4 text-slate">
                    <span className="drive-badge">
                      {formatRoleLabel(managedUser.role)}
                      {managedUser.role === 'ADMIN' && managedUser.isActive === false ? ' · Blocked' : ''}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-slate">
                    {managedUser.sessions?.map((session) => `${session.label} (${session.status})`).join(', ') || 'None'}
                  </td>
                  <td className="px-6 py-4 text-slate">
                    {managedUser.apiKeys?.map((key) => `${key.name}${key.isActive ? ' (active)' : ' (blocked)'}`).join(', ') || 'None'}
                  </td>
                  <td className="px-6 py-4">
                    {managedUser.role === 'API_USER' || (user.role === 'SUPERADMIN' && managedUser.role === 'ADMIN') ? (
                      <div className="relative">
                        <button
                          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-line bg-white text-slate transition hover:border-signal hover:text-signal"
                          onClick={() => setOpenActionMenuId((current) => (current === managedUser.id ? null : managedUser.id))}
                          aria-label={`Open actions for ${managedUser.email}`}
                        >
                          <MoreIcon />
                        </button>
                        {openActionMenuId === managedUser.id ? (
                          <div className="absolute right-0 z-20 mt-2 w-44 rounded-2xl border border-line bg-white p-2 shadow-panel">
                            {managedUser.role === 'API_USER' ? (
                              <>
                                <Link
                                  className="block rounded-xl px-3 py-2 text-sm font-medium text-ink transition hover:bg-cloud"
                                  href={`/dashboard/users/${managedUser.id}`}
                                  onClick={() => setOpenActionMenuId(null)}
                                >
                                  Manage user
                                </Link>
                                <button
                                  className="block w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-red-700 transition hover:bg-red-50"
                                  onClick={() => {
                                    setOpenActionMenuId(null);
                                    void deleteUser(managedUser.id, managedUser.email);
                                  }}
                                >
                                  Delete user
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  className="block w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-ink transition hover:bg-cloud"
                                  onClick={() => {
                                    setOpenActionMenuId(null);
                                    void setAdminStatus(managedUser.id, managedUser.email, !(managedUser.isActive ?? true));
                                  }}
                                >
                                  {managedUser.isActive === false ? 'Unblock admin' : 'Block admin'}
                                </button>
                                <button
                                  className="block w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-red-700 transition hover:bg-red-50"
                                  onClick={() => {
                                    setOpenActionMenuId(null);
                                    void deleteAdmin(managedUser.id, managedUser.email);
                                  }}
                                >
                                  Delete admin
                                </button>
                              </>
                            )}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-xs text-slate/60">Protected</span>
                    )}
                  </td>
                </tr>
              ))}
                  </tbody>
                </table>
              </div>
              {!filteredUsers.length ? <p className="mt-4 text-sm text-slate">No users matched your search.</p> : null}
            </div>
            </section>
          ) : null}

          {activeView === 'api' ? (
            <section className="drive-section">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-signal">Admin API Reference</p>
                  <h3 className="mt-2 text-2xl font-semibold text-ink">Create API User</h3>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate">
                    Use this admin endpoint to create an API user, generate its first API key, and create its primary WhatsApp session.
                  </p>
                </div>
                <button
                  className="drive-button-secondary"
                  onClick={() => copyToClipboard(selectedCreateApiUserExample, `${adminApiLanguageLabels[selectedAdminApiLanguage]} example`)}
                >
                  <CopyIcon />
                  Copy {adminApiLanguageLabels[selectedAdminApiLanguage]}
                </button>
              </div>

              <div className="mt-6 rounded-[24px] border border-line bg-cloud p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="drive-badge bg-signal/10 text-signal">POST</span>
                  <span className="font-mono text-sm text-ink">/auth/login</span>
                  <span className="drive-badge bg-signal/10 text-signal">POST</span>
                  <span className="font-mono text-sm text-ink">/admin/api-users</span>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                {adminApiLanguages.map((language) => (
                  <button
                    key={language}
                    className={`rounded-xl px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] transition ${
                      selectedAdminApiLanguage === language
                        ? 'bg-ink text-white'
                        : 'border border-line bg-cloud text-slate'
                    }`}
                    onClick={() => setSelectedAdminApiLanguage(language)}
                  >
                    {adminApiLanguageLabels[language]}
                  </button>
                ))}
              </div>

              <div className="mt-5 rounded-3xl bg-[#101826] p-5 text-white shadow-inner">
                <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[13px] leading-6 text-slate-100">
                  <code>{selectedCreateApiUserExample}</code>
                </pre>
              </div>

              <div className="mt-5 rounded-[24px] border border-line bg-cloud p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-signal">Create User Response</p>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-2xl bg-white p-4 font-mono text-[13px] leading-6 text-slate">
                  <code>{`{
  "user": {
    "id": "user-id",
    "name": "Customer Support Bot",
    "email": "support-api@example.com",
    "role": "API_USER"
  },
  "apiKey": {
    "id": "key-id",
    "name": "Customer Support Bot Default Key",
    "rawKey": "AIza..."
  },
  "session": {
    "id": "session-id",
    "label": "Primary session"
  }
}`}</code>
                </pre>
              </div>
            </section>
          ) : null}

          {activeView === 'keys' ? (
            <section className="space-y-6">
              <section className="drive-section">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-signal">Key Coverage</p>
                    <h3 className="mt-2 text-2xl font-semibold text-ink">Users with API access</h3>
                  </div>
                </div>
                <div className="mt-5 space-y-3">
                  {filteredUsers
                    .filter((managedUser) => managedUser.role === 'API_USER')
                    .map((managedUser) => {
                      const activeKeys = managedUser.apiKeys.filter((key) => key.isActive);
                      return (
                      <div key={managedUser.id} className="rounded-[24px] border border-line bg-cloud px-4 py-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-ink">{managedUser.name}</p>
                            <p className="mt-1 text-sm text-slate">{managedUser.email}</p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="drive-badge bg-white text-slate">{managedUser.apiKeys.length} keys</span>
                            <span className={`drive-badge ${activeKeys.length === 1 ? 'bg-warm/10 text-warm' : 'bg-red-50 text-red-700'}`}>
                              {activeKeys.length} active
                            </span>
                          </div>
                        </div>
                        <div className="mt-4 space-y-2">
                          {managedUser.apiKeys.length ? (
                            managedUser.apiKeys.map((key) => (
                              <div key={key.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white px-4 py-3">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="font-medium text-ink">{key.name}</p>
                                    <span className={`drive-badge ${key.isActive ? 'bg-warm/10 text-warm' : 'bg-slate-100 text-slate'}`}>
                                      {key.isActive ? 'Active' : 'Blocked'}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-xs text-slate">
                                    {key.createdAt ? `Created ${new Date(key.createdAt).toLocaleString()}` : 'Created date unavailable'}
                                    {key.lastUsedAt ? ` · Last used ${new Date(key.lastUsedAt).toLocaleString()}` : ' · Never used'}
                                  </p>
                                </div>
                                <button
                                  className={key.isActive ? 'drive-button-danger' : 'drive-button-secondary'}
                                  onClick={() => void setApiKeyStatus(key.id, key.name, managedUser.email, !key.isActive)}
                                >
                                  {key.isActive ? 'Block key' : 'Unblock key'}
                                </button>
                              </div>
                            ))
                          ) : (
                            <p className="text-sm text-slate">No API key has been generated for this user.</p>
                          )}
                        </div>
                      </div>
                    );
                    })}
                </div>
              </section>
            </section>
          ) : null}

          {activeView === 'sessions' ? (
            <div className="space-y-6">
              {summary?.systemHealth ? (
                <section className="drive-section">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-signal">Server Load & Health</p>
                    <h3 className="mt-2 text-2xl font-semibold text-ink">System Metrics</h3>
                  </div>
                  <div className="mt-6 grid gap-6 md:grid-cols-2">
                    <div className="rounded-[24px] border border-line bg-cloud px-6 py-6">
                      <div className="flex items-center gap-3">
                        <PulseIcon />
                        <h4 className="font-semibold text-ink">Backend Server</h4>
                      </div>
                      <div className="mt-4 space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-slate">CPU Cores</span>
                          <span className="font-medium text-ink">{summary.systemHealth.backend.cpus}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate">Active Load (1m / 5m / 15m)</span>
                          <span className="font-medium text-ink">
                            {summary.systemHealth.backend.loadavg.map(n => n.toFixed(2)).join(' / ')}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate">Memory Free</span>
                          <span className="font-medium text-ink">
                            {(summary.systemHealth.backend.freemem / 1024 / 1024).toFixed(0)} MB / {(summary.systemHealth.backend.totalmem / 1024 / 1024).toFixed(0)} MB
                          </span>
                        </div>
                      </div>
                    </div>
                    {summary.systemHealth.worker ? (
                      <div className="rounded-[24px] border border-line bg-cloud px-6 py-6">
                        <div className="flex items-center gap-3">
                          <PulseIcon />
                          <h4 className="font-semibold text-ink">Worker Server</h4>
                        </div>
                        <div className="mt-4 space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-slate">CPU Cores</span>
                            <span className="font-medium text-ink">{summary.systemHealth.worker.cpus}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-slate">Active Load (1m / 5m / 15m)</span>
                            <span className="font-medium text-ink">
                              {summary.systemHealth.worker.loadavg.map(n => n.toFixed(2)).join(' / ')}
                            </span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-slate">Memory Free</span>
                            <span className="font-medium text-ink">
                              {(summary.systemHealth.worker.freemem / 1024 / 1024).toFixed(0)} MB / {(summary.systemHealth.worker.totalmem / 1024 / 1024).toFixed(0)} MB
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-[24px] border border-line bg-cloud px-6 py-6 flex items-center justify-center">
                        <p className="text-sm text-slate">Worker metrics unavailable</p>
                      </div>
                    )}
                  </div>
                </section>
              ) : null}

              {summary?.containers && summary.containers.length > 0 ? (
                <section className="drive-section">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-signal">Infrastructure</p>
                    <h3 className="mt-2 text-2xl font-semibold text-ink">Docker Containers</h3>
                  </div>
                  <div className="mt-6 grid gap-4 lg:grid-cols-2">
                    {summary.containers.map((container) => (
                      <div key={container.Id} className="flex items-center justify-between rounded-[22px] border border-line bg-cloud px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`h-2.5 w-2.5 rounded-full ${container.State === 'running' ? 'bg-[#10B981]' : 'bg-[#EF4444]'}`} />
                          <p className="font-semibold text-ink">{container.Names?.[0]?.replace(/^\//, '') ?? 'unknown'}</p>
                        </div>
                        <p className="text-sm text-slate">{container.Status}</p>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-start">
              <section className="drive-section min-w-0 overflow-hidden">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-signal">Session Summary</p>
                  <h3 className="mt-2 text-2xl font-semibold text-ink">Connection analytics</h3>
                </div>
                <div className="mt-6 grid gap-4">
                  {[
                    { label: 'Connected Sessions', value: summary?.connectedCount ?? 0 },
                    { label: 'Disconnected Sessions', value: summary?.disconnectedCount ?? 0 },
                    { label: 'Pending QR', value: summary?.qrPendingCount ?? 0 },
                    { label: 'Total Sessions', value: summary?.sessions ?? 0 },
                  ].map((item) => (
                    <div key={item.label} className="rounded-[24px] border border-line bg-cloud px-4 py-4">
                      <p className="text-sm text-slate">{item.label}</p>
                      <p className="mt-2 text-3xl font-semibold text-ink">{item.value}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="drive-section">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-signal">Realtime Activity</p>
                  <h3 className="mt-2 text-2xl font-semibold text-ink">Worker events</h3>
                </div>
                <div className="mt-5 space-y-3">
                  {paginatedEvents.length ? (
                    paginatedEvents.map((event, index) => {
                      const eventKey = `${event}-${eventStartIndex + index}`;
                      return (
                        <EventCard
                          key={eventKey}
                          event={event}
                          eventKey={eventKey}
                          expanded={expandedEventIds.has(eventKey)}
                          onToggle={toggleEvent}
                        />
                      );
                    })
                  ) : (
                    <p className="text-sm leading-6 text-slate">
                      {normalizedSearch ? 'No worker events matched your search.' : 'Socket.IO event feed will appear here as sessions change.'}
                    </p>
                  )}
                </div>
                <EventPagination
                  currentPage={safeEventPage}
                  totalPages={eventTotalPages}
                  totalItems={filteredEvents.length}
                  startItem={eventRangeStart}
                  endItem={eventRangeEnd}
                  onPageChange={setEventPage}
                />
              </section>
            </section>
            </div>
          ) : null}

          {activeView === 'settings' ? (
            <section className="grid gap-6 xl:grid-cols-[1fr_0.8fr]">
              <div className="drive-section">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-signal">Security</p>
                    <h3 className="mt-2 text-2xl font-semibold text-ink">Change Password</h3>
                    <p className="mt-2 text-sm leading-6 text-slate">
                      Update the password for the currently signed-in {user.role === 'SUPERADMIN' ? 'superadmin' : 'admin'} account.
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  <input
                    className="drive-input"
                    type="password"
                    value={passwordState.currentPassword}
                    onChange={(event) => setPasswordState((current) => ({ ...current, currentPassword: event.target.value }))}
                    placeholder="Current password"
                  />
                  <input
                    className="drive-input"
                    type="password"
                    value={passwordState.newPassword}
                    onChange={(event) => setPasswordState((current) => ({ ...current, newPassword: event.target.value }))}
                    placeholder="New password"
                  />
                </div>

                <button className="drive-button-secondary mt-5" onClick={changeOwnPassword} disabled={changingPassword}>
                  {changingPassword ? 'Updating password...' : 'Update Password'}
                </button>
              </div>

              <div className="drive-section">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-signal">Operator Profile</p>
                <div className="mt-5 rounded-[24px] border border-line bg-cloud p-5">
                  <p className="text-lg font-semibold text-ink">{user.name}</p>
                  <p className="mt-1 text-sm text-slate">{formatRoleLabel(user.role)}</p>
                  <p className="mt-4 text-sm leading-6 text-slate">
                    This page is intentionally isolated from user provisioning and analytics so security actions do not get buried in operational noise.
                  </p>
                </div>
              </div>
            </section>
          ) : null}
        </section>
      </div>
    </main>
  );
}
