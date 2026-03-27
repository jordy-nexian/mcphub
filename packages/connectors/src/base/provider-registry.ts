import type { ProviderAdapter } from "@nexian/core/connectors/contracts";

import { haloPsaAdapter } from "../halopsa/adapter";
import { hubspotAdapter } from "../hubspot/adapter";
import { itGlueAdapter } from "../itglue/adapter";
import { microsoft365Adapter } from "../microsoft365/adapter";

const providers = [haloPsaAdapter, microsoft365Adapter, hubspotAdapter, itGlueAdapter];

export function getProviderRegistry(): Map<string, ProviderAdapter> {
  return new Map(providers.map((provider) => [provider.provider, provider]));
}

