import { PageHeader } from "../../../components/page-header";
import { WorkspaceConsole } from "../../../components/workspace-console";

export default function ConnectorsPage() {
  return (
    <div className="stack">
      <PageHeader
        eyebrow="Customer Workspace"
        title="Connected products"
        description="Choose a connector to configure credentials, launch OAuth, and manage tenant-specific integrations."
      />
      <WorkspaceConsole mode="catalog" />
    </div>
  );
}
