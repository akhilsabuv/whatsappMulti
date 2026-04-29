export type UserEntity = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: string;
  parentAdminId: string | null;
  isActive: boolean;
  portalTokenVersion: number;
  createdAt: Date;
  updatedAt: Date;
};

export type JsonPayload =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonPayload }
  | JsonPayload[];
