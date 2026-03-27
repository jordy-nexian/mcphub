import { z } from "zod";

import type { ConnectedAccountRecord, ProviderName, TokenPair, ToolExecutionContext } from "../domain/models";

export const oauthProviderConfigSchema = z.object({
  authorizationUrl: z.string().url(),
  tokenUrl: z.string().url(),
  scopes: z.array(z.string()).min(1),
  redirectUri: z.string().url()
});

export type OAuthProviderConfig = z.infer<typeof oauthProviderConfigSchema>;

export interface ConnectorToolDefinition<TInput = any, TOutput = any> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  execute: (context: ToolExecutionContext, input: TInput) => Promise<TOutput>;
}

export interface ProviderAdapter {
  provider: ProviderName;
  displayName: string;
  supportsOAuth: boolean;
  oauthConfig?: OAuthProviderConfig;
  getAuthorizationUrl?(state: string): string;
  exchangeCode?(code: string): Promise<TokenPair>;
  refreshToken?(account: ConnectedAccountRecord, refreshToken: string): Promise<TokenPair>;
  revoke?(account: ConnectedAccountRecord): Promise<void>;
  getTools(): ConnectorToolDefinition<any, any>[];
}
