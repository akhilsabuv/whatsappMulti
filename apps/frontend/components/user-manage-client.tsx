'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { confirmAction } from '../lib/alerts';
import { csrfHeaders } from '../lib/csrf';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';

type ApiKeyItem = {
  id: string;
  name: string;
  rawKey: string | null;
  isActive: boolean;
  createdAt: string;
  lastUsedAt: string | null;
};

type SessionItem = {
  id: string;
  label: string;
  status: string;
  phoneNumber: string | null;
};

type SessionLiveState = {
  sessionId: string;
  label: string;
  status: string;
  phoneNumber: string | null;
  pushName?: string | null;
  qr: string | null;
  qrDataUrl: string | null;
  isMockMode: boolean;
};

type AccessBundle = {
  user: {
    id: string;
    name: string;
    email: string;
  };
  apiKeys: ApiKeyItem[];
  sessions: SessionItem[];
  docs: {
    swaggerUrl: string | null;
    swaggerJsonUrl: string | null;
    apiTag: string;
    authHeader: string;
    endpoints: string[];
  };
  portal: {
    shareUrl: string;
  };
};

type MessageActivity = {
  id: string;
  jobId: string | null;
  providerMessageId: string | null;
  direction: string;
  toNumber: string | null;
  messageType: string;
  status: string;
  errorText: string | null;
  createdAt: string;
  updatedAt: string;
  session: {
    id: string;
    label: string;
  };
};

type FreshKey = {
  id: string;
  name: string;
  rawKey: string;
};

type ExampleLanguage = 'curl' | 'javascript' | 'python' | 'php';

type EndpointDoc = {
  id: string;
  method: 'GET' | 'POST';
  path: string;
  title: string;
  description: string;
  languages: Record<ExampleLanguage, string>;
};

type UserManageView = 'access' | 'connection' | 'reference' | 'activity';

function CopyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-2">
      <rect x="9" y="9" width="10" height="10" rx="2" />
      <path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

async function fetchWithToken(path: string, _token?: string) {
  const response = await fetch(`${apiUrl}${path}`, {
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${path}`);
  }

  return response.json();
}

function buildEndpointDocs(input: {
  apiBaseUrl: string;
  authHeader: string;
  apiKey: string;
  samplePhone: string;
}) {
  const { apiBaseUrl, authHeader, apiKey, samplePhone } = input;
  const authLine = `'${authHeader}': '${apiKey}'`;

  return [
    {
      id: 'request-qr',
      method: 'POST',
      path: '/api/session/request-qr',
      title: 'Request QR Code',
      description: 'Starts a WhatsApp linking flow for the authenticated API user session.',
      languages: {
        curl: `curl -X POST '${apiBaseUrl}/api/session/request-qr' \\
  -H '${authHeader}: ${apiKey}'`,
        javascript: `const response = await fetch('${apiBaseUrl}/api/session/request-qr', {
  method: 'POST',
  headers: {
    ${authLine},
  },
});

const data = await response.json();
console.log(data);`,
        python: `import requests

response = requests.post(
    '${apiBaseUrl}/api/session/request-qr',
    headers={
        '${authHeader}': '${apiKey}',
    },
)

print(response.json())`,
        php: `<?php

$response = file_get_contents('${apiBaseUrl}/api/session/request-qr', false, stream_context_create([
    'http' => [
        'method' => 'POST',
        'header' => '${authHeader}: ${apiKey}',
    ],
]));

echo $response;`,
      },
    },
    {
      id: 'session-status',
      method: 'GET',
      path: '/api/session/status',
      title: 'Get Session Status',
      description: 'Checks whether the user session is connected, disconnected, or waiting for QR scan.',
      languages: {
        curl: `curl '${apiBaseUrl}/api/session/status' \\
  -H '${authHeader}: ${apiKey}'`,
        javascript: `const response = await fetch('${apiBaseUrl}/api/session/status', {
  headers: {
    ${authLine},
  },
});

const data = await response.json();
console.log(data);`,
        python: `import requests

response = requests.get(
    '${apiBaseUrl}/api/session/status',
    headers={
        '${authHeader}': '${apiKey}',
    },
)

print(response.json())`,
        php: `<?php

$response = file_get_contents('${apiBaseUrl}/api/session/status', false, stream_context_create([
    'http' => [
        'method' => 'GET',
        'header' => '${authHeader}: ${apiKey}',
    ],
]));

echo $response;`,
      },
    },
    {
      id: 'check-number',
      method: 'GET',
      path: `/api/contacts/check-number?phone=${samplePhone}`,
      title: 'Check WhatsApp Number',
      description: 'Queues a lookup to verify whether a phone number exists on WhatsApp.',
      languages: {
        curl: `curl '${apiBaseUrl}/api/contacts/check-number?phone=${samplePhone}' \\
  -H '${authHeader}: ${apiKey}'`,
        javascript: `const phone = '${samplePhone}';
const response = await fetch(
  '${apiBaseUrl}/api/contacts/check-number?phone=' + encodeURIComponent(phone),
  {
    headers: {
      ${authLine},
    },
  },
);

const data = await response.json();
console.log(data);`,
        python: `import requests

response = requests.get(
    '${apiBaseUrl}/api/contacts/check-number',
    headers={
        '${authHeader}': '${apiKey}',
    },
    params={
        'phone': '${samplePhone}',
    },
)

print(response.json())`,
        php: `<?php

$phone = '${samplePhone}';
$url = '${apiBaseUrl}/api/contacts/check-number?phone=' . urlencode($phone);

$response = file_get_contents($url, false, stream_context_create([
    'http' => [
        'method' => 'GET',
        'header' => '${authHeader}: ${apiKey}',
    ],
]));

echo $response;`,
      },
    },
    {
      id: 'send-message',
      method: 'POST',
      path: '/api/messages/send',
      title: 'Check Number and Send Message',
      description: 'Checks whether the phone number exists on WhatsApp, then sends a text message or file attachment based on type.',
      languages: {
        curl: `curl -X POST '${apiBaseUrl}/api/messages/send' \\
  -H '${authHeader}: ${apiKey}' \\
  -F 'to=${samplePhone}' \\
  -F 'type=file' \\
  -F 'text=Product brochure' \\
  -F 'file=@/absolute/path/to/file.pdf'

curl -X POST '${apiBaseUrl}/api/messages/send' \\
  -H '${authHeader}: ${apiKey}' \\
  -F 'to=${samplePhone}' \\
  -F 'type=text' \\
  -F 'text=Hello from the WhatsApp Platform API'`,
        javascript: `const formData = new FormData();
formData.append('to', '${samplePhone}');
formData.append('type', 'file');
formData.append('text', 'Product brochure');
formData.append('file', fileInput.files[0]);

const response = await fetch('${apiBaseUrl}/api/messages/send', {
  method: 'POST',
  headers: {
    ${authLine},
  },
  body: formData,
});

const data = await response.json();
console.log(data);`,
        python: `import requests

with open('/absolute/path/to/file.pdf', 'rb') as file_handle:
    response = requests.post(
        '${apiBaseUrl}/api/messages/send',
        headers={
            '${authHeader}': '${apiKey}',
        },
        data={
            'to': '${samplePhone}',
            'type': 'file',
            'text': 'Product brochure',
        },
        files={
            'file': ('file.pdf', file_handle, 'application/pdf'),
        },
    )

print(response.json())`,
        php: `<?php

$file = new CURLFile('/absolute/path/to/file.pdf', 'application/pdf', 'file.pdf');

$ch = curl_init('${apiBaseUrl}/api/messages/send');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => [
        '${authHeader}: ${apiKey}',
    ],
    CURLOPT_POSTFIELDS => [
        'to' => '${samplePhone}',
        'type' => 'file',
        'text' => 'Product brochure',
        'file' => $file,
    ],
    CURLOPT_RETURNTRANSFER => true,
]);

$response = curl_exec($ch);
curl_close($ch);

echo $response;`,
      },
    },
    {
      id: 'send-text',
      method: 'POST',
      path: '/api/messages/send-text',
      title: 'Send Text Message',
      description: 'Sends a plain text WhatsApp message through the user session.',
      languages: {
        curl: `curl -X POST '${apiBaseUrl}/api/messages/send-text' \\
  -H '${authHeader}: ${apiKey}' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "to": "${samplePhone}",
    "text": "Hello from the WhatsApp Platform API"
  }'`,
        javascript: `const response = await fetch('${apiBaseUrl}/api/messages/send-text', {
  method: 'POST',
  headers: {
    ${authLine},
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    to: '${samplePhone}',
    text: 'Hello from the WhatsApp Platform API',
  }),
});

const data = await response.json();
console.log(data);`,
        python: `import requests

response = requests.post(
    '${apiBaseUrl}/api/messages/send-text',
    headers={
        '${authHeader}': '${apiKey}',
        'Content-Type': 'application/json',
    },
    json={
        'to': '${samplePhone}',
        'text': 'Hello from the WhatsApp Platform API',
    },
)

print(response.json())`,
        php: `<?php

$payload = json_encode([
    'to' => '${samplePhone}',
    'text' => 'Hello from the WhatsApp Platform API',
]);

$response = file_get_contents('${apiBaseUrl}/api/messages/send-text', false, stream_context_create([
    'http' => [
        'method' => 'POST',
        'header' => [
            '${authHeader}: ${apiKey}',
            'Content-Type: application/json',
        ],
        'content' => $payload,
    ],
]));

echo $response;`,
      },
    },
    {
      id: 'send-file',
      method: 'POST',
      path: '/api/messages/send-file',
      title: 'Send File Message',
      description: 'Uploads a file and sends it as a WhatsApp attachment with an optional caption.',
      languages: {
        curl: `curl -X POST '${apiBaseUrl}/api/messages/send-file' \\
  -H '${authHeader}: ${apiKey}' \\
  -F 'to=${samplePhone}' \\
  -F 'caption=Product brochure' \\
  -F 'file=@/absolute/path/to/file.pdf'`,
        javascript: `const formData = new FormData();
formData.append('to', '${samplePhone}');
formData.append('caption', 'Product brochure');
formData.append('file', fileInput.files[0]);

const response = await fetch('${apiBaseUrl}/api/messages/send-file', {
  method: 'POST',
  headers: {
    ${authLine},
  },
  body: formData,
});

const data = await response.json();
console.log(data);`,
        python: `import requests

with open('/absolute/path/to/file.pdf', 'rb') as file_handle:
    response = requests.post(
        '${apiBaseUrl}/api/messages/send-file',
        headers={
            '${authHeader}': '${apiKey}',
        },
        data={
            'to': '${samplePhone}',
            'caption': 'Product brochure',
        },
        files={
            'file': ('file.pdf', file_handle, 'application/pdf'),
        },
    )

print(response.json())`,
        php: `<?php

$file = new CURLFile('/absolute/path/to/file.pdf', 'application/pdf', 'file.pdf');

$ch = curl_init('${apiBaseUrl}/api/messages/send-file');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => [
        '${authHeader}: ${apiKey}',
    ],
    CURLOPT_POSTFIELDS => [
        'to' => '${samplePhone}',
        'caption' => 'Product brochure',
        'file' => $file,
    ],
    CURLOPT_RETURNTRANSFER => true,
]);

$response = curl_exec($ch);
curl_close($ch);

echo $response;`,
      },
    },
    {
      id: 'usage-me',
      method: 'GET',
      path: '/api/usage/me',
      title: 'Get Usage Summary',
      description: 'Returns usage records for the authenticated API user and linked sessions.',
      languages: {
        curl: `curl '${apiBaseUrl}/api/usage/me' \\
  -H '${authHeader}: ${apiKey}'`,
        javascript: `const response = await fetch('${apiBaseUrl}/api/usage/me', {
  headers: {
    ${authLine},
  },
});

const data = await response.json();
console.log(data);`,
        python: `import requests

response = requests.get(
    '${apiBaseUrl}/api/usage/me',
    headers={
        '${authHeader}': '${apiKey}',
    },
)

print(response.json())`,
        php: `<?php

$response = file_get_contents('${apiBaseUrl}/api/usage/me', false, stream_context_create([
    'http' => [
        'method' => 'GET',
        'header' => '${authHeader}: ${apiKey}',
    ],
]));

echo $response;`,
      },
    },
  ] satisfies EndpointDoc[];
}

export function UserManageClient({ userId }: { userId: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [bundle, setBundle] = useState<AccessBundle | null>(null);
  const [messages, setMessages] = useState<MessageActivity[]>([]);
  const [freshKey, setFreshKey] = useState<FreshKey | null>(null);
  const [currentView, setCurrentView] = useState<UserManageView>('access');
  const [selectedEndpointId, setSelectedEndpointId] = useState('request-qr');
  const [selectedLanguage, setSelectedLanguage] = useState<ExampleLanguage>('curl');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [liveSession, setLiveSession] = useState<SessionLiveState | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [password, setPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithToken('/auth/me')
      .then(() => {
        setToken('cookie');
      })
      .catch(() => {
        window.location.href = '/';
      });
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }

    setLoading(true);
    Promise.all([
      fetchWithToken(`/admin/users/${userId}/api-access`, token),
      fetchWithToken(`/admin/users/${userId}/messages`, token),
    ])
      .then(([bundleData, messageData]) => {
        setBundle(bundleData);
        setMessages(messageData);
        setSelectedSessionId((current) => current ?? bundleData.sessions[0]?.id ?? null);
        setError(null);
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load user');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [token, userId]);

  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;

    const loadMessages = async () => {
      try {
        const data = await fetchWithToken(`/admin/users/${userId}/messages`, token);
        if (!cancelled) {
          setMessages(data);
        }
      } catch {
        // Leave the last known list in place if polling fails briefly.
      }
    };

    void loadMessages();
    const interval = window.setInterval(loadMessages, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [token, userId]);

  const generatedKeyName = useMemo(() => {
    if (!bundle?.user.name) {
      return 'Primary API Key';
    }

    return `${bundle.user.name} API Key`;
  }, [bundle?.user.name]);

  const apiBaseUrl = useMemo(() => bundle?.docs.swaggerUrl?.replace(/\/docs$/, '') ?? apiUrl, [bundle?.docs.swaggerUrl]);
  const activeApiKey = freshKey?.rawKey ?? 'YOUR_API_KEY';
  const endpointDocs = useMemo(
    () =>
      buildEndpointDocs({
        apiBaseUrl,
        authHeader: bundle?.docs.authHeader ?? 'X-API-Key',
        apiKey: activeApiKey,
        samplePhone: liveSession?.phoneNumber ?? '60123456789',
      }),
    [activeApiKey, apiBaseUrl, bundle?.docs.authHeader, liveSession?.phoneNumber],
  );
  const selectedEndpoint = endpointDocs.find((endpoint) => endpoint.id === selectedEndpointId) ?? endpointDocs[0];

  useEffect(() => {
    if (!token || !selectedSessionId) {
      return;
    }

    let cancelled = false;

    const loadLiveSession = async () => {
      try {
        const data = await fetchWithToken(`/admin/sessions/${selectedSessionId}/live`, token);
        if (!cancelled) {
          setLiveSession(data);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load session state');
        }
      }
    };

    void loadLiveSession();
    const interval = window.setInterval(loadLiveSession, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [token, selectedSessionId]);

  async function copyToClipboard(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied to clipboard.`);
    } catch {
      toast.error(`Unable to copy ${label.toLowerCase()}.`);
    }
  }

  async function generateKey() {
    if (!token || !bundle) {
      return;
    }

    setNotice(null);
    setError(null);

    try {
      const response = await fetch(`${apiUrl}/admin/users/${bundle.user.id}/api-keys`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          ...csrfHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: generatedKeyName,
        }),
      });

      if (!response.ok) {
        throw new Error('Unable to generate API key');
      }

      const created = await response.json();
      setFreshKey({
        id: created.id,
        name: created.name,
        rawKey: created.rawKey,
      });
      toast.success(`New API key generated for ${bundle.user.email}. Copy it now.`);

      const [refreshedBundle, refreshedMessages] = await Promise.all([
        fetchWithToken(`/admin/users/${bundle.user.id}/api-access`, token),
        fetchWithToken(`/admin/users/${bundle.user.id}/messages`, token),
      ]);
      setBundle(refreshedBundle);
      setMessages(refreshedMessages);
    } catch (generationError) {
      toast.error(generationError instanceof Error ? generationError.message : 'Unable to generate API key');
    }
  }

  async function revokeKey(keyId: string, keyName: string) {
    if (!token || !bundle) {
      return;
    }

    const confirmed = await confirmAction({
      title: 'Delete API key?',
      text: `"${keyName}" will be removed for this user.`,
      confirmButtonText: 'Delete key',
    });
    if (!confirmed) {
      return;
    }

    setNotice(null);
    setError(null);

    try {
      const response = await fetch(`${apiUrl}/admin/api-keys/${keyId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: csrfHeaders(),
      });

      if (!response.ok) {
        throw new Error('Unable to delete API key');
      }

      const [refreshedBundle, refreshedMessages] = await Promise.all([
        fetchWithToken(`/admin/users/${bundle.user.id}/api-access`, token),
        fetchWithToken(`/admin/users/${bundle.user.id}/messages`, token),
      ]);
      setBundle(refreshedBundle);
      setMessages(refreshedMessages);
      if (freshKey?.id === keyId) {
        setFreshKey(null);
      }
      toast.success(`API key "${keyName}" deleted.`);
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : 'Unable to delete API key');
    }
  }

  async function setKeyStatus(keyId: string, keyName: string, isActive: boolean) {
    if (!token || !bundle) {
      return;
    }

    const confirmed = await confirmAction({
      title: `${isActive ? 'Unblock' : 'Block'} API key?`,
      text: isActive
        ? `"${keyName}" will become the active key for ${bundle.user.email}. Other active keys for this user will be blocked.`
        : `"${keyName}" will stop working for ${bundle.user.email}.`,
      confirmButtonText: isActive ? 'Unblock key' : 'Block key',
      confirmButtonColor: isActive ? '#1a73e8' : '#dc2626',
    });
    if (!confirmed) {
      return;
    }

    setNotice(null);
    setError(null);

    try {
      const response = await fetch(`${apiUrl}/admin/api-keys/${keyId}/status`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          ...csrfHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isActive }),
      });

      if (!response.ok) {
        throw new Error('Unable to update API key status');
      }

      const [refreshedBundle, refreshedMessages] = await Promise.all([
        fetchWithToken(`/admin/users/${bundle.user.id}/api-access`, token),
        fetchWithToken(`/admin/users/${bundle.user.id}/messages`, token),
      ]);
      setBundle(refreshedBundle);
      setMessages(refreshedMessages);
      if (!isActive && freshKey?.id === keyId) {
        setFreshKey(null);
      }
      toast.success(`API key "${keyName}" ${isActive ? 'unblocked' : 'blocked'}.`);
    } catch (statusError) {
      toast.error(statusError instanceof Error ? statusError.message : 'Unable to update API key status');
    }
  }

  async function requestQr() {
    if (!token || !selectedSessionId) {
      return;
    }

    setConnecting(true);
    setNotice(null);
    setError(null);

    try {
      const response = await fetch(`${apiUrl}/admin/sessions/${selectedSessionId}/request-qr`, {
        method: 'POST',
        credentials: 'include',
        headers: csrfHeaders(),
      });

      if (!response.ok) {
        throw new Error('Unable to request QR');
      }

      const data = await response.json();
      toast.success(`QR requested for session ${data.sessionId}.`);
      const refreshed = await fetchWithToken(`/admin/sessions/${selectedSessionId}/live`, token);
      setLiveSession(refreshed);
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : 'Unable to request QR');
    } finally {
      setConnecting(false);
    }
  }

  async function changePassword() {
    if (!token || !bundle || password.trim().length < 8) {
      toast.error('Password must be at least 8 characters long.');
      return;
    }

    setSavingPassword(true);
    setNotice(null);
    setError(null);

    try {
      const response = await fetch(`${apiUrl}/admin/users/${bundle.user.id}/password`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          ...csrfHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        throw new Error('Unable to change password');
      }

      setPassword('');
      toast.success(`Password updated for ${bundle.user.email}.`);
    } catch (passwordError) {
      toast.error(passwordError instanceof Error ? passwordError.message : 'Unable to change password');
    } finally {
      setSavingPassword(false);
    }
  }

  if (loading || !bundle) {
    return <main className="p-10 text-slate">{error ?? 'Loading user management...'}</main>;
  }

  const statusStyles: Record<string, string> = {
    queued: 'bg-amber-100 text-amber-800',
    sent: 'bg-emerald-100 text-emerald-800',
    failed: 'bg-red-100 text-red-700',
  };

  const sentCount = messages.filter((message) => message.status === 'sent').length;
  const failedCount = messages.filter((message) => message.status === 'failed').length;
  const queuedCount = messages.filter((message) => message.status === 'queued').length;
  const connectedState = liveSession?.status === 'connected';
  const currentMeta: Record<UserManageView, { eyebrow: string; title: string; description: string }> = {
    access: {
      eyebrow: 'User Access',
      title: 'Keys, portal access, and credentials',
      description: 'Handle API key sharing and password changes for this user without mixing in live session or message tooling.',
    },
    connection: {
      eyebrow: 'WhatsApp Connection',
      title: 'Manage the linked session',
      description: 'Request QR codes, inspect the current session state, and share connection details in one focused area.',
    },
    reference: {
      eyebrow: 'API Reference',
      title: 'Developer examples for this user',
      description: 'Switch between endpoints and examples without competing with credentials or message activity.',
    },
    activity: {
      eyebrow: 'Message Activity',
      title: 'Recent delivery lifecycle',
      description: 'Review queued, sent, and failed jobs with the context needed for follow-up or support.',
    },
  };
  const navItems: Array<{ id: UserManageView; label: string }> = [
    { id: 'access', label: 'Access' },
    { id: 'connection', label: 'Connection' },
    { id: 'reference', label: 'API Reference' },
    { id: 'activity', label: 'Activity' },
  ];

  return (
    <main className="drive-shell">
      <div className="mx-auto flex min-h-screen w-full max-w-[1200px] flex-col gap-6 px-6 py-8">
        <header className="drive-topbar">
          <div>
            <Link href="/dashboard" className="text-sm font-medium text-signal">
              Back to Dashboard
            </Link>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink">{bundle.user.name}</h1>
            <p className="mt-2 text-slate">{bundle.user.email}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                className="drive-button-secondary"
                onClick={() => copyToClipboard(bundle.portal.shareUrl, 'Client portal URL')}
                aria-label="Copy client portal URL"
                title="Copy client portal URL"
              >
                <CopyIcon />
                Copy URL
              </button>
            </div>
          </div>
          <button className="drive-button-primary" onClick={generateKey}>
            Generate New API Key
          </button>
        </header>

        {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

        <section className="drive-topbar">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.26em] text-signal">{currentMeta[currentView].eyebrow}</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-ink">{currentMeta[currentView].title}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate">{currentMeta[currentView].description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {navItems.map((item) => (
              <button
                key={item.id}
                className={currentView === item.id ? 'drive-button-primary' : 'drive-button-secondary'}
                onClick={() => setCurrentView(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>

        {currentView === 'access' ? (
          <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="drive-section">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-signal">API Access</p>
                  <h2 className="mt-2 text-2xl font-semibold text-ink">Shareable credentials</h2>
                </div>
                <span className="drive-badge bg-cloud text-slate">{bundle.apiKeys.length} stored keys</span>
              </div>
              <div className="mt-5 rounded-3xl border border-line bg-cloud p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-signal">Actual API Key</h3>
                <p className="mt-2 text-sm text-slate">
                  This is the only place where the raw key can be copied. Stored keys below only show labels because the real key is hashed after creation.
                </p>
              </div>
              {!freshKey ? (
                <button
                  className="drive-button-primary"
                  onClick={generateKey}
                >
                  Generate Key To Copy
                </button>
              ) : null}
            </div>

            {freshKey ? (
              <div className="mt-4">
                <p className="text-sm font-medium text-ink">{freshKey.name}</p>
                <div className="mt-3 flex items-start gap-3 rounded-2xl border border-line bg-white px-4 py-4">
                  <p className="min-w-0 flex-1 font-mono text-xs text-ink break-all">{freshKey.rawKey}</p>
                  <button
                    className="drive-button-primary shrink-0"
                    onClick={() => copyToClipboard(freshKey.rawKey, 'API key')}
                    aria-label="Copy API key"
                    title="Copy API key"
                  >
                    <CopyIcon />
                    Copy
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-3">
                  <button
                    className="drive-button-secondary"
                    onClick={() => copyToClipboard(`${bundle.docs.authHeader}: ${freshKey.rawKey}`, 'Auth header')}
                  >
                    Copy Auth Header
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-line bg-white px-4 py-4 text-sm text-slate">
                No raw API key is available on this page yet. Click <span className="font-medium text-ink">Generate Key To Copy</span> and the actual key with copy icon will appear here.
              </div>
            )}
          </div>

              <div className="mt-6 space-y-3">
                <div className="rounded-2xl border border-line bg-white px-4 py-4 text-sm">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-signal">Password</h3>
                  <p className="mt-2 text-slate">
                    Change the login password for this API user before sharing the client portal.
                  </p>
                  <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                    <input
                      className="drive-input min-w-0 flex-1"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="New password"
                    />
                    <button
                      className="drive-button-secondary disabled:opacity-60"
                      onClick={changePassword}
                      disabled={savingPassword}
                    >
                      {savingPassword ? 'Saving...' : 'Change Password'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="drive-section">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-signal">Stored Keys</p>
                  <h2 className="mt-2 text-2xl font-semibold text-ink">Saved credentials</h2>
                </div>
              </div>
              <div className="mt-5 space-y-3">
                {bundle.apiKeys.length ? (
                  bundle.apiKeys.map((key) => (
                    <div key={key.id} className="rounded-2xl border border-line bg-white px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="font-medium text-ink">{key.name}</p>
                        <span className={`drive-badge ${key.isActive ? 'bg-warm/10 text-warm' : 'bg-red-50 text-red-700'}`}>
                          {key.isActive ? 'Active' : 'Blocked'}
                        </span>
                      </div>
                      {key.isActive && key.rawKey ? (
                        <div className="mt-3 flex items-start gap-3 rounded-2xl bg-cloud px-4 py-4">
                          <p className="min-w-0 flex-1 font-mono text-xs text-ink break-all">{key.rawKey}</p>
                          <button
                            className="drive-button-primary shrink-0"
                            onClick={() => copyToClipboard(key.rawKey ?? '', `${key.name} API key`)}
                            aria-label={`Copy ${key.name} API key`}
                            title={`Copy ${key.name} API key`}
                          >
                            <CopyIcon />
                            Copy
                          </button>
                        </div>
                      ) : !key.isActive ? (
                        <p className="mt-3 rounded-2xl bg-red-50 px-4 py-4 text-xs text-red-700">
                          This key is blocked. Its raw value is hidden and it cannot be used for API requests.
                        </p>
                      ) : (
                        <p className="mt-3 rounded-2xl bg-mist px-4 py-4 text-xs text-slate">
                          Raw key is not available for this older record. Generate a new key if you need a copyable value.
                        </p>
                      )}
                      <p className="mt-1 text-slate">
                        {key.lastUsedAt ? `Last used ${new Date(key.lastUsedAt).toLocaleString()}` : 'Never used'}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          className={key.isActive ? 'drive-button-danger' : 'drive-button-secondary'}
                          onClick={() => setKeyStatus(key.id, key.name, !key.isActive)}
                        >
                          {key.isActive ? 'Block API Key' : 'Unblock API Key'}
                        </button>
                        <button className="drive-button-danger" onClick={() => revokeKey(key.id, key.name)}>
                          Delete API Key
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate">No stored keys.</p>
                )}
              </div>
            </div>
          </section>
        ) : null}

        {currentView === 'connection' ? (
          <section className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="drive-section">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-signal">Session Summary</p>
                  <h2 className="mt-2 text-2xl font-semibold text-ink">Connection analytics</h2>
                </div>
                <span className={`drive-badge ${connectedState ? 'bg-warm/10 text-warm' : 'bg-amber-100 text-amber-800'}`}>
                  {liveSession?.status ?? 'unknown'}
                </span>
              </div>
              <div className="mt-5 grid gap-3">
                <div className="rounded-[24px] border border-line bg-cloud px-4 py-4">
                  <p className="text-sm text-slate">Session Label</p>
                  <p className="mt-2 text-xl font-semibold text-ink">{liveSession?.label ?? bundle.sessions[0]?.label ?? 'Primary session'}</p>
                </div>
                <div className="rounded-[24px] border border-line bg-cloud px-4 py-4">
                  <p className="text-sm text-slate">Connected Number</p>
                  <p className="mt-2 text-xl font-semibold text-ink">{liveSession?.phoneNumber ?? 'Not connected yet'}</p>
                </div>
                <div className="rounded-[24px] border border-line bg-cloud px-4 py-4">
                  <p className="text-sm text-slate">Push Name</p>
                  <p className="mt-2 text-xl font-semibold text-ink">{liveSession?.pushName ?? 'Not available'}</p>
                </div>
              </div>
            </div>

            <div className="drive-section">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-2xl font-semibold text-ink">WhatsApp Connection</h2>
                <button
                  className="drive-button-primary bg-warm hover:bg-warm/90 disabled:opacity-60"
                  onClick={requestQr}
                  disabled={!selectedSessionId || connecting}
                >
                  {connecting ? 'Requesting QR...' : 'Connect WhatsApp'}
                </button>
              </div>

              <div className="mt-6 rounded-3xl bg-cloud p-5">
                <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-signal">Selected Session</h3>
                {liveSession ? (
                  <div className="mt-4 space-y-4">
                    <div className="rounded-2xl border border-line bg-white px-4 py-4 text-sm text-slate">
                      <p className="font-semibold text-ink">{liveSession.label}</p>
                      <p className="mt-1">Status: {liveSession.status}</p>
                      <p className="mt-1">Phone: {liveSession.phoneNumber ?? 'Not connected yet'}</p>
                      <p className="mt-1">Push name: {liveSession.pushName ?? 'Not available'}</p>
                    </div>
                    {liveSession.qrDataUrl ? (
                      <div className="rounded-2xl border border-line bg-white p-4">
                        <Image
                          src={liveSession.qrDataUrl}
                          alt={`QR for ${liveSession.label}`}
                          width={260}
                          height={260}
                          className="mx-auto h-[260px] w-[260px] rounded-2xl"
                          unoptimized
                        />
                        <p className="mt-3 text-center text-xs text-slate">
                          Scan this QR in WhatsApp Linked Devices to connect this session.
                        </p>
                      </div>
                    ) : (
                      <p className="rounded-2xl border border-line bg-white px-4 py-4 text-sm text-slate">
                        No QR is active right now. Click <span className="font-medium text-ink">Connect WhatsApp</span> to request one.
                      </p>
                    )}
                    {liveSession.qr ? (
                      <button className="drive-button-secondary" onClick={() => copyToClipboard(liveSession.qr ?? '', 'QR payload')}>
                        <CopyIcon />
                        Copy QR Payload
                      </button>
                    ) : null}
                    {liveSession.isMockMode ? (
                      <p className="text-xs text-slate">
                        Mock WhatsApp mode is enabled in this deployment. The connection flow UI is live, but a real scannable production pairing requires the Baileys adapter to be switched from mock mode.
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-slate">Select a session to manage its WhatsApp connection.</p>
                )}
              </div>
            </div>
          </section>
        ) : null}

        {currentView === 'reference' ? (
          <section className="drive-section">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold text-ink">API Reference</h2>
            <p className="mt-2 text-sm text-slate">
              Click any endpoint on the left to see ready-to-use examples on the right. Generate a key above, then use it with the{' '}
              <span className="font-mono text-ink">{bundle.docs.authHeader}</span> header.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {bundle.docs.swaggerJsonUrl ? (
              <a
                className="rounded-xl border border-slate/20 bg-white px-3 py-2 text-xs font-medium text-ink"
                href={bundle.docs.swaggerJsonUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open API JSON
              </a>
            ) : null}
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[0.72fr_1.28fr]">
          <div className="rounded-3xl bg-cloud p-5">
            <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-signal">User Endpoints</h3>
            <div className="mt-4 space-y-3">
              {endpointDocs.map((endpoint) => (
                <button
                  key={endpoint.id}
                  className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                    selectedEndpoint.id === endpoint.id
                      ? 'border-signal bg-white shadow-sm'
                      : 'border-transparent bg-white/80 hover:border-line'
                  }`}
                  onClick={() => setSelectedEndpointId(endpoint.id)}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
                        endpoint.method === 'POST'
                          ? 'bg-warm/15 text-warm'
                          : 'bg-signal/12 text-signal'
                      }`}
                    >
                      {endpoint.method}
                    </span>
                    <span className="font-mono text-xs text-ink">{endpoint.path}</span>
                  </div>
                  <p className="mt-3 text-sm font-medium text-ink">{endpoint.title}</p>
                  <p className="mt-1 text-xs text-slate">{endpoint.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-line bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
                      selectedEndpoint.method === 'POST'
                        ? 'bg-warm/15 text-warm'
                        : 'bg-signal/12 text-signal'
                    }`}
                  >
                    {selectedEndpoint.method}
                  </span>
                  <span className="font-mono text-sm text-ink">{selectedEndpoint.path}</span>
                </div>
                <h3 className="mt-4 text-2xl font-semibold text-ink">{selectedEndpoint.title}</h3>
                <p className="mt-2 max-w-2xl text-sm text-slate">{selectedEndpoint.description}</p>
              </div>

              <button
                className="drive-button-secondary"
                onClick={() => copyToClipboard(selectedEndpoint.languages[selectedLanguage], `${selectedLanguage} example`)}
              >
                <CopyIcon />
                Copy {selectedLanguage}
              </button>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {(['curl', 'javascript', 'python', 'php'] as ExampleLanguage[]).map((language) => (
                <button
                  key={language}
                  className={`rounded-xl px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] transition ${
                    selectedLanguage === language
                      ? 'bg-ink text-white'
                      : 'border border-line bg-cloud text-slate'
                  }`}
                  onClick={() => setSelectedLanguage(language)}
                >
                  {language === 'javascript' ? 'JavaScript' : language.toUpperCase()}
                </button>
              ))}
            </div>

            <div className="mt-5 rounded-3xl bg-[#101826] p-5 text-white shadow-inner">
              <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[13px] leading-6 text-slate-100">
                <code>{selectedEndpoint.languages[selectedLanguage]}</code>
              </pre>
            </div>

            <div className="mt-5 rounded-2xl bg-cloud p-4 text-sm text-slate">
              <p>
                Header: <span className="font-mono text-ink">{bundle.docs.authHeader}</span>
              </p>
              <p className="mt-2">
                Current example key:{' '}
                <span className="font-mono text-ink">{freshKey?.rawKey ? 'fresh generated key inserted' : 'placeholder key shown until you generate one'}</span>
              </p>
              <p className="mt-2">
                Sample phone:{' '}
                <span className="font-mono text-ink">{liveSession?.phoneNumber ?? '60123456789'}</span>
              </p>
            </div>
          </div>
        </div>
          </section>
        ) : null}

        {currentView === 'activity' ? (
          <section className="space-y-6">
            <div className="grid gap-4 md:grid-cols-3">
              {[
                { label: 'Queued', value: queuedCount, tone: 'bg-amber-100 text-amber-800' },
                { label: 'Sent', value: sentCount, tone: 'bg-emerald-100 text-emerald-800' },
                { label: 'Failed', value: failedCount, tone: 'bg-red-100 text-red-700' },
              ].map((item) => (
                <div key={item.label} className="drive-section">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-slate">{item.label}</p>
                    <span className={`drive-badge ${item.tone}`}>{item.label}</span>
                  </div>
                  <p className="mt-4 text-3xl font-semibold text-ink">{item.value}</p>
                </div>
              ))}
            </div>

            <section className="drive-section">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold text-ink">Recent Message Activity</h2>
            <p className="mt-2 text-sm text-slate">
              This shows the real lifecycle for sends: queued first, then sent or failed after the worker finishes processing.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {messages.length ? (
            messages.map((message) => (
              <div key={message.id} className="rounded-2xl border border-line bg-white px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      {message.messageType.toUpperCase()} to {message.toNumber ?? 'Unknown recipient'}
                    </p>
                    <p className="mt-1 text-xs text-slate">
                      {message.session.label} · queued {new Date(message.createdAt).toLocaleString()}
                    </p>
                    <p className="mt-1 text-xs text-slate">
                      Job ID: {message.jobId ?? 'Not recorded'}
                      {message.providerMessageId ? ` · Provider ID: ${message.providerMessageId}` : ''}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${
                      statusStyles[message.status] ?? 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {message.status}
                  </span>
                </div>
                <p className="mt-3 text-xs text-slate">
                  Last updated {new Date(message.updatedAt).toLocaleString()}
                </p>
                {message.errorText ? (
                  <p className="mt-2 rounded-2xl bg-red-50 px-3 py-3 text-xs text-red-700">{message.errorText}</p>
                ) : null}
              </div>
            ))
          ) : (
            <p className="text-sm text-slate">No message activity yet for this user.</p>
          )}
        </div>
            </section>
          </section>
        ) : null}
      </div>
    </main>
  );
}
