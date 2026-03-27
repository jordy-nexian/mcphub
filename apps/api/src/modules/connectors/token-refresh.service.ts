import type Redis from "ioredis";

import type { ProviderAdapter } from "@nexian/core/connectors/contracts";
import type { ConnectedAccountRecord } from "@nexian/core/domain/models";
import { TokenEncryptionService } from "@nexian/core/security/encryption";

export class TokenRefreshService {
  constructor(
    private readonly redis: Redis | undefined,
    private readonly encryption: TokenEncryptionService
  ) {}

  async refreshIfNeeded(account: ConnectedAccountRecord, adapter: ProviderAdapter): Promise<ConnectedAccountRecord> {
    if (!account.expiresAt || account.expiresAt.getTime() > Date.now() + 60_000) {
      return account;
    }

    if (!account.refreshTokenEncrypted || !adapter.refreshToken) {
      throw new Error(`No refresh path configured for ${account.provider}`);
    }

    const lockKey = `refresh-lock:${account.id}`;
    const lockAcquired = this.redis ? await this.redis.set(lockKey, "1", "EX", 30, "NX") : "OK";
    if (!lockAcquired) {
      throw new Error(`Refresh already in progress for account ${account.id}`);
    }

    try {
      const refreshToken = this.encryption.decrypt(account.refreshTokenEncrypted);
      const tokens = await adapter.refreshToken(account, refreshToken);
      return {
        ...account,
        accessTokenEncrypted: this.encryption.encrypt(tokens.accessToken),
        refreshTokenEncrypted: tokens.refreshToken
          ? this.encryption.encrypt(tokens.refreshToken)
          : account.refreshTokenEncrypted,
        expiresAt: tokens.expiresAt ?? account.expiresAt,
        status: "ACTIVE",
        lastError: undefined
      };
    } catch (error) {
      return {
        ...account,
        status: "ERROR",
        lastError: error instanceof Error ? error.message : "Unknown refresh error"
      };
    } finally {
      if (this.redis) {
        await this.redis.del(lockKey);
      }
    }
  }
}

