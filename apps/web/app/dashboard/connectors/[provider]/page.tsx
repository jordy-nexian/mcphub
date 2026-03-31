import { notFound } from "next/navigation";

import { PageHeader } from "../../../../components/page-header";
import { WorkspaceConsole } from "../../../../components/workspace-console";

const providers = new Set(["halopsa", "microsoft365", "ninjaone", "cipp", "n8n"]);

export default async function ConnectorDetailPage(props: {
  params: Promise<{ provider: string }>;
}) {
  const params = await props.params;
  if (!providers.has(params.provider)) {
    notFound();
  }

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Customer Workspace"
        title="Connector configuration"
        description="Manage tenant-specific credentials, redirect URIs, and live connection state for the selected integration."
      />
      <WorkspaceConsole mode="detail" initialSelectedConnector={params.provider} />
    </div>
  );
}
