import { PageHeader } from "../../../components/page-header";
import { McpAccessPanel } from "../../../components/mcp-access-panel";

export default function McpPage() {
  return (
    <div className="stack">
      <PageHeader
        eyebrow="MCP Access"
        title="Endpoint and bearer access"
        description="Use the customer workspace endpoint to route approved tools into downstream AI clients."
      />
      <McpAccessPanel />
    </div>
  );
}
