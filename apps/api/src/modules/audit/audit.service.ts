export interface AuditEventInput {
  tenantId: string;
  userId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

export class AuditService {
  async log(event: AuditEventInput): Promise<void> {
    console.info("audit", JSON.stringify(event));
  }
}

