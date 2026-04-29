import { LoginForm } from '../components/login-form';

export default function HomePage() {
  return (
    <main className="drive-shell">
      <div className="mx-auto grid min-h-screen w-full max-w-7xl items-center gap-10 px-6 py-16 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="space-y-8">
          <span className="inline-flex rounded-full bg-signal/10 px-4 py-2 text-sm font-medium text-signal">
            Google Drive inspired control workspace
          </span>
          <div className="space-y-5">
            <h1 className="max-w-4xl text-5xl font-semibold tracking-tight text-ink sm:text-6xl">
              A calmer dashboard for WhatsApp operations, team access, and message delivery.
            </h1>
            <p className="max-w-3xl text-lg leading-8 text-slate">
              Built for production workflows: create users, share API keys, connect sessions, review live status, and manage client access in a cleaner workspace UI.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {[
              'Admin-managed user access',
              'Google-style, lighter workspace hierarchy',
              'Live queue and session visibility',
            ].map((item) => (
              <div key={item} className="rounded-[28px] border border-line bg-white px-5 py-5 text-sm font-medium text-slate shadow-panel">
                {item}
              </div>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[32px] border border-line bg-white px-6 py-6 shadow-panel">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-signal">Designed For Teams</p>
              <p className="mt-3 text-base leading-7 text-slate">
                Superadmins, admins, and API users each get a clearer lane, without the cluttered MVP feel.
              </p>
            </div>
            <div className="rounded-[32px] border border-line bg-gradient-to-br from-signal to-[#4c8df6] px-6 py-6 text-white shadow-float">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/70">Now Shipping</p>
              <p className="mt-3 text-base leading-7 text-white/90">
                Real session management, shareable client portals, and polished dashboard UX in one place.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-[36px] border border-line bg-white p-8 shadow-panel">
          <LoginForm />
        </section>
      </div>
    </main>
  );
}
