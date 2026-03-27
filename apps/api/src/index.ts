import Fastify from "fastify";

import { buildAppConfig } from "./common/config/env";
import { AuditService } from "./modules/audit/audit.service";
import { ConnectorService } from "./modules/connectors/connector.service";
import { registerApiRoutes } from "./modules/mcp/routes";

const config = buildAppConfig();
const app = Fastify({ logger: true });

const auditService = new AuditService();
const connectorService = new ConnectorService(auditService);

registerApiRoutes(app, { connectorService, auditService, config });

app.listen({ host: "0.0.0.0", port: config.port }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
