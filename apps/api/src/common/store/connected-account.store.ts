import fs from "node:fs/promises";
import path from "node:path";

import type { ConnectedAccountRecord, ProviderName } from "@nexian/core/domain/models";

type StoredConnectedAccount = Omit<ConnectedAccountRecord, "createdAt" | "updatedAt" | "expiresAt"> & {
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
};

interface StoreShape {
  connectedAccounts: StoredConnectedAccount[];
}

const defaultStore: StoreShape = {
  connectedAccounts: []
};

export class ConnectedAccountStore {
  constructor(private readonly filePath: string) {}

  static createDefault() {
    return new ConnectedAccountStore(path.resolve(process.cwd(), "../../data/connected-accounts.json"));
  }

  private async readStore(): Promise<StoreShape> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return JSON.parse(raw) as StoreShape;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.writeFile(this.filePath, JSON.stringify(defaultStore, null, 2), "utf8");
        return defaultStore;
      }
      throw error;
    }
  }

  private async writeStore(store: StoreShape): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(store, null, 2), "utf8");
  }

  private hydrate(record: StoredConnectedAccount): ConnectedAccountRecord {
    return {
      ...record,
      expiresAt: record.expiresAt ? new Date(record.expiresAt) : undefined,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt)
    };
  }

  private serialize(record: ConnectedAccountRecord): StoredConnectedAccount {
    return {
      ...record,
      expiresAt: record.expiresAt?.toISOString(),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString()
    };
  }

  async upsert(account: ConnectedAccountRecord): Promise<ConnectedAccountRecord> {
    const store = await this.readStore();
    const existingIndex = store.connectedAccounts.findIndex(
      (candidate) =>
        candidate.tenantId === account.tenantId &&
        candidate.userId === account.userId &&
        candidate.provider === account.provider
    );
    const nextRecord = this.serialize(account);

    if (existingIndex >= 0) {
      store.connectedAccounts[existingIndex] = nextRecord;
    } else {
      store.connectedAccounts.push(nextRecord);
    }

    await this.writeStore(store);
    return account;
  }

  async findByTenantUser(tenantId: string, userId: string): Promise<ConnectedAccountRecord[]> {
    const store = await this.readStore();
    return store.connectedAccounts
      .filter((candidate) => candidate.tenantId === tenantId && candidate.userId === userId)
      .map((candidate) => this.hydrate(candidate));
  }

  async disconnect(tenantId: string, userId: string, provider: ProviderName): Promise<void> {
    const store = await this.readStore();
    store.connectedAccounts = store.connectedAccounts.filter(
      (candidate) => !(candidate.tenantId === tenantId && candidate.userId === userId && candidate.provider === provider)
    );
    await this.writeStore(store);
  }
}

