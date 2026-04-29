import { UserManageClient } from '../../../../components/user-manage-client';

export default async function UserManagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <UserManageClient userId={id} />;
}

