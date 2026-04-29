import './globals.css';
import 'sweetalert2/dist/sweetalert2.min.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppToaster } from '../components/app-toaster';

export const metadata: Metadata = {
  title: 'WhatsApp Platform',
  description: 'Admin dashboard for WhatsApp API operations',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <AppToaster />
      </body>
    </html>
  );
}
