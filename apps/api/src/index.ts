import Fastify from "fastify";

import { buildAppConfig } from "./common/config/env";
import { ensureDatabaseSchema } from "./common/db/postgres";
import { AuditService } from "./modules/audit/audit.service";
import { AuthService } from "./modules/auth/auth.service";
import { ConnectorService } from "./modules/connectors/connector.service";
import { registerApiRoutes } from "./modules/mcp/routes";

const config = buildAppConfig();
const app = Fastify({ logger: true });

const auditService = new AuditService();
const authService = new AuthService();
const connectorService = new ConnectorService(auditService);

registerApiRoutes(app, { authService, connectorService, auditService, config });

await ensureDatabaseSchema();

app.listen({ host: "0.0.0.0", port: config.port }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
