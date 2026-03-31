import { z } from "zod";

export const bearerTokenSchema = z.string().min(20);

export const connectorInstallSchema = z.object({
  provider: z.enum(["halopsa", "microsoft365", "hubspot", "itglue", "ninjaone", "cipp", "n8n"]),
  tenantId: z.string().min(1),
  userId: z.string().min(1)
});

export const apiKeySecretSchema = z.object({
  apiKey: z.string().min(8)
});
