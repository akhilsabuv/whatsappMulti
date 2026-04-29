'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type PortalPayload = {
  user: {
    id: string;
    name: string;
    email: string;
  };
  session: {
    sessionId: string;
    label: string;
    status: string;
    phoneNumber: string | null;
    pushName?: string | null;
    qr: string | null;
    qrDataUrl: string | null;
    isMockMode: boolean;
  };
  shareUrl: string;
};

function CopyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-2">
      <rect x="9" y="9" width="10" height="10" rx="2" />
      <path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function ClientAccessClient({ token }: { token: string }) {
  const [portal, setPortal] = useState<PortalPayload | null>(null);
  const [to, setTo] = useState('');
  const [text, setText] = useState('Hello from the WhatsApp Platform test interface.');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [refreshingQr, setRefreshingQr] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadPortal = async () => {
      try {
        const response = await fetch(`${apiUrl}/client-portal/${token}`, {
          cache: 'no-store',
        });
        if (!response.ok) {
          throw new Error('Unable to load shared page');
        }

        const data = await response.json();
        if (!cancelled) {
          setPortal(data);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load shared page');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadPortal();
    const interval = window.setInterval(loadPortal, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [token]);

  async function copyToClipboard(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied to clipboard.`);
    } catch {
      toast.error(`Unable to copy ${label.toLowerCase()}.`);
    }
  }

  async function requestQr() {
    setRefreshingQr(true);
    setNotice(null);
    setError(null);

    try {
      const response = await fetch(`${apiUrl}/client-portal/${token}/request-qr`, {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error('Unable to refresh QR');
      }

      const refreshed = await fetch(`${apiUrl}/client-portal/${token}`, {
        cache: 'no-store',
      });
      const data = await refreshed.json();
      setPortal(data);
      toast.success('Fresh QR requested successfully.');
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : 'Unable to refresh QR');
    } finally {
      setRefreshingQr(false);
    }
  }

  async function sendTestMessage() {
    if (!to.trim() || !text.trim()) {
      toast.error('Phone number and message are required.');
      return;
    }

    setSending(true);
    setNotice(null);
    setError(null);

    try {
      const response = await fetch(`${apiUrl}/client-portal/${token}/send-test-message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ to, text }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message ?? 'Unable to queue test message');
      }

      const data = await response.json();
      toast.success(`Test message queued. Job ${data.jobId}.`);
    } catch (sendError) {
      toast.error(sendError instanceof Error ? sendError.message : 'Unable to queue test message');
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return <main className="p-10 text-slate">Loading shared access...</main>;
  }

  if (!portal) {
    return <main className="p-10 text-red-700">{error ?? 'Shared access is unavailable.'}</main>;
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl space-y-8 px-6 py-10">
      <header className="rounded-[2rem] bg-ink px-8 py-8 text-white shadow-panel">
        <p className="text-sm uppercase tracking-[0.3em] text-white/60">Client Access</p>
        <h1 className="mt-3 text-4xl font-semibold">{portal.user.name}</h1>
        <p className="mt-2 text-white/75">{portal.user.email}</p>
      </header>

      {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

      <section className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="panel p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-semibold text-ink">WhatsApp QR</h2>
            <button
              className="rounded-2xl bg-warm px-4 py-3 text-sm font-medium text-white disabled:opacity-60"
              onClick={requestQr}
              disabled={refreshingQr}
            >
              {refreshingQr ? 'Refreshing...' : 'Refresh QR'}
            </button>
          </div>

          <div className="mt-5 rounded-3xl bg-mist p-5">
            <p className="text-sm text-slate">Status: {portal.session.status}</p>
            <p className="mt-1 text-sm text-slate">Phone: {portal.session.phoneNumber ?? 'Not connected yet'}</p>
            <p className="mt-1 text-sm text-slate">Push name: {portal.session.pushName ?? 'Not available'}</p>

            {portal.session.qrDataUrl ? (
              <div className="mt-4 rounded-2xl bg-white p-4">
                <Image
                  src={portal.session.qrDataUrl}
                  alt={`QR for ${portal.session.label}`}
                  width={280}
                  height={280}
                  className="mx-auto h-[280px] w-[280px] rounded-2xl"
                  unoptimized
                />
                <p className="mt-3 text-center text-xs text-slate">
                  Scan this QR from WhatsApp Linked Devices.
                </p>
              </div>
            ) : (
              <p className="mt-4 rounded-2xl bg-white px-4 py-4 text-sm text-slate">
                No active QR right now. Use <span className="font-medium text-ink">Refresh QR</span> to request a new one.
              </p>
            )}
          </div>
        </div>

        <div className="panel p-6">
          <h2 className="text-2xl font-semibold text-ink">Send Test Message</h2>
          <p className="mt-2 text-sm text-slate">
            Use this simple form to verify the linked WhatsApp session can send messages successfully.
          </p>
          <div className="mt-5 grid gap-3">
            <input
              className="rounded-2xl border border-slate/15 bg-mist px-4 py-3"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              placeholder="Recipient phone, for example 919999999999"
            />
            <textarea
              className="min-h-36 rounded-2xl border border-slate/15 bg-mist px-4 py-3"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Message text"
            />
            <button
              className="rounded-2xl bg-ink px-4 py-3 text-sm font-medium text-white disabled:opacity-60"
              onClick={sendTestMessage}
              disabled={sending}
            >
              {sending ? 'Sending...' : 'Send Test Message'}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
