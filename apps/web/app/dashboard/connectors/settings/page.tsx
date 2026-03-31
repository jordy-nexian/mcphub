import { PageHeader } from "../../../../components/page-header";
import { WorkspaceConsole } from "../../../../components/workspace-console";

export default async function ConnectorSettingsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = props.searchParams ? await props.searchParams : undefined;
  const provider = typeof searchParams?.provider === "string" ? searchParams.provider : undefined;

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Customer Workspace"
        title="Connector settings"
        description="Store tenant-specific API URLs, redirect URIs, scopes, and secrets without crowding the main connectors catalogue."
      />
      <WorkspaceConsole mode="settings" initialSelectedConnector={provider} />
    </div>
  );
}
