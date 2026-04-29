export enum UserRole {
  SUPERADMIN = 'SUPERADMIN',
  ADMIN = 'ADMIN',
  API_USER = 'API_USER',
}

export enum SessionStatus {
  CREATED = 'created',
  PENDING_QR = 'pending_qr',
  CONNECTED = 'connected',
  DISCONNECTED = 'disconnected',
  RECONNECTING = 'reconnecting',
  LOGGED_OUT = 'logged_out',
  FAILED = 'failed',
}

export enum QueueName {
  SEND = 'whatsapp-send',
  RECONNECT = 'whatsapp-reconnect',
  QR = 'whatsapp-qr',
  NUMBER_CHECK = 'whatsapp-number-check',
  MAINTENANCE = 'whatsapp-maintenance',
}

export enum AuditAction {
  LOGIN = 'auth.login',
  USER_CREATED = 'user.created',
  USER_DELETED = 'user.deleted',
  API_KEY_CREATED = 'api_key.created',
  API_KEY_REVOKED = 'api_key.revoked',
  API_KEY_STATUS_CHANGED = 'api_key.status_changed',
  SESSION_CREATED = 'session.created',
  SESSION_QR_REQUESTED = 'session.qr.requested',
  MESSAGE_QUEUED = 'message.queued',
}

export type QueueJobPayload =
  | {
      type: 'sendText';
      sessionId: string;
      userId: string;
      to: string;
      text: string;
    }
  | {
      type: 'sendFile';
      sessionId: string;
      userId: string;
      to: string;
      caption?: string;
      fileName: string;
      mimeType: string;
      storagePath: string;
    }
  | {
      type: 'checkAndSend';
      sessionId: string;
      userId: string;
      to: string;
      messageType: 'text' | 'file';
      text?: string;
      caption?: string;
      fileName?: string;
      mimeType?: string;
      storagePath?: string;
    }
  | {
      type: 'requestQr';
      sessionId: string;
      actorUserId: string;
    }
  | {
      type: 'checkNumber';
      sessionId: string;
      phone: string;
    };
