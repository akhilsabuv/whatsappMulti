'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${apiUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        throw new Error('Unable to sign in');
      }

      await response.json();
      toast.success('Signed in successfully.');
      router.push('/dashboard');
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Unable to sign in';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm uppercase tracking-[0.25em] text-signal">Workspace Login</p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-ink">Sign in to the control plane</h2>
        <p className="mt-3 text-sm leading-6 text-slate">
          Access the admin workspace, manage WhatsApp users, and share production-ready API access from one secure place.
        </p>
      </div>
      <form className="space-y-4" onSubmit={onSubmit}>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate">Email</span>
          <input
            className="drive-input w-full"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate">Password</span>
          <input
            type="password"
            className="drive-input w-full"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="drive-button-primary w-full justify-center disabled:opacity-70"
        >
          {loading ? 'Signing in...' : 'Open dashboard'}
        </button>
      </form>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
