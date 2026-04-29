"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditAction = exports.QueueName = exports.SessionStatus = exports.UserRole = void 0;
var UserRole;
(function (UserRole) {
    UserRole["SUPERADMIN"] = "SUPERADMIN";
    UserRole["ADMIN"] = "ADMIN";
    UserRole["API_USER"] = "API_USER";
})(UserRole || (exports.UserRole = UserRole = {}));
var SessionStatus;
(function (SessionStatus) {
    SessionStatus["CREATED"] = "created";
    SessionStatus["PENDING_QR"] = "pending_qr";
    SessionStatus["CONNECTED"] = "connected";
    SessionStatus["DISCONNECTED"] = "disconnected";
    SessionStatus["RECONNECTING"] = "reconnecting";
    SessionStatus["LOGGED_OUT"] = "logged_out";
    SessionStatus["FAILED"] = "failed";
})(SessionStatus || (exports.SessionStatus = SessionStatus = {}));
var QueueName;
(function (QueueName) {
    QueueName["SEND"] = "whatsapp-send";
    QueueName["RECONNECT"] = "whatsapp-reconnect";
    QueueName["QR"] = "whatsapp-qr";
    QueueName["NUMBER_CHECK"] = "whatsapp-number-check";
    QueueName["MAINTENANCE"] = "whatsapp-maintenance";
})(QueueName || (exports.QueueName = QueueName = {}));
var AuditAction;
(function (AuditAction) {
    AuditAction["LOGIN"] = "auth.login";
    AuditAction["USER_CREATED"] = "user.created";
    AuditAction["API_KEY_CREATED"] = "api_key.created";
    AuditAction["API_KEY_REVOKED"] = "api_key.revoked";
    AuditAction["SESSION_CREATED"] = "session.created";
    AuditAction["SESSION_QR_REQUESTED"] = "session.qr.requested";
    AuditAction["MESSAGE_QUEUED"] = "message.queued";
})(AuditAction || (exports.AuditAction = AuditAction = {}));
//# sourceMappingURL=index.js.map