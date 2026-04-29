import { ClientAccessClient } from '../../../components/client-access-client';

export default async function ClientAccessPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ClientAccessClient token={token} />;
}
